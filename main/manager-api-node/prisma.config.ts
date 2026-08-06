import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // env() throws when unset, so branch on process.env instead of using ||.
    url: process.env.DIRECT_URL ? env('DIRECT_URL') : env('DATABASE_URL'),
  },
});
