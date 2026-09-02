/**
 * The custom-card pack code is written to an RFID card with an 8-byte field.
 *
 * Length is the whole point of the format, so it is asserted on every case
 * rather than only on the shape: a 9-character code would still look valid,
 * still parse, and resolve to the wrong child once the card truncated it.
 */

'use strict';

const { packCodeForKid } = require('../../src/utils/helpers');

describe('packCodeForKid', () => {
  it('is exactly 8 characters for every id it accepts', () => {
    for (const id of [0, 1, 29, 999, 1000, 99999, 999999]) {
      expect(packCodeForKid(id)).toHaveLength(8);
    }
  });

  it('zero-pads to a fixed width so the card layout never shifts', () => {
    expect(packCodeForKid(29)).toBe('CK000029');
    expect(packCodeForKid(1)).toBe('CK000001');
    expect(packCodeForKid(999999)).toBe('CK999999');
  });

  it('accepts the id as number, string or bigint', () => {
    expect(packCodeForKid(29)).toBe('CK000029');
    expect(packCodeForKid('29')).toBe('CK000029');
    expect(packCodeForKid(29n)).toBe('CK000029');
  });

  it('matches the pattern rfid.service parses back to a kid id', () => {
    // Kept in step with the regex in the custom-pack query: a change here that
    // is not made there stops every custom pack resolving, silently.
    const parse = /^CK([0-9]{6})$/;
    const match = packCodeForKid(29).match(parse);
    expect(match).not.toBeNull();
    expect(BigInt(match[1])).toBe(29n);
  });

  it('refuses an id too large to fit, rather than emitting 9 characters', () => {
    // Truncation is the dangerous failure: CK1000000 cut to 8 becomes CK100000,
    // which is a valid code belonging to a different child.
    expect(() => packCodeForKid(1000000)).toThrow(/999999/);
    expect(() => packCodeForKid(-1)).toThrow();
  });
});
