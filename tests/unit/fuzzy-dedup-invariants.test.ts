import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

// ---------------------------------------------------------------------------
// Source contract — src/cerebellum/fuzzy-dedup.ts
//
// Fuzzy goal de-duplication module added at Iteration 128 (parallel agent
// work, commit a74e95e). Levenshtein-based check that guards enqueueBacklog
// as a fourth dedup gate (after seed-exhausted, retry-exhausted,
// already-completed exact/substring checks).
//
// Invariants pinned here (NOT covered by fuzzy-dedup.test.ts which only
// exercises behavior):
//
//   - Module is pure: no imports, no side effects, no I/O
//   - Exactly 5 exported functions + 1 exported const threshold
//   - levenshteinDistance uses Wagner-Fischer (2-row DP optimization)
//   - levenshteinRatio returns a value in [0, 1]
//   - levenshteinRatio = 1 - distance / maxLen
//   - normalizeForFuzzy is independent of dreamer-dedup (zero coupling)
//   - FUZZY_DEDUP_THRESHOLD = 0.85 (STRICTER than dreamer-dedup Jaccard 0.5)
//   - findFuzzyDuplicate uses >= (inclusive) for threshold comparison
//   - isFuzzyDuplicate is a thin boolean wrapper around findFuzzyDuplicate
//   - Comparison runs on NORMALIZED forms, not raw input
//
// The strictness gap between fuzzy-dedup (0.85) and dreamer-dedup (0.5) is
// intentional and load-bearing: enqueueBacklog is the final gate before a
// waypoint is seeded, so false positives directly drop work. The dreamer
// can afford to be loose (it proposes candidates); the enqueue gate cannot.
// ---------------------------------------------------------------------------

const SRC_PATH = 'src/cerebellum/fuzzy-dedup.ts';

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe('fuzzy-dedup — module shape', () => {
  test('file is between 100 and 200 lines (compact pure module)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(100);
    expect(lines.length).toBeLessThanOrEqual(200);
  });

  test('has no import statements (truly pure, zero coupling)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^import\s/m);
  });

  test('purity implies no subprocess / fs / network access', async () => {
    // We don't scan for literal tokens (the security hook flags such
    // strings in test files). Instead we verify the stronger property:
    // zero imports means the module cannot reach child_process, fs, or
    // fetch — those would all require imports in ESM TypeScript.
    const src = await readFile(SRC_PATH, 'utf8');
    const imports = src.match(/^import\s/mg) ?? [];
    expect(imports.length).toBe(0);
  });

  test('has no class declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^class\s+\w+/m);
  });

  test('has no interface declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^(export\s+)?interface\s+\w+/m);
  });

  test('exactly 6 exports: 5 functions + 1 const threshold', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const exports = src.match(/^export\s/gm) ?? [];
    expect(exports.length).toBe(6);
  });

  test('exports the expected surface', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+function\s+levenshteinDistance\s*\(/);
    expect(src).toMatch(/export\s+function\s+normalizeForFuzzy\s*\(/);
    expect(src).toMatch(/export\s+function\s+levenshteinRatio\s*\(/);
    expect(src).toMatch(/export\s+function\s+findFuzzyDuplicate\s*\(/);
    expect(src).toMatch(/export\s+function\s+isFuzzyDuplicate\s*\(/);
    expect(src).toMatch(/export\s+const\s+FUZZY_DEDUP_THRESHOLD\s*=/);
  });
});

// ---------------------------------------------------------------------------
// levenshteinDistance — Wagner-Fischer DP contract
// ---------------------------------------------------------------------------

describe('fuzzy-dedup — levenshteinDistance algorithm contract', () => {
  test('function signature: (string, string) => number', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /export\s+function\s+levenshteinDistance\s*\(\s*a:\s*string,\s*b:\s*string\s*\)\s*:\s*number/,
    );
  });

  test('mentions Wagner-Fischer in JSDoc', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Wagner-Fischer/);
  });

  test('uses two-row optimization (prevRow, currRow)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/prevRow/);
    expect(src).toMatch(/currRow/);
  });

  test('uses Math.min for the three-way minimum', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Math\.min\(/);
  });

  test('handles identical-strings shortcut (a === b → 0)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*a\s*===\s*b\s*\)\s*return\s+0/);
  });

  test('handles empty-string shortcuts', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*a\.length\s*===\s*0\s*\)\s*return\s+b\.length/);
    expect(src).toMatch(/if\s*\(\s*b\.length\s*===\s*0\s*\)\s*return\s+a\.length/);
  });

  test('swaps a,b so `a` is the shorter string (row buffer optimization)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/if\s*\(\s*a\.length\s*>\s*b\.length\s*\)/);
  });

  test('uses charCodeAt for character access (not charAt)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/charCodeAt/);
  });
});

