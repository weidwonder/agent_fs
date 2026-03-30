// packages/server/src/routes/search-routes.ts

import type { FastifyInstance } from 'fastify';
import { createAuthMiddleware } from '../middleware/auth.js';
import type { SearchService } from '../services/search-service.js';
import { createCloudAdapter } from '@agent-fs/storage-cloud';

export async function searchRoutes(
  app: FastifyInstance,
  searchService: SearchService,
  jwtSecret: string,
): Promise<void> {
  const auth = createAuthMiddleware(jwtSecret);

  app.post('/search', { preHandler: auth }, async (request, reply) => {
    const { query, keyword, scope, topK } = request.body as {
      query: string;
      keyword?: string;
      scope?: string | string[];
      topK?: number;
    };

    if (!query) {
      return reply.status(400).send({ error: 'query is required' });
    }

    const tenantId = request.user!.tenantId;
    const adapter = createCloudAdapter({ tenantId });
    await adapter.init();

    try {
      return await searchService.search(
        { tenantId, query, keyword, scope, topK },
        adapter,
      );
    } finally {
      await adapter.close();
    }
  });
}
