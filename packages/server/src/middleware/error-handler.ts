// packages/server/src/middleware/error-handler.ts

import type { FastifyError, FastifyRequest, FastifyReply } from 'fastify';

const ERROR_STATUS_MAP: Record<string, number> = {
  EMAIL_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  INVALID_TOKEN: 401,
  NO_TENANT: 403,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
};

const ERROR_MESSAGE_MAP: Record<string, string> = {
  EMAIL_TAKEN: 'Email already registered',
  INVALID_CREDENTIALS: 'Invalid email or password',
  INVALID_TOKEN: 'Invalid or expired token',
  NO_TENANT: 'No tenant associated with this account',
  NOT_FOUND: 'Resource not found',
  FORBIDDEN: 'Access denied',
};

export function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  const code = error.message;
  const status = ERROR_STATUS_MAP[code] ?? error.statusCode ?? 500;
  const message = ERROR_MESSAGE_MAP[code] ?? error.message ?? 'Internal server error';

  if (status >= 500) {
    console.error('Server error:', error);
  }

  void reply.status(status).send({ error: message });
}
