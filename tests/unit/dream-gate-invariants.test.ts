import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { shouldDream } from '../../src/cerebellum/dream-gate.js';

// ---------------------------------------------------------------------------
// Source contract — src/cerebellum/dream-gate.ts
//
// Pure decision function extracted from the orchestrator so the
// "graduated dreamer rhythm" (Aspiration 1: self-model) can be tested in
// isolation before being wired into the orchestrator. Today the dreamer
// fires on a binary "did side-effects happen?" condition; the gate is
// the seam for adding circadian-style rhythm later.
//
// Invariants pinned here (NOT covered by dream-gate.test.ts which only
// exercises behavior):
//
//   - Module is pure: no imports, no side effects, no I/O
//   - Exactly 1 export (shouldDream function)
//   - Function signature: (number, number, boolean) => boolean
//   - Decision is AND of two conditions, not OR:
//       hasSideEffects AND workWaypointCounter >= threshold
//   - Threshold comparison is >= (inclusive), not > (strict)
//   - No LLM calls, no provider access
//   - JSDoc explains the extraction rationale
// ---------------------------------------------------------------------------

const SRC_PATH = 'src/cerebellum/dream-gate.ts';

// ---------------------------------------------------------------------------
// Module shape
// ---------------------------------------------------------------------------

describe('dream-gate — module shape', () => {
  test('file is between 30 and 45 lines (compact pure module)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(30);
    expect(lines.length).toBeLessThanOrEqual(45);
  });

  test('has no import statements (truly pure)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^import\s/m);
  });

  test('has no class declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^class\s+\w+/m);
  });

  test('has no interface declarations', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^(export\s+)?interface\s+\w+/m);
  });

  test('has no type aliases', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/^(export\s+)?type\s+\w+/m);
  });

  test('exactly 1 export: shouldDream function', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const exports = src.match(/^export\s/gm) ?? [];
    expect(exports.length).toBe(1);
    expect(src).toMatch(/export\s+function\s+shouldDream\s*\(/);
  });

  test('no other top-level functions', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const fns = src.match(/^(export\s+)?function\s+\w+/gm) ?? [];
    expect(fns.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Function signature
// ---------------------------------------------------------------------------

describe('dream-gate — function signature', () => {
  test('shouldDream takes 3 parameters', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(
      /export\s+function\s+shouldDream\s*\(\s*\w+:\s*number,\s*\w+:\s*number,\s*\w+:\s*boolean\s*\)/,
    );
  });

  test('first parameter is typed number (workWaypointCounter)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/workWaypointCounter:\s*number/);
  });

  test('second parameter is typed number (threshold)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/threshold:\s*number/);
  });

  test('third parameter is typed boolean (hasSideEffects)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/hasSideEffects:\s*boolean/);
  });

  test('return type is boolean', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/export\s+function\s+shouldDream[\s\S]*?\):\s*boolean/);
  });

  test('runtime: returns only boolean values', () => {
    const inputs: Array<[number, number, boolean]> = [
      [0, 0, false],
      [0, 0, true],
      [0, 5, true],
      [5, 0, true],
      [3, 3, true],
      [3, 3, false],
      [100, 1, true],
      [1, 100, true],
    ];
    for (const [counter, threshold, hasSideEffects] of inputs) {
      const result = shouldDream(counter, threshold, hasSideEffects);
      expect(typeof result).toBe('boolean');
    }
  });
});

// ---------------------------------------------------------------------------
// Decision contract — AND of two conditions
// ---------------------------------------------------------------------------

