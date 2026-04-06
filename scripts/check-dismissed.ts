import { db, schema } from '../src/lib/db/client';
import { isNotNull } from 'drizzle-orm';

async function main() {
  // Check all tasks with dupeDismissedIds
  const tasks = await db.query.tasks.findMany({
    where: isNotNull(schema.tasks.dupeDismissedIds),
  });

  console.log(`Tasks with dupeDismissedIds: ${tasks.length}`);
  for (const t of tasks) {
    console.log(`  "${t.title}" dismissed: ${t.dupeDismissedIds}`);
    console.log(`    duplicateSuspectOf: ${t.duplicateSuspectOf}`);
  }

  // Also check the two specific tasks
  const all = await db.query.tasks.findMany({
    where: isNotNull(schema.tasks.embedding),
  });
  const crawl = all.find(t => t.title?.toLowerCase().includes('crawl'));
  const multi = all.find(t => t.title?.toLowerCase().includes('multi-agent'));

  if (crawl) console.log(`\nCrawl task: dismissed=${crawl.dupeDismissedIds}, suspectOf=${crawl.duplicateSuspectOf}`);
  if (multi) console.log(`Multi-agent task: dismissed=${multi.dupeDismissedIds}, suspectOf=${multi.duplicateSuspectOf}`);
}

main().catch(e => { console.error(e); process.exit(1); });
