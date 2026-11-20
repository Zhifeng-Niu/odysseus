/**
 * Memory retrieval — precision-at-need over the markdown memory store.
 *
 * The memory files are the store (append-only markdown, see memory.ts);
 * this module adds relevance-scored recall on top. Two consumers:
 *
 *   - searchMemory(rootDir, query): scored entries for RQ2-style scar
 *     probes and tooling.
 *   - recallMemoryAsPromptContext(rootDir, query, {maxEntries}): top-k
 *     entries as a prompt block, '' when nothing matches — the
 *     relevance-filtered alternative to whole-store injection
 *     (loadLongTermMemoryMarkdown), whose token tax is why the
 *     memory-size caps exist.
 *
 * Honest scope: lexical scoring — tag hits weigh 5, title 3, body 1.
 * Chinese queries (no spaces) are matched via CJK bigrams: a connected
 * run like 花生过敏 contributes its bigrams (花生/生过/过敏) as partial
 * scores, so entries containing most bigrams outrank entries containing
 * one — no false "whole-phrase-or-nothing" cliff. Semantic embeddings are
 * now available as the hybrid path (searchMemoryHybrid + embedding.ts);
 * latency indexing is YAGNI at KB-scale stores — readMemory already parses
 * everything cheaply.
 */

import { readMemory } from './memory.js';
import { cosineSimilarity, type EmbeddingProvider } from './embedding.js';
import { quarantineExternalContent } from '../util/quarantine.js';
import type { MemoryCategory } from '../orchestrator/events.js';
import type { MemoryEntry } from './memory.js';

const ALL_CATEGORIES: readonly MemoryCategory[] = [
  'patterns',
  'lessons',
  'preferences',
  'dreams',
];

const TAG_WEIGHT = 5;
const TITLE_WEIGHT = 3;
const BODY_WEIGHT = 1;

export interface SearchOptions {
  readonly limit?: number;
  readonly categories?: readonly MemoryCategory[];
}

export interface ScoredMemoryEntry {
  readonly entry: MemoryEntry;
  readonly score: number;
  /** Which surfaces matched: 'tag' | 'title' | 'body'. */
  readonly matchedBy: readonly string[];
}

