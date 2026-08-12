/**
 * The owner key is the whole of 003's correctness argument, so it gets its own
 * test rather than only being exercised through the services that use it.
 *
 * The claim: a row stamped `kid:123` is unreachable from a `mac:` lookup, so a
 * toy handed to a sibling before the parent picks a child cannot read the
 * previous child's workspace or memory. That has to hold as a property of the
 * key itself, not of any caller remembering a guard.
 */

const { ownerKeyForDevice } = require('../../src/utils/helpers');

describe('ownerKeyForDevice', () => {
  it('resolves a paired device to its child, ignoring the MAC', () => {
    expect(ownerKeyForDevice({ kid_id: 77n, mac_address: 'AA:BB:CC:DD:EE:FF' }))
      .toBe('kid:77');
  });

  it('gives the same key on a different toy, which is the point', () => {
    const onOldToy = ownerKeyForDevice({ kid_id: 77n, mac_address: 'AA:BB:CC:DD:EE:FF' });
    const onNewToy = ownerKeyForDevice({ kid_id: 77n, mac_address: '11:22:33:44:55:66' });

    expect(onNewToy).toBe(onOldToy);
  });

  it('falls back to the MAC namespace when no child is paired', () => {
    expect(ownerKeyForDevice({ kid_id: null, mac_address: 'AA:BB:CC:DD:EE:FF' }))
      .toBe('mac:aa:bb:cc:dd:ee:ff');
  });

  it('normalizes the MAC so casing and separators cannot split a device in two', () => {
    const spellings = ['AA:BB:CC:DD:EE:FF', 'aa:bb:cc:dd:ee:ff', 'aabbccddeeff'];
    const keys = new Set(spellings.map((mac) => ownerKeyForDevice({ mac_address: mac })));

    expect(keys.size).toBe(1);
  });

  it('never lets a MAC key collide with a child key', () => {
    const childKey = ownerKeyForDevice({ kid_id: 77n, mac_address: 'AA:BB:CC:DD:EE:FF' });
    const deviceKey = ownerKeyForDevice({ kid_id: null, mac_address: 'AA:BB:CC:DD:EE:FF' });

    // The sibling hand-me-down leak is impossible because these two strings
    // cannot be equal, not because a query remembered to exclude one.
    expect(childKey).not.toBe(deviceKey);
    expect(deviceKey.startsWith('mac:')).toBe(true);
    expect(childKey.startsWith('kid:')).toBe(true);
  });

  it('refuses to invent a key for a device with neither a child nor a usable MAC', () => {
    expect(() => ownerKeyForDevice({ kid_id: null, mac_address: 'not-a-mac' })).toThrow();
    expect(() => ownerKeyForDevice({})).toThrow();
  });
});
