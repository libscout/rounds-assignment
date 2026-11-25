import { entityReferences, namedEntities } from './consts/listing-text.const';

/** Decode listing text from the source, including previously stored HTML escapes. */
export function displayText(value: string) {
  return value
    .replace(entityReferences, (original: string, reference: string) => {
      const name = reference.toLowerCase().replace(/;$/, '');
      if (name in namedEntities) {
        return namedEntities[name];
      }
      const point = name.startsWith('#x')
        ? parseInt(name.slice(2), 16)
        : Number(name.slice(1));

      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point)
        : original;
    })
    .replace(/\u00a0/g, ' ');
}