describe('dream-gate — decision contract', () => {
  test('truth table: only TRUE when both conditions hold', () => {
    // 4 combinations of (hasSideEffects, counter>=threshold):
    //   (false, false) → false
    //   (false, true)  → false
    //   (true,  false) → false
    //   (true,  true)  → TRUE
    expect(shouldDream(0, 3, false)).toBe(false); // (F, F)
    expect(shouldDream(5, 3, false)).toBe(false); // (F, T)
    expect(shouldDream(0, 3, true)).toBe(false); // (T, F)
    expect(shouldDream(5, 3, true)).toBe(true); // (T, T)
  });

  test('uses AND semantics (not OR)', () => {
    // OR would return true when EITHER condition holds. Pinning AND.
    expect(shouldDream(0, 3, true)).toBe(false); // OR would return true
    expect(shouldDream(5, 3, false)).toBe(false); // OR would return true
  });

  test('threshold comparison is INCLUSIVE (>=, not >)', () => {
    // At counter === threshold, shouldDream returns true (with side effects).
    // If the source used > (strict), this would be false.
    expect(shouldDream(3, 3, true)).toBe(true);
    expect(shouldDream(0, 0, true)).toBe(true);
    expect(shouldDream(7, 7, true)).toBe(true);
  });

  test('source-level: uses >= operator for threshold comparison', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/workWaypointCounter\s*>=\s*threshold/);
    // Must NOT use strict >
    expect(src).not.toMatch(/workWaypointCounter\s*>\s*threshold/);
  });

  test('source-level: combines with AND (&&), not OR (||)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/hasSideEffects\s*&&\s*workWaypointCounter/);
    // Must NOT use ||
    expect(src).not.toMatch(/hasSideEffects\s*\|\|\s*workWaypointCounter/);
  });

  test('return expression is a single boolean expression (no if/else)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/return\s+hasSideEffects\s*&&\s*workWaypointCounter\s*>=\s*threshold\s*;/);
    // No if statements in the function body
    expect(src).not.toMatch(/^\s*if\s*\(/m);
  });
});

// ---------------------------------------------------------------------------
// Boundary behavior
// ---------------------------------------------------------------------------

