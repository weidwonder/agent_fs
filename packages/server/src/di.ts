// packages/server/src/di.ts

import {
  initDb,
  initS3,
  closeDb,
  type DbConfig,
  type S3Config,
} from '@agent-fs/storage-cloud';
import type { ServerConfig } from './config.js';

export async function initDependencies(config: ServerConfig): Promise<void> {
  const dbConfig: DbConfig = { connectionString: config.databaseUrl };
  const s3Config: S3Config = {
    endpoint: config.s3Endpoint,
    bucket: config.s3Bucket,
    accessKeyId: config.s3AccessKey,
    secretAccessKey: config.s3SecretKey,
  };

  await initDb(dbConfig);
  initS3(s3Config);
}

export async function disposeDependencies(): Promise<void> {
  await closeDb();
}
