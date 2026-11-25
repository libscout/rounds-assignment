export const namedEntities: Record<string, string> = {
  amp: '&',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
};
export const entityReferences =
  /&(?:amp;)*(nbsp(?:;|(?![a-z\d=]))|(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);)/gi;

export const currencyCodes: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
};
