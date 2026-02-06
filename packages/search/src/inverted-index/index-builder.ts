import nodejieba from 'nodejieba';
import { readFileSync } from 'node:fs';

export interface BuildIndexEntryInput {
  text: string;
  chunkId: string;
  locator: string;
}

export interface BuiltIndexEntry extends BuildIndexEntryInput {
  terms: string[];
}

const STOPWORDS = new Set(
  readFileSync(new URL('./stopwords.txt', import.meta.url), 'utf-8')
    .split(/\r?\n/u)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
);

export function tokenizeText(text: string): string[] {
  return nodejieba
    .cutForSearch(text)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => {
      if (!token) return false;
      if (/^[a-z0-9]$/u.test(token)) return false;
      if (STOPWORDS.has(token)) return false;
      if (/^[^\w\u4e00-\u9fa5]+$/u.test(token)) return false;
      return true;
    });
}

export class IndexEntryBuilder {
  buildEntries(entries: BuildIndexEntryInput[]): BuiltIndexEntry[] {
    return entries
      .map((entry) => ({
        ...entry,
        terms: tokenizeText(entry.text),
      }))
      .filter((entry) => entry.terms.length > 0);
  }
}