export async function searchMemory(
  rootDir: string,
  query: string,
  options: SearchOptions = {}
): Promise<ScoredMemoryEntry[]> {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  const categories = options.categories ?? ALL_CATEGORIES;
  const scored: ScoredMemoryEntry[] = [];

  for (const category of categories) {
    const entries = await readMemory(rootDir, category);
    for (const entry of entries) {
      const matchedBy = new Set<string>();
      let score = 0;
      for (const term of terms) {
        const tagText = (entry.tags ?? []).join(' ').toLowerCase();
        if (tagText.includes(term)) {
          score += TAG_WEIGHT;
          matchedBy.add('tag');
        }
        if (entry.title.toLowerCase().includes(term)) {
          score += TITLE_WEIGHT;
          matchedBy.add('title');
        }
        if (entry.body.toLowerCase().includes(term)) {
          score += BODY_WEIGHT;
          matchedBy.add('body');
        }
      }
      if (score > 0) {
        scored.push({ entry, score, matchedBy: [...matchedBy] });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score || b.entry.ts.localeCompare(a.entry.ts));
  const limit = options.limit ?? scored.length;
  return scored.slice(0, Math.max(0, limit));
}

// ---------------------------------------------------------------------------
// Hybrid search — lexical ⊕ vector blend (P2 upgrade path)
// ---------------------------------------------------------------------------

export interface HybridSearchOptions extends SearchOptions {
  readonly embedding?: EmbeddingProvider;
  /** Blend: w·cosine + (1−w)·normalizedLexical. Default 0.5, clamped [0,1]. */
  readonly vectorWeight?: number;
}

const DEFAULT_VECTOR_WEIGHT = 0.5;

/**
 * Hybrid recall: lexical scoring blended with embedding cosine similarity.
 *
 * - No provider → identical behavior to searchMemory (lexical fallback).
 * - With a provider, zero-lexical entries can surface via the vector path
 *   (synonyms / cross-lingual recall — the whole point of the upgrade).
 *   `matchedBy` gains 'vector' when cosine > 0.
 * - Provider failure degrades gracefully to pure lexical results: the
 *   semantic layer is an enhancement, never a dependency.
 */
export async function searchMemoryHybrid(
  rootDir: string,
  query: string,
  options: HybridSearchOptions = {}
): Promise<ScoredMemoryEntry[]> {
  const { embedding, vectorWeight = DEFAULT_VECTOR_WEIGHT, ...base } = options;
  if (!embedding) return searchMemory(rootDir, query, base);

  const terms = tokenize(query);
  const categories = base.categories ?? ALL_CATEGORIES;
  const collected: Array<{
    entry: MemoryEntry;
    lexical: number;
    matchedBy: Set<string>;
  }> = [];

  for (const category of categories) {
    const entries = await readMemory(rootDir, category);
    for (const entry of entries) {
      const matchedBy = new Set<string>();
      let lexical = 0;
      for (const term of terms) {
        const tagText = (entry.tags ?? []).join(' ').toLowerCase();
        if (tagText.includes(term)) {
          lexical += TAG_WEIGHT;
          matchedBy.add('tag');
        }
        if (entry.title.toLowerCase().includes(term)) {
          lexical += TITLE_WEIGHT;
          matchedBy.add('title');
        }
        if (entry.body.toLowerCase().includes(term)) {
          lexical += BODY_WEIGHT;
          matchedBy.add('body');
        }
      }
      collected.push({ entry, lexical, matchedBy });
    }
  }
  if (collected.length === 0) return [];

  let queryVector: number[];
  try {
    queryVector = await embedding.embed(query);
  } catch {
    return searchMemory(rootDir, query, base);
  }

  const docVectors = new Map<string, number[]>();
  for (const item of collected) {
    try {
      const vector = await embedding.embed(`${item.entry.title}\n${item.entry.body}`);
      docVectors.set(item.entry.id, vector);
    } catch {
      return searchMemory(rootDir, query, base);
    }
  }

  const weight = Math.min(1, Math.max(0, vectorWeight));
  const maxLexical = Math.max(...collected.map((c) => c.lexical), 0);
  const scored: ScoredMemoryEntry[] = [];
  for (const item of collected) {
    const docVector = docVectors.get(item.entry.id)!;
    const cosine = cosineSimilarity(queryVector, docVector);
    if (cosine > 0) item.matchedBy.add('vector');
    const lexNorm = maxLexical > 0 ? item.lexical / maxLexical : 0;
    const score = weight * cosine + (1 - weight) * lexNorm;
    if (score > 0) {
      scored.push({ entry: item.entry, score, matchedBy: [...item.matchedBy] });
    }
  }

  scored.sort((a, b) => b.score - a.score || b.entry.ts.localeCompare(a.entry.ts));
  const limit = base.limit ?? scored.length;
  return scored.slice(0, Math.max(0, limit));
}

/**
 * Top-k relevant entries as a prompt block, '' when nothing matches —
 * callers can blindly concatenate (same contract as
 * readMemoryAsPromptContext, but relevance-filtered).
 */
export async function recallMemoryAsPromptContext(
  rootDir: string,
  query: string,
  options: SearchOptions & { readonly maxEntries?: number } = {}
): Promise<string> {
  const maxEntries = options.maxEntries ?? 5;
  const scored = await searchMemory(rootDir, query, {
    limit: maxEntries,
    ...(options.categories ? { categories: options.categories } : {}),
  });
  if (scored.length === 0) return '';

  const block = scored
    .map(
      (s) =>
        `## ${s.entry.title}\n_source: ${s.entry.source}, ${s.entry.category}, ts: ${s.entry.ts}_\n\n${s.entry.body}`
    )
    .join('\n\n---\n\n');
  // P3 injection defense: recalled memory is DATA — memory poisoning is the
  // threat (defense #1 is the IthacaCore write channel; this is layer #2).
  return quarantineExternalContent(block, {
    origin: 'memory-recall',
    provenance: `entries=${scored.map((s) => s.entry.id).join(',')}`,
  });
}

/**
 * Tokenize a query: ASCII words split on non-word chars; CJK runs of
 * length ≥ 2 contribute their bigrams as individual terms (partial
 * scoring — no whole-phrase cliff). Empty query → no terms.
 */
function tokenize(query: string): string[] {
  const runs = query.toLowerCase().match(/[一-鿿]+|[a-z0-9]+/g) ?? [];
  const terms: string[] = [];
  for (const run of runs) {
    if (/[一-鿿]/.test(run)) {
      if (run.length === 1) {
        terms.push(run);
        continue;
      }
      for (let i = 0; i + 2 <= run.length; i++) {
        terms.push(run.slice(i, i + 2));
      }
    } else {
      terms.push(run);
    }
  }
  return terms;
}
