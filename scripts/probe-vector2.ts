import { knowledgeDb } from '../src/lib/knowledge/db';
import { sql } from 'drizzle-orm';

async function main() {
  // Try vector_distance_cos
  try {
    const r = await knowledgeDb.all(sql`
      SELECT o.id, o.name, vector_distance_cos(o.embedding, (SELECT embedding FROM objects WHERE id != o.id LIMIT 1)) AS similarity
      FROM objects o LIMIT 3
    `);
    console.log('vector_distance_cos:', JSON.stringify(r));
  } catch(e: any) {
    console.log('vector_distance_cos error:', e.message);
  }

  // Join works without distance?
  try {
    const r = await knowledgeDb.all(sql`
      SELECT o.id, o.name
      FROM vector_top_k('objects_embedding_idx', (SELECT embedding FROM objects LIMIT 1), 5) AS v
      JOIN objects o ON o.rowid = v.id
      LIMIT 3
    `);
    console.log('join works:', JSON.stringify(r));
  } catch(e: any) {
    console.log('join error:', e.message);
  }

  // vector_top_k with explicit distance column check
  try {
    const r = await knowledgeDb.all(sql`
      SELECT v.*
      FROM vector_top_k('objects_embedding_idx', (SELECT embedding FROM objects LIMIT 1), 3) AS v
    `);
    console.log('v.* columns:', r.length > 0 ? Object.keys(r[0] as any) : 'empty');
  } catch(e: any) {
    console.log('v.* error:', e.message);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
