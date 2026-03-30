// packages/storage-cloud/src/db.ts

import pg from 'pg';

export interface DbConfig {
  connectionString: string;
  maxConnections?: number;
}

let pool: pg.Pool | null = null;

export async function initDb(config: DbConfig): Promise<pg.Pool> {
  pool = new pg.Pool({
    connectionString: config.connectionString,
    max: config.maxConnections ?? 20,
  });
  const client = await pool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  } finally {
    client.release();
  }
  return pool;
}

export function getPool(): pg.Pool {
  if (!pool) throw new Error('Database not initialized. Call initDb() first.');
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
