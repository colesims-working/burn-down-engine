import { createClient } from '@libsql/client';

async function main() {
  const c = createClient({
    url: process.env.TURSO_KG_DATABASE_URL!,
    authToken: process.env.TURSO_KG_AUTH_TOKEN,
  });

  console.log('Dropping old vector index...');
  await c.execute('DROP INDEX IF EXISTS objects_embedding_idx');

  console.log('Creating vector index with correct dimensions...');
  await c.execute("CREATE INDEX objects_embedding_idx ON objects(libsql_vector_idx(embedding, 'metric=cosine'))");

  console.log('Vector index recreated successfully.');
}

main().catch(e => { console.error(e); process.exit(1); });
