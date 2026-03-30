// packages/server/src/app.ts

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { ServerConfig } from './config.js';
import { initDependencies, disposeDependencies } from './di.js';
import { AuthService } from './services/auth-service.js';
import { ProjectService } from './services/project-service.js';
import { IndexingService } from './services/indexing-service.js';
import { SearchService } from './services/search-service.js';
import { McpToolService } from './services/mcp-tool-service.js';
import { authRoutes } from './routes/auth-routes.js';
import { projectRoutes } from './routes/project-routes.js';
import { documentRoutes } from './routes/document-routes.js';
import { indexingEventRoutes } from './routes/indexing-event-routes.js';
import { searchRoutes } from './routes/search-routes.js';
import { mcpRoutes } from './mcp/streamable.js';
import { errorHandler } from './middleware/error-handler.js';
import PgBoss from 'pg-boss';
import { EmbeddingService } from '@agent-fs/llm';

export async function createApp(config: ServerConfig) {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(multipart);

  await initDependencies(config);

  // Embedding service — global singleton
  const embeddingConfig = buildEmbeddingConfig();
  const embeddingService = new EmbeddingService(embeddingConfig);
  await embeddingService.init();

  // pg-boss for enqueuing (HTTP server doesn't run workers)
  const boss = new PgBoss(config.databaseUrl);
  await boss.start();

  const authService = new AuthService(
    config.jwtSecret,
    config.jwtExpiresIn,
    config.jwtRefreshExpiresIn,
  );
  const projectService = new ProjectService();
  const indexingService = new IndexingService(boss);
  const searchService = new SearchService(embeddingService);
  const mcpToolService = new McpToolService(searchService, indexingService);

  await authRoutes(app, authService);
  await projectRoutes(app, projectService, config.jwtSecret);
  await documentRoutes(app, indexingService, config.jwtSecret);
  await indexingEventRoutes(app, config.jwtSecret);
  await searchRoutes(app, searchService, config.jwtSecret);
  await mcpRoutes(app, config, mcpToolService);

  app.get('/health', async () => ({ status: 'ok' }));

  // Serve web-app SPA in production
  const webAppDist = join(dirname(fileURLToPath(import.meta.url)), '../../web-app/dist');
  if (existsSync(webAppDist)) {
    await app.register(fastifyStatic, { root: webAppDist, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (
        request.url.startsWith('/auth') ||
        request.url.startsWith('/projects') ||
        request.url.startsWith('/search') ||
        request.url.startsWith('/mcp') ||
        request.url.startsWith('/health')
      ) {
        reply.status(404).send({ error: 'Not found' });
      } else {
        void reply.sendFile('index.html');
      }
    });
  }

  app.setErrorHandler(errorHandler);

  app.addHook('onClose', async () => {
    await embeddingService.dispose();
    await boss.stop();
    await disposeDependencies();
  });

  return app;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function buildEmbeddingConfig() {
  const apiKey = process.env['EMBEDDING_API_KEY'];
  const baseUrl = process.env['EMBEDDING_BASE_URL'];
  const model = process.env['EMBEDDING_MODEL'] ?? 'text-embedding-3-small';

  if (apiKey && baseUrl) {
    return {
      default: 'api' as const,
      api: {
        provider: 'openai-compatible' as const,
        base_url: baseUrl,
        api_key: apiKey,
        model,
        timeout_ms: 30000,
        max_retries: 3,
      },
    };
  }

  const localModel =
    process.env['EMBEDDING_LOCAL_MODEL'] ?? 'BAAI/bge-small-zh-v1.5';
  return {
    default: 'local' as const,
    local: { model: localModel, device: 'cpu' as const },
  };
}
