// packages/server/src/app.ts

import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { ServerConfig } from './config.js';
import { initDependencies, disposeDependencies } from './di.js';
import { AuthService } from './services/auth-service.js';
import { ProjectService } from './services/project-service.js';
import { authRoutes } from './routes/auth-routes.js';
import { projectRoutes } from './routes/project-routes.js';
import { errorHandler } from './middleware/error-handler.js';

export async function createApp(config: ServerConfig) {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  await initDependencies(config);

  const authService = new AuthService(
    config.jwtSecret,
    config.jwtExpiresIn,
    config.jwtRefreshExpiresIn,
  );
  const projectService = new ProjectService();

  await authRoutes(app, authService);
  await projectRoutes(app, projectService, config.jwtSecret);

  app.get('/health', async () => ({ status: 'ok' }));

  app.setErrorHandler(errorHandler);

  app.addHook('onClose', async () => {
    await disposeDependencies();
  });

  return app;
}
