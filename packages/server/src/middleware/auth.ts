// packages/server/src/middleware/auth.ts

import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify';
import { verifyToken } from '../auth/jwt.js';

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
    const authHeader = request.headers.authorization;
    // Allow token via query param as fallback for SSE connections
    const queryToken = (request.query as Record<string, string>)?.token;

    let token: string;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    } else if (queryToken) {
      token = queryToken;
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
