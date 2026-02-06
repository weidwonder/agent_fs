import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { decode, encode } from '@msgpack/msgpack';
import Database from 'better-sqlite3';

import { bm25TermScore, idf } from '../bm25/algorithm';
import { tokenizeText } from './index-builder';

export interface InvertedIndexOptions {
  dbPath: string;
}

export interface IndexEntry {
  text: string;
  chunkId: string;
  locator: string;
}

export interface InvertedSearchOptions {
  dirIds?: string[];
  topK?: number;
}

export interface InvertedSearchResult {
  chunkId: string;
  fileId: string;
  dirId: string;
  locator: string;
  score: number;
}

interface Posting {
  chunk_id: string;
  locator: string;
  tf: number;
  positions: number[];
}

interface TermRow {
  fileId: string;
  dirId: string;
  postings: Buffer;
  docLength: number;
}

interface ScopeStats {
  totalDocs: number;
  avgDocLength: number;
}

export class InvertedIndex {
  private readonly db: Database.Database;
  private closed = false;

  constructor(private readonly options: InvertedIndexOptions) {
    mkdirSync(dirname(options.dbPath), { recursive: true });
    this.db = new Database(options.dbPath);
  }

  async init(): Promise<void> {
    this.ensureOpen();

    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_terms (
        term TEXT NOT NULL,
        file_id TEXT NOT NULL,
        dir_id TEXT NOT NULL,
        postings BLOB NOT NULL,
        tf_sum INTEGER NOT NULL,
        chunk_count INTEGER NOT NULL,
        doc_length INTEGER NOT NULL,
        PRIMARY KEY (term, file_id)
      );

      CREATE TABLE IF NOT EXISTS index_stats (
        dir_id TEXT PRIMARY KEY,
        total_docs INTEGER NOT NULL,
        avg_doc_length REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_term_dir ON file_terms(term, dir_id, tf_sum DESC);
      CREATE INDEX IF NOT EXISTS idx_dir ON file_terms(dir_id);
      CREATE INDEX IF NOT EXISTS idx_file ON file_terms(file_id);
    `);
  }

  async addFile(fileId: string, dirId: string, entries: IndexEntry[]): Promise<void> {
    this.ensureOpen();

    const { postingsByTerm, docLength } = this.buildPostings(entries);
    const affectedDirIds = new Set<string>([...this.getDirIdsByFile(fileId), dirId]);

    const insertStmt = this.db.prepare(`
      INSERT INTO file_terms (
        term,
        file_id,
        dir_id,
        postings,
        tf_sum,
        chunk_count,
        doc_length
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM file_terms WHERE file_id = ?').run(fileId);

      for (const [term, postings] of postingsByTerm) {
        const tfSum = postings.reduce((sum, posting) => sum + posting.tf, 0);
        insertStmt.run(
          term,
          fileId,
          dirId,
          Buffer.from(encode(postings)),
          tfSum,
          postings.length,
          docLength
        );
      }
    })();

    for (const affectedDirId of affectedDirIds) {
      this.updateStats(affectedDirId);
    }
  }

