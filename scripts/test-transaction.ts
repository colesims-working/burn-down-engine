import { knowledgeDb, schema } from '../src/lib/knowledge/db';
import { eq } from 'drizzle-orm';

async function main() {
  try {
    await knowledgeDb.transaction(async (tx) => {
      const obj = await tx.query.objects.findFirst();
      console.log('Transaction works! Found:', obj?.name ?? 'no objects');
    });
    console.log('knowledgeDb.transaction() SUCCESS');
  } catch (e: any) {
    console.log('knowledgeDb.transaction() FAILED:', e.message);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
