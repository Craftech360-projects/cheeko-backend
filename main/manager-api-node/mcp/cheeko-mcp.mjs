/**
 * Cheeko MCP server (stdio).
 *
 * Exposes RFID content-pack tools to MCP clients (Claude Code, Claude Desktop).
 * Talks to manager-api over HTTP with X-Service-Key rather than touching Prisma
 * directly, so Joi validation, the XSS filter and request logging all still run.
 *
 * Environment (set per-entry in .mcp.json / claude mcp add):
 *   CHEEKO_API           base URL incl. context path, e.g. https://dev-api.../toy
 *   SERVICE_SECRET_KEY   god-mode key accepted by requireAdmin
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

function makeApi(base, key) {
  // `form` is a FormData for multipart routes; fetch sets the boundary itself,
  // so no Content-Type header in that case.
  return async function api(route, { method = 'GET', body, form } = {}) {
    const res = await fetch(`${base}${route}`, {
      method,
      headers: {
        'X-Service-Key': key,
        // requestId.js honours an inbound X-Request-ID, so this lands in the
        // API's normal logs and makes MCP-originated writes greppable.
        'X-Request-ID': `mcp-${ACTOR}-${randomUUID().slice(0, 8)}`,
        ...(body && { 'Content-Type': 'application/json' })
      },
      body: form ?? (body && JSON.stringify(body))
    });
    return toToolResult(res.status, await res.text());
  };
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

export function buildServer({ api, canWrite }) {
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
  console.error(`cheeko-mcp: ${base} (${canWrite ? 'read+write' : 'read-only'}) as ${ACTOR}`);
  await buildServer({ api: makeApi(base.replace(/\/$/, ''), key), canWrite })
    .connect(new StdioServerTransport());
}
