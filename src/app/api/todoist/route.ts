import { NextRequest, NextResponse } from 'next/server';
import { isAuthenticated } from '@/lib/auth/session';
import { db, schema } from '@/lib/db/client';
import { eq, ne, and, sql, lte, isNull, isNotNull, inArray, notInArray } from 'drizzle-orm';
import { syncInbox, syncProjects, syncAllTasks, pushTaskToTodoist, completeTaskInTodoist, killTaskInTodoist, refreshProjectCounts } from '@/lib/todoist/sync';
import { todoist } from '@/lib/todoist/client';
import { buildEngageList, completeTask, bumpTask, blockTask, waitTask, handleFire } from '@/lib/priority/engine';
import { clarifyTask, applyClarification, answerClarifyQuestion } from '@/actions/clarify';
import { getDailyReviewData, generateDailyObservations, saveDailyReview, generateWeeklyReview } from '@/actions/reflect';
import { runProjectAudit, getFilingSuggestions, organizeConversation } from '@/actions/organize';
import { getKnowledgeEntries, getPeople, getKnowledgeStats, createKnowledgeEntry, updateKnowledgeEntry, deleteKnowledgeEntry, createPerson, updatePerson, deletePerson } from '@/actions/knowledge';
import { getAppSettings, updateAppSettings, getModelConfig, getDisabledModels } from '@/lib/db/settings';
import { listAvailableModels, testModel } from '@/lib/llm/providers';
import { revertTask } from '@/lib/undo/engine';
import { mergeTasks, dismissDuplicate, runBackgroundDedup, detectDuplicates } from '@/lib/embeddings/dedup';
import { buildLegacyEnrichmentInstructions } from '@/lib/llm/prompts/clarify';
import { writeToExtractionBuffer, flushExtractionBuffer, getBufferCount } from '@/lib/knowledge/extraction';
import { runConsolidation, revertConsolidationRun, finalizeReferenceOutcomes } from '@/lib/knowledge/consolidation';
import { logInfo, logError } from '@/lib/logging';
import type { IntegrityIssue, IntegrityLevel } from '@/components/providers/trust-provider';

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

      case 'legacy-count': {
        const result = await db.select({ count: sql<number>`count(*)` })
          .from(schema.tasks)
          .where(and(
            isNotNull(schema.tasks.todoistId),
            isNull(schema.tasks.clarifyConfidence),
            notInArray(schema.tasks.status, ['completed', 'killed', 'inbox']),
          ));
        return NextResponse.json({ count: result[0].count });
      }

      case 'legacy-tasks': {
        const legacyTasks = await db
          .select({
            id: schema.tasks.id,
            title: schema.tasks.title,
            originalText: schema.tasks.originalText,
            status: schema.tasks.status,
            projectId: schema.tasks.projectId,
            priority: schema.tasks.priority,
            labels: schema.tasks.labels,
            dueDate: schema.tasks.dueDate,
            description: schema.tasks.description,
            todoistId: schema.tasks.todoistId,
            createdAt: schema.tasks.createdAt,
            projectName: schema.projects.name,
          })
          .from(schema.tasks)
          .leftJoin(schema.projects, eq(schema.tasks.projectId, schema.projects.id))
          .where(and(
            isNotNull(schema.tasks.todoistId),
            isNull(schema.tasks.clarifyConfidence),
            notInArray(schema.tasks.status, ['completed', 'killed', 'inbox']),
          ))
          .orderBy(schema.tasks.projectId, schema.tasks.createdAt);
        return NextResponse.json(legacyTasks);
      }

      case 'engage': {
        const data = await buildEngageList();
        return NextResponse.json(data);
      }

      case 'projects': {
        // Return projects immediately, refresh counts in background
        const status = request.nextUrl.searchParams.get('status');
        const projects = status
          ? await db.query.projects.findMany({ where: eq(schema.projects.status, status as any) })
          : await db.query.projects.findMany();
        // Fire-and-forget: update counts for next request
        refreshProjectCounts().catch(e => console.error('Background project count refresh failed:', e));
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
        // New: fetch from knowledge graph DB
        try {
          const { knowledgeDb, schema: kgSchema } = await import('@/lib/knowledge/db');
          const typeFilter = request.nextUrl.searchParams.get('type');
          const statusFilter = request.nextUrl.searchParams.get('status') || 'active';
          const subtypeFilter = request.nextUrl.searchParams.get('subtype');

          let where = eq(kgSchema.objects.status, statusFilter);
          if (typeFilter) where = and(where, eq(kgSchema.objects.type, typeFilter))!;
          if (subtypeFilter) where = and(where, eq(kgSchema.objects.subtype, subtypeFilter))!;

          const objects = await knowledgeDb.query.objects.findMany({ where });
          return NextResponse.json(objects);
        } catch (e) {
          // Fallback to legacy
          const category = request.nextUrl.searchParams.get('category') || undefined;
          const entries = await getKnowledgeEntries(category);
          return NextResponse.json(entries);
        }
      }

      case 'knowledge-object': {
        const { knowledgeDb, schema: kgSchema } = await import('@/lib/knowledge/db');
        const objId = request.nextUrl.searchParams.get('id');
        if (!objId) return NextResponse.json({ error: 'id required' }, { status: 400 });

        const obj = await knowledgeDb.query.objects.findFirst({ where: eq(kgSchema.objects.id, objId) });
        if (!obj) return NextResponse.json({ error: 'Not found' }, { status: 404 });

        // Fetch linked objects
        const links = await knowledgeDb.query.links.findMany({
          where: sql`${kgSchema.links.sourceId} = ${objId} OR ${kgSchema.links.targetId} = ${objId}`,
        });
        const linkedObjIds = [...new Set(links.flatMap(l => [l.sourceId, l.targetId]).filter(id => id !== objId))];
        const linkedObjects = linkedObjIds.length > 0
          ? await knowledgeDb.query.objects.findMany({ where: inArray(kgSchema.objects.id, linkedObjIds) })
          : [];

        // Fetch evidence trail
        const evidence = await knowledgeDb.query.objectEvidence.findMany({
          where: eq(kgSchema.objectEvidence.objectId, objId),
        });

        // Fetch absorbed-from trail (for absorbed/synthesized objects)
        const absorbedFrom = await knowledgeDb.query.links.findMany({
          where: and(eq(kgSchema.links.targetId, objId), eq(kgSchema.links.linkType, 'absorbed_into')),
        });
        const absorbedSourceIds = absorbedFrom.map(l => l.sourceId);
        const absorbedSources = absorbedSourceIds.length > 0
          ? await knowledgeDb.query.objects.findMany({ where: inArray(kgSchema.objects.id, absorbedSourceIds) })
          : [];

        return NextResponse.json({ object: obj, links, linkedObjects, evidence, absorbedSources });
      }

      case 'knowledge-links': {
        const { knowledgeDb, schema: kgSchema } = await import('@/lib/knowledge/db');
        const links = await knowledgeDb.query.links.findMany();
        return NextResponse.json(links);
      }

      case 'knowledge-stats': {
        try {
          const { knowledgeDb, schema: kgSchema } = await import('@/lib/knowledge/db');
          const objects = await knowledgeDb.query.objects.findMany();
          const byType: Record<string, number> = {};
          const byStatus: Record<string, number> = {};
          let withEmbedding = 0;
          for (const o of objects) {
            byType[o.type] = (byType[o.type] || 0) + 1;
            byStatus[o.status] = (byStatus[o.status] || 0) + 1;
            if (o.embedding) withEmbedding++;
          }
          return NextResponse.json({
            totalObjects: objects.length,
            byType,
            byStatus,
            withEmbedding,
            withoutEmbedding: objects.length - withEmbedding,
            embeddingModel: 'qwen/qwen3-embedding-8b',
          });
        } catch {
          const stats = await getKnowledgeStats();
          return NextResponse.json(stats);
        }
      }

      case 'knowledge-review': {
        const { knowledgeDb, schema: kgSchema } = await import('@/lib/knowledge/db');
        const statusParam = request.nextUrl.searchParams.get('status') || 'pending';
        const items = await knowledgeDb.query.reviewQueue.findMany({
          where: eq(kgSchema.reviewQueue.status, statusParam),
        });
        return NextResponse.json(items);
      }

      case 'knowledge-consolidation-log': {
        const { knowledgeDb, schema: kgSchema } = await import('@/lib/knowledge/db');
        const runs = await knowledgeDb.query.consolidationRuns.findMany({
          limit: 5,
        });
        // Sort by startedAt descending (in JS since Drizzle findMany ordering may vary)
        runs.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
        return NextResponse.json(runs);
      }

      case 'knowledge-export': {
        const { knowledgeDb, schema: kgSchema } = await import('@/lib/knowledge/db');
        const [objects, links, aliases, evidence, references] = await Promise.all([
          knowledgeDb.query.objects.findMany(),
          knowledgeDb.query.links.findMany(),
          knowledgeDb.query.objectAliases.findMany(),
          knowledgeDb.query.objectEvidence.findMany(),
          knowledgeDb.query.objectReferences.findMany(),
        ]);
        return NextResponse.json({ objects, links, aliases, evidence, references, exportedAt: new Date().toISOString() });
      }

      case 'people': {
        // Legacy fallback — kept for backward compat during transition
        const people = await getPeople();
        return NextResponse.json(people);
      }

      case 'extraction-recent': {
        try {
          const { knowledgeDb, schema: kgSchema } = await import('@/lib/knowledge/db');
          const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const recent = await knowledgeDb.query.objectEvidence.findMany({
            where: and(
              eq(kgSchema.objectEvidence.evidenceType, 'extraction'),
              sql`${kgSchema.objectEvidence.createdAt} >= ${fiveMinAgo}`,
            ),
            limit: 20,
          });

          // Get object names for the extracted IDs
          const objectIds = [...new Set(recent.map(r => r.objectId))];
          const objects = objectIds.length > 0
            ? await knowledgeDb.query.objects.findMany({
                where: inArray(kgSchema.objects.id, objectIds),
              })
            : [];
          const nameMap = new Map(objects.map(o => [o.id, o.name]));

          return NextResponse.json({
            count: objectIds.length,
            items: objectIds.map(id => ({
              id,
              name: nameMap.get(id) ?? 'Unknown',
            })),
            bufferCount: await getBufferCount(),
          });
        } catch {
          return NextResponse.json({ count: 0, items: [], bufferCount: 0 });
        }
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

      case 'task-history': {
        const limit = parseInt(request.nextUrl.searchParams.get('limit') || '500', 10);
        const history = await db.query.taskHistory.findMany({
          orderBy: (h, { desc }) => [desc(h.timestamp)],
          limit: Math.min(limit, 2000),
        });
        return NextResponse.json(history);
      }

      case 'usage-stats': {
        // Aggregate LLM usage data for the dashboard
        const period = request.nextUrl.searchParams.get('period') || '30'; // days
        const since = new Date(Date.now() - parseInt(period) * 86400000).toISOString();

        const interactions = await db.query.llmInteractions.findMany({
          where: sql`${schema.llmInteractions.timestamp} >= ${since}`,
          orderBy: (t, { desc }) => [desc(t.timestamp)],
        });

        // Aggregate by operation
        const byOperation: Record<string, { calls: number; tokensIn: number; tokensOut: number; cost: number; avgLatency: number }> = {};
        let totalCost = 0;
        let totalCalls = 0;
        let totalTokensIn = 0;
        let totalTokensOut = 0;

        for (const i of interactions) {
          const op = i.purpose || 'unknown';
          if (!byOperation[op]) byOperation[op] = { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0, avgLatency: 0 };
          byOperation[op].calls++;
          byOperation[op].tokensIn += i.tokensIn || 0;
          byOperation[op].tokensOut += i.tokensOut || 0;
          byOperation[op].cost += i.costEstimate || 0;
          byOperation[op].avgLatency += i.latencyMs || 0;
          totalCost += i.costEstimate || 0;
          totalCalls++;
          totalTokensIn += i.tokensIn || 0;
          totalTokensOut += i.tokensOut || 0;
        }

        for (const op of Object.keys(byOperation)) {
          if (byOperation[op].calls > 0) {
            byOperation[op].avgLatency = Math.round(byOperation[op].avgLatency / byOperation[op].calls);
          }
        }

        // Aggregate by day for chart
        const byDay: Record<string, { calls: number; cost: number }> = {};
        for (const i of interactions) {
          const day = (i.timestamp ?? 'unknown').slice(0, 10); // Extract YYYY-MM-DD from any format
          if (!byDay[day]) byDay[day] = { calls: 0, cost: 0 };
          byDay[day].calls++;
          byDay[day].cost += i.costEstimate || 0;
        }

        return NextResponse.json({
          totalCalls, totalCost, totalTokensIn, totalTokensOut,
          byOperation, byDay,
          period: parseInt(period),
        });
      }

      case 'app-log': {
        const limitParam = parseInt(request.nextUrl.searchParams.get('limit') || '200', 10);
        const category = request.nextUrl.searchParams.get('category') || undefined;

        const where = category ? eq(schema.appLog.category, category as any) : undefined;
        const logs = await db.query.appLog.findMany({
          where,
          orderBy: (l, { desc }) => [desc(l.timestamp)],
          limit: Math.min(limitParam, 500),
        });
        return NextResponse.json(logs);
      }

      case 'integrity-check': {
        const issues: IntegrityIssue[] = [];
        const now = new Date();

        // 1. Check for stale inbox tasks (>48h without clarification)
        const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
        const staleInbox = await db.query.tasks.findMany({
          where: and(
            eq(schema.tasks.status, 'inbox'),
            lte(schema.tasks.createdAt, twoDaysAgo),
          ),
        });
        for (const t of staleInbox) {
          issues.push({
            type: 'stale_inbox',
            taskId: t.id,
            todoistId: t.todoistId || undefined,
            title: t.title,
            detail: `In inbox for ${Math.floor((now.getTime() - new Date(t.createdAt!).getTime()) / 86400000)} days without clarification`,
            resolution: { label: 'Clarify now', action: 'clarify' },
          });
        }

        // 2. Check for stale active tasks (>14 days no engagement)
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const staleActive = await db.query.tasks.findMany({
          where: and(
            eq(schema.tasks.status, 'active'),
            lte(schema.tasks.updatedAt, twoWeeksAgo),
          ),
        });
        for (const t of staleActive) {
          issues.push({
            type: 'stale_active',
            taskId: t.id,
            todoistId: t.todoistId || undefined,
            title: t.title,
            detail: `Active for ${Math.floor((now.getTime() - new Date(t.updatedAt!).getTime()) / 86400000)} days with no engagement`,
            resolution: { label: 'Review in Engage', action: 'review' },
          });
        }

        // 3. Compare local tasks with Todoist (sample: inbox + active tasks with todoistId)
        try {
          const localTasksWithTodoist = await db.query.tasks.findMany({
            where: and(
              ne(schema.tasks.status, 'killed'),
              ne(schema.tasks.status, 'completed'),
            ),
          });
          const localTodoistIds = new Set(
            localTasksWithTodoist.filter(t => t.todoistId).map(t => t.todoistId!)
          );

          // Fetch all open Todoist tasks
          const todoistTasks = await todoist.getTasks();
          const todoistIds = new Set(todoistTasks.map(t => t.id));

          // Tasks in Todoist but not locally
          for (const tt of todoistTasks) {
            if (!localTodoistIds.has(tt.id)) {
              issues.push({
                type: 'missing_locally',
                todoistId: tt.id,
                title: tt.content,
                detail: 'Task exists in Todoist but not in Burn-Down Engine',
                resolution: { label: 'Import task', action: 'import' },
              });
            }
          }

          // Tasks marked open locally but completed/missing in Todoist
          const todoistTaskMap = new Map(todoistTasks.map(t => [t.id, t]));
          for (const lt of localTasksWithTodoist) {
            if (lt.todoistId && !todoistIds.has(lt.todoistId)) {
              issues.push({
                type: 'missing_in_todoist',
                taskId: lt.id,
                todoistId: lt.todoistId,
                title: lt.title,
                detail: 'Task is open locally but missing or completed in Todoist',
                resolution: { label: 'Mark complete', action: 'complete' },
              });
            }

            // Sync conflict detection: title changed in both systems
            if (lt.todoistId && lt.status !== 'inbox') {
              const tt = todoistTaskMap.get(lt.todoistId);
              if (tt && tt.content !== lt.title && lt.updatedAt && lt.todoistSyncedAt && lt.updatedAt > lt.todoistSyncedAt) {
                issues.push({
                  type: 'sync_conflict',
                  taskId: lt.id,
                  todoistId: lt.todoistId,
                  title: lt.title,
                  detail: `Title differs — local: "${lt.title}" vs Todoist: "${tt.content}"`,
                  resolution: { label: 'Resolve', action: 'resolve_conflict' },
                  conflict: { field: 'title', localValue: lt.title, todoistValue: tt.content },
                });
              }
            }
          }
        } catch (e) {
          // Todoist API failure — report as warning but don't fail the check
          issues.push({
            type: 'status_mismatch',
            title: 'Todoist connection failed',
            detail: 'Could not compare with Todoist. Check your API key and network.',
            resolution: { label: 'Retry', action: 'retry' },
          });
        }

        // Determine level
        let level: IntegrityLevel = 'ok';
        const hasMissing = issues.some(i => i.type === 'missing_locally' || i.type === 'missing_in_todoist');
        const hasStale = issues.some(i => i.type === 'stale_inbox' || i.type === 'stale_active');
        if (hasMissing || issues.some(i => i.type === 'status_mismatch')) level = 'error';
        else if (hasStale) level = 'warning';

        return NextResponse.json({
          level,
          issues,
          checkedAt: now.toISOString(),
        });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    console.error(`GET ${action} error:`, error);
    logError('system', `GET ${action} failed`, { error: (error as Error).message });
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

  // Validate required fields for task-mutation actions
  const taskIdRequired = ['complete', 'defer', 'block', 'kill', 'kill-todoist', 'wait', 'delete', 'clarify', 'apply-clarification', 'answer-clarify', 'complete-in-clarify', 'update-task', 'dismiss-duplicate', 'enrich-legacy'];
  if (taskIdRequired.includes(action) && !body.taskId) {
    return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
  }

  try {
    switch (action) {
      case 'undo': {
        const task = await revertTask(
          body.taskId,
          body.snapshot,
          body.undoAction,
          body.todoistSynced,
        );
        return NextResponse.json(task);
      }
      // ─── Sync ──────────────────────────
      case 'sync-inbox': {
        logInfo('sync', 'Inbox sync started');
        const tasks = await syncInbox();
        logInfo('sync', `Inbox sync completed: ${tasks.length} tasks`, { count: tasks.length });
        // Don't run dedup here — the inbox page runs it explicitly via 'run-dedup'
        // to avoid race conditions with user dismissals
        return NextResponse.json({ synced: tasks.length, tasks });
      }

      case 'run-dedup': {
        // Explicit dedup trigger — embed all unembedded tasks, then detect duplicates.
        // Returns results synchronously (not fire-and-forget).
        const dedupSettings = await getAppSettings();
        const dedupResult = await runBackgroundDedup(dedupSettings.dupeSimilarityThreshold ?? 0.65);
        return NextResponse.json(dedupResult);
      }

      case 'sync-all': {
        logInfo('sync', 'Full sync started');
        await syncProjects();
        const tasks = await syncAllTasks();
        await refreshProjectCounts();
        logInfo('sync', `Full sync completed: ${tasks.length} tasks`, { count: tasks.length });
        // Don't run dedup here — caller runs it explicitly to avoid races
        return NextResponse.json({ synced: tasks.length });
      }

      // ─── Inbox ─────────────────────────
      case 'quick-add': {
        if (!body.content?.trim()) {
          return NextResponse.json({ error: 'content required' }, { status: 400 });
        }
        const todoistTask = await todoist.createTask({ content: body.content });
        let local;
        try {
          local = await db.insert(schema.tasks)
            .values({
              todoistId: todoistTask.id,
              originalText: body.content,
              title: body.content,
              status: 'inbox',
              todoistSyncedAt: new Date().toISOString(),
            })
            .returning();
        } catch (dbError) {
          // Clean up Todoist task if DB insert fails
          try { await todoist.deleteTask(todoistTask.id); } catch {}
          throw dbError;
        }

        // Don't run dedup here — inbox page runs it after sync to avoid races

        return NextResponse.json(local[0]);
      }

      // ─── Clarify ───────────────────────
      case 'delete': {
        const taskToDelete = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, body.taskId) });
        if (taskToDelete?.todoistId) {
          try { await todoist.deleteTask(taskToDelete.todoistId); } catch (e) {
            console.error('Failed to delete task in Todoist:', e);
          }
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

      // ─── Duplicate Management ─────────
      case 'preview-merge': {
        // Lightweight title suggestion — uses Gemini Flash directly, no extraction overhead
        if (!body.titles || !Array.isArray(body.titles) || body.titles.length < 2) {
          return NextResponse.json({ error: 'titles array required' }, { status: 400 });
        }
        try {
          const { geminiGenerateJSON } = await import('@/lib/llm/gemini');
          const titleList = body.titles.map((t: string) => `- "${t}"`).join('\n');
          const suggestion = await geminiGenerateJSON<{ title: string }>({
            system: 'Merge duplicate task titles into one clean, actionable title. Return JSON: {"title": "..."}',
            prompt: `These are duplicates. One clean title:\n${titleList}`,
          });
          return NextResponse.json({ suggestedTitle: suggestion.title?.trim() || body.titles[0] });
        } catch {
          return NextResponse.json({ suggestedTitle: body.titles[0] });
        }
      }

      case 'merge-duplicates': {
        if (!body.primaryTaskId || !body.duplicateTaskId) {
          return NextResponse.json({ error: 'primaryTaskId and duplicateTaskId required' }, { status: 400 });
        }
        // If the caller provides a pre-approved title, pass it through
        const merged = await mergeTasks(body.primaryTaskId, body.duplicateTaskId, body.mergedTitle);
        return NextResponse.json(merged);
      }

      case 'dismiss-duplicate': {
        const dismissed = await dismissDuplicate(body.taskId, body.groupTaskIds);
        return NextResponse.json(dismissed);
      }

      case 'recalculate-duplicates': {
        const recalcSettings = await getAppSettings();
        const flagged = await detectDuplicates(recalcSettings.dupeSimilarityThreshold ?? 0.65);
        return NextResponse.json({ flagged });
      }

      // ─── Knowledge Migration ──────────
      case 'migrate-knowledge': {
        const { migrateLegacyKnowledge, setupVectorIndex } = await import('@/lib/knowledge/migration');
        const migResult = await migrateLegacyKnowledge();
        // Create vector index after migration (safe to call multiple times)
        try { await setupVectorIndex(); } catch (e) {
          migResult.errors.push(`Vector index creation: ${(e as Error).message}`);
        }
        logInfo('system', `Knowledge migration completed: ${migResult.objectsMigrated} objects, ${migResult.peopleMigrated} people, ${migResult.embeddingsGenerated} embeddings`);
        return NextResponse.json(migResult);
      }

      case 'knowledge-migration-status': {
        const { isMigrationComplete } = await import('@/lib/knowledge/migration');
        const complete = await isMigrationComplete();
        return NextResponse.json({ migrated: complete });
      }

      // ─── Knowledge Consolidation ──────
      case 'consolidate-knowledge': {
        const consolidateResult = await runConsolidation({ scope: body.scope || 'full' });
        logInfo('system', `Knowledge consolidation: ${consolidateResult.mergesPerformed} merges, ${consolidateResult.synthesesCreated} syntheses, ${consolidateResult.dormancyTransitions} dormant`);
        return NextResponse.json(consolidateResult);
      }

      case 'revert-consolidation': {
        if (!body.runId) return NextResponse.json({ error: 'runId required' }, { status: 400 });
        const revertResult = await revertConsolidationRun(body.runId);
        return NextResponse.json(revertResult);
      }

      case 'finalize-references': {
        if (!body.interactionId || !body.outcome) {
          return NextResponse.json({ error: 'interactionId and outcome required' }, { status: 400 });
        }
        await finalizeReferenceOutcomes(body.interactionId, body.outcome);
        return NextResponse.json({ ok: true });
      }

      // ─── Legacy Enrichment ────────────
      case 'enrich-legacy': {
        // Fetch task + project for context
        const legacyTask = await db.query.tasks.findFirst({
          where: eq(schema.tasks.id, body.taskId),
        });
        if (!legacyTask) {
          return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        }

        let projectName: string | null = null;
        if (legacyTask.projectId) {
          const proj = await db.query.projects.findFirst({
            where: eq(schema.projects.id, legacyTask.projectId),
          });
          projectName = proj?.name ?? null;
        }

        // Build legacy-specific instructions
        const instructions = buildLegacyEnrichmentInstructions({
          projectName,
          priority: legacyTask.priority ?? 4,
          labels: legacyTask.labels ?? '[]',
          dueDate: legacyTask.dueDate,
          description: legacyTask.description,
        });

        // Clarify with existing metadata as context
        const result = await clarifyTask(body.taskId, instructions);

        // Server-side guard: lock project and merge labels
        if (projectName) {
          result.projectName = projectName;
          result.newProject = false;
        }
        const existingLabels: string[] = JSON.parse(legacyTask.labels || '[]');
        result.labels = Array.from(new Set([...existingLabels, ...(result.labels || [])]));

        return NextResponse.json(result);
      }

      case 'answer-clarify': {
        const result = await answerClarifyQuestion(body.taskId, body.answer);
        return NextResponse.json(result);
      }

      // ─── Engage ────────────────────────
      case 'complete': {
        const completed = await completeTask(body.taskId);
        let syncWarning: string | undefined;
        try { await completeTaskInTodoist(completed); } catch (e) {
          syncWarning = `Failed to complete task in Todoist: ${(e as Error).message}`;
          console.error(syncWarning);
        }
        void writeToExtractionBuffer({ eventType: 'complete', taskId: completed.id, taskTitle: completed.title, taskContext: { projectId: completed.projectId, priority: completed.priority } }).catch(() => {});
        return NextResponse.json({ ...completed, syncWarning });
      }

      case 'defer': {
        const deferred = await bumpTask(body.taskId, body.reason);
        void writeToExtractionBuffer({ eventType: 'defer', taskId: body.taskId, taskTitle: deferred.title, taskContext: { reason: body.reason, bumpCount: deferred.bumpCount } }).catch(() => {});
        return NextResponse.json(deferred);
      }

      case 'block': {
        const blocked = await blockTask(body.taskId, body.blockerNote);
        void writeToExtractionBuffer({ eventType: 'block', taskId: body.taskId, taskTitle: blocked.title, taskContext: { blockerNote: body.blockerNote } }).catch(() => {});
        return NextResponse.json(blocked);
      }

      case 'fire': {
        const result = await handleFire({ description: body.description });
        void writeToExtractionBuffer({ eventType: 'fire', taskTitle: body.description }).catch(() => {});
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
        if (!body.deferTodoist && taskToKill) {
          try { await killTaskInTodoist(taskToKill); } catch (e) {
            console.error('Failed to kill task in Todoist:', e);
          }
        }
        void writeToExtractionBuffer({ eventType: 'kill', taskId: body.taskId, taskTitle: taskToKill?.title ?? killed[0]?.title }).catch(() => {});
        return NextResponse.json(killed[0]);
      }

      case 'kill-todoist': {
        // Deferred Todoist DELETE — called after undo window expires
        const taskForKill = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, body.taskId) });
        if (taskForKill) {
          try { await killTaskInTodoist(taskForKill); } catch (e) {
            console.error('Deferred Todoist kill failed:', e);
          }
        }
        return NextResponse.json({ ok: true });
      }

      case 'wait': {
        const waited = await waitTask(body.taskId, body.waitingFor);
        void writeToExtractionBuffer({ eventType: 'wait', taskId: body.taskId, taskTitle: waited.title, taskContext: { waitingFor: body.waitingFor } }).catch(() => {});
        return NextResponse.json(waited);
      }

      case 'complete-in-clarify': {
        const taskToComplete = await db.query.tasks.findFirst({ where: eq(schema.tasks.id, body.taskId) });
        if (!taskToComplete) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
        const completedTask = await completeTask(body.taskId);
        let clarifyCompleteWarning: string | undefined;
        try { await completeTaskInTodoist(completedTask); } catch (e) {
          clarifyCompleteWarning = `Failed to complete task in Todoist: ${(e as Error).message}`;
          console.error(clarifyCompleteWarning);
        }
        return NextResponse.json({ ...completedTask, syncWarning: clarifyCompleteWarning });
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

        // Allowlist fields to prevent mass assignment
        const allowedProjectFields = ['name', 'category', 'goal', 'status', 'notes'];
        const safeProjectData: Record<string, unknown> = {};
        for (const key of allowedProjectFields) {
          if (key in (body.data || {})) safeProjectData[key] = body.data[key];
        }
        safeProjectData.updatedAt = new Date().toISOString();

        const updated = await db.update(schema.projects)
          .set(safeProjectData)
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

      // ─── Knowledge Graph CRUD ────────
      case 'kg-update-object': {
        const { knowledgeDb: kdb, schema: kgs } = await import('@/lib/knowledge/db');
        if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        const updates: any = { updatedAt: new Date().toISOString() };
        if (body.name !== undefined) updates.name = body.name;
        if (body.properties !== undefined) updates.properties = typeof body.properties === 'string' ? body.properties : JSON.stringify(body.properties);
        if (body.confidence !== undefined) updates.confidence = body.confidence;
        if (body.status !== undefined) updates.status = body.status;
        if (body.pinned !== undefined) {
          updates.pinned = body.pinned ? 1 : 0;
          updates.pinnedAt = body.pinned ? new Date().toISOString() : null;
        }
        if (body.subtype !== undefined) updates.subtype = body.subtype;
        const updated = await kdb.update(kgs.objects).set(updates).where(eq(kgs.objects.id, body.id)).returning();
        return NextResponse.json(updated[0]);
      }

      case 'kg-delete-object': {
        // Tombstone — set status to 'deleted', never hard delete
        const { knowledgeDb: kdb, schema: kgs } = await import('@/lib/knowledge/db');
        if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        const deleted = await kdb.update(kgs.objects).set({
          status: 'deleted',
          updatedAt: new Date().toISOString(),
        }).where(eq(kgs.objects.id, body.id)).returning();
        return NextResponse.json(deleted[0]);
      }

      case 'kg-review-resolve': {
        const { knowledgeDb: kdb, schema: kgs } = await import('@/lib/knowledge/db');
        if (!body.id || !body.resolution) return NextResponse.json({ error: 'id and resolution required' }, { status: 400 });

        if (body.resolution === 'approved' && body.objectId) {
          // Direct update on the protected object
          const proposed = body.proposedData ? (typeof body.proposedData === 'string' ? JSON.parse(body.proposedData) : body.proposedData) : {};
          const updates: any = { updatedAt: new Date().toISOString() };
          if (proposed.name) updates.name = proposed.name;
          if (proposed.properties) updates.properties = typeof proposed.properties === 'string' ? proposed.properties : JSON.stringify(proposed.properties);
          if (proposed.confidence) updates.confidence = proposed.confidence;
          await kdb.update(kgs.objects).set(updates).where(eq(kgs.objects.id, body.objectId));
        }

        await kdb.update(kgs.reviewQueue).set({
          status: body.resolution,
          resolvedAt: new Date().toISOString(),
        }).where(eq(kgs.reviewQueue.id, body.id));
        return NextResponse.json({ success: true });
      }

      case 'kg-import': {
        const { upsertKnowledge } = await import('@/lib/knowledge/upsert');
        const imported = body.data;
        if (!imported?.objects) return NextResponse.json({ error: 'Invalid import data' }, { status: 400 });

        let objectsImported = 0;
        let linksImported = 0;
        const importErrors: string[] = [];

        // Import objects in batches via upsertKnowledge (additive, dedup-key matching)
        const batchSize = 10;
        for (let i = 0; i < imported.objects.length; i += batchSize) {
          const batch = imported.objects.slice(i, i + batchSize).map((o: any) => ({
            type: o.type,
            name: o.name,
            subtype: o.subtype || undefined,
            properties: typeof o.properties === 'string' ? JSON.parse(o.properties) : (o.properties || {}),
            confidence: o.confidence ?? 0.7,
            sensitivity: o.sensitivity || undefined,
          }));
          const batchLinks = (imported.links || []).slice(0, 8).map((l: any) => ({
            sourceName: l.sourceName || '',
            sourceType: l.sourceType || 'concept',
            targetName: l.targetName || '',
            targetType: l.targetType || 'concept',
            linkType: l.linkType,
            confidence: l.confidence ?? 0.7,
          }));
          try {
            const result = await upsertKnowledge({ objects: batch, links: i === 0 ? batchLinks : [] }, 'manual', { sourceContext: 'review' });
            objectsImported += result.objectsCreated + result.objectsUpdated;
            linksImported += result.linksCreated;
            importErrors.push(...result.errors);
          } catch (e) {
            importErrors.push((e as Error).message);
          }
        }
        return NextResponse.json({ objectsImported, linksImported, errors: importErrors });
      }

      case 'kg-backfill-embeddings': {
        const { knowledgeDb: kdb, schema: kgs } = await import('@/lib/knowledge/db');
        const { generateEmbedding, buildEmbeddingText } = await import('@/lib/knowledge/embedding');
        const { KNOWLEDGE_CONFIG: KC } = await import('@/lib/knowledge/config');
        const { isNull: isNullOp } = await import('drizzle-orm');

        const regenerateAll = body.regenerateAll === true;
        const where = regenerateAll ? undefined : isNullOp(kgs.objects.embedding);
        const objects = await kdb.query.objects.findMany({ where });

        let generated = 0;
        const backfillErrors: string[] = [];
        for (const obj of objects) {
          try {
            const props = JSON.parse(obj.properties || '{}');
            const text = buildEmbeddingText({ type: obj.type, name: obj.name, properties: props });
            const embedding = await generateEmbedding(text, { sourceContext: 'review' });
            await kdb.update(kgs.objects).set({
              embedding, embeddingModel: KC.EMBEDDING_MODEL, embeddingText: text,
            }).where(eq(kgs.objects.id, obj.id));
            generated++;
          } catch (e) {
            backfillErrors.push(`${obj.name}: ${(e as Error).message}`);
          }
        }
        return NextResponse.json({ generated, total: objects.length, errors: backfillErrors });
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
    logError('system', `POST ${action} failed`, { error: (error as Error).message });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
