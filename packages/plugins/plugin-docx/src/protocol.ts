export type DocxMethod = 'convert' | 'shutdown';

export interface DocxRequest {
  id: string;
  method: DocxMethod;
  params?: {
    filePath: string;
  };
}

export interface DocxMapping {
  startLine: number;
  endLine: number;
  locator: string;
}

export interface DocxSuccessData {
  markdown: string;
  mappings: DocxMapping[];
}

export type DocxErrorCode =
  | 'FILE_NOT_FOUND'
  | 'UNSUPPORTED_FORMAT'
  | 'CONVERSION_FAILED'
  | 'FALLBACK_UNAVAILABLE'
  | 'FALLBACK_FAILED'
  | 'INVALID_REQUEST';

export interface DocxErrorInfo {
  code: DocxErrorCode;
  message: string;
}

export interface DocxSuccessResponse {
  id: string;
  success: true;
  data: DocxSuccessData;
}

export interface DocxErrorResponse {
  id: string;
  success: false;
  error: DocxErrorInfo;
}

export type DocxResponse = DocxSuccessResponse | DocxErrorResponse;
