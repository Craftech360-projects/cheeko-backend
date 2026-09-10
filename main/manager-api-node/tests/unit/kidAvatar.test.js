'use strict';

const { isKidAvatarUrl, kidAvatarOrNull } = require('../../src/utils/kidAvatar');

const CDN = 'https://dsmzc13oafp54.cloudfront.net';
const OWN = `${CDN}/kids/avatars/12-abc.jpg`;

describe('kid avatar URLs', () => {
  it('accepts a photo uploaded through the avatar route', () => {
    expect(isKidAvatarUrl(OWN)).toBe(true);
    expect(kidAvatarOrNull(OWN)).toBe(OWN);
  });

  it.each([
    // What Rahul's profile held: an Adobe Stock preview, not his photo.
    ['a stock-photo URL', 'https://t4.ftcdn.net/jpg/14/24/51/47/240_F_1424514793_85CPo5TDaV9OnDuAgxcxoloROK0NFWlv.jpg'],
    ['another folder on our CDN', `${CDN}/rfidcontent/voicecards/vc.jpg`],
    ['a prefix-escaping key', `${CDN}/kids/avatars/../../music/cover.jpg`],
    ['our path on a different host', 'https://evil.example.com/kids/avatars/12-abc.jpg'],
    ['a host that only starts like ours', 'https://dsmzc13oafp54.cloudfront.net.evil.com/kids/avatars/12-abc.jpg'],
    ['null', null],
    ['empty', ''],
    ['a non-string', 42],
  ])('rejects %s', (_label, url) => {
    expect(isKidAvatarUrl(url)).toBe(false);
    expect(kidAvatarOrNull(url)).toBeNull();
  });
});
