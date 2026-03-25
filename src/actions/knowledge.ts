'use server';

import { db, schema } from '@/lib/db/client';
import { eq, desc } from 'drizzle-orm';
import { embedKnowledgeEntry } from '@/lib/embeddings/generate';
import { revalidatePath } from 'next/cache';

export async function getKnowledgeEntries(category?: string) {
  if (category) {
    return db.query.knowledgeEntries.findMany({
      where: eq(schema.knowledgeEntries.category, category as any),
      orderBy: [desc(schema.knowledgeEntries.updatedAt)],
    });
  }
  return db.query.knowledgeEntries.findMany({
    orderBy: [desc(schema.knowledgeEntries.updatedAt)],
  });
}

export async function getPeople() {
  return db.query.people.findMany({
    orderBy: [desc(schema.people.updatedAt)],
  });
}

export async function createKnowledgeEntry(data: {
  category: string;
  key: string;
  value: string;
  confidence?: number;
}) {
  const entry = await db.insert(schema.knowledgeEntries)
    .values({
      category: data.category as any,
      key: data.key,
      value: data.value,
      confidence: data.confidence || 1.0,
      source: 'user_edit',
    })
    .returning();

  // Generate embedding (best-effort, non-blocking)
  void embedKnowledgeEntry(entry[0]).catch(() => {});

  revalidatePath('/knowledge');
  return entry[0];
}

export async function updateKnowledgeEntry(id: string, data: {
  key?: string;
  value?: string;
  confidence?: number;
  category?: string;
}) {
  const updated = await db.update(schema.knowledgeEntries)
    .set({ ...data, updatedAt: new Date().toISOString(), category: data.category as any })
    .where(eq(schema.knowledgeEntries.id, id))
    .returning();

  if (updated[0]) void embedKnowledgeEntry(updated[0]).catch(() => {});

  revalidatePath('/knowledge');
  return updated[0];
}

export async function deleteKnowledgeEntry(id: string) {
  await db.delete(schema.knowledgeEntries)
    .where(eq(schema.knowledgeEntries.id, id));
  revalidatePath('/knowledge');
}

export async function createPerson(data: {
  name: string;
  relationship?: string;
  organization?: string;
  role?: string;
  contextNotes?: string;
}) {
  const person = await db.insert(schema.people)
    .values(data)
    .returning();

  revalidatePath('/knowledge');
  return person[0];
}

export async function updatePerson(id: string, data: Partial<schema.Person>) {
  const updated = await db.update(schema.people)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(schema.people.id, id))
    .returning();

  revalidatePath('/knowledge');
  return updated[0];
}

export async function deletePerson(id: string) {
  await db.delete(schema.people)
    .where(eq(schema.people.id, id));
  revalidatePath('/knowledge');
}

export async function getKnowledgeStats() {
  const entries = await db.query.knowledgeEntries.findMany();
  const people = await db.query.people.findMany();

  const byCategory: Record<string, number> = {};
  let totalConfidence = 0;
  let maxReferenced = { key: '', count: 0 };

  for (const entry of entries) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
    totalConfidence += entry.confidence || 0;
    if ((entry.timesReferenced || 0) > maxReferenced.count) {
      maxReferenced = { key: entry.key, count: entry.timesReferenced || 0 };
    }
  }

  return {
    totalEntries: entries.length,
    totalPeople: people.length,
    byCategory,
    avgConfidence: entries.length > 0 ? totalConfidence / entries.length : 0,
    mostReferenced: maxReferenced,
  };
}
