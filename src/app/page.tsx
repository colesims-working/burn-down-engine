import { redirect } from 'next/navigation';
import { db, schema } from '@/lib/db/client';
import { eq } from 'drizzle-orm';

export default async function Home() {
  // Check inbox count — if zero items, go straight to Engage
  const inboxTasks = await db.query.tasks.findMany({
    where: eq(schema.tasks.status, 'inbox'),
    columns: { id: true },
  });

  if (inboxTasks.length === 0) {
    redirect('/engage');
  }

  redirect('/inbox');
}
