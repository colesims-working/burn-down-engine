import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from './schema';

// Lazy-init: avoid crashing during Next.js build when env vars aren't available
let _db: LibSQLDatabase<typeof schema> | null = null;

export const db: LibSQLDatabase<typeof schema> = new Proxy({} as LibSQLDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    if (!_db) {
      const client = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
      _db = drizzle(client, { schema });
    }
    return Reflect.get(_db, prop, receiver);
  },
});

export { schema };
