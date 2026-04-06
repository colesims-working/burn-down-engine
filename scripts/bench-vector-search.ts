import { knowledgeDb, schema } from '../src/lib/knowledge/db';
import { generateQueryEmbedding } from '../src/lib/knowledge/embedding';
import { sql, eq } from 'drizzle-orm';

async function main() {
  // Count objects
  const count = await knowledgeDb.select({ count: sql<number>`count(*)` }).from(schema.objects);
  console.log(`Objects: ${count[0].count}`);

  // Generate a test embedding
  const t0 = Date.now();
  const emb = await generateQueryEmbedding('test task about work projects', 'retrieval');
  console.log(`Embedding generation: ${Date.now() - t0}ms (${emb.length} dims)`);

  // Test vector_top_k
  const queryVec = JSON.stringify(emb);
  const t1 = Date.now();
  const results = await knowledgeDb.all(sql`
    SELECT o.id, o.name,
           (1.0 - vector_distance_cos(o.embedding, vector(${queryVec}))) AS similarity
    FROM vector_top_k('objects_embedding_idx', vector(${queryVec}), 30) AS v
    JOIN objects o ON o.rowid = v.id
    WHERE o.status = 'active'
    LIMIT 20
  `);
  console.log(`vector_top_k: ${Date.now() - t1}ms (${(results as any[]).length} results)`);

  // Test simple SELECT all (cold start approach)
  const t2 = Date.now();
  const all = await knowledgeDb.query.objects.findMany({
    where: eq(schema.objects.status, 'active'),
  });
  console.log(`SELECT all active: ${Date.now() - t2}ms (${all.length} results)`);
}

main().catch(e => { console.error(e); process.exit(1); });
