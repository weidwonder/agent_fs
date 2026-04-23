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
  const clue = {
    async init(): Promise<void> {},
    async listClues(): Promise<[]> {
      return [];
    },
    async getClue(): Promise<null> {
      return null;
    },
    async saveClue(): Promise<void> {
      throw new Error('云端 ClueAdapter 尚未实现');
    },
    async deleteClue(): Promise<void> {
      throw new Error('云端 ClueAdapter 尚未实现');
    },
    async removeLeavesByFileId(): Promise<{
      affectedClues: string[];
      removedLeaves: number;
      removedFolders: number;
    }> {
      return {
        affectedClues: [],
        removedLeaves: 0,
        removedFolders: 0,
      };
    },
    async close(): Promise<void> {},
  };

  return {
    vector,
    invertedIndex,
    archive,
    metadata,
    clue,
    async init(): Promise<void> {
      await Promise.all([vector.init(), invertedIndex.init()]);
    },
    async close(): Promise<void> {
      await Promise.all([vector.close(), invertedIndex.close(), archive.close()]);
    },
  };
}