describe('dream-gate — boundary behavior', () => {
  test('counter = 0 with threshold = 0: dreams iff side effects', () => {
    expect(shouldDream(0, 0, true)).toBe(true);
    expect(shouldDream(0, 0, false)).toBe(false);
  });

  test('negative counter: still works (counter >= threshold is false for negative vs positive)', () => {
    // The source does not validate non-negative counter. Pinning that it
    // does not throw and follows the same >= semantics.
    expect(() => shouldDream(-1, 0, true)).not.toThrow();
    expect(shouldDream(-1, 0, true)).toBe(false); // -1 >= 0 is false
    expect(shouldDream(-1, -1, true)).toBe(true); // -1 >= -1 is true
  });

  test('negative threshold: counter >= negative threshold is true for non-negative counter', () => {
    // Edge case: a negative threshold is degenerate but the function does
    // not validate. non-negative counter >= negative threshold is always
    // true, so dreaming reduces to just hasSideEffects.
    expect(shouldDream(0, -5, true)).toBe(true);
    expect(shouldDream(0, -5, false)).toBe(false);
  });

  test('large values: no overflow or precision issues', () => {
    const big = Number.MAX_SAFE_INTEGER;
    expect(shouldDream(big, big, true)).toBe(true);
    expect(shouldDream(big - 1, big, true)).toBe(false);
    expect(shouldDream(big, big - 1, true)).toBe(true);
  });

  test('NaN inputs: comparison returns false (NaN >= anything is false)', () => {
    // NaN threshold makes counter >= threshold always false.
    expect(shouldDream(NaN, 3, true)).toBe(false);
    expect(shouldDream(3, NaN, true)).toBe(false);
    // NaN counter, threshold 0: NaN >= 0 is false
    expect(shouldDream(NaN, 0, true)).toBe(false);
  });

  test('does not throw on any combination of number/boolean inputs', () => {
    const values: number[] = [-Infinity, -1, 0, 1, 3, 100, Infinity, NaN];
    for (const counter of values) {
      for (const threshold of values) {
        expect(() => shouldDream(counter, threshold, true)).not.toThrow();
        expect(() => shouldDream(counter, threshold, false)).not.toThrow();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('dream-gate — purity', () => {
  test('same inputs always produce same output (referential transparency)', () => {
    const cases: Array<[number, number, boolean]> = [
      [0, 0, false],
      [3, 3, true],
      [5, 10, true],
      [10, 5, false],
    ];
    for (const [c, t, h] of cases) {
      const r1 = shouldDream(c, t, h);
      const r2 = shouldDream(c, t, h);
      const r3 = shouldDream(c, t, h);
      expect(r1).toBe(r2);
      expect(r2).toBe(r3);
    }
  });

  test('calling shouldDream has no observable side effects', () => {
    // No throws, no console output, no file I/O — the function is pure.
    // We can only assert it doesn't throw; purity is also pinned at the
    // source level (no imports, no process.* access).
    for (let i = 0; i < 100; i++) {
      shouldDream(i, 50, true);
    }
  });
});

// ---------------------------------------------------------------------------
// JSDoc / documentation contract
// ---------------------------------------------------------------------------

describe('dream-gate — documentation contract', () => {
  test('module JSDoc explains the extraction rationale', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/extracts?\s+the\s+pure\s+decision\s+function/);
    expect(src).toMatch(/tested\s+in\s+isolation/);
  });

  test('module JSDoc mentions Aspiration 1 (self-model)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Aspiration\s+1/);
    expect(src).toMatch(/self-model/);
  });

  test('module JSDoc mentions circadian rhythm', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/circadian/);
  });

  test('module JSDoc declares "Pure function, no I/O, no LLM calls"', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/Pure\s+function,\s+no\s+I\/O,\s+no\s+LLM\s+calls/);
  });

  test('shouldDream JSDoc documents the @param tags', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/@param\s+workWaypointCounter/);
    expect(src).toMatch(/@param\s+threshold/);
    expect(src).toMatch(/@param\s+hasSideEffects/);
  });

  test('shouldDream JSDoc documents @returns', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/@returns/);
    expect(src).toMatch(/side\s+effects\s+AND/);
  });

  test('JSDoc explains threshold reset behavior', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).toMatch(/reset\s+after\s+dreaming/);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('dream-gate — source-level safety', () => {
  test('no child_process / exec / spawn', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\(/);
    expect(src).not.toMatch(/\bspawn\(/);
  });

  test('no fs I/O', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/readFile/);
    expect(src).not.toMatch(/writeFile/);
    expect(src).not.toMatch(/readFileSync/);
    expect(src).not.toMatch(/writeFileSync/);
  });

  test('no fetch / network access', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/^import\s+.*from\s+'https?'/m);
  });

  test('no eval or Function constructor', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\beval\(/);
    expect(src).not.toMatch(/new\s+Function\(/);
  });

  test('no console.log', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/\bconsole\./);
  });

  test('no process.exit / process.env access (pure function)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/process\.exit/);
    expect(src).not.toMatch(/process\.env/);
  });

  test('no Math.random / Date.now (no non-determinism)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/Date\.now/);
    expect(src).not.toMatch(/new\s+Date\(\)/);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('dream-gate — structural fingerprint', () => {
  test('module-scoped function (no closures, no factories)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    // The function body is a single return statement — no closures created.
    expect(src).toMatch(/export\s+function\s+shouldDream[\s\S]*?return\s+hasSideEffects\s*&&\s*workWaypointCounter\s*>=\s*threshold\s*;/);
  });

  test('function body is a single return statement (no statements before)', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const bodyMatch = src.match(
      /export\s+function\s+shouldDream\s*\([^)]*\)[^{]*\{([\s\S]*?)\}/,
    );
    expect(bodyMatch).not.toBeNull();
    const body = bodyMatch![1].trim();
    // Body should be ONLY `return ...;`
    expect(body).toMatch(/^return\s+/);
    expect(body).toMatch(/;$/);
    // No other statements (no const, let, if, for, etc.)
    expect(body).not.toMatch(/^\s*(const|let|var|if|for|while)\s/m);
  });

  test('exactly one return statement', async () => {
    const src = await readFile(SRC_PATH, 'utf8');
    const returns = src.match(/\breturn\s/g) ?? [];
    expect(returns.length).toBe(1);
  });
});
