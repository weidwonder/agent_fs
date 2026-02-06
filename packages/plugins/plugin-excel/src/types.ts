export interface ConvertResponse {
  sheets: SheetResult[];
}

export interface SheetResult {
  name: string;
  index: number;
  regions: RegionResult[];
}

export interface RegionResult {
  range: string;
  tables: string[];
  markdown: string;
  searchableEntries?: RegionSearchableEntry[];
}

export interface RegionSearchableEntry {
  text: string;
  locator: string;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}
