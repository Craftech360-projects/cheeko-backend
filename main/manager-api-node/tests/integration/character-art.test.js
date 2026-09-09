/**
 * Character artwork over the wire.
 *
 * The conversion and the all-four-or-nothing rule are unit-tested elsewhere.
 * What only an HTTP request exercises is the part covered here: that a
 * multipart field named after a conversation state reaches the service as that
 * state, that a non-PNG is refused before ffmpeg is spent on it, and that the
 * sentences an operator is shown say what went wrong.
 *
 * S3 and the database are stubbed. A test that put objects in a real bucket
 * could not be run twice, and each run would bump a real character's version.
 */

'use strict';

const TEMPLATE_ID = '11111111-2222-3333-4444-555555555555';

jest.mock('../../src/middleware/auth', () => ({
  ...jest.requireActual('../../src/middleware/auth'),
  requireAuth: (req, res, next) => { req.user = { id: 1 }; next(); }
}));

// Real ffmpeg is covered in tests/unit/characterArt.encoder.test.js; here the
// PNG fixture is a magic-byte header, so the converter has to be stubbed.
jest.mock('../../src/utils/lvglImage', () => ({
  ...jest.requireActual('../../src/utils/lvglImage'),
  toLvglRgb565A8Bin: jest.fn(async () => Buffer.alloc(213132))
}));

const mockUpload = {
  uploadCharacterArt: jest.fn(async (bin, folder, version, state) => ({
    s3Key: `chars/${folder}/v${version}/${state}.bin`,
    url: `https://cdn.test/chars/${folder}/v${version}/${state}.bin`
  }))
};

jest.mock('../../src/services/upload.service', () => ({
  ...jest.requireActual('../../src/services/upload.service'),
  ...mockUpload
}));

// Disabled by default (matches no CONTENT_MASTER_KEY set), so the existing
// tests above see the same plaintext behaviour they did before this mock
// existed. Individual tests below turn it on to check the sealKey wiring.
const mockContentKeys = {
  isEnabled: jest.fn(() => false),
  getOrCreateCharacterKey: jest.fn(async () => null)
};
jest.mock('../../src/services/contentKeys.service', () => mockContentKeys);

// A real config/database import builds a live pg Pool and Supabase client
// against whatever DATABASE_URL/.env this process has — this suite only ever
// wants the three ai_agent_template methods it spies on below.
jest.mock('../../src/config/database', () => ({
  prisma: {
    ai_agent_template: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn()
    }
  }
}));

const request = require('supertest');
const app = require('../../src/app');
const { prisma } = require('../../src/config/database');

const BASE = `/toy/agent/template/${TEMPLATE_ID}/art`;
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64)]);
const JPEG = Buffer.concat([Buffer.from('ffd8ff', 'hex'), Buffer.alloc(64)]);

const template = (overrides = {}) => ({
  agent_name: 'Cheeko',
  sd_folder: 'cheeko',
  art_version: 1,
  art_connect_url: 'https://cdn.test/chars/cheeko/v1/connect.bin',
  art_listen_url: 'https://cdn.test/chars/cheeko/v1/listen.bin',
  art_think_url: 'https://cdn.test/chars/cheeko/v1/think.bin',
  art_talk_url: 'https://cdn.test/chars/cheeko/v1/talk.bin',
  ...overrides
});

let written = null;

beforeEach(() => {
  jest.clearAllMocks();
  written = null;
  jest.spyOn(prisma.ai_agent_template, 'findUnique').mockResolvedValue(template());
  jest.spyOn(prisma.ai_agent_template, 'update').mockImplementation(async ({ data }) => {
    written = data;
    return {};
  });
});

afterEach(() => jest.restoreAllMocks());

