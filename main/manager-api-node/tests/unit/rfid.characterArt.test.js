'use strict';

/**
 * Character conversation artwork on an AI card.
 *
 * The device shows a different picture while connecting, listening, thinking and
 * talking, and gets the four URLs from this lookup. Everything asserted here is
 * a rule whose breach is invisible from the server: the toy just draws the wrong
 * face, or none, with nothing logged between the admin and the child.
 */

const mockPrisma = {
  $queryRaw: jest.fn(),
  rfid_card_mapping: { findFirst: jest.fn() },
  rfid_series: { findFirst: jest.fn() },
  custom_card: { findFirst: jest.fn() },
  ai_device: { findFirst: jest.fn() },
  ai_agent_template: { findFirst: jest.fn() },
  rfid_content_pack: { findFirst: jest.fn() }
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
jest.mock('../../src/services/upload.service', () => ({}));

const rfidService = require('../../src/services/rfid.service');

const UID = '04A1B2C3';
const AGENT = 'Cheeko';

const ART = {
  sd_folder: 'cheeko',
  art_version: 3,
  art_connect_url: 'https://cdn.example/chars/cheeko/v3/connect.bin',
  art_listen_url: 'https://cdn.example/chars/cheeko/v3/listen.bin',
  art_think_url: 'https://cdn.example/chars/cheeko/v3/think.bin',
  art_talk_url: 'https://cdn.example/chars/cheeko/v3/talk.bin'
};

/** An AI card resolved through a bulk range, which is how the shipped cards go. */
const aiSeries = (agentName) => ({
  id: BigInt(9),
  card_type: 'ai',
  notes: 'AI Card',
  action_data: agentName ? { agent_name: agentName } : {}
});

const lookup = () => rfidService.lookupCardByUid(UID);

beforeEach(() => {
  jest.clearAllMocks();
  // Column probes hit information_schema; nothing else in this suite uses raw SQL.
  mockPrisma.$queryRaw.mockResolvedValue([]);
  mockPrisma.rfid_card_mapping.findFirst.mockResolvedValue(null);
  mockPrisma.rfid_series.findFirst.mockResolvedValue(aiSeries(AGENT));
  mockPrisma.ai_agent_template.findFirst.mockResolvedValue(ART);
});

describe('character artwork on an AI card', () => {
  it('returns the four state sprites and the version', async () => {
    const result = await lookup();

    expect(result.character).toEqual({
      folder: 'cheeko',
      version: 3,
      assets: [
        { state: 'connect', url: ART.art_connect_url },
        { state: 'listen', url: ART.art_listen_url },
        { state: 'think', url: ART.art_think_url },
        { state: 'talk', url: ART.art_talk_url }
      ]
    });
  });

  it('matches the character name case-insensitively', async () => {
    mockPrisma.rfid_series.findFirst.mockResolvedValue(aiSeries('cheeko'));

    await lookup();

    // agent_name is capitalised for most characters ("Cheeko", "Tara") but not
    // all ("quizzy"), and the name on the card is free text. An exact match
    // would silently give the character no face.
    expect(mockPrisma.ai_agent_template.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { agent_name: { equals: 'cheeko', mode: 'insensitive' } }
      })
    );
  });

  it.each(['art_connect_url', 'art_listen_url', 'art_think_url', 'art_talk_url'])(
    'omits the artwork entirely when %s is missing',
    async (missing) => {
      mockPrisma.ai_agent_template.findFirst.mockResolvedValue({ ...ART, [missing]: null });

      const result = await lookup();

      // All four or nothing. A half-populated folder is a character that loses
      // its face partway through talking, which reads as a crash rather than as
      // missing content — the firmware drops a short set for the same reason.
      expect(result.character).toBeNull();
      expect(result.agentName).toBe(AGENT);
    }
  );

  it('omits the artwork when the character has no SD folder', async () => {
    mockPrisma.ai_agent_template.findFirst.mockResolvedValue({ ...ART, sd_folder: null });

    // Without a folder the device has nowhere to store the sprites, so the URLs
    // are unusable even though all four are present.
    expect((await lookup()).character).toBeNull();
  });

  it('defaults a missing version to 1 rather than dropping the artwork', async () => {
    mockPrisma.ai_agent_template.findFirst.mockResolvedValue({ ...ART, art_version: null });

    expect((await lookup()).character.version).toBe(1);
  });

  it('does not look up artwork for a card with no character', async () => {
    mockPrisma.rfid_series.findFirst.mockResolvedValue(aiSeries(null));

    const result = await lookup();

    expect(result.character).toBeNull();
    expect(mockPrisma.ai_agent_template.findFirst).not.toHaveBeenCalled();
  });

  it('still resolves the card when the artwork lookup throws', async () => {
    mockPrisma.ai_agent_template.findFirst.mockRejectedValue(new Error('connection lost'));

    const result = await lookup();

    // Artwork is an enhancement. A failure here must not stop a child talking to
    // the character — the conversation runs with the drawn face instead.
    expect(result).not.toBeNull();
    expect(result.agentName).toBe(AGENT);
    expect(result.character).toBeNull();
  });

  it('returns no character for a card that is not an AI card', async () => {
    mockPrisma.rfid_series.findFirst.mockResolvedValue({
      id: BigInt(9),
      card_type: 'content',
      rfid_question: { id: BigInt(1), title: 'A question', prompt_text: 'Ask away' }
    });

    const result = await lookup();

    expect(result.character).toBeUndefined();
    expect(mockPrisma.ai_agent_template.findFirst).not.toHaveBeenCalled();
  });
});
