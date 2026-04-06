import { todoist } from '../src/lib/todoist/client';
import { db, schema } from '../src/lib/db/client';
import { like, sql } from 'drizzle-orm';

async function main() {
  // Check local DB
  const tasks = await db.query.tasks.findMany({
    where: sql`${schema.tasks.title} LIKE '%ER Visit%' OR ${schema.tasks.title} LIKE '%Resolve ER%' OR ${schema.tasks.originalText} LIKE '%bills from ER%'`,
  });
  console.log(`Local tasks (${tasks.length}):`);
  for (const t of tasks) {
    console.log(`  title: "${t.title?.slice(0,50)}" | status: ${t.status} | todoistId: ${t.todoistId} | projectId: ${t.projectId}`);
  }

  // Check if project exists locally
  const projects = await db.query.projects.findMany({
    where: like(schema.projects.name, '%ER_bill%'),
  });
  console.log(`\nLocal projects matching ER_bill (${projects.length}):`);
  for (const p of projects) {
    console.log(`  "${p.name}" | todoistId: ${p.todoistId}`);
  }

  // Check Todoist directly
  if (tasks[0]?.todoistId) {
    try {
      const todoistTask = await todoist.getTask(tasks[0].todoistId);
      console.log(`\nTodoist task: "${todoistTask.content}" | project_id: ${todoistTask.project_id}`);
    } catch (e: any) {
      console.log(`\nTodoist task fetch error: ${e.message}`);
    }
  }

  // Check all Todoist projects for the new one
  const allProjects = await todoist.getProjects();
  const erProject = allProjects.find(p => p.name.toLowerCase().includes('er_bill') || p.name.toLowerCase().includes('er bill'));
  console.log(`\nTodoist project search: ${erProject ? `Found "${erProject.name}" (id: ${erProject.id})` : 'Not found'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