  async removeFile(fileId: string): Promise<void> {
    this.ensureOpen();

    const affectedDirIds = this.getDirIdsByFile(fileId);

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM file_terms WHERE file_id = ?').run(fileId);
    })();

    for (const dirId of affectedDirIds) {
      this.updateStats(dirId);
    }
  }

  async removeDirectory(dirId: string): Promise<void> {
    this.ensureOpen();

    this.db.transaction(() => {
      this.db.prepare('DELETE FROM file_terms WHERE dir_id = ?').run(dirId);
      this.db.prepare('DELETE FROM index_stats WHERE dir_id = ?').run(dirId);
    })();
  }

  async search(query: string, options: InvertedSearchOptions = {}): Promise<InvertedSearchResult[]> {
    this.ensureOpen();

    const topK = options.topK ?? 10;
    if (topK <= 0) {
      return [];
    }

    const queryTerms = tokenizeText(query);
    if (queryTerms.length === 0) {
      return [];
    }

    const normalizedDirIds = options.dirIds?.length ? Array.from(new Set(options.dirIds)) : undefined;
    const scopeStats = this.getScopeStats(normalizedDirIds);
    if (scopeStats.totalDocs === 0) {
      return [];
    }

    const avgDocLength = scopeStats.avgDocLength > 0 ? scopeStats.avgDocLength : 1;

    const results = new Map<string, InvertedSearchResult>();

    for (const term of queryTerms) {
      const rows = this.getTermRows(term, normalizedDirIds);
      if (rows.length === 0) {
        continue;
      }

      const termIdf = idf(scopeStats.totalDocs, rows.length);
      for (const row of rows) {
        const postings = decode(row.postings) as Posting[];
        for (const posting of postings) {
          const key = `${row.fileId}:${posting.chunk_id}`;
          const scoreDelta = bm25TermScore(posting.tf, row.docLength, avgDocLength, termIdf);
          const current = results.get(key);
          if (current) {
            current.score += scoreDelta;
          } else {
            results.set(key, {
              chunkId: posting.chunk_id,
              fileId: row.fileId,
              dirId: row.dirId,
              locator: posting.locator,
              score: scoreDelta,
            });
          }
        }
      }
    }

    return [...results.values()]
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.db.close();
    this.closed = true;
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('InvertedIndex 已关闭');
    }
  }

  private buildPostings(entries: IndexEntry[]): {
    postingsByTerm: Map<string, Posting[]>;
    docLength: number;
  } {
    const postingMap = new Map<string, Map<string, Posting>>();
    let docLength = 0;

    for (const entry of entries) {
      const tokens = tokenizeText(entry.text);
      docLength += tokens.length;

      const positionsByTerm = new Map<string, number[]>();
      for (const [position, term] of tokens.entries()) {
        const positions = positionsByTerm.get(term);
        if (positions) {
          positions.push(position);
        } else {
          positionsByTerm.set(term, [position]);
        }
      }

      for (const [term, positions] of positionsByTerm) {
        let chunkMap = postingMap.get(term);
        if (!chunkMap) {
          chunkMap = new Map<string, Posting>();
          postingMap.set(term, chunkMap);
        }

        const existing = chunkMap.get(entry.chunkId);
        if (existing) {
          existing.tf += positions.length;
          existing.positions.push(...positions);
        } else {
          chunkMap.set(entry.chunkId, {
            chunk_id: entry.chunkId,
            locator: entry.locator,
            tf: positions.length,
            positions: [...positions],
          });
        }
      }
    }

    const postingsByTerm = new Map<string, Posting[]>();
    for (const [term, chunkMap] of postingMap) {
      postingsByTerm.set(term, [...chunkMap.values()]);
    }

    return {
      postingsByTerm,
      docLength,
    };
  }

  private getDirIdsByFile(fileId: string): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT dir_id AS dirId FROM file_terms WHERE file_id = ?')
      .all(fileId) as { dirId: string }[];

    return rows.map((row) => row.dirId);
  }

  private updateStats(dirId: string): void {
    const row = this.db
      .prepare(`
        SELECT
          COUNT(*) AS totalDocs,
          AVG(doc_length) AS avgDocLength
        FROM (
          SELECT file_id, MAX(doc_length) AS doc_length
          FROM file_terms
          WHERE dir_id = ?
          GROUP BY file_id
        )
      `)
      .get(dirId) as { totalDocs: number; avgDocLength: number | null };

    if (!row || row.totalDocs === 0) {
      this.db.prepare('DELETE FROM index_stats WHERE dir_id = ?').run(dirId);
      return;
    }

    this.db
      .prepare(
        `
          INSERT INTO index_stats (dir_id, total_docs, avg_doc_length)
          VALUES (?, ?, ?)
          ON CONFLICT(dir_id)
          DO UPDATE SET
            total_docs = excluded.total_docs,
            avg_doc_length = excluded.avg_doc_length
        `
      )
      .run(dirId, row.totalDocs, row.avgDocLength ?? 0);
  }

  private getScopeStats(dirIds?: string[]): ScopeStats {
    if (dirIds && dirIds.length > 0) {
      const placeholders = dirIds.map(() => '?').join(', ');
      const row = this.db
        .prepare(
          `
            SELECT
              SUM(total_docs) AS totalDocs,
              SUM(total_docs * avg_doc_length) AS weightedLength
            FROM index_stats
            WHERE dir_id IN (${placeholders})
          `
        )
        .get(...dirIds) as { totalDocs: number | null; weightedLength: number | null };

      const totalDocs = row?.totalDocs ?? 0;
      if (totalDocs <= 0) {
        return { totalDocs: 0, avgDocLength: 0 };
      }

      const weightedLength = row.weightedLength ?? 0;
      return {
        totalDocs,
        avgDocLength: weightedLength / totalDocs,
      };
    }

    const row = this.db
      .prepare(`
        SELECT
          COUNT(*) AS totalDocs,
          AVG(doc_length) AS avgDocLength
        FROM (
          SELECT file_id, MAX(doc_length) AS doc_length
          FROM file_terms
          GROUP BY file_id
        )
      `)
      .get() as { totalDocs: number; avgDocLength: number | null };

    return {
      totalDocs: row?.totalDocs ?? 0,
      avgDocLength: row?.avgDocLength ?? 0,
    };
  }

  private getTermRows(term: string, dirIds?: string[]): TermRow[] {
    if (dirIds && dirIds.length > 0) {
      const placeholders = dirIds.map(() => '?').join(', ');
      return this.db
        .prepare(
          `
            SELECT
              file_id AS fileId,
              dir_id AS dirId,
              postings,
              doc_length AS docLength
            FROM file_terms
            WHERE term = ?
              AND dir_id IN (${placeholders})
          `
        )
        .all(term, ...dirIds) as TermRow[];
    }

    return this.db
      .prepare(
        `
          SELECT
            file_id AS fileId,
            dir_id AS dirId,
            postings,
            doc_length AS docLength
          FROM file_terms
          WHERE term = ?
        `
      )
      .all(term) as TermRow[];
  }
}
