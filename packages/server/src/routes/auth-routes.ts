// packages/server/src/routes/auth-routes.ts

import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../services/auth-service.js';
import { createAuthMiddleware } from '../middleware/auth.js';
import { createTicket } from '../auth/sse-ticket.js';

export async function authRoutes(
  app: FastifyInstance,
  authService: AuthService,
  jwtSecret?: string,
): Promise<void> {
  // POST /auth/sse-ticket — exchange a Bearer JWT for a short-lived one-time SSE ticket
  if (jwtSecret) {
    const auth = createAuthMiddleware(jwtSecret);
    app.post('/auth/sse-ticket', { preHandler: auth }, async (request, reply) => {
      const ticket = await createTicket(request.user!);
      return reply.send({ ticket });
    });
  }
  app.post('/auth/register', async (request, reply) => {
    const { email, password, tenantName } = request.body as {
      email: string;
      password: string;
      tenantName?: string;
    };
    try {
      const result = await authService.register(
        email,
        password,
        tenantName ?? `${email}'s workspace`,
      );
      return reply.status(201).send(result);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'EMAIL_TAKEN') {
        return reply.status(409).send({ error: 'Email already registered' });
      }
      throw err;
    }
  });

  app.post('/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string };
    try {
      const result = await authService.login(email, password);
      return reply.send(result);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'INVALID_CREDENTIALS') {
        return reply.status(401).send({ error: 'Invalid email or password' });
      }
      throw err;
    }
  });

  app.post('/auth/refresh', async (request, reply) => {
    const { refreshToken } = request.body as { refreshToken: string };
    try {
      const result = await authService.refresh(refreshToken);
      return reply.send(result);
    } catch (err: unknown) {
      if (err instanceof Error && (err.message === 'INVALID_TOKEN' || err.message === 'NO_TENANT')) {
        return reply.status(401).send({ error: 'Invalid or expired refresh token' });
      }
      throw err;
    }
  });
}
