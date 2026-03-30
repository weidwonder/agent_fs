// packages/storage-cloud/src/cloud-adapter-factory.ts

import type { StorageAdapter } from '@agent-fs/storage-adapter';
import { CloudVectorStoreAdapter } from './cloud-vector-store-adapter.js';
import { CloudInvertedIndexAdapter } from './cloud-inverted-index-adapter.js';
import { CloudArchiveAdapter } from './cloud-archive-adapter.js';
import { CloudMetadataAdapter } from './cloud-metadata-adapter.js';

export interface CloudAdapterConfig {
  tenantId: string;
}

export function createCloudAdapter(config: CloudAdapterConfig): StorageAdapter {
  const { tenantId } = config;
  const vector = new CloudVectorStoreAdapter(tenantId);
  const invertedIndex = new CloudInvertedIndexAdapter(tenantId);
  const archive = new CloudArchiveAdapter(tenantId);
  const metadata = new CloudMetadataAdapter(tenantId);

  return {
    vector,
    invertedIndex,
    archive,
    metadata,
    async init(): Promise<void> {
      await Promise.all([
        vector.init(),
        invertedIndex.init(),
      ]);
    },
    async close(): Promise<void> {
      await Promise.all([
        vector.close(),
        invertedIndex.close(),
        archive.close(),
      ]);
    },
  };
}
