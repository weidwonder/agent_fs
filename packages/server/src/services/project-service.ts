// packages/server/src/services/project-service.ts

import { getPool } from '@agent-fs/storage-cloud';

export interface Project {
  id: string;
  name: string;
  config: object;
  created_at: Date;
}

export class ProjectService {
  async list(tenantId: string): Promise<Project[]> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, name, config, created_at FROM projects WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId],
    );
    return result.rows as Project[];
  }

  async create(tenantId: string, name: string, config?: object): Promise<Project> {
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const projResult = await client.query(
        'INSERT INTO projects (tenant_id, name, config) VALUES ($1, $2, $3) RETURNING id, name, config, created_at',
        [tenantId, name, JSON.stringify(config ?? {})],
      );
      const project = projResult.rows[0] as Project;
      await client.query(
        `INSERT INTO directories (project_id, relative_path) VALUES ($1, '.')`,
        [project.id],
      );
      await client.query('COMMIT');
      return project;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async get(tenantId: string, projectId: string): Promise<Project | null> {
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, name, config, created_at FROM projects WHERE id = $1 AND tenant_id = $2',
      [projectId, tenantId],
    );
    return (result.rows[0] as Project) ?? null;
  }

  async delete(tenantId: string, projectId: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM projects WHERE id = $1 AND tenant_id = $2 RETURNING id',
      [projectId, tenantId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
