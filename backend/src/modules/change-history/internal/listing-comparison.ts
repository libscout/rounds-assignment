import {
  ChangeKind,
  ObservationKind,
  type ChangedFields,
  type ListingDiff,
  type Observation,
} from '../types';

const entities: Record<string, string> = {
  amp: '&',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
};
const currencies: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

function text(value: string): string {
  return value
    .replace(/&(amp|nbsp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (raw: string, entity: string) => {
      const key = entity.toLowerCase();
      if (key in entities) return entities[key];
      const point = key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : raw;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function price(value: string): string {
  const input = text(value);
  if (/^free( forever)?$/i.test(input)) return 'free';
  const match = /^(USD|EUR|GBP|\$|€|£)\s*(\d+(?:\.\d+)?)\s*(?:\/|per\s+)(.+)$/i.exec(input);
  if (!match) return input;
  const currency = currencies[match[1]] ?? match[1].toUpperCase();
  const amount = match[2].replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const period = match[3]
    .trim()
    .toLowerCase()
    .replace(/\s*(?:\/|\bper\b)\s*/g, '/')
    .replace(/\bmo\b/g, 'month')
    .replace(/\byr\b/g, 'year');
  return amount === '0' && ['month', 'year'].includes(period)
    ? 'free'
    : currency + ' ' + amount + '/' + period;
}

export function compareListing(observation: Observation): ListingDiff | null {
  const { current, previousFields, previouslyVisible } = observation;
  if (!previousFields || current.kind === ObservationKind.Inconclusive) return null;
  if (current.kind !== ObservationKind.Complete) {
    return previouslyVisible ? { kind: ChangeKind.Disappeared, changedFields: {} } : null;
  }
  const changedFields: ChangedFields = {};
  for (const key of ['title', 'tagline', 'price', 'description'] as const) {
    const normalize = key === 'price' ? price : text;
    const from = previousFields[key],
      to = current.fields[key];
    if (normalize(from) !== normalize(to)) changedFields[key] = { from, to };
  }
  if (previouslyVisible === false) return { kind: ChangeKind.Returned, changedFields };
  return Object.keys(changedFields).length
    ? { kind: ChangeKind.ContentChanged, changedFields }
    : null;
}
