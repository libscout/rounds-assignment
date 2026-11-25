import type { Field, Snapshot } from '../api';

export const fieldLabels = {
  title: 'Title',
  tagline: 'Tagline',
  price: 'Price',
  description: 'Description',
} satisfies Record<Field, string>;

export const outcomes = {
  complete: { title: 'Listing observed', badge: 'Available', tone: 'green' },
  missing: { title: 'Listing unavailable', badge: 'HTTP 404', tone: 'amber' },
  partial: { title: 'Incomplete listing', badge: 'Partial', tone: 'amber' },
  rate_limited: {
    title: 'Source rate limit reached',
    badge: 'HTTP 429',
    tone: 'amber',
  },
  upstream_error: {
    title: 'Source returned an error',
    badge: 'Server error',
    tone: 'red',
  },
  timeout: { title: 'Listing request timed out', badge: 'Timeout', tone: 'red' },
  transport_error: {
    title: 'Could not reach the source',
    badge: 'Connection error',
    tone: 'red',
  },
  invalid_response: {
    title: 'Source returned an invalid listing',
    badge: 'Invalid response',
    tone: 'red',
  },
  interrupted: {
    title: 'Listing check interrupted',
    badge: 'Interrupted',
    tone: 'red',
  },
} satisfies Record<
  Snapshot['outcomeKind'],
  { title: string; badge: string; tone: string }
>;

export const summaryStatuses = {
  not_applicable: { label: 'Not requested', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'blue' },
  unavailable: { label: 'Summary unavailable', tone: 'amber' },
  ready: { label: 'Ready', tone: 'green' },
  timeout: { label: 'Timed out', tone: 'red' },
  invalid_output: { label: 'Unusable response', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
  budget_exhausted: { label: 'Daily limit reached', tone: 'amber' },
} satisfies Record<Snapshot['summaryStatus'], { label: string; tone: string }>;

export const listingFields = Object.keys(fieldLabels) as Field[];
