'use strict';

/**
 * A game card is logged as `game`, not `content`. Both classifiers — the
 * mapping-based one and the lookup-fallback one — must agree, or the tap
 * analytics tab shows the same card under two names depending on which path
 * the gateway happened to take.
 */

jest.mock('../../src/config/database', () => ({ prisma: { $queryRaw: jest.fn() } }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
jest.mock('../../src/services/upload.service', () => ({}));
jest.mock('../../src/services/contentKeys.service', () => ({ isEnabled: () => false }));

const { determineTapCardType, classifyLookupCardType } = require('../../src/services/rfid.service');

describe('determineTapCardType', () => {
  it('is game when card_type says so', () => {
    expect(determineTapCardType({ card_type: 'game', content_pack_id: BigInt(9) })).toBe('game');
  });
  it('is game when the linked pack is a sound_quiz even if card_type is null', () => {
    expect(determineTapCardType({
      card_type: null, content_pack_id: BigInt(9), rfid_content_pack: { content_type: 'sound_quiz' }
    })).toBe('game');
  });
  it('is still content for an ordinary pack', () => {
    expect(determineTapCardType({
      card_type: null, content_pack_id: BigInt(9), rfid_content_pack: { content_type: 'story_pack' }
    })).toBe('content');
  });
  it('ai still wins over everything', () => {
    expect(determineTapCardType({ card_type: 'ai', content_pack_id: BigInt(9) })).toBe('ai');
  });
});

describe('classifyLookupCardType', () => {
  it('is game for a sound_quiz lookup', () => {
    expect(classifyLookupCardType({ contentType: 'sound_quiz', appId: 'hometown' })).toBe('game');
  });
  it('keeps the existing answers', () => {
    expect(classifyLookupCardType(null)).toBe('unknown');
    expect(classifyLookupCardType({ agentName: 'Tara' })).toBe('ai');
    expect(classifyLookupCardType({ contentType: 'prompt_pack' })).toBe('qna');
    expect(classifyLookupCardType({ contentType: 'story_pack' })).toBe('content');
    expect(classifyLookupCardType({ contentType: 'prompt' })).toBe('prompt');
  });
});
