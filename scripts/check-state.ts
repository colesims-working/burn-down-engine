import { db, schema } from '../src/lib/db/client';
import { like, sql } from 'drizzle-orm';

async function main() {
  // Check ALL projects for anything ER/bill related
  const all = await db.query.projects.findMany();
  console.log(`Total projects: ${all.length}`);
  const matching = all.filter(p =>
    p.name.toLowerCase().includes('er_bill') ||
    p.name.toLowerCase().includes('er bill') ||
    p.name.toLowerCase().includes('financial_resolution')
  );
  console.log(`Projects matching ER/bill/resolution: ${matching.length}`);
  for (const p of matching) console.log(`  "${p.name}" | todoistId: ${p.todoistId} | id: ${p.id}`);

  // Check the task
  const tasks = await db.query.tasks.findMany({
    where: sql`${schema.tasks.originalText} LIKE '%bills from ER%'`,
  });
  console.log(`\nTasks:`);
  for (const t of tasks) {
    console.log(`  title: "${t.title?.slice(0,50)}"`);
    console.log(`  status: ${t.status}`);
    console.log(`  projectId: ${t.projectId}`);
    console.log(`  clarifyConfidence: ${t.clarifyConfidence}`);
    console.log(`  todoistId: ${t.todoistId}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
