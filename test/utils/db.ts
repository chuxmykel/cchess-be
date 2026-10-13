import type { DataSource } from 'typeorm';

/**
 * Tests now share one persistent Postgres database (see TEST_DB_NAME in
 * .env/.env.example) instead of each getting a fresh SQLite :memory:
 * instance, so isolation has to be done explicitly: wipe every app table
 * before each test app boots. Table names come from entity metadata rather
 * than a hardcoded list so this doesn't silently go stale as entities are
 * added.
 */
export async function truncateAllTables(dataSource: DataSource): Promise<void> {
  const tableNames = dataSource.entityMetadatas.map((m) => `"${m.tableName}"`).join(', ');
  if (!tableNames) return;
  await dataSource.query(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE`);
}
