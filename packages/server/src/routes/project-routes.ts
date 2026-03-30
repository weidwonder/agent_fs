// packages/server/src/routes/project-routes.ts

import type { FastifyInstance } from 'fastify';
import type { ProjectService } from '../services/project-service.js';
import { createAuthMiddleware } from '../middleware/auth.js';

export async function projectRoutes(
  app: FastifyInstance,
  projectService: ProjectService,
  jwtSecret: string,
): Promise<void> {
  const auth = createAuthMiddleware(jwtSecret);

  app.get('/projects', { preHandler: auth }, async (request) => {
    const tenantId = request.user!.tenantId;
    const projects = await projectService.list(tenantId);
    return { projects };
  });

  app.post('/projects', { preHandler: auth }, async (request, reply) => {
    const tenantId = request.user!.tenantId;
    const { name, config } = request.body as { name: string; config?: object };
    const project = await projectService.create(tenantId, name, config);
    return reply.status(201).send(project);
  });

  app.get('/projects/:id', { preHandler: auth }, async (request, reply) => {
    const tenantId = request.user!.tenantId;
    const { id } = request.params as { id: string };
    const project = await projectService.get(tenantId, id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return project;
  });

  app.delete('/projects/:id', { preHandler: auth }, async (request, reply) => {
    const tenantId = request.user!.tenantId;
    const { id } = request.params as { id: string };
    const deleted = await projectService.delete(tenantId, id);
    if (!deleted) return reply.status(404).send({ error: 'Project not found' });
    return reply.status(204).send();
  });
}
