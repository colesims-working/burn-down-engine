import { migrateLegacyKnowledge, setupVectorIndex } from '../src/lib/knowledge/migration';

async function main() {
  console.log('Running knowledge migration...');
  const result = await migrateLegacyKnowledge();
  console.log(`Objects migrated: ${result.objectsMigrated}`);
  console.log(`People migrated: ${result.peopleMigrated}`);
  console.log(`Links migrated: ${result.linksMigrated}`);
  console.log(`Embeddings generated: ${result.embeddingsGenerated}`);
  if (result.errors.length > 0) {
    console.log(`Errors (${result.errors.length}):`);
    result.errors.forEach(e => console.log(`  - ${e}`));
  }

  console.log('\nEnsuring vector + pinned indexes...');
  await setupVectorIndex();
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
