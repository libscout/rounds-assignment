import type { Field, Snapshot } from './api'
import { displayText } from './displayText'

export const fieldLabels = {
  title: 'Title', tagline: 'Tagline', price: 'Price', description: 'Description',
} satisfies Record<Field, string>

const outcomes = {
  complete: { title: 'Listing observed', badge: 'Available', tone: 'green' },
  missing: { title: 'Listing unavailable', badge: 'HTTP 404', tone: 'amber' },
  partial: { title: 'Incomplete listing', badge: 'Partial', tone: 'amber' },
  rate_limited: { title: 'Source rate limit reached', badge: 'HTTP 429', tone: 'amber' },
  upstream_error: { title: 'Source returned an error', badge: 'Server error', tone: 'red' },
  timeout: { title: 'Listing request timed out', badge: 'Timeout', tone: 'red' },
  transport_error: { title: 'Could not reach the source', badge: 'Connection error', tone: 'red' },
  invalid_response: { title: 'Source returned an invalid listing', badge: 'Invalid response', tone: 'red' },
  interrupted: { title: 'Listing check interrupted', badge: 'Interrupted', tone: 'red' },
} satisfies Record<Snapshot['outcomeKind'], { title: string, badge: string, tone: string }>

function comparablePrice(value: string) {
  const match = /^(USD|EUR|GBP|[$€£])\s*(\d+(?:\.\d+)?)\s*(?:(?:\/|per )\s*(.+))?$/i.exec(displayText(value).trim())
  if (!match) return null
  const currency: Record<string, string> = { '$': 'USD', '€': 'EUR', '£': 'GBP' }
  const period = (match[3] ?? '').toLowerCase().replace(/\bmo\b/g, 'month').replace(/\byr\b/g, 'year').replace(/\s*\/\s*|\s+per\s+/g, '/')
  return { amount: Number(match[2]), unit: (currency[match[1]] ?? match[1].toUpperCase()) + '/' + period }
}

export function changeTitle(poll: Snapshot) {
  if (poll.changeKind === 'returned') return 'Listing returned'
  if (poll.changeKind === 'disappeared') return 'Listing disappeared'
  const fields = Object.keys(poll.changedFields) as Field[]
  if (fields.length !== 1) return 'Listing updated'
  const price = poll.changedFields.price
  if (!price) return fieldLabels[fields[0]] + ' updated'
  const before = comparablePrice(price.from)
  const after = comparablePrice(price.to)
  if (before && after && before.unit === after.unit) {
    if (after.amount > before.amount) return 'Price increased'
    if (after.amount < before.amount) return 'Price decreased'
  }
  return 'Price changed'
}

export function pollStatus(poll: Snapshot) {
  const status = outcomes[poll.outcomeKind]
  if (!poll.changed) return status
  if (poll.changeKind === 'content_changed') {
    return { title: changeTitle(poll), badge: 'Changed', tone: 'blue' }
  }
  return { ...status, title: changeTitle(poll) }
}

export const summaryStatuses = {
  not_applicable: { label: 'Not requested', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'blue' },
  ready: { label: 'Ready', tone: 'green' },
  timeout: { label: 'Timed out', tone: 'red' },
  invalid_output: { label: 'Unusable response', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
  budget_exhausted: { label: 'Daily limit reached', tone: 'amber' },
} satisfies Record<Snapshot['summaryStatus'], { label: string, tone: string }>
