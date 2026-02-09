/**
 * 目录索引元数据（.fs_index/index.json）
 */
export interface IndexMetadata {
  /** 版本号 */
  version: string;

  /** 创建时间 */
  createdAt: string;

  /** 更新时间 */
  updatedAt: string;

  /** 目录 ID（UUID） */
  dirId: string;

  /** 目录路径 */
  directoryPath: string;

  /** 目录摘要 */
  directorySummary: string;

  /** 所属 Project ID */
  projectId: string;

  /** 相对于 Project 的路径（根目录为 "."） */
  relativePath: string;

  /** 父目录 ID（Project 根目录为 null） */
  parentDirId: string | null;

  /** 统计信息 */
  stats: IndexStats;

  /** 文件列表 */
  files: FileMetadata[];

  /** 子目录列表 */
  subdirectories: SubdirectoryInfo[];

  /** 不支持的文件列表 */
  unsupportedFiles: string[];
}

/**
 * 索引统计信息
 */
export interface IndexStats {
  /** 文件数量 */
  fileCount: number;

  /** Chunk 数量 */
  chunkCount: number;

  /** 总 Token 数 */
  totalTokens: number;
}

/**
 * 文件元数据
 */
export interface FileMetadata {
  /** 文件名 */
  name: string;

  /** AFD 归档名（不含 .afd 后缀） */
  afdName?: string;

  /** 文件类型 */
  type: string;

  /** 文件大小（字节） */
  size: number;

  /** 文件哈希 */
  hash: string;

  /** 文件 ID */
  fileId: string;

  /** 索引时间 */
  indexedAt: string;

  /** Chunk 数量 */
  chunkCount: number;

  /** 文件摘要 */
  summary: string;
}

/**
 * 子目录信息
 */
export interface SubdirectoryInfo {
  /** 子目录名 */
  name: string;

  /** 子目录 ID */
  dirId: string;

  /** 是否已索引 */
  hasIndex: boolean;

  /** 子目录摘要 */
  summary: string | null;

  /** 子目录文件数（递归） */
  fileCount: number;

  /** 最后更新时间 */
  lastUpdated: string | null;

  /** 子目录递归 fileId 列表（用于增量删除清理） */
  fileIds: string[];

  /** 子目录递归 AFD 归档映射（用于目录缺失时清理归档） */
  fileArchives?: Array<{
    fileId: string;
    afdName: string;
  }>;
}

/**
 * 全局注册表（~/.agent_fs/registry.json）
 */
export interface Registry {
  /** 版本号 */
  version: string;

  /** Embedding 模型名称 */
  embeddingModel: string;

  /** Embedding 向量维度 */
  embeddingDimension: number;

  /** 已索引 Project 列表 */
  projects: RegisteredProject[];
}

/**
 * 已注册 Project
 */
export interface RegisteredProject {
  /** 目录路径 */
  path: string;

  /** 别名 */
  alias: string;

  /** Project ID */
  projectId: string;

  /** 目录摘要 */
  summary: string;

  /** 最后更新时间 */
  lastUpdated: string;

  /** 文件总数 */
  totalFileCount: number;

  /** Chunk 总数 */
  totalChunkCount: number;

  /** 扁平化子目录引用 */
  subdirectories: SubdirectoryRef[];

  /** 是否有效 */
  valid: boolean;
}

/**
 * 子目录引用
 */
export interface SubdirectoryRef {
  /** 相对路径 */
  relativePath: string;

  /** 子目录 ID */
  dirId: string;

  /** 文件数 */
  fileCount: number;

  /** Chunk 数 */
  chunkCount: number;

  /** 最后更新时间 */
  lastUpdated: string;
}
