// packages/server/src/auth/sse-ticket.ts
// Short-lived ticket store for SSE authentication.
// Uses PostgreSQL for multi-instance compatibility.
// Tickets are one-time use with a 60s TTL.

import { randomUUID } from 'node:crypto';
import { getPool } from '@agent-fs/storage-cloud';
import type { AuthUser } from '../middleware/auth.js';

const TICKET_TTL_MS = 60_000;

/** Ensure the sse_tickets table exists (called once at startup). */
export async function initTicketStore(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sse_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      role TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
}

export async function createTicket(user: AuthUser): Promise<string> {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + TICKET_TTL_MS);
  const pool = getPool();
  await pool.query(
    'INSERT INTO sse_tickets (id, user_id, tenant_id, role, expires_at) VALUES ($1, $2, $3, $4, $5)',
    [id, user.userId, user.tenantId, user.role, expiresAt],
  );
  return id;
}

/** Validate and consume a ticket. Returns user or null if invalid/expired. */
export async function consumeTicket(id: string): Promise<AuthUser | null> {
  const pool = getPool();
  const result = await pool.query(
    'DELETE FROM sse_tickets WHERE id = $1 AND expires_at > now() RETURNING user_id, tenant_id, role',
    [id],
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return { userId: row.user_id, tenantId: row.tenant_id, role: row.role };
}

/** Cleanup expired tickets (call periodically or via pg_cron). */
export async function cleanExpiredTickets(): Promise<void> {
  const pool = getPool();
  await pool.query('DELETE FROM sse_tickets WHERE expires_at < now()');
}
