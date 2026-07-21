import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';

/**
 * Extraction-invariant meta tests for Iteration 36 and Iteration 39.
 *
 * Iterations 42-55 each landed a "code lives in the new file" test
 * alongside their extraction (see voyage-stats-format.test.ts,
 * memory-parse.test.ts, backlog.test.ts:retry-counter extraction,
 * dreamer.test.ts:buildUserPrompt extraction, etc.). These tests pin
 * the extraction so a future refactor cannot silently re-inline the
 * code (which would re-trigger file-size pressure).
 *
 * Iterations 36 (dreamer-dedup) and 39 (backlog-registries) were
 * extracted BEFORE this convention solidified. They have direct unit
 * tests but no extraction-invariant test. This file closes that gap
 * so every Iter ≥36 extraction follows the same pattern.
 *
 * Each test:
 *   1. Verifies the extracted symbols live in the new file.
 *   2. Verifies the OLD file does NOT contain the implementation.
 *   3. Verifies the re-export / direct-import shape is stable.
 *
 * The string-match style is intentional — it's the same pattern used
 * by voyage-stats-format.test.ts and memory-parse.test.ts.
 */

// ---------------------------------------------------------------------------
// Iteration 36 — dreamer-dedup.ts (extracted from dreamer.ts)
// ---------------------------------------------------------------------------

describe('dreamer-dedup extraction (Iteration 36)', () => {
  test('dedup symbols live in dreamer-dedup.ts', async () => {
    const src = await readFile('src/cerebellum/dreamer-dedup.ts', 'utf8');
    expect(src).toContain('export function normalizeGoal');
    expect(src).toContain('export function isDuplicateGoal');
    expect(src).toContain('export function buildSucceededGoalSet');
  });

  test('dreamer.ts does NOT re-define the dedup symbols', async () => {
    // The functions must not be re-implemented in dreamer.ts. If a
    // future refactor re-inlines them, the file-size cap test
    // (cerebellum-size.test.ts) will also fire — but this test gives
    // a more specific error message pointing at the regression.
    const src = await readFile('src/cerebellum/dreamer.ts', 'utf8');
    expect(src).not.toContain('export function normalizeGoal');
    expect(src).not.toContain('export function isDuplicateGoal');
    expect(src).not.toContain('export function buildSucceededGoalSet');
  });

  test('dreamer.ts imports the dedup symbols directly (no re-export)', async () => {
    // Unlike Iter 39 (backlog-registries) and Iter 53 (memory-parse),
    // dreamer.ts does NOT re-export dreamer-dedup — it just consumes
    // the symbols directly. This is because dreamer.ts is the only
    // caller; the re-export pattern is reserved for extractions where
    // multiple callers need import-stability. Pinning this so a future
    // "consistency" refactor doesn't add a re-export that doesn't
    // serve any caller.
    const src = await readFile('src/cerebellum/dreamer.ts', 'utf8');
    expect(src).toContain("from './dreamer-dedup.js'");
    expect(src).not.toContain(
      "export { normalizeGoal } from './dreamer-dedup.js'",
    );
    expect(src).not.toContain(
      "export { isDuplicateGoal } from './dreamer-dedup.js'",
    );
    expect(src).not.toContain(
      "export { buildSucceededGoalSet } from './dreamer-dedup.js'",
    );
  });
});

// ---------------------------------------------------------------------------
// Iteration 39 — backlog-registries.ts (extracted from backlog.ts)
// ---------------------------------------------------------------------------

describe('backlog-registries extraction (Iteration 39)', () => {
  test('registry symbols live in backlog-registries.ts', async () => {
    const src = await readFile(
      'src/cerebellum/backlog-registries.ts',
      'utf8',
    );
    expect(src).toContain('export type SkipReason');
    expect(src).toContain('export interface SkippedEnqueue');
    expect(src).toContain('export interface RejectedGoal');
    expect(src).toContain('export function recordSkippedEnqueue');
    expect(src).toContain('export function listSkippedEnqueues');
    expect(src).toContain('export function clearSkippedEnqueues');
    expect(src).toContain('export function recordRejectedGoal');
    expect(src).toContain('export function listRejectedGoals');
    expect(src).toContain('export function clearRejectedGoals');
  });

  test('backlog.ts does NOT re-define the registry symbols', async () => {
    // The implementations must not be inlined back into backlog.ts.
    // Comments documenting the move are allowed (and present) — the
    // check is specifically for export statements that would
    // re-declare these symbols as live code in backlog.ts.
    const src = await readFile('src/cerebellum/backlog.ts', 'utf8');
    expect(src).not.toContain('export type SkipReason');
    expect(src).not.toContain('export interface SkippedEnqueue');
    expect(src).not.toContain('export interface RejectedGoal');
    expect(src).not.toContain('export function recordSkippedEnqueue');
    expect(src).not.toContain('export function listSkippedEnqueues');
    expect(src).not.toContain('export function clearSkippedEnqueues');
    expect(src).not.toContain('export function recordRejectedGoal');
    expect(src).not.toContain('export function listRejectedGoals');
    expect(src).not.toContain('export function clearRejectedGoals');
  });

  test('backlog.ts re-exports the registry symbols for backwards compat', async () => {
    // The re-export is load-bearing: orchestrator.ts and
    // pending-review.ts import these symbols from backlog.ts. Removing
    // the re-export would force an orchestrator.ts edit, which
    // CLAUDE.md forbids without manual review.
    const src = await readFile('src/cerebellum/backlog.ts', 'utf8');
    expect(src).toContain(
      "export type {\n  SkipReason,\n  SkippedEnqueue,\n  RejectedGoal,\n} from './backlog-registries.js';",
    );
    expect(src).toContain(
      "export {\n  recordSkippedEnqueue,\n  listSkippedEnqueues,\n  clearSkippedEnqueues,\n  recordRejectedGoal,\n  listRejectedGoals,\n  clearRejectedGoals,\n} from './backlog-registries.js';",
    );
  });
});
