#!/usr/bin/env node
/**
 * Mint or revoke a long-lived manager-api user token for the MCP server.
 *
 *   node scripts/mcp-token.js <username|userId> [days=90]   → prints the token
 *   node scripts/mcp-token.js --revoke <token>
 *
 * The service key only satisfies requireAdmin / requireServiceKey. Roughly half
 * the API (requireAuth, requireSuperAdmin, requireFlexAuth) wants a user Bearer
 * token, and /user/login sits behind a captcha. This mirrors login's INSERT
 * into sys_user_token without the captcha. Put the result in CHEEKO_USER_TOKEN.
 *
 * Revoking is deleting the row; the token stops working on the next request.
 */
require('dotenv').config();
// Force quiet regardless of what .env sets: dotenv.config() runs first, so a
// LOG_LEVEL already in .env (debug in dev, seen in practice) would otherwise
// survive a `||` fallback here untouched, and its DB-connect banner lands on
// stdout ahead of the token — this script has no reason to respect the app's
// ambient logging preference.
process.env.LOG_LEVEL = 'error';
const crypto = require('crypto');
const { prisma } = require('../src/config/database');

async function main() {
  const [a, b] = process.argv.slice(2);

  if (a === '--revoke') {
    const { count } = await prisma.sys_user_token.deleteMany({ where: { token: b || '' } });
    console.log(count ? 'revoked' : 'no such token');
    return;
  }
  if (!a) {
    console.error('usage: mcp-token.js <username|userId> [days] | --revoke <token>');
    process.exit(1);
  }

  const where = /^\d+$/.test(a) ? { id: BigInt(a) } : { username: a };
  const user = await prisma.sys_user.findFirst({
    where: { ...where, status: 1 },
    select: { id: true, username: true, role: true }
  });
  if (!user) {
    console.error(`no active user matching "${a}"`);
    process.exit(1);
  }

  const days = Number(b || 90);
  const token = crypto.randomBytes(16).toString('hex'); // 32 chars, same length as login's
  const expireDate = new Date(Date.now() + days * 86400e3);

  // Same raw INSERT as auth.service.js: the PrismaPg adapter can't autoincrement
  // this BigInt id and the column has no sequence default.
  await prisma.$executeRaw`
    INSERT INTO sys_user_token (id, user_id, token, expire_date, created_at, updated_at)
    VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM sys_user_token), ${user.id}, ${token}, ${expireDate}, NOW(), NOW())
  `;

  // Info on stderr, token alone on stdout, so `export X=$(node scripts/mcp-token.js me)` works.
  console.error(`token for ${user.username} (${user.role}), expires ${expireDate.toISOString().slice(0, 10)}`);
  console.log(token);
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
