/**
 * Prisma CLI config (Prisma 7): the runtime client gets its URL from
 * src/config/database.js, but `prisma migrate deploy` / `db push` need the
 * datasource here. Source .env first when running the CLI by hand
 * (`set -a; . ./.env; set +a`) — the config does not auto-load .env.
 */
const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL,
  },
});
