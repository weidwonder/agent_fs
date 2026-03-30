// packages/server/src/middleware/auth.ts

import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { verifyToken } from '../auth/jwt.js';
import { consumeTicket } from '../auth/sse-ticket.js';

export interface AuthUser {
  userId: string;
  tenantId: string;
  role: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function createAuthMiddleware(jwtSecret: string): preHandlerHookHandler {
  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const query = request.query as Record<string, string>;

    // SSE ticket auth — one-time ticket via ?ticket= query param (avoids JWT in URL logs)
    const ticketId = query?.ticket;
    if (ticketId) {
      const user = await consumeTicket(ticketId);
      if (!user) {
        await reply.status(401).send({ error: 'Invalid or expired SSE ticket' });
        return;
      }
      request.user = user;
      return;
    }

    const authHeader = request.headers.authorization;

    let token: string;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else {
      await reply.status(401).send({ error: 'Missing or invalid Authorization header' });
      return;
    }
    try {
      const payload = verifyToken(token, jwtSecret) as any;
      if (payload.type !== 'access') {
        await reply.status(401).send({ error: 'Invalid token type' });
        return;
      }
      request.user = {
        userId: payload.userId as string,
        tenantId: payload.tenantId as string,
        role: payload.role as string,
      };
    } catch {
      await reply.status(401).send({ error: 'Invalid or expired token' });
    }
  };
}
