// packages/storage-cloud/src/cloud-inverted-index-adapter.ts

import type {
  InvertedIndexAdapter,
  InvertedIndexEntry,
  InvertedSearchResult,
} from '@agent-fs/storage-adapter';
import { getPool } from './db.js';

// Tokenizer with nodejieba fallback to whitespace split
let jieba: { cut: (text: string) => string[] } | null = null;
async function loadJieba(): Promise<{ cut: (text: string) => string[] }> {
  if (jieba) return jieba;
  try {
    const mod = await import('nodejieba');
    jieba = mod.default ?? (mod as unknown as { cut: (text: string) => string[] });
  } catch {
    jieba = { cut: (text: string) => text.split(/\s+/) };
  }
  return jieba;
}

async function tokenize(text: string): Promise<string[]> {
  const j = await loadJieba();
  return j
    .cut(text)
    .map((t: string) => t.trim().toLowerCase())
    .filter((t: string) => t.length > 0 && !/^\s+$/.test(t));
}

export class CloudInvertedIndexAdapter implements InvertedIndexAdapter {
  constructor(private readonly tenantId: string) {}

  async init(): Promise<void> {
    // Tables created by migration
  }

  async addFile(
    fileId: string,
    dirId: string,
    entries: InvertedIndexEntry[],
  ): Promise<void> {
    const pool = getPool();

    await pool.query(
      'DELETE FROM inverted_terms WHERE file_id = $1 AND tenant_id = $2',
      [fileId, this.tenantId],
    );

    if (entries.length === 0) return;

    // Build term→postings map
    const termPostings = new Map<
      string,
      { chunkId: string; locator: string; tf: number; positions: number[] }[]
    >();

    for (const entry of entries) {
      const tokens = await tokenize(entry.text);
      const posMap = new Map<string, number[]>();
      for (const [pos, term] of tokens.entries()) {
        const arr = posMap.get(term);
        if (arr) arr.push(pos);
        else posMap.set(term, [pos]);
      }
      for (const [term, positions] of posMap) {
        let postings = termPostings.get(term);
        if (!postings) {
          postings = [];
          termPostings.set(term, postings);
        }
        postings.push({ chunkId: entry.chunkId, locator: entry.locator, tf: positions.length, positions });
      }
    }

    const allValues: unknown[] = [];
    const allPlaceholders: string[] = [];
    let idx = 1;

    for (const [term, postings] of termPostings) {
      for (const p of postings) {
        allPlaceholders.push(
          `($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6},$${idx + 7})`,
        );
        allValues.push(term, fileId, dirId, this.tenantId, p.chunkId, p.locator, p.tf, p.positions);
        idx += 8;
      }
    }

    // Insert in batches of 1000 rows to stay within param limits
    const BATCH = 1000;
    const PER_ROW = 8;
    for (let i = 0; i < allPlaceholders.length; i += BATCH) {
      const batchPh = allPlaceholders.slice(i, i + BATCH);
      const batchVals = allValues.slice(i * PER_ROW, (i + BATCH) * PER_ROW);
      // Re-index placeholders for this batch
      const reindexed = batchPh.map((ph, bi) => {
        const base = bi * PER_ROW + 1;
        return `($${base},$${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
      });
      await pool.query(
        `INSERT INTO inverted_terms (term, file_id, dir_id, tenant_id, chunk_id, locator, tf, positions)
         VALUES ${reindexed.join(', ')}`,
        batchVals,
      );
    }

    await this.updateStats(dirId);
  }

  async search(params: {
    terms: string[];
    dirIds: string[];
    topK: number;
  }): Promise<InvertedSearchResult[]> {
    const pool = getPool();
    if (params.terms.length === 0) return [];

    const { terms, dirIds, topK } = params;

    // Get BM25 stats for scoped directories
    let statsRows: { total: string; avg_len: string }[];
    if (dirIds.length > 0) {
      const r = await pool.query(
        `SELECT SUM(total_docs) AS total,
                SUM(total_docs * avg_doc_length) / NULLIF(SUM(total_docs), 0) AS avg_len
         FROM inverted_stats WHERE dir_id = ANY($1)`,
        [dirIds],
      );
      statsRows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT SUM(total_docs) AS total,
                SUM(total_docs * avg_doc_length) / NULLIF(SUM(total_docs), 0) AS avg_len
         FROM inverted_stats`,
        [],
      );
      statsRows = r.rows;
    }

    const totalDocs = parseInt(statsRows[0]?.total ?? '0');
    if (totalDocs === 0) return [];

    // Fetch matching postings
    let termRows: { term: string; file_id: string; dir_id: string; chunk_id: string; locator: string; tf: number }[];
    if (dirIds.length > 0) {
      const r = await pool.query(
        `SELECT term, file_id, dir_id, chunk_id, locator, tf
         FROM inverted_terms
         WHERE term = ANY($1) AND dir_id = ANY($2) AND tenant_id = $3`,
        [terms, dirIds, this.tenantId],
      );
      termRows = r.rows;
    } else {
      const r = await pool.query(
        `SELECT term, file_id, dir_id, chunk_id, locator, tf
         FROM inverted_terms
         WHERE term = ANY($1) AND tenant_id = $2`,
        [terms, this.tenantId],
      );
      termRows = r.rows;
    }

    // BM25 scoring (application layer)
    const k1 = 1.2;
    const b = 0.75;

    const dfMap = new Map<string, Set<string>>();
    for (const row of termRows) {
      let set = dfMap.get(row.term);
      if (!set) { set = new Set(); dfMap.set(row.term, set); }
      set.add(row.file_id);
    }

    const scores = new Map<string, InvertedSearchResult>();
    for (const row of termRows) {
      const df = dfMap.get(row.term)?.size ?? 0;
      const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
      const tfNorm = (row.tf * (k1 + 1)) / (row.tf + k1 * (1 - b + b));
      const delta = idf * tfNorm;

      const key = `${row.file_id}:${row.chunk_id}`;
      const existing = scores.get(key);
      if (existing) {
        existing.score += delta;
      } else {
        scores.set(key, { chunkId: row.chunk_id, fileId: row.file_id, dirId: row.dir_id, score: delta, locator: row.locator });
      }
    }

    return [...scores.values()]
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async removeFile(fileId: string): Promise<void> {
    const pool = getPool();
    const dirs = await pool.query(
      'SELECT DISTINCT dir_id FROM inverted_terms WHERE file_id = $1 AND tenant_id = $2',
      [fileId, this.tenantId],
    );
    await pool.query(
      'DELETE FROM inverted_terms WHERE file_id = $1 AND tenant_id = $2',
      [fileId, this.tenantId],
    );
    for (const row of dirs.rows as { dir_id: string }[]) {
      await this.updateStats(row.dir_id);
    }
  }

  async removeDirectory(dirId: string): Promise<void> {
    await this.removeDirectories([dirId]);
  }

  async removeDirectories(dirIds: string[]): Promise<void> {
    if (dirIds.length === 0) return;
    const pool = getPool();
    await pool.query(
      'DELETE FROM inverted_terms WHERE dir_id = ANY($1) AND tenant_id = $2',
      [dirIds, this.tenantId],
    );
    await pool.query('DELETE FROM inverted_stats WHERE dir_id = ANY($1)', [dirIds]);
  }

  async close(): Promise<void> {
    // Pool is shared
  }

  private async updateStats(dirId: string): Promise<void> {
    const pool = getPool();
    const result = await pool.query(
      `SELECT COUNT(DISTINCT file_id) AS total_docs,
              COALESCE(AVG(doc_length), 0) AS avg_doc_length
       FROM (
         SELECT file_id, SUM(tf) AS doc_length
         FROM inverted_terms WHERE dir_id = $1
         GROUP BY file_id
       ) sub`,
      [dirId],
    );
    const { total_docs, avg_doc_length } = result.rows[0] as {
      total_docs: string;
      avg_doc_length: string;
    };
    if (parseInt(total_docs) === 0) {
      await pool.query('DELETE FROM inverted_stats WHERE dir_id = $1', [dirId]);
    } else {
      await pool.query(
        `INSERT INTO inverted_stats (dir_id, total_docs, avg_doc_length)
         VALUES ($1, $2, $3)
         ON CONFLICT (dir_id) DO UPDATE SET
           total_docs = EXCLUDED.total_docs,
           avg_doc_length = EXCLUDED.avg_doc_length`,
        [dirId, total_docs, avg_doc_length],
      );
    }
  }
}
