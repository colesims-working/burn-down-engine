import { createClient } from '@libsql/client';

async function main() {
  const c = createClient({ url: process.env.TURSO_KG_DATABASE_URL!, authToken: process.env.TURSO_KG_AUTH_TOKEN });
  await c.execute('ALTER TABLE links ADD COLUMN source_context TEXT');
  console.log('Added source_context column to links table');
}
main().catch(e => console.error(e));
