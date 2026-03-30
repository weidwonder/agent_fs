// packages/server/src/routes/document-routes.ts

import type { FastifyInstance } from 'fastify';
import { createAuthMiddleware } from '../middleware/auth.js';
import type { IndexingService } from '../services/indexing-service.js';

export async function documentRoutes(
  app: FastifyInstance,
  indexingService: IndexingService,
  jwtSecret: string,
): Promise<void> {
  const auth = createAuthMiddleware(jwtSecret);

  // POST /projects/:projectId/upload — multipart file upload
  app.post(
    '/projects/:projectId/upload',
    { preHandler: auth },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const tenantId = request.user!.tenantId;

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ error: 'No file provided' });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk);
      }
      const fileBuffer = Buffer.concat(chunks);

      const result = await indexingService.uploadAndEnqueue(
        tenantId,
        projectId,
        data.filename,
        fileBuffer,
      );

      return reply.status(202).send(result);
    },
  );

  // GET /projects/:projectId/files — list files
  app.get(
    '/projects/:projectId/files',
    { preHandler: auth },
    async (request) => {
      const { projectId } = request.params as { projectId: string };
      const tenantId = request.user!.tenantId;
      const files = await indexingService.listFiles(tenantId, projectId);
      return { files };
    },
  );

  // DELETE /files/:fileId — delete file
  app.delete('/files/:fileId', { preHandler: auth }, async (request, reply) => {
    const { fileId } = request.params as { fileId: string };
    const tenantId = request.user!.tenantId;
    const deleted = await indexingService.deleteFile(tenantId, fileId);
    if (!deleted) return reply.status(404).send({ error: 'File not found' });
    return reply.status(204).send();
  });
}
