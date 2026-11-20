/**
 * P2 semantic-retrieval upgrade path — embedding provider seam + offline
 * default.
 *
 * The interface lets a real embedding model plug in later (a network
 * provider behind the same three-method shape); the hashing embedder is
 * the dependency-free default: overlapping character trigrams hash to
 * shared buckets, so fuzzy/partial surface overlap gets vector affinity
 * without any model or network. Deterministic by construction — same
 * text, same vector.
 */

export interface EmbeddingProvider {
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}

/** Cosine similarity; either argument zero-norm → 0 (never NaN). */
export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[]
): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / Math.sqrt(normA * normB);
}

/**
 * Character-trigram hashing embedder: bucket each trigram into
 * [0, dimensions) via FNV-1a, then L2-normalize. Empty (or <3-char)
 * text → zero vector.
 */
export function createHashingEmbedder(dimensions: number): EmbeddingProvider {
  return {
    dimensions,
    async embed(text: string): Promise<number[]> {
      const vector = new Array<number>(dimensions).fill(0);
      // Boundary padding so short strings still contribute trigrams.
      const normalized = ` ${text.toLowerCase().trim()} `;
      for (let i = 0; i + 3 <= normalized.length; i++) {
        const gram = normalized.slice(i, i + 3);
        const bucket = fnv1a(gram) % dimensions;
        vector[bucket] = (vector[bucket] ?? 0) + 1;
      }
      let norm = 0;
      for (const x of vector) norm += x * x;
      if (norm === 0) return vector;
      const inverse = 1 / Math.sqrt(norm);
      return vector.map((x) => x * inverse);
    },
  };
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
