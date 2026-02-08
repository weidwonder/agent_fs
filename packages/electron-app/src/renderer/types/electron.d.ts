interface IndexProgress {
  phase: 'scan' | 'convert' | 'chunk' | 'summary' | 'embed' | 'write';
  currentFile: string;
  processed: number;
  total: number;
}

interface RegisteredProject {
  path: string;
  alias: string;
  projectId: string;
  summary: string;
  lastUpdated: string;
  totalFileCount: number;
  totalChunkCount: number;
  valid: boolean;
}

interface SearchResultItem {
  chunk_id: string;
  score: number;
  content: string;
  summary: string;
  source: { file_path: string; locator: string };
}

interface SearchMeta {
  total_searched: number;
  fusion_method: string;
  elapsed_ms: number;
}

interface SearchInput {
  query: string;
  keyword?: string;
  scope: string[];      // projectId 数组
  top_k?: number;
}

interface SearchResponse {
  results: SearchResultItem[];
  meta: SearchMeta;
}

interface RawConfigResult {
  rawConfig: Record<string, unknown>;
  resolvedConfig: Record<string, unknown>;
  envFields: string[];
}

interface ElectronAPI {
  selectDirectory: () => Promise<string | undefined>;
  startIndexing: (path: string) => Promise<{ success: boolean; metadata?: unknown; error?: string }>;
  onIndexingProgress: (callback: (progress: IndexProgress) => void) => void;
  getRegistry: () => Promise<{ projects: RegisteredProject[] }>;
  removeProject: (projectId: string) => Promise<{ success: boolean; error?: string }>;
  updateProjectSummary: (projectId: string, summary: string) => Promise<{ success: boolean; error?: string }>;
  getConfig: () => Promise<RawConfigResult>;
  saveConfig: (updates: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  search: (input: SearchInput) => Promise<SearchResponse>;
}

interface Window {
  electronAPI: ElectronAPI;
}
