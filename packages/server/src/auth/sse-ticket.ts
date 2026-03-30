// packages/server/src/auth/sse-ticket.ts
// In-memory short-lived ticket store for SSE authentication.
// Tickets are one-time use with a 60s TTL.

import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../middleware/auth.js';

interface Ticket {
  user: AuthUser;
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();
const TICKET_TTL_MS = 60_000;

// Periodically clean expired tickets
setInterval(() => {
  const now = Date.now();
  for (const [id, ticket] of tickets) {
    if (ticket.expiresAt < now) tickets.delete(id);
  }
}, 30_000).unref();

export function createTicket(user: AuthUser): string {
  const id = randomUUID();
  tickets.set(id, { user, expiresAt: Date.now() + TICKET_TTL_MS });
  return id;
}

/** Validate and consume a ticket. Returns user or null if invalid/expired. */
export function consumeTicket(id: string): AuthUser | null {
  const ticket = tickets.get(id);
  if (!ticket) return null;
  tickets.delete(id);
  if (ticket.expiresAt < Date.now()) return null;
  return ticket.user;
}
