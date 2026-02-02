// @agent-fs/core
// 核心类型定义导出

export const VERSION = '0.1.0';

// Plugin types
export type {
  DocumentPlugin,
  DocumentConversionResult,
  PositionMapping,
  LocatorInfo,
} from './types/plugin';

// Chunk types
export type { Chunk, ChunkMetadata, ChunkResult, ChunkerOptions } from './types/chunk';
