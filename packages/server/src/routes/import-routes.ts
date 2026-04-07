import type { FastifyInstance } from 'fastify';
import { createAuthMiddleware } from '../middleware/auth.js';
import { buildEmbeddingConfig } from '../services/embedding-config.js';
import type { ImportFileRequest, ImportService } from '../services/import-service.js';

export async function importRoutes(
  app: FastifyInstance,
  importService: ImportService,
  jwtSecret: string,
): Promise<void> {
  const auth = createAuthMiddleware(jwtSecret);

  app.get(
    '/projects/:projectId/embedding-info',
    { preHandler: auth },
    async (_request, reply) => {
      const config = buildEmbeddingConfig();
      const model = config.default === 'api' ? config.api!.model : config.local!.model;
      const dimension = Number(process.env['EMBEDDING_DIMENSION'] ?? '512');
      return reply.send({ model, dimension });
    },
  );

  app.post(
    '/projects/:projectId/import',
    { preHandler: auth },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const tenantId = request.user!.tenantId;
      const body = request.body as ImportFileRequest;

      try {
        const result = await importService.importFile(tenantId, projectId, body);
        return reply.status(201).send(result);
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'FILE_EXISTS') {
          return reply.status(409).send({ error: 'File already exists in this directory' });
        }
        if (error instanceof Error && error.message === 'PROJECT_NOT_FOUND') {
          return reply.status(404).send({ error: 'Project not found' });
        }
        throw error;
      }
    },
  );
}
