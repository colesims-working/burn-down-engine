import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth/session';
import { db, schema } from '@/lib/db/client';
import { eq, ne, and, sql } from 'drizzle-orm';
import { syncInbox, syncProjects, syncAllTasks, pushTaskToTodoist, completeTaskInTodoist, killTaskInTodoist, refreshProjectCounts } from '@/lib/todoist/sync';
import { todoist } from '@/lib/todoist/client';
import { buildEngageList, completeTask, bumpTask, blockTask, waitTask, handleFire } from '@/lib/priority/engine';
import { clarifyTask, applyClarification, answerClarifyQuestion } from '@/actions/clarify';
import { getDailyReviewData, generateDailyObservations, saveDailyReview, generateWeeklyReview } from '@/actions/reflect';
import { runProjectAudit, getFilingSuggestions, organizeConversation } from '@/actions/organize';
import { getKnowledgeEntries, getPeople, getKnowledgeStats, createKnowledgeEntry, updateKnowledgeEntry, deleteKnowledgeEntry, createPerson, updatePerson, deletePerson } from '@/actions/knowledge';
import { getAppSettings, updateAppSettings, getModelConfig, getDisabledModels } from '@/lib/db/settings';
import { listAvailableModels, testModel } from '@/lib/llm/providers';

// ─── GET: Read operations ────────────────────────────────────

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const action = request.nextUrl.searchParams.get('action');

  try {
    switch (action) {
      case 'inbox': {
        const tasks = await db.query.tasks.findMany({
          where: eq(schema.tasks.status, 'inbox'),
          orderBy: (t, { desc }) => [desc(t.createdAt)],
        });
        return NextResponse.json(tasks);
      }

      case 'inbox-count': {
        const result = await db.select({ count: sql<number>`count(*)` }).from(schema.tasks).where(eq(schema.tasks.status, 'inbox'));
        return NextResponse.json({ count: result[0].count });
      }

      case 'engage': {
        const data = await buildEngageList();
        return NextResponse.json(data);
      }

      case 'projects': {
        // Refresh task counts before returning
        await refreshProjectCounts();
        const status = request.nextUrl.searchParams.get('status');
        const projects = status
          ? await db.query.projects.findMany({ where: eq(schema.projects.status, status as any) })
          : await db.query.projects.findMany();
        return NextResponse.json(projects);
      }

      case 'project-tasks': {
        const projectId = request.nextUrl.searchParams.get('projectId');
        if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });
        const tasks = await db.query.tasks.findMany({
          where: and(eq(schema.tasks.projectId, projectId), ne(schema.tasks.status, 'killed')),
        });
        return NextResponse.json(tasks);
      }

      case 'daily-review': {
        const date = request.nextUrl.searchParams.get('date') || undefined;
        const data = await getDailyReviewData(date);
        return NextResponse.json(data);
      }

      case 'knowledge': {
        const category = request.nextUrl.searchParams.get('category') || undefined;
        const entries = await getKnowledgeEntries(category);
        return NextResponse.json(entries);
      }

      case 'people': {
        const people = await getPeople();
        return NextResponse.json(people);
      }

      case 'knowledge-stats': {
        const stats = await getKnowledgeStats();
        return NextResponse.json(stats);
      }

      case 'sync-state': {
        const state = await db.query.syncState.findFirst();
        return NextResponse.json(state || { lastFullSync: null, lastInboxSync: null });
      }

      case 'app-settings': {
        const settings = await getAppSettings();
        const modelConfig = getModelConfig(settings);
        const disabledModels = getDisabledModels(settings);
        return NextResponse.json({ ...settings, modelConfig, disabledModels });
      }

      case 'available-models': {
        const models = await listAvailableModels();
        return NextResponse.json(models);
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error(`GET ${action} error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ─── POST: Write operations ──────────────────────────────────

export async function POST(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const { action } = body;

  try {
    switch (action) {
      // ─── Sync ──────────────────────────
      case 'sync-inbox': {
        const tasks = await syncInbox();
        return NextResponse.json({ synced: tasks.length, tasks });
      }

      case 'sync-all': {
        await syncProjects();
        const tasks = await syncAllTasks();
        await refreshProjectCounts();
        return NextResponse.json({ synced: tasks.length });
      }

      // ─── Inbox ─────────────────────────
      case 'quick-add': {
        const todoistTask = await todoist.createTask({ content: body.content });
        const local = await db.insert(schema.tasks)
          .values({
            todoistId: todoistTask.id,
            originalText: body.content,
            title: body.content,
            status: 'inbox',
            todoistSyncedAt: new Date().toISOString(),
          })
          .returning();
        return NextResponse.json(local[0]);
      }

      // ─── Clarify ───────────────────────
      case 'delete': {
        const taskToDelete = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, body.taskId) });
        if (taskToDelete?.todoistId) {
          try { await todoist.deleteTask(taskToDelete.todoistId); } catch {}
        }
        await db.delete(schema.tasks).where(eq(schema.tasks.id, body.taskId));
        return NextResponse.json({ deleted: true });
      }

      case 'clarify': {
        const result = await clarifyTask(body.taskId, body.additionalInstructions);
        return NextResponse.json(result);
      }

      case 'apply-clarification': {
        const task = await applyClarification(body.taskId, body.clarification);
        return NextResponse.json(task);
      }

      case 'answer-clarify': {
        const result = await answerClarifyQuestion(body.taskId, body.answer);
        return NextResponse.json(result);
      }

      // ─── Engage ────────────────────────
      case 'complete': {
        const completed = await completeTask(body.taskId);
        try { await completeTaskInTodoist(completed); } catch {}
        return NextResponse.json(completed);
      }

      case 'defer': {
        const deferred = await bumpTask(body.taskId, body.reason);
        return NextResponse.json(deferred);
      }

      case 'block': {
        const blocked = await blockTask(body.taskId, body.blockerNote);
        return NextResponse.json(blocked);
      }

      case 'fire': {
        const result = await handleFire({ description: body.description });
        return NextResponse.json(result);
      }

      case 'kill': {
        const taskToKill = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, body.taskId) });
        const killed = await db.update(schema.tasks)
          .set({ status: 'killed', updatedAt: new Date().toISOString() })
          .where(eq(schema.tasks.id, body.taskId))
          .returning();
        await db.insert(schema.taskHistory).values({
          taskId: body.taskId,
          action: 'killed',
          details: JSON.stringify({ killedAt: new Date().toISOString() }),
        });
        if (taskToKill) {
          try { await killTaskInTodoist(taskToKill); } catch {}
        }
        return NextResponse.json(killed[0]);
      }

      case 'wait': {
        const waited = await waitTask(body.taskId, body.waitingFor);
        return NextResponse.json(waited);
      }

      case 'complete-in-clarify': {
        const taskToComplete = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, body.taskId) });
        if (!taskToComplete) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        const completedTask = await completeTask(body.taskId);
        try { await completeTaskInTodoist(completedTask); } catch {}
        return NextResponse.json(completedTask);
      }

      case 'update-task': {
        // Allowlist fields to prevent mass assignment
        const allowedFields: (keyof typeof schema.tasks.$inferInsert)[] = [
          'title', 'nextAction', 'description', 'projectId', 'priority',
          'labels', 'dueDate', 'timeEstimateMin', 'energyLevel', 'status',
          'blockerNote', 'contextNotes',
        ];
        const safeData: Record<string, unknown> = {};
        for (const key of allowedFields) {
          if (key in (body.data || {})) safeData[key] = body.data[key];
        }
        safeData.updatedAt = new Date().toISOString();
        const updated = await db.update(schema.tasks)
          .set(safeData)
          .where(eq(schema.tasks.id, body.taskId))
          .returning();
        return NextResponse.json(updated[0]);
      }

      // ─── Organize ──────────────────────
      case 'project-audit': {
        const audit = await runProjectAudit();
        return NextResponse.json(audit);
      }

      case 'filing-suggestions': {
        const suggestions = await getFilingSuggestions();
        return NextResponse.json(suggestions);
      }

      case 'organize-chat': {
        const response = await organizeConversation(body.message);
        return NextResponse.json({ response });
      }

      case 'create-project': {
        const todoistProject = await todoist.createProject({ name: body.name });
        const project = await db.insert(schema.projects)
          .values({
            todoistId: todoistProject.id,
            name: body.name,
            category: body.category,
            goal: body.goal,
            status: 'active',
            todoistSyncedAt: new Date().toISOString(),
          })
          .returning();
        return NextResponse.json(project[0]);
      }

      case 'update-project': {
        // Look up project to get todoistId
        const projToUpdate = await db.query.projects.findFirst({
          where: eq(schema.projects.id, body.projectId),
        });

        // Push name change to Todoist if linked
        if (projToUpdate?.todoistId) {
          const todoistData: Record<string, string> = {};
          if (body.data.name) todoistData.name = body.data.name;
          if (Object.keys(todoistData).length > 0) {
            try {
              await todoist.updateProject(projToUpdate.todoistId, todoistData);
            } catch (e) {
              console.error('Failed to push project update to Todoist:', e);
            }
          }
        }

        const updated = await db.update(schema.projects)
          .set({ ...body.data, updatedAt: new Date().toISOString() })
          .where(eq(schema.projects.id, body.projectId))
          .returning();
        return NextResponse.json(updated[0]);
      }

      case 'archive-project': {
        // Look up project to get todoistId for Todoist deletion/archival
        const projToArchive = await db.query.projects.findFirst({
          where: eq(schema.projects.id, body.projectId),
        });

        if (projToArchive?.todoistId) {
          try {
            // Todoist REST API doesn't have archive — delete removes it
            // Use update to rename with [Archived] prefix as a soft signal
            await todoist.updateProject(projToArchive.todoistId, {
              name: `[Archived] ${projToArchive.name}`,
            });
          } catch (e) {
            console.error('Failed to push archive to Todoist:', e);
          }
        }

        await db.update(schema.projects)
          .set({ status: 'archived', updatedAt: new Date().toISOString() })
          .where(eq(schema.projects.id, body.projectId));
        return NextResponse.json({ success: true });
      }

      // ─── Reflect ───────────────────────
      case 'daily-observations': {
        const obs = await generateDailyObservations(body.date);
        return NextResponse.json(obs);
      }

      case 'save-daily-review': {
        await saveDailyReview(body);
        return NextResponse.json({ success: true });
      }

      case 'weekly-review': {
        const review = await generateWeeklyReview();
        return NextResponse.json(review);
      }

      // ─── Knowledge ─────────────────────
      case 'create-knowledge': {
        const entry = await createKnowledgeEntry(body);
        return NextResponse.json(entry);
      }

      case 'update-knowledge': {
        const entry = await updateKnowledgeEntry(body.id, body.data);
        return NextResponse.json(entry);
      }

      case 'delete-knowledge': {
        await deleteKnowledgeEntry(body.id);
        return NextResponse.json({ success: true });
      }

      case 'create-person': {
        const person = await createPerson(body);
        return NextResponse.json(person);
      }

      case 'update-person': {
        const person = await updatePerson(body.id, body.data);
        return NextResponse.json(person);
      }

      case 'delete-person': {
        await deletePerson(body.id);
        return NextResponse.json({ success: true });
      }

      case 'update-settings': {
        const settings = await updateAppSettings(body.data);
        return NextResponse.json(settings);
      }

      case 'test-model': {
        const { provider, model } = body;
        if (!provider || !model) {
          return NextResponse.json({ error: 'provider and model required' }, { status: 400 });
        }
        const result = await testModel(provider, model);
        return NextResponse.json(result);
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error(`POST ${action} error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
