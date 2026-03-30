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

  // POST /projects/:projectId/upload — multipart file upload (multiple files)
  app.post(
    '/projects/:projectId/upload',
    { preHandler: auth },
    async (request, reply) => {
      const { projectId } = request.params as { projectId: string };
      const tenantId = request.user!.tenantId;

      const results: { fileId: string; fileName: string }[] = [];
      for await (const part of request.files()) {
        const fileChunks: Buffer[] = [];
        for await (const chunk of part.file) {
          fileChunks.push(chunk);
        }
        const fileBuffer = Buffer.concat(fileChunks);
        const result = await indexingService.uploadAndEnqueue(
          tenantId,
          projectId,
          part.filename,
          fileBuffer,
        );
        results.push({ fileId: result.fileId, fileName: part.filename });
      }

      if (results.length === 0) {
        return reply.status(400).send({ error: 'No files provided' });
      }

      return reply.status(202).send({ files: results });
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
