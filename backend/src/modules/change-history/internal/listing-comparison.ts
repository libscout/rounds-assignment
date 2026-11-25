import {
  ChangeKind,
  ObservationKind,
  type ChangedFields,
  type ListingContent,
  type ListingDiff,
  type Observation,
} from '../types';
import { listingFields } from '../consts/listing-fields.const';
import { currencyCodes, htmlEntities } from '../consts/listing-normalization.const';

/** Detects availability and content changes using normalized listing fields. */
export class ListingComparison {
  /** Compares an observation with the latest known listing and returns any meaningful change. */
  static compare(
    observation: Observation & {
      previousFields: ListingContent | null;
      previouslyVisible: boolean;
    },
  ): ListingDiff | null {
    const { current, previousFields, previouslyVisible } = observation;
    if (!previousFields) {
      return null;
    }
    if (current.kind !== ObservationKind.Complete) {
      return previouslyVisible
        ? { kind: ChangeKind.Disappeared, changedFields: {} }
        : null;
    }
    const changedFields = ListingComparison.compareFields(
      previousFields,
      current.fields,
    );
    if (previouslyVisible === false) {
      return { kind: ChangeKind.Returned, changedFields };
    }

    return Object.keys(changedFields).length
      ? { kind: ChangeKind.ContentChanged, changedFields }
      : null;
  }

  /** Compares normalized fields and keeps the original before-and-after values in the diff. */
  private static compareFields(
    previous: ListingContent,
    current: ListingContent,
  ): ChangedFields {
    const changedFields: ChangedFields = {};
    for (const key of listingFields) {
      const from = previous[key];
      const to = current[key];
      if (
        ListingComparison.normalizeField(key, from) !==
        ListingComparison.normalizeField(key, to)
      ) {
        changedFields[key] = { from, to };
      }
    }

    return changedFields;
  }

  /** Normalizes a listing field according to its pricing or text semantics. */
  private static normalizeField(key: keyof ListingContent, value: string): string {
    return key === 'price'
      ? ListingComparison.normalizePrice(value)
      : ListingComparison.normalizeText(value);
  }

  /** Decodes HTML references and collapses whitespace before comparing listing text. */
  private static normalizeText(value: string): string {
    return value
      .replace(
        /&(amp|nbsp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi,
        ListingComparison.decodeEntity,
      )
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Decodes a supported HTML reference and preserves an out-of-range reference. */
  private static decodeEntity(this: void, raw: string, entity: string): string {
    const key = entity.toLowerCase();
    if (key in htmlEntities) {
      return htmlEntities[key];
    }
    const point = key.startsWith('#x')
      ? parseInt(key.slice(2), 16)
      : Number(key.slice(1));

    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : raw;
  }

  /** Normalizes supported currencies, billing periods and free offers for price comparisons. */
  private static normalizePrice(value: string): string {
    const input = ListingComparison.normalizeText(value);
    if (/^free( forever)?$/i.test(input)) {
      return 'free';
    }
    const match = /^(USD|EUR|GBP|\$|€|£)\s*(\d+(?:\.\d+)?)\s*(?:\/|per\s+)(.+)$/i.exec(
      input,
    );
    if (!match) {
      return input;
    }
    const currency = currencyCodes[match[1]] ?? match[1].toUpperCase();
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
}
