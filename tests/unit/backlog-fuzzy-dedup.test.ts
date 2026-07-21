import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enqueueBacklog } from '../../src/cerebellum/backlog-enqueue.js';
import { sizeBacklog } from '../../src/cerebellum/backlog.js';
import {
  clearCompletedGoals,
  markCompleted,
  getCompletedGoals,
} from '../../src/cerebellum/completedGoals.js';
import { clearSeedAttempts } from '../../src/cerebellum/seedAttempts.js';
import {
  clearRetryCounters,
} from '../../src/cerebellum/retry-counter.js';
import {
  clearSkippedEnqueues,
  listSkippedEnqueues,
} from '../../src/cerebellum/backlog-registries.js';

/**
 * Integration tests for the fuzzy-duplicate dedup gate in enqueueBacklog.
 *
 * The fuzzy check is the fourth gate (after seed-exhausted, retry-exhausted,
 * already-completed). It compares the incoming goal against:
 *   1. Goals in the completedGoals registry (recently completed).
 *   2. Goals currently in the backlog file (in-progress / queued).
 *
 * Uses Levenshtein distance ratio with threshold 0.85.
 */
describe('enqueueBacklog — fuzzy-duplicate gate', () => {
  let rootDir: string;

  beforeEach(async () => {
    clearCompletedGoals();
    clearSeedAttempts();
    clearRetryCounters();
    clearSkippedEnqueues();
    rootDir = await mkdtemp(join(tmpdir(), 'ody-fuzzy-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('near-duplicate of a completed goal is blocked with fuzzy-duplicate reason', async () => {
    markCompleted('add retry logic to glm provider', 'shipped');
    // 'add retry logik to glm provider' — 1 char substitution, ratio ~0.97.
    // Not a substring of the completed goal, so isCompleted won't catch it.
    const item = await enqueueBacklog(rootDir, 'add retry logik to glm provider', 'dream');
    // Phantom item returned, not written to disk.
    expect(await sizeBacklog(rootDir)).toBe(0);
    // Skipped registry records the fuzzy-duplicate reason.
    const skipped = listSkippedEnqueues();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toBe('fuzzy-duplicate');
    expect(skipped[0]!.goal).toBe('add retry logik to glm provider');
  });

  test('near-duplicate of a completed goal is blocked (not just exact match)', async () => {
    // Enqueue and complete a goal.
    await enqueueBacklog(rootDir, 'fix bug in parser module', 'dream');
    markCompleted('fix bug in parser module', 'shipped');
    // Now try to enqueue a near-duplicate — 1 char substitution so
    // isCompleted's substring check doesn't catch it first.
    const item = await enqueueBacklog(rootDir, 'fix bug in parsez module', 'reflect');
    expect(await sizeBacklog(rootDir)).toBe(1); // still 1, not 2
    const skipped = listSkippedEnqueues();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toBe('fuzzy-duplicate');
  });

  test('genuinely different goal passes through (no false positive)', async () => {
    markCompleted('add retry logic to glm provider', 'shipped');
    // Completely different task.
    const item = await enqueueBacklog(rootDir, 'refactor memory parser', 'dream');
    expect(await sizeBacklog(rootDir)).toBe(1);
    expect(listSkippedEnqueues()).toHaveLength(0);
  });

  test('exact match of completed goal hits already-completed BEFORE fuzzy-duplicate', async () => {
    // When the goal is an exact match, isCompleted (substring) catches it
    // first. The fuzzy gate should NOT be reached.
    markCompleted('exact same goal', 'done');
    await enqueueBacklog(rootDir, 'exact same goal', 'dream');
    const skipped = listSkippedEnqueues();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toBe('already-completed');
  });

  test('user-origin bypasses fuzzy-duplicate check', async () => {
    // User-origin bypasses ALL dedup, including fuzzy.
    markCompleted('add retry logic to glm', 'done');
    const item = await enqueueBacklog(rootDir, 'add retry to glm', 'user');
    expect(await sizeBacklog(rootDir)).toBe(1);
    expect(listSkippedEnqueues()).toHaveLength(0);
  });

  test('fuzzy-duplicate phantom item has correct shape (5 keys, no sourceWaypointId)', async () => {
    markCompleted('add retry logic to glm', 'done');
    const item = await enqueueBacklog(rootDir, 'add retry to glm', 'dream');
    expect(Object.keys(item)).toHaveLength(5);
    expect('sourceWaypointId' in item).toBe(false);
    expect(item.goal).toBe('add retry to glm');
  });

  test('fuzzy-duplicate does not increment retry counter', async () => {
    markCompleted('add retry logic to glm', 'done');
    // Use substitution so isCompleted substring check doesn't catch it first.
    await enqueueBacklog(rootDir, 'add retry logik to glm', 'dream');
    const { getRetryCount } = await import('../../src/cerebellum/retry-counter.js');
    expect(getRetryCount('add retry logik to glm')).toBe(0);
  });

  test('case/punctuation differences are normalized before fuzzy comparison', async () => {
    markCompleted('Add Retry Logic!', 'done');
    // After normalization both become 'add retry logic' → exact match →
    // but isCompleted uses substring matching which is case-sensitive.
    // 'Add Retry Logic!' is in the registry; 'add retry logic' is the
    // new goal. isCompleted checks if 'add retry logic' is a substring
    // of 'Add Retry Logic!' — it's NOT (case mismatch). So the fuzzy
    // gate should catch it.
    const item = await enqueueBacklog(rootDir, 'add retry logic', 'dream');
    expect(await sizeBacklog(rootDir)).toBe(0);
    const skipped = listSkippedEnqueues();
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.reason).toBe('fuzzy-duplicate');
  });
});
