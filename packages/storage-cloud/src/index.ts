// packages/storage-cloud/src/index.ts

export { initDb, getPool, closeDb } from './db.js';
export type { DbConfig } from './db.js';

export {
  initS3,
  getS3,
  getS3Bucket,
  putObject,
  getObject,
  deleteObject,
  objectExists,
  listObjects,
} from './s3.js';
export type { S3Config } from './s3.js';

export { CloudVectorStoreAdapter } from './cloud-vector-store-adapter.js';
export { CloudInvertedIndexAdapter, tokenize } from './cloud-inverted-index-adapter.js';
export { CloudArchiveAdapter } from './cloud-archive-adapter.js';
export { CloudMetadataAdapter } from './cloud-metadata-adapter.js';

export { createCloudAdapter } from './cloud-adapter-factory.js';
export type { CloudAdapterConfig } from './cloud-adapter-factory.js';