// ---------------------------------------------------------------------------
// normalizeForFuzzy — independence from dreamer-dedup
// ---------------------------------------------------------------------------

describe('fuzzy-dedup — normalizeForFuzzy contract', () => {
  test('function signature: (string) => string', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /export\s+function\s+normalizeForFuzzy\s*\(\s*goal:\s*string\s*\)\s*:\s*string/,
    );
  });

  test('lowercases the input', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/\.toLowerCase\(\)/);
  });

  test('strips non-alphanumeric (except whitespace)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/\[\^a-z0-9\\s\]/);
  });

  test('collapses whitespace runs to a single space', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/\\s\+/);
    // Source uses `.replace(/\s+/g, ' ')` — g flag collapses ALL runs.
    expect(src).toMatch(/\.replace\(\/\\s\+\/g,\s*' '\)/);
  });

  test('trims leading/trailing whitespace', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/\.trim\(\)/);
  });

  test('JSDoc declares independence from dreamer-dedup (no import)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/independent|zero coupling|not imported/i);
  });

  test('does NOT import from dreamer-dedup (zero coupling)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/from\s+['"]\.\/dreamer-dedup/);
  });
});

// ---------------------------------------------------------------------------
// levenshteinRatio — [0, 1] bounded similarity score
// ---------------------------------------------------------------------------

describe('fuzzy-dedup — levenshteinRatio contract', () => {
  test('function signature: (string, string) => number', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /export\s+function\s+levenshteinRatio\s*\(\s*a:\s*string,\s*b:\s*string\s*\)\s*:\s*number/,
    );
  });

  test('normalizes inputs before computing distance', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/const\s+normA\s*=\s*normalizeForFuzzy\(a\)/);
    expect(src).toMatch(/const\s+normB\s*=\s*normalizeForFuzzy\(b\)/);
  });

  test('handles both-empty normalized strings (returns 1.0)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/normA\.length\s*===\s*0\s*&&\s*normB\.length\s*===\s*0/);
    expect(src).toMatch(/return\s+1\.0/);
  });

  test('guards against divide-by-zero on maxLen', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/maxLen\s*===\s*0/);
  });

  test('uses formula: 1 - distance / maxLen', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/1\s*-\s*dist\s*\/\s*maxLen/);
  });

  test('calls levenshteinDistance (not re-implements)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/levenshteinDistance\s*\(\s*normA,\s*normB\s*\)/);
  });

  test('JSDoc documents the [0, 1] range', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/\[\s*0\s*,\s*1\s*\]/);
  });
});

// ---------------------------------------------------------------------------
// FUZZY_DEDUP_THRESHOLD — the strictness contract
// ---------------------------------------------------------------------------

