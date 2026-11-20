/**
 * P2 语义检索升级路径 — EmbeddingProvider interface + deterministic hashing
 * embedder (offline default, no network) + hybrid search (lexical ⊕ cosine
 * blend, graceful degradation to pure lexical when no provider or on
 * provider failure).
 *
 * The MECHANISM test uses a stub embedder that maps synonyms to the same
 * vector (花生→[1,0], peanut→[1,0], …) — proving the vector path surfaces
 * a zero-lexical-match entry. The hashing embedder itself is character-
 * trigram based: deterministic, normalized, no network.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createHashingEmbedder,
  cosineSimilarity,
  type EmbeddingProvider,
} from '../../src/cerebellum/embedding.js';
import {
  searchMemory,
  searchMemoryHybrid,
} from '../../src/cerebellum/memory-retrieval.js';
import { writeMemory } from '../../src/cerebellum/memory.js';

describe('createHashingEmbedder — deterministic offline embedder', () => {
  test('same text → identical vector; dimension respected; L2-normalized', async () => {
    const e = createHashingEmbedder(64);
    const v1 = await e.embed('花生过敏不能吃花生酱');
    const v2 = await e.embed('花生过敏不能吃花生酱');
    expect(v1).toEqual(v2);
    expect(v1).toHaveLength(64);
    const norm = Math.sqrt(v1!.reduce((acc, x) => acc + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  test('overlapping texts score higher cosine than disjoint texts', async () => {
    const e = createHashingEmbedder(128);
    const a = await e.embed('deploy checklist run tests before ship');
    const b = await e.embed('deploy checklist verify tests');
    const c = await e.embed('花生过敏 历史');
    expect(cosineSimilarity(a!, b!)).toBeGreaterThan(cosineSimilarity(a!, c!));
  });

  test('empty text → zero vector; cosine against it is 0 (no NaN)', async () => {
    const e = createHashingEmbedder(32);
    const zero = await e.embed('');
    expect(zero!.every((x) => x === 0)).toBe(true);
    const v = await e.embed('anything');
    expect(cosineSimilarity(v!, zero!)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Hybrid search
// ---------------------------------------------------------------------------

function crossLingualEmbedder(): EmbeddingProvider {
  // Maps Chinese and English surface forms onto shared semantic axes.
  const lexicon: Record<string, number[]> = {
    花生: [1, 0],
    peanut: [1, 0],
    过敏: [0, 1],
    allergy: [0, 1],
  };
  return {
    dimensions: 2,
    async embed(text: string): Promise<number[]> {
      const lower = text.toLowerCase();
      const v = [0, 0];
      for (const [key, vec] of Object.entries(lexicon)) {
        if (lower.includes(key)) {
          v[0] += vec[0]!;
          v[1] += vec[1]!;
        }
      }
      return v;
    },
  };
}

describe('searchMemoryHybrid — lexical ⊕ vector blend', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-hybrid-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await writeMemory(root, {
      category: 'preferences',
      source: 'user',
      title: '花生过敏',
      body: '用户对花生严重过敏，推荐食物时必须排除花生与花生酱。',
      tags: ['健康', '饮食'],
    });
    await writeMemory(root, {
      category: 'preferences',
      source: 'user',
      title: ' deploying rules',
      body: 'ship only after tests pass on main.',
      tags: ['workflow'],
    });
  });

  test('no embedder → identical results to pure lexical search', async () => {
    const lexical = await searchMemory(root, '花生');
    const hybrid = await searchMemoryHybrid(root, '花生');
    expect(hybrid.map((s) => s.entry.id)).toEqual(lexical.map((s) => s.entry.id));
  });

  test('zero-lexical query surfaces the entry via vector path (matchedBy: vector)', async () => {
    // 'peanut' shares no token or CJK bigram with the stored entry.
    const lexical = await searchMemory(root, 'peanut');
    expect(lexical).toHaveLength(0); // precondition: lexical misses

    const hybrid = await searchMemoryHybrid(root, 'peanut', {
      embedding: crossLingualEmbedder(),
    });
    expect(hybrid.length).toBeGreaterThan(0);
    expect(hybrid[0]!.entry.title).toBe('花生过敏');
    expect(hybrid[0]!.matchedBy).toContain('vector');
  });

  test('vectorWeight shifts the blend: high weight lets vector-only outrank lexical-only', async () => {
    // 'deploy test flow' lexically hits the deploying entry only; the stub
    // embedder maps 'deploy'-containing text to [1,0]-ish axes shared with…
    // Use the cross-lingual embedder: query 'peanut deploy' — lexical hits
    // only 'deploying rules' (body 'ship only after tests pass'? no 'deploy'
    // in body; title ' deploying rules' yes). Vector sees both 花生 & deploy.
    const query = 'peanut deploy';
    const lexHeavy = await searchMemoryHybrid(root, query, {
      embedding: crossLingualEmbedder(),
      vectorWeight: 0.05,
    });
    const vecHeavy = await searchMemoryHybrid(root, query, {
      embedding: crossLingualEmbedder(),
      vectorWeight: 0.95,
    });
    expect(lexHeavy[0]!.entry.title).not.toBe('花生过敏');
    expect(vecHeavy[0]!.entry.title).toBe('花生过敏');
  });

  test('failing embedder degrades gracefully to lexical results', async () => {
    const boom: EmbeddingProvider = {
      dimensions: 8,
      embed: async () => {
        throw new Error('embedding service down');
      },
    };
    const lexical = await searchMemory(root, '花生');
    const hybrid = await searchMemoryHybrid(root, '花生', { embedding: boom });
    expect(hybrid.map((s) => s.entry.id)).toEqual(lexical.map((s) => s.entry.id));
  });

  test('limit is respected in hybrid mode', async () => {
    const hybrid = await searchMemoryHybrid(root, 'peanut deploy', {
      embedding: crossLingualEmbedder(),
      limit: 1,
    });
    expect(hybrid).toHaveLength(1);
  });
});
