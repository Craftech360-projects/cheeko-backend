/**
 * Cheeko MCP server (stdio).
 *
 * Exposes manager-api to MCP clients (Claude Code, Claude Desktop): curated
 * RFID content-pack tools for the daily job, plus a generic proxy
 * (search_endpoints / describe_endpoint / admin_request) that reaches every
 * route in the API's own swagger.json. Talks HTTP with X-Service-Key rather
 * than touching Prisma directly, so Joi validation, the XSS filter and request
 * logging all still run.
 *
 * Environment (set per-entry in .mcp.json / claude mcp add):
 *   CHEEKO_API           base URL incl. context path, e.g. https://dev-api.../toy
 *   SERVICE_SECRET_KEY   god-mode key accepted by requireAdmin / requireServiceKey
 *   CHEEKO_USER_TOKEN    optional user Bearer token (scripts/mcp-token.js) for the
 *                        requireAuth / requireSuperAdmin / requireFlexAuth routes
 *                        the service key cannot reach
 *   ALLOW_WRITES=1       registers the create/update tools. Absent = read-only.
 */

import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// The API's PNG/JPEG -> LVGL RGB565 .bin converter. CJS, and pure apart from
// spawning ffmpeg, so it loads from here without dragging the API in.
const lvgl = createRequire(import.meta.url)('../src/utils/lvglImage.js');

const ACTOR = process.env.CHEEKO_MCP_ACTOR || os.userInfo().username;

/**
 * Routes the generic proxy will not WRITE to, even with ALLOW_WRITES. A wrong
 * call here is not a bad row — it is an admin account created, firmware pushed
 * to every toy in the field, or provider keys / runtime config replaced. Reads
 * stay open; the dashboard shows all of it anyway. Edit freely.
 */
export const NO_WRITE = [
  /^\/user\b/,                 // login, register, password reset
  /^\/ota\b/, /^\/otaMag\b/,   // firmware rollout
  /^\/admin\/(params|server)\b/, // runtime params, server control
  /^\/models\b/, /^\/livekit\b/  // LLM/TTS/STT provider config and keys
];

/** null when the call may proceed, otherwise the reason it may not. */
export function writeCheck(method, route, canWrite) {
  if (method === 'GET') return null;
  if (!canWrite) return 'This server is read-only (ALLOW_WRITES not set): GET only.';
  const hit = NO_WRITE.find((re) => re.test(route));
  return hit ? `${method} ${route} is blocked for the generic proxy (NO_WRITE in cheeko-mcp.mjs). GET still works.` : null;
}

/** Rank operations in an OpenAPI spec by how many query words they match. */
export function searchSpec(spec, query, limit = 25) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = [];
  for (const [route, ops] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(ops)) {
      const hay = `${method} ${route} ${op.summary ?? ''} ${op.description ?? ''} ${(op.tags ?? []).join(' ')}`.toLowerCase();
      const score = terms.filter((t) => hay.includes(t)).length;
      if (score) rows.push({ score, line: `${method.toUpperCase()} ${route} — ${op.summary ?? ''}` });
    }
  }
  return rows.sort((a, b) => b.score - a.score).slice(0, limit).map((r) => r.line);
}

const MIME = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/m4a',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.bin': 'application/octet-stream'
};

/**
 * What to send for a local file. The pack upload endpoint stores bytes as-is,
 * and the toy only renders LVGL .bin, so PNG/JPEG default to converting —
 * except when the upload is a pack thumbnail (contentPackId set), which the
 * web dashboard shows and therefore wants as a real image.
 */
export function uploadPlan(filePath, { convert, contentPackId } = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error(`Unsupported file type ${ext || '(none)'}; expected ${Object.keys(MIME).join(' ')}`);
  const convertible = ext === '.png' || ext === '.jpg' || ext === '.jpeg';
  const shouldConvert = convertible && (convert ?? !contentPackId);
  return {
    filename: shouldConvert ? path.basename(filePath, ext) + '.bin' : path.basename(filePath),
    mime: shouldConvert ? MIME['.bin'] : mime,
    shouldConvert
  };
}

/**
 * manager-api answers 200 with {code:0} on success and a non-zero code on
 * failure, so HTTP status alone is not enough to tell the model it went wrong.
 */
export function toToolResult(status, bodyText) {
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { content: [{ type: 'text', text: bodyText }], isError: status >= 400 };
  }
  const failed = status >= 400 || body.code !== 0;
  return {
    content: [{ type: 'text', text: JSON.stringify(failed ? body : body.data, null, 2) }],
    isError: failed
  };
}

