import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

// Lazy-init: avoid crashing during Next.js build when env vars aren't available
let _knowledgeDb: LibSQLDatabase<typeof schema> | null = null;

export const knowledgeDb: LibSQLDatabase<typeof schema> = new Proxy({} as LibSQLDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    if (!_knowledgeDb) {
      const client = createClient({
        url: process.env.TURSO_KG_DATABASE_URL!,
        authToken: process.env.TURSO_KG_AUTH_TOKEN,
      });
      _knowledgeDb = drizzle(client, { schema });
    }
    return Reflect.get(_knowledgeDb, prop, receiver);
  },
});

export { schema };
