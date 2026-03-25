/**
 * Seeds the knowledge base with personal context from seed.json.
 *
 * Usage:
 *   cp seed.example.json seed.json   # then edit with your info
 *   npm run db:seed
 *
 * Safe to run multiple times — skips entries that already exist (matched by key).
 */

/// <reference types="node" />

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq, and } from 'drizzle-orm';
import * as schema from './src/lib/db/schema';
import * as fs from 'fs';
import * as path from 'path';

async function seed() {
  const seedPath = path.join(process.cwd(), 'seed.json');

  if (!fs.existsSync(seedPath)) {
    console.error('❌ seed.json not found. Copy seed.example.json to seed.json and fill in your data.');
    console.error('   cp seed.example.json seed.json');
    process.exit(1);
  }

  if (!process.env.TURSO_DATABASE_URL) {
    console.error('❌ TURSO_DATABASE_URL not set. Make sure your .env.local is configured.');
    process.exit(1);
  }

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const db = drizzle(client, { schema });

  const data = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  let created = 0;
  let skipped = 0;

  // Seed people
  if (Array.isArray(data.people)) {
    for (const person of data.people) {
      const existing = await db.query.people.findFirst({
        where: eq(schema.people.name, person.name),
      });

      if (existing) {
        console.log(`  ⏭️  Person "${person.name}" already exists, skipping`);
        skipped++;
        continue;
      }

      await db.insert(schema.people).values({
        name: person.name,
        relationship: person.relationship,
        organization: person.organization,
        role: person.role,
        contextNotes: person.contextNotes,
        relatedProjects: JSON.stringify(person.relatedProjects || []),
      });
      console.log(`  ✅ Added person: ${person.name}`);
      created++;
    }
  }

  // Seed knowledge entries
  if (Array.isArray(data.knowledge)) {
    for (const entry of data.knowledge) {
      const existing = await db.query.knowledgeEntries.findFirst({
        where: and(
          eq(schema.knowledgeEntries.category, entry.category),
          eq(schema.knowledgeEntries.key, entry.key),
        ),
      });

      if (existing) {
        console.log(`  ⏭️  Knowledge "${entry.category}/${entry.key}" already exists, skipping`);
        skipped++;
        continue;
      }

      await db.insert(schema.knowledgeEntries).values({
        category: entry.category,
        key: entry.key,
        value: entry.value,
        confidence: 1.0,
        source: 'seed',
      });
      console.log(`  ✅ Added knowledge: ${entry.category}/${entry.key}`);
      created++;
    }
  }

  console.log(`\n🌱 Seed complete: ${created} created, ${skipped} skipped`);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