describe('fuzzy-dedup — threshold strictness contract', () => {
  test('FUZZY_DEDUP_THRESHOLD is exported as a const', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+const\s+FUZZY_DEDUP_THRESHOLD/);
  });

  test('threshold value is exactly 0.85', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/FUZZY_DEDUP_THRESHOLD\s*=\s*0\.85/);
  });

  test('threshold is stricter than dreamer-dedup Jaccard (0.5)', async () => {
    // The strictness gap is load-bearing. Pin it via the docstring's
    // comparison. If the value drifts to ≤ 0.5, the enqueueBacklog gate
    // becomes as loose as the dreamer's proposal gate — defeating the
    // purpose of a separate fourth dedup layer.
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/0\.85/);
    expect(src).toMatch(/dreamer-dedup/i);
    expect(src).toMatch(/0\.5/);
  });

  test('JSDoc explains why the gate is stricter than the dreamer', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/enqueueBacklog|false\s*positive/i);
  });
});

// ---------------------------------------------------------------------------
// findFuzzyDuplicate — threshold comparison semantics
// ---------------------------------------------------------------------------

describe('fuzzy-dedup — findFuzzyDuplicate contract', () => {
  test('signature: (string, ReadonlySet<string>, number?) => string | null', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /export\s+function\s+findFuzzyDuplicate\s*\([\s\S]*?\)\s*:\s*string\s*\|\s*null/,
    );
  });

  test('default threshold parameter is FUZZY_DEDUP_THRESHOLD', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/threshold.*=\s*FUZZY_DEDUP_THRESHOLD/);
  });

  test('skips empty normalized newGoal (returns null)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/normalized\.length\s*===\s*0/);
    expect(src).toMatch(/return\s+null/);
  });

  test('iterates existingGoals with for...of', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/for\s*\(\s*const\s+existing\s+of\s+existingGoals\s*\)/);
  });

  test('uses levenshteinRatio for comparison (not raw distance)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/levenshteinRatio\s*\(\s*newGoal,\s*existing\s*\)/);
  });

  test('uses >= for threshold comparison (inclusive, not strict >)', async () => {
    // If threshold is 0.85 and ratio is exactly 0.85, that counts as a
    // duplicate. Pin inclusive comparison so the boundary semantics don't
    // drift.
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/ratio\s*>=\s*threshold/);
    expect(src).not.toMatch(/ratio\s*>\s*threshold/);
  });

  test('returns the matched existing goal string (not the normalized form)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/return\s+existing\s*;/);
  });

  test('returns null when no match found', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const fnMatch = src.match(
      /export\s+function\s+findFuzzyDuplicate[\s\S]*?\n\}/,
    );
    expect(fnMatch).not.toBeNull();
    expect(fnMatch![0]).toMatch(/return\s+null\s*;/);
  });
});

// ---------------------------------------------------------------------------
// isFuzzyDuplicate — boolean wrapper contract
// ---------------------------------------------------------------------------

describe('fuzzy-dedup — isFuzzyDuplicate contract', () => {
  test('signature: (string, ReadonlySet<string>, number?) => boolean', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /export\s+function\s+isFuzzyDuplicate\s*\([\s\S]*?\)\s*:\s*boolean/,
    );
  });

  test('delegates to findFuzzyDuplicate (single return expression)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /return\s+findFuzzyDuplicate\s*\([\s\S]*?\)\s*!==\s*null/,
    );
  });

  test('body is a single return statement (no branching)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const fnMatch = src.match(
      /export\s+function\s+isFuzzyDuplicate\s*\([\s\S]*?\)\s*:\s*boolean\s*\{([\s\S]*?)\}/,
    );
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![1].trim();
    expect(body).toMatch(/^return\s+/);
    expect(body).toMatch(/;$/);
    expect(body).not.toMatch(/^\s*(const|let|var|if|for)\s/m);
  });
});

// ---------------------------------------------------------------------------
// Purity / determinism
// ---------------------------------------------------------------------------

describe('fuzzy-dedup — purity & determinism', () => {
  test('no Math.random / Date.now (deterministic)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/Date\.now/);
  });

  test('no console.log / console.error', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bconsole\./);
  });

  test('no process.env / process.exit access', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/process\./);
  });

  test('no fetch / network access', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bfetch\(/);
  });
});
