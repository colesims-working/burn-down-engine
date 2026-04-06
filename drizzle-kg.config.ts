import type { Config } from 'drizzle-kit';

export default {
  schema: './src/lib/knowledge/schema.ts',
  out: './src/lib/knowledge/migrations',
  dialect: 'turso',
  dbCredentials: {
    url: process.env.TURSO_KG_DATABASE_URL!,
    authToken: process.env.TURSO_KG_AUTH_TOKEN,
  },
} satisfies Config;