export function makeApi(base, key, userToken) {
  // Both credentials go on every call: requireAdmin/requireServiceKey take the
  // key first and ignore the bearer; requireAuth and friends ignore the key and
  // take the bearer. Neither middleware objects to the other header.
  // `form` is a FormData for multipart routes; fetch sets the boundary itself,
  // so no Content-Type header in that case.
  const headers = (body) => ({
    'X-Service-Key': key,
    ...(userToken && { Authorization: `Bearer ${userToken}` }),
    // requestId.js honours an inbound X-Request-ID, so this lands in the
    // API's normal logs and makes MCP-originated writes greppable.
    'X-Request-ID': `mcp-${ACTOR}-${randomUUID().slice(0, 8)}`,
    ...(body && { 'Content-Type': 'application/json' })
  });
  const api = async function api(route, { method = 'GET', body, form } = {}) {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: headers(body),
      body: form ?? (body && JSON.stringify(body))
    });
    return toToolResult(res.status, await res.text());
  };
  // Un-enveloped JSON (swagger.json is the spec itself, not {code,msg,data}).
  api.raw = async (route) => (await fetch(`${base}${route}`, { headers: headers() })).json();
  return api;
}

const packFields = {
  packCode: z.string().describe('Unique pack code, e.g. STORY_ANIMALS_EN'),
  name: z.string(),
  description: z.string().optional(),
  contentType: z.string().optional().describe('story | music | quiz | riddle ...'),
  contentMd: z.string().optional().describe('Markdown body of the pack'),
  totalItems: z.number().int().optional(),
  language: z.string().optional().describe('e.g. en, hi'),
  active: z.boolean().optional()
};

