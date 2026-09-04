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
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ACTOR = process.env.CHEEKO_MCP_ACTOR || os.userInfo().username;

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
  return async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'X-Service-Key': key,
        // requestId.js honours an inbound X-Request-ID, so this lands in the
        // API's normal logs and makes MCP-originated writes greppable.
        'X-Request-ID': `mcp-${ACTOR}-${randomUUID().slice(0, 8)}`,
        ...(body && { 'Content-Type': 'application/json' })
      },
      body: body && JSON.stringify(body)
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
        ...Object.fromEntries(Object.entries(packFields).map(([k, v]) => [k, v.optional()]))
      })
    }, async (data) => {
      // rfid.service.updateContentPack uses updateMany, which matches zero rows
      // and still reports success. Harmless for the admin UI (it only sends ids
      // it just listed) but through MCP the model would report an edit that
      // never happened, so check the id exists first.
      //
      // Via /list, not /content-pack/:id — that route is on requireAuth, which
      // unlike its sibling routes has no service-key branch and 401s us.
      const found = await api('/admin/rfid/content-pack/list');
      if (found.isError) return found;
      const exists = JSON.parse(found.content[0].text)?.some((p) => Number(p.id) === data.id);
      if (!exists) {
        return { content: [{ type: 'text', text: `No content pack with id ${data.id}. Use list_content_packs to find the right id.` }], isError: true };
      }
      return api('/admin/rfid/content-pack', { method: 'PUT', body: data });
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
