import type { Field, Snapshot } from './api';
import { displayText } from './displayText';
import { currencyCodes } from './consts/listing-text.const';
import { fieldLabels, outcomes } from './consts/timeline-labels.const';

/** Extracts the amount, currency and billing period used to compare two price strings. */
function comparablePrice(value: string) {
  const match =
    /^(USD|EUR|GBP|[$€£])\s*(\d+(?:\.\d+)?)\s*(?:(?:\/|per )\s*(.+))?$/i.exec(
      displayText(value).trim(),
    );
  if (!match) {
    return null;
  }
  const period = (match[3] ?? '')
    .toLowerCase()
    .replace(/\bmo\b/g, 'month')
    .replace(/\byr\b/g, 'year')
    .replace(/\s*\/\s*|\s+per\s+/g, '/');

  return {
    amount: Number(match[2]),
    unit: (currencyCodes[match[1]] ?? match[1].toUpperCase()) + '/' + period,
  };
}

/** Names the detected listing change, including the direction of comparable price changes. */
export function changeTitle(poll: Snapshot) {
  if (poll.changeKind === 'returned') {
    return 'Listing returned';
  }
  if (poll.changeKind === 'disappeared') {
    return 'Listing disappeared';
  }
  const fields = Object.keys(poll.changedFields) as Field[];
  if (fields.length !== 1) {
    return 'Listing updated';
  }
  const price = poll.changedFields.price;
  if (!price) {
    return fieldLabels[fields[0]] + ' updated';
  }
  const before = comparablePrice(price.from);
  const after = comparablePrice(price.to);
  if (before && after && before.unit === after.unit) {
    if (after.amount > before.amount) {
      return 'Price increased';
    }
    if (after.amount < before.amount) {
      return 'Price decreased';
    }
  }

  return 'Price changed';
}

/** Selects the timeline title, badge and tone for the poll's outcome and detected change. */
export function pollStatus(poll: Snapshot) {
  const status = outcomes[poll.outcomeKind];
  if (!poll.changed) {
    return status;
  }
  if (poll.changeKind === 'content_changed') {
    return { title: changeTitle(poll), badge: 'Changed', tone: 'blue' };
  }

  return { ...status, title: changeTitle(poll) };
}
