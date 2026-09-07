'use strict';

/**
 * The catalogue grid's view of rfid_content_pack.
 *
 * A parent's recording lives in the same table as catalogue content: the app
 * mints it a pack row whose code is `CK` + the zero-padded kid id. Nothing on
 * the row says "this is a custom card" — the code shape is the only marker —
 * so the admin grid used to list every child's private recording alongside the
 * packs an operator actually authored.
 *
 * This file pins both halves of the fix: the default page excludes those rows,
 * and asking for them by scope returns only those rows. It reads the generated
 * SQL rather than the result set, because the exclusion IS the query.
 */

const mockPrisma = { $queryRaw: jest.fn() };

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));
jest.mock('../../src/services/integrations/qdrant.service', () => ({}));
jest.mock('../../src/services/upload.service', () => ({}));

const rfidService = require('../../src/services/rfid.service');

const CUSTOM_PATTERN = '^CK[0-9]{6}$';

/**
 * The statements $queryRaw was handed, flattened.
 *
 * The shared WHERE is passed as one nested Prisma.Sql value, so a naive join
 * of the outer template hides every filter. This splices the nested fragments
 * back in, which is what the driver does before it reaches Postgres.
 */
const flatten = (strings, values) => {
  let sql = '';
  const flatValues = [];
  strings.forEach((chunk, i) => {
    sql += chunk;
    if (i >= values.length) return;
    const value = values[i];
    if (value && Array.isArray(value.strings)) {
      const nested = flatten(value.strings, value.values);
      sql += nested.sql;
      flatValues.push(...nested.values);
    } else {
      sql += '?';
      flatValues.push(value);
    }
  });
  return { sql, values: flatValues };
};

const capturedQueries = () =>
  mockPrisma.$queryRaw.mock.calls.map(([template, ...values]) => flatten(template, values));

beforeEach(() => {
  mockPrisma.$queryRaw.mockReset();
  // count first, then the page — the service issues them together.
  mockPrisma.$queryRaw
    .mockResolvedValueOnce([{ count: 0 }])
    .mockResolvedValueOnce([]);
});

describe('getContentPackPage', () => {
  it('excludes the per-child custom packs by default', async () => {
    await rfidService.getContentPackPage({ page: 1, limit: 10 });

    for (const { sql, values } of capturedQueries()) {
      expect(sql).toContain('pack_code !~');
      expect(sql).not.toContain('pack_code ~ ');
      expect(values).toContain(CUSTOM_PATTERN);
    }
  });

  it('returns only the custom packs when that scope is asked for', async () => {
    await rfidService.getContentPackPage({ page: 1, limit: 10, scope: 'custom' });

    for (const { sql, values } of capturedQueries()) {
      expect(sql).toContain('pack_code ~');
      expect(sql).not.toContain('!~');
      expect(values).toContain(CUSTOM_PATTERN);
    }
  });

  it('keeps the exclusion on alongside the other filters', async () => {
    await rfidService.getContentPackPage({
      page: 2,
      limit: 5,
      packCode: 'bed',
      contentType: 'story_pack',
      language: 'en',
      active: 'true'
    });

    const [count, page] = capturedQueries();

    expect(count.sql).toContain('pack_code ILIKE');
    expect(count.sql).toContain('content_type =');
    expect(count.sql).toContain('language =');
    expect(count.sql).toContain('active =');
    expect(count.sql).toContain('pack_code !~');
    expect(count.values).toEqual(['%bed%', 'story_pack', 'en', true, CUSTOM_PATTERN]);

    // The page carries the same WHERE, plus its window.
    expect(page.values).toEqual(['%bed%', 'story_pack', 'en', true, CUSTOM_PATTERN, 5, 5]);
  });

  it('reports the total from the count query, not the page length', async () => {
    mockPrisma.$queryRaw.mockReset();
    mockPrisma.$queryRaw
      .mockResolvedValueOnce([{ count: 30 }])
      .mockResolvedValueOnce([
        { id: 1n, pack_code: 'sty_bed', name: 'Bedtime Stories', total_items: 5 }
      ]);

    const result = await rfidService.getContentPackPage({ page: 1, limit: 10 });

    expect(result.total).toBe(30);
    expect(result.pages).toBe(3);
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toMatchObject({ id: 1, packCode: 'sty_bed', totalItems: 5 });
  });
});
