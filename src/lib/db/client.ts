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

// Auto-migrate: add new columns that may not exist yet in the remote DB.
// Each statement is idempotent — duplicate column errors are caught and ignored.
let _migrated = false;
export async function ensureSchema() {
  if (_migrated) return;
  _migrated = true;
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const statements = [
    'ALTER TABLE tasks ADD COLUMN project_order integer',
    'ALTER TABLE tasks ADD COLUMN urgency_class text',
  ];
  for (const sql of statements) {
    try { await client.execute(sql); } catch {
      // Column already exists — safe to ignore
    }
  }
}
