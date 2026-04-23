export interface Segment {
  fileId: string;
  type: 'document' | 'range';
  anchorStart?: number;
  anchorEnd?: number;
}

export interface ClueFolder {
  kind: 'folder';
  organization: 'tree' | 'timeline';
  timeFormat?: string;
  name: string;
  summary: string;
  children: ClueNode[];
}

export interface ClueLeaf {
  kind: 'leaf';
  name: string;
  summary: string;
  segment: Segment;
}

export type ClueNode = ClueFolder | ClueLeaf;

export interface Clue {
  id: string;
  projectId: string;
  name: string;
  description: string;
  principle: string;
  createdAt: string;
  updatedAt: string;
  root: ClueFolder;
}

export interface ClueSummary {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  leafCount?: number;
}

export interface ClueReference {
  clueId: string;
  clueName: string;
  leafPath: string;
}