export function buildServer({ api, canWrite, hasUserToken = false }) {
  const server = new McpServer({ name: 'cheeko', version: '1.0.0' });

  server.registerTool('list_content_packs', {
    description: 'List RFID content packs, optionally filtered. Read-only.',
    inputSchema: z.object({
      packCode: z.string().optional(),
      name: z.string().optional(),
      contentType: z.string().optional(),
      language: z.string().optional(),
      active: z.boolean().optional()
    })
  }, (args) => api(`/admin/rfid/content-pack/list?${new URLSearchParams(
    Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  )}`));

  server.registerTool('get_content_pack', {
    description: 'Get one RFID content pack by its pack code. Read-only.',
    inputSchema: z.object({ packCode: z.string() })
  }, ({ packCode }) => api(`/admin/rfid/content-pack/code/${encodeURIComponent(packCode)}`));

  // ---- Generic proxy: every route in the API's own swagger.json ----------
  // Fetched once per process from the box this server points at, so dev and
  // prod each describe themselves.
  let spec;
  const getSpec = () => (spec ??= api.raw('/swagger.json'));
  const findOp = async (method, route) => (await getSpec()).paths?.[route]?.[method.toLowerCase()];

  server.registerTool('search_endpoints', {
    description: 'Find manager-api endpoints by keyword (path, summary, tag). Use this before admin_request to learn the exact METHOD and path. Returns up to 25 matches.',
    inputSchema: z.object({ query: z.string().describe('e.g. "device list", "agent template", "rfid card"') })
  }, async ({ query }) => {
    const lines = searchSpec(await getSpec(), query);
    return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'No endpoints matched.' }] };
  });

  server.registerTool('describe_endpoint', {
    description: 'Full OpenAPI definition of one endpoint — path/query parameters and request body schema — so you can build a correct admin_request.',
    inputSchema: z.object({ method: z.string(), path: z.string().describe('As returned by search_endpoints, e.g. /device/list') })
  }, async ({ method, path: route }) => {
    const op = await findOp(method, route);
    return op
      ? { content: [{ type: 'text', text: JSON.stringify(op, null, 2) }] }
      : { content: [{ type: 'text', text: `No ${method.toUpperCase()} ${route} in swagger.json. Try search_endpoints.` }], isError: true };
  });

  server.registerTool('admin_request', {
    description: `Call any manager-api endpoint under /toy. GET is always allowed; POST/PUT/PATCH/DELETE need ALLOW_WRITES and are refused on ${NO_WRITE.length} protected route groups (auth, OTA, params, models, providers). Use search_endpoints + describe_endpoint first. Path params go inline (/device/AA:BB:...), query params in "query", JSON body in "body".`,
    inputSchema: z.object({
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
      path: z.string().describe('Route relative to /toy, e.g. /device/list'),
      query: z.record(z.string(), z.string()).optional(),
      body: z.unknown().optional().describe('JSON body for POST/PUT/PATCH/DELETE')
    })
  }, async ({ method, path: rawPath, query, body }) => {
    // Tolerate a copied "/toy/..." and refuse anything that isn't a plain route.
    const route = rawPath.replace(/^\/toy(?=\/)/, '');
    if (!route.startsWith('/') || route.includes('..') || route.includes('://')) {
      return { content: [{ type: 'text', text: `Refusing path "${rawPath}": must be a route like /device/list` }], isError: true };
    }
    const refusal = writeCheck(method, route, canWrite);
    if (refusal) return { content: [{ type: 'text', text: refusal }], isError: true };
    const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query)}` : '';
    const result = await api(route + qs, { method, body });
    // Some routes sit on requireAuth (a user's own devices, profile, etc.),
    // which has no service-key branch. Say so, or the model retries forever.
    if (result.isError && /"code":\s*401/.test(result.content[0].text)) {
      result.content[0].text += hasUserToken
        ? '\n\nCHEEKO_USER_TOKEN was sent and rejected: it has expired or been revoked. Mint a new one with `node scripts/mcp-token.js <username>` and restart the MCP server.'
        : '\n\nThis route needs a user Bearer token, not the service key. Set CHEEKO_USER_TOKEN (mint one with `node scripts/mcp-token.js <username>`) and restart the MCP server, or use an admin-scoped equivalent (search_endpoints).';
    }
    return result;
  });

  if (canWrite) {
    server.registerTool('create_content_pack', {
      description: 'Create a new RFID content pack. Writes to the database.',
      inputSchema: z.object(packFields)
    }, (data) => api('/admin/rfid/content-pack', { method: 'POST', body: data }));

    server.registerTool('update_content_pack', {
      description: 'Update an existing RFID content pack by numeric id. Only the fields you pass are changed. Writes to the database.',
      inputSchema: z.object({
        id: z.number().int().describe('Numeric pack id — get it from list_content_packs'),
        ...Object.fromEntries(Object.entries(packFields).map(([k, v]) => [k, v.optional()])),
        items: z.array(z.object({
          itemNumber: z.number().int().optional().describe('1-based order; defaults to array position'),
          title: z.string(),
          description: z.string().optional(),
          audioUrl: z.string().optional().describe('URL returned by upload_pack_file'),
          imageUrl: z.string().optional().describe('URL of a .bin returned by upload_pack_file'),
          text: z.string().optional().describe('Lyrics / story text shown alongside the item')
        })).optional().describe('REPLACES every item on the pack (delete-all, reinsert). Omit to leave items untouched.')
      })
    }, (data) => api('/admin/rfid/content-pack', { method: 'PUT', body: data }));

    server.registerTool('upload_pack_file', {
      description: 'Upload a local audio, image or .bin file to the content CDN and return its URL for use in update_content_pack items. PNG/JPEG are converted to the LVGL .bin the toy renders unless convert=false or contentPackId is set (thumbnails stay real images).',
      inputSchema: z.object({
        path: z.string().describe('Absolute path on this machine'),
        category: z.string().optional().describe('CDN subfolder, e.g. the pack code. Default "uploads"'),
        contentPackId: z.number().int().optional().describe('Set to use this file as that pack\'s thumbnail'),
        convert: z.boolean().optional().describe('Force PNG/JPEG -> .bin on or off')
      })
    }, async ({ path: filePath, category, contentPackId, convert }) => {
      const plan = uploadPlan(filePath, { convert, contentPackId });
      let buf = await readFile(filePath);
      if (plan.shouldConvert) buf = await lvgl.toLvglRgb565Bin(buf);
      const form = new FormData();
      form.append('file', new Blob([buf], { type: plan.mime }), plan.filename);
      if (category) form.append('category', category);
      if (contentPackId) form.append('contentPackId', String(contentPackId));
      return api('/admin/rfid/content-pack/upload', { method: 'POST', form });
    });
  }

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.env.CHEEKO_API;
  const key = process.env.SERVICE_SECRET_KEY;
  // Fail loudly: an unset key would otherwise send the literal "undefined" and
  // come back as a confusing 401 on every tool call.
  if (!base || !key) {
    console.error('cheeko-mcp: CHEEKO_API and SERVICE_SECRET_KEY are required');
    process.exit(1);
  }
  const canWrite = process.env.ALLOW_WRITES === '1';
  // Claude Code leaves an unset ${VAR} in .mcp.json unexpanded, so a literal
  // "${...}" here means "not configured", not a token.
  const rawToken = process.env.CHEEKO_USER_TOKEN;
  const userToken = rawToken && !rawToken.startsWith('${') ? rawToken : undefined;
  console.error(`cheeko-mcp: ${base} (${canWrite ? 'read+write' : 'read-only'}, user token: ${userToken ? 'yes' : 'no'}) as ${ACTOR}`);
  await buildServer({ api: makeApi(base.replace(/\/$/, ''), key, userToken), canWrite, hasUserToken: Boolean(userToken) })
    .connect(new StdioServerTransport());
}
