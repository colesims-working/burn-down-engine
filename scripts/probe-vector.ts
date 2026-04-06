import { knowledgeDb } from '../src/lib/knowledge/db';
import { sql } from 'drizzle-orm';

async function main() {
  // What does vector_top_k return by itself?
  try {
    const raw = await knowledgeDb.all(sql`
      SELECT * FROM vector_top_k('objects_embedding_idx', (SELECT embedding FROM objects LIMIT 1), 3)
    `);
    console.log('vector_top_k columns:', raw.length > 0 ? Object.keys(raw[0] as any) : 'no rows');
    console.log('first row:', JSON.stringify(raw[0]));
  } catch(e: any) {
    console.log('Error on bare query:', e.message);
  }

  // Try with alias
  try {
    const aliased = await knowledgeDb.all(sql`
      SELECT v.id, v.distance
      FROM vector_top_k('objects_embedding_idx', (SELECT embedding FROM objects LIMIT 1), 3) AS v
    `);
    console.log('aliased columns:', aliased.length > 0 ? Object.keys(aliased[0] as any) : 'no rows');
    console.log('aliased first:', JSON.stringify(aliased[0]));
  } catch(e: any) {
    console.log('Error on aliased:', e.message);
  }

  // Try without alias prefix
  try {
    const noprefix = await knowledgeDb.all(sql`
      SELECT id, distance
      FROM vector_top_k('objects_embedding_idx', (SELECT embedding FROM objects LIMIT 1), 3)
    `);
    console.log('no-prefix columns:', noprefix.length > 0 ? Object.keys(noprefix[0] as any) : 'no rows');
    console.log('no-prefix first:', JSON.stringify(noprefix[0]));
  } catch(e: any) {
    console.log('Error on no-prefix:', e.message);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
