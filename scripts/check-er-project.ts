import { db, schema } from '../src/lib/db/client';
import { like, sql } from 'drizzle-orm';

async function main() {
  const projects = await db.query.projects.findMany({
    where: like(schema.projects.name, '%ER%'),
  });
  console.log(`Found ${projects.length} ER-related projects:`);
  for (const p of projects) {
    console.log(`  "${p.name}" | todoistId: ${p.todoistId} | status: ${p.status}`);
  }

  const tasks = await db.query.tasks.findMany({
    where: sql`${schema.tasks.title} LIKE '%Resolve ER%' OR ${schema.tasks.title} LIKE '%ER Visit%' OR ${schema.tasks.title} LIKE '%itemized bill%'`,
  });
  console.log(`\nFound ${tasks.length} related tasks:`);
  for (const t of tasks) {
    console.log(`  "${t.title?.slice(0,50)}" | projectId: ${t.projectId} | todoistId: ${t.todoistId} | status: ${t.status}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
