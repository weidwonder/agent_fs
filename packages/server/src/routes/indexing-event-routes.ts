// packages/server/src/routes/indexing-event-routes.ts

import type { FastifyInstance } from 'fastify';
import { getPool } from '@agent-fs/storage-cloud';
import { createAuthMiddleware } from '../middleware/auth.js';

export async function indexingEventRoutes(
  app: FastifyInstance,
  jwtSecret: string,
): Promise<void> {
  const auth = createAuthMiddleware(jwtSecret);

  app.get(
    '/projects/:projectId/indexing-events',
    { preHandler: auth },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const tenantId = request.user!.tenantId;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const pool = getPool();

      const interval = setInterval(async () => {
        try {
          const result = await pool.query(
            `SELECT f.id, f.name, f.status, f.chunk_count, f.error_message, f.indexed_at
             FROM files f
             JOIN directories d ON f.directory_id = d.id
             WHERE d.project_id = $1 AND f.tenant_id = $2
             ORDER BY f.created_at DESC
             LIMIT 50`,
            [projectId, tenantId],
          );
          reply.raw.write(`data: ${JSON.stringify({ files: result.rows })}\n\n`);
        } catch {
          // Client may have disconnected
        }
      }, 2000);

      request.raw.on('close', () => {
        clearInterval(interval);
      });

      // Hijack so Fastify doesn't auto-close the response
      reply.hijack();
    },
  );
}