describe('POST /agent/template/:id/art', () => {
  it('stores each part under the state its field name says', async () => {
    const res = await request(app)
      .post(BASE)
      .attach('connect', PNG, 'connect.png')
      .attach('talk', PNG, 'talk.png');

    expect(res.status).toBe(200);
    expect(res.body.code).toBe(0);

    // A field name is the only thing saying which of the four a picture is;
    // pairing it by arrival order would silently give a character the wrong face
    // in the wrong state.
    const states = mockUpload.uploadCharacterArt.mock.calls.map(([, , , state]) => state);
    expect(states.sort()).toEqual(['connect', 'talk']);
  });

  it('bumps the version and writes the new URLs, leaving untouched states alone', async () => {
    await request(app).post(BASE).attach('talk', PNG, 'talk.png');

    // Every upload bumps: the toy keeps the sprite folder across taps and only
    // re-downloads when the version changes.
    expect(written.art_version).toBe(2);
    expect(written.art_talk_url).toBe('https://cdn.test/chars/cheeko/v2/talk.bin');
    // The three that were not re-uploaded keep pointing at v1's objects, which
    // are still on the CDN. A mixed-version set is fine — the URLs are absolute.
    expect(written.art_connect_url).toBeUndefined();
    expect(mockUpload.uploadCharacterArt).toHaveBeenCalledWith(
      expect.any(Buffer), 'cheeko', 2, 'talk', { sealKey: null }
    );
  });

  it('refuses a character whose set would still be incomplete', async () => {
    jest.spyOn(prisma.ai_agent_template, 'findUnique')
      .mockResolvedValue(template({ art_listen_url: null, art_think_url: null }));

    const res = await request(app).post(BASE).attach('listen', PNG, 'listen.png');

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/think/);
    // Nothing is written: a row with three of four faces is a character that
    // loses its face partway through talking.
    expect(written).toBeNull();
  });

  it('refuses artwork for a character with no SD folder', async () => {
    jest.spyOn(prisma.ai_agent_template, 'findUnique')
      .mockResolvedValue(template({ sd_folder: null }));

    const res = await request(app).post(BASE).attach('connect', PNG, 'connect.png');

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/SD folder/i);
    expect(mockUpload.uploadCharacterArt).not.toHaveBeenCalled();
  });

  it('refuses a non-PNG before spending a conversion on it', async () => {
    const res = await request(app).post(BASE).attach('connect', JPEG, 'connect.jpg');

    // PNG is the only format here that carries the alpha channel the panel
    // composites the sprite with.
    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/PNG/);
    expect(mockUpload.uploadCharacterArt).not.toHaveBeenCalled();
  });

  it('refuses a field name that is not one of the four states', async () => {
    const res = await request(app).post(BASE).attach('shouting', PNG, 'x.png');

    expect(res.status).toBe(400);
    expect(mockUpload.uploadCharacterArt).not.toHaveBeenCalled();
  });

  it('refuses a request with no files at all', async () => {
    const res = await request(app).post(BASE).field('note', 'nothing attached');

    expect(res.status).toBe(400);
    expect(res.body.msg).toMatch(/No artwork/i);
  });

  it('404s for a template that does not exist', async () => {
    jest.spyOn(prisma.ai_agent_template, 'findUnique').mockResolvedValue(null);

    const res = await request(app).post(BASE).attach('connect', PNG, 'connect.png');

    expect(res.status).toBe(404);
  });

  // Caller-level coverage for the sealKey wiring: nothing else exercised it
  // reaching uploadCharacterArt at all, so setting the call site to null in
  // updateTemplateArt passed 153/153 tests before this was added.
  it('uploads artwork with the character key as sealKey when encryption is on', async () => {
    const K = Buffer.alloc(16, 3);
    mockContentKeys.isEnabled.mockReturnValueOnce(true);
    mockContentKeys.getOrCreateCharacterKey.mockResolvedValueOnce(K);

    const res = await request(app).post(BASE).attach('talk', PNG, 'talk.png');

    expect(res.status).toBe(200);
    expect(mockContentKeys.getOrCreateCharacterKey).toHaveBeenCalledWith('cheeko');
    const opts = mockUpload.uploadCharacterArt.mock.calls[0][4];
    expect(opts.sealKey).toEqual(K);
  });

  it('uploads with no sealKey when encryption is off', async () => {
    const res = await request(app).post(BASE).attach('talk', PNG, 'talk.png');

    expect(res.status).toBe(200);
    expect(mockContentKeys.getOrCreateCharacterKey).not.toHaveBeenCalled();
    const opts = mockUpload.uploadCharacterArt.mock.calls[0][4];
    expect(opts.sealKey).toBeNull();
  });
});

/**
 * The folder name is the one field an operator types by hand, and the one whose
 * mistakes are invisible: the toy's card is mounted without long-filename
 * support, so a name it cannot store produces no error anywhere between the
 * dashboard and the child. Both writers are checked because both are reachable.
 */
describe('sd_folder validation', () => {
  const VALID = 'newchar';
  const INVALID = ['Cheeko', 'my-char', 'toolongname', 'a b'];

  beforeEach(() => {
    jest.spyOn(prisma.ai_agent_template, 'create').mockResolvedValue({ id: TEMPLATE_ID });
  });

  it.each(INVALID)('refuses "%s" when creating a template', async (folder) => {
    const res = await request(app)
      .post('/toy/agent/template')
      .send({ agentName: 'New Character', systemPrompt: 'Be kind.', sdFolder: folder });

    expect(res.status).toBe(400);
    expect(prisma.ai_agent_template.create).not.toHaveBeenCalled();
  });

  it.each(INVALID)('refuses "%s" when updating a template', async (folder) => {
    const res = await request(app)
      .put(`/toy/agent/template/${TEMPLATE_ID}`)
      .send({ sdFolder: folder });

    expect(res.status).toBe(400);
    expect(written).toBeNull();
  });

  it('stores a valid folder on create', async () => {
    const res = await request(app)
      .post('/toy/agent/template')
      .send({ agentName: 'New Character', systemPrompt: 'Be kind.', sdFolder: VALID });

    expect(res.status).toBe(200);
    expect(prisma.ai_agent_template.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sd_folder: VALID }) })
    );
  });

  it('stores an omitted folder as null rather than an empty string', async () => {
    // '' would satisfy neither the check constraint nor a path built from it,
    // and the column is nullable precisely so a character can exist without art.
    await request(app)
      .post('/toy/agent/template')
      .send({ agentName: 'New Character', systemPrompt: 'Be kind.', sdFolder: '' });

    expect(prisma.ai_agent_template.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sd_folder: null }) })
    );
  });
});
