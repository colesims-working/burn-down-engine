import { db, schema } from '../src/lib/db/client';
import { sql } from 'drizzle-orm';

async function main() {
  const tasks = await db.query.tasks.findMany({
    where: sql`${schema.tasks.originalText} LIKE '%bills from ER%'`,
  });
  const t = tasks[0];
  if (t?.llmNotes) {
    const notes = JSON.parse(t.llmNotes);
    console.log('projectName:', notes.projectName);
    console.log('newProject:', notes.newProject);
    console.log('title:', notes.title);
  } else {
    console.log('No llmNotes on task');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
