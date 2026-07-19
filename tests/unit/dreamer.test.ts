import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, LLMCompletion } from '../../src/llm/provider.js';
import {
  dream,
  normalizeGoal,
  isDuplicateGoal,
  buildSucceededGoalSet,
} from '../../src/cerebellum/dreamer.js';
import { listBacklog } from '../../src/cerebellum/backlog.js';
import { listPendingReview } from '../../src/cerebellum/pending-review.js';
import { readMemory } from '../../src/cerebellum/memory.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';

function completion(content: string): LLMCompletion {
  return {
    content,
    model: 'mock',
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: 'stop',
  };
}

function staticProvider(responseContent: string): LLMProvider {
  return {
    async complete(): Promise<LLMCompletion> {
      return completion(responseContent);
    },
    async *stream() {
      yield '';
    },
    getModel() {
      return 'mock';
    },
  };
}

function failingProvider(error: Error): LLMProvider {
  return {
    async complete(): Promise<LLMCompletion> {
      throw error;
    },
    async *stream() {
      yield '';
    },
    getModel() {
      return 'mock';
    },
  };
}

const emptyTrace: TraceRecord[] = [];

describe('dreamer', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-dream-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('valid JSON produces backlog + memory entries', async () => {
    const response = JSON.stringify({
      backlogItems: [
        { goal: 'add retry to glm provider', priority: 75, rationale: 'flaky network' },
        { goal: 'document the voyage loop' },
      ],
      memoryEntries: [
        {
          category: 'lessons',
          title: 'tsc catches silent bugs',
          body: 'Strict mode is non-negotiable.',
        },
        {
          category: 'patterns',
          title: 'append-only trace',
          body: 'Trace records are append-only; memory is append-only.',
        },
      ],
    });

    const out = await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.parseOk).toBe(true);
    expect(out.backlogItemsAdded).toBe(2);
    expect(out.memoryEntriesAdded).toBe(2);

    const backlog = await listPendingReview(rootDir);
    expect(backlog.length).toBe(2);
    expect(backlog[0]!.goal).toBe('add retry to glm provider');
    expect(backlog[0]!.priority).toBe(75);
    expect(backlog[0]!.origin).toBe('dream');

    const lessons = await readMemory(rootDir, 'lessons');
    expect(lessons.length).toBe(1);
    expect(lessons[0]!.source).toBe('dream');
    expect(lessons[0]!.title).toBe('tsc catches silent bugs');

    const patterns = await readMemory(rootDir, 'patterns');
    expect(patterns.length).toBe(1);
    expect(patterns[0]!.body).toContain('append-only');
  });

  test('JSON wrapped in markdown code fence is parsed', async () => {
    const response = [
      'Here is my reflection:',
      '',
      '```json',
      JSON.stringify({
        backlogItems: [{ goal: 'fenced goal' }],
        memoryEntries: [],
      }),
      '```',
    ].join('\n');

    const out = await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.parseOk).toBe(true);
    expect(out.backlogItemsAdded).toBe(1);

    const backlog = await listPendingReview(rootDir);
    expect(backlog[0]!.goal).toBe('fenced goal');
  });

  test('garbage response → parseOk=false, no persistence', async () => {
    const out = await dream({
      rootDir,
      provider: staticProvider('I refuse to return JSON, sorry.'),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.parseOk).toBe(false);
    expect(out.parseError).toBeDefined();
    expect(out.backlogItemsAdded).toBe(0);
    expect(out.memoryEntriesAdded).toBe(0);

    const backlog = await listPendingReview(rootDir);
    expect(backlog.length).toBe(0);
  });

  test('priority out of [0, 100] is clamped', async () => {
    const response = JSON.stringify({
      backlogItems: [
        { goal: 'low priority', priority: -50 },
        { goal: 'high priority', priority: 9999 },
      ],
      memoryEntries: [],
    });

    await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    const backlog = await listPendingReview(rootDir);
    expect(backlog.length).toBe(2);
    const priorities = backlog.map((b) => b.priority).sort((a, b) => a - b);
    expect(priorities).toEqual([0, 100]);
  });

  test('backlog item with empty goal is dropped', async () => {
    const response = JSON.stringify({
      backlogItems: [
        { goal: '', priority: 10 },
        { goal: '   ', priority: 20 },
        { goal: 'valid goal' },
      ],
      memoryEntries: [],
    });

    const out = await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.backlogItemsAdded).toBe(1);
    const backlog = await listPendingReview(rootDir);
    expect(backlog[0]!.goal).toBe('valid goal');
  });

  test('memory entry with invalid category is dropped', async () => {
    const response = JSON.stringify({
      backlogItems: [],
      memoryEntries: [
        { category: 'bogus', title: 't', body: 'b' },
        { category: 'lessons', title: 'good', body: 'real insight' },
      ],
    });

    const out = await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.memoryEntriesAdded).toBe(1);
    const lessons = await readMemory(rootDir, 'lessons');
    expect(lessons.length).toBe(1);
    expect(lessons[0]!.title).toBe('good');
  });

  test('cap: extra items beyond maxBacklogItems are dropped', async () => {
    const response = JSON.stringify({
      backlogItems: [
        { goal: 'one' },
        { goal: 'two' },
        { goal: 'three' },
        { goal: 'four' },
      ],
      memoryEntries: [],
    });

    const out = await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
      maxBacklogItems: 2,
    });

    expect(out.backlogItemsAdded).toBe(2);
    const backlog = await listPendingReview(rootDir);
    expect(backlog.length).toBe(2);
  });

  test('cap: extra items beyond maxMemoryEntries are dropped', async () => {
    const response = JSON.stringify({
      backlogItems: [],
      memoryEntries: [
        { category: 'patterns', title: 'one', body: 'a' },
        { category: 'patterns', title: 'two', body: 'b' },
        { category: 'patterns', title: 'three', body: 'c' },
      ],
    });

    const out = await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
      maxMemoryEntries: 1,
    });

    expect(out.memoryEntriesAdded).toBe(1);
  });

  test('LLM provider throws → error propagates', async () => {
    await expect(
      dream({
        rootDir,
        provider: failingProvider(new Error('rate limited')),
        recentTrace: emptyTrace,
        memorySnapshot: [],
      })
    ).rejects.toThrow(/rate limited/);

    // Nothing persisted despite the throw.
    const backlog = await listPendingReview(rootDir);
    expect(backlog.length).toBe(0);
  });

  test('durationMs is positive even on parse failure', async () => {
    const out = await dream({
      rootDir,
      provider: staticProvider('garbage'),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('empty backlogItems + memoryEntries is valid (silent dream)', async () => {
    const response = JSON.stringify({
      backlogItems: [],
      memoryEntries: [],
    });

    const out = await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.parseOk).toBe(true);
    expect(out.backlogItemsAdded).toBe(0);
    expect(out.memoryEntriesAdded).toBe(0);
  });

  test('skips backlog items that duplicate a previously succeeded waypoint', async () => {
    // recentTrace says "add retry to glm provider" already succeeded. The LLM
    // proposes the same work again under a slightly different phrasing. The
    // dreamer must skip it rather than enqueue a duplicate.
    const trace: TraceRecord[] = [
      {
        ts: new Date().toISOString(),
        waypoint_id: 'wp_abc',
        goal: 'add retry to glm provider',
        strategy: 'engineer',
        parent: null,
        outcome: 'success',
        checkpoint_sha: null,
        iterations_used: 3,
        tokens_consumed: { input: 10, output: 20 },
        verify_result: {},
        fail_reason: null,
        diff_summary: 'committed',
      },
    ];

    const response = JSON.stringify({
      backlogItems: [
        { goal: 'add retry logic to the glm provider' }, // near-dup of succeeded
        { goal: 'extract conversation detector into src/cerebellum/conversation.ts' }, // fresh
      ],
      memoryEntries: [],
    });

    const out = await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: trace,
      memorySnapshot: [],
    });

    expect(out.backlogItemsAdded).toBe(1);
    expect(out.backlogItemsSkipped).toBe(1);

    const backlog = await listPendingReview(rootDir);
    expect(backlog.length).toBe(1);
    expect(backlog[0]!.goal).toContain('conversation detector');
  });

  test('skips near-duplicate items within the same dream pass', async () => {
    // LLM hallucinates two near-identical items in one response. The second
    // must be skipped so we don't get duplicate backlog entries.
    const response = JSON.stringify({
      backlogItems: [
        { goal: 'add dedup check to enqueueBacklog in src/cerebellum/backlog.ts' },
        { goal: 'add deduplication to enqueueBacklog() in backlog.ts' },
      ],
      memoryEntries: [],
    });

    const out = await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.backlogItemsAdded).toBe(1);
    expect(out.backlogItemsSkipped).toBe(1);
  });

  test('does not skip items that merely share a verb with succeeded goals', async () => {
    // "add X" vs "add Y" — both start with "add" but target different files.
    // The dedup must not over-fire and kill legitimately distinct work.
    const trace: TraceRecord[] = [
      {
        ts: new Date().toISOString(),
        waypoint_id: 'wp_x',
        goal: 'add retry to glm provider in src/llm/glm-provider.ts',
        strategy: 'engineer',
        parent: null,
        outcome: 'success',
        checkpoint_sha: null,
        iterations_used: 3,
        tokens_consumed: { input: 10, output: 20 },
        verify_result: {},
        fail_reason: null,
        diff_summary: 'committed',
      },
    ];

    const response = JSON.stringify({
      backlogItems: [
        { goal: 'add trace rotation to src/trace/jsonl.ts' }, // shares verb, different target
      ],
      memoryEntries: [],
    });

    const out = await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: trace,
      memorySnapshot: [],
    });

    expect(out.backlogItemsAdded).toBe(1);
    expect(out.backlogItemsSkipped).toBe(0);
  });

  test('only success-outcome waypoints count as duplicates; failures do not', async () => {
    // A previously failed attempt should not block re-proposing — the work
    // was never actually shipped.
    const trace: TraceRecord[] = [
      {
        ts: new Date().toISOString(),
        waypoint_id: 'wp_fail',
        goal: 'add dedup check to enqueueBacklog in src/cerebellum/backlog.ts',
        strategy: 'engineer',
        parent: null,
        outcome: 'failure',
        checkpoint_sha: null,
        iterations_used: 3,
        tokens_consumed: { input: 10, output: 20 },
        verify_result: {},
        fail_reason: 'verify failed',
        diff_summary: null,
      },
    ];

    const response = JSON.stringify({
      backlogItems: [
        { goal: 'add dedup check to enqueueBacklog in src/cerebellum/backlog.ts' },
      ],
      memoryEntries: [],
    });

    const out = await dream({
      rootDir,
      provider: staticProvider(response),
      recentTrace: trace,
      memorySnapshot: [],
    });

    expect(out.backlogItemsAdded).toBe(1);
    expect(out.backlogItemsSkipped).toBe(0);
  });
});

describe('dreamer dedup helpers', () => {
  test('normalizeGoal strips punctuation and lowercases', () => {
    expect(normalizeGoal('Add Retry to GLM!')).toBe('add retry to glm');
    expect(normalizeGoal('  fix   bug  ')).toBe('fix bug');
    expect(normalizeGoal('Update src/foo-bar.ts (urgent)')).toBe(
      'update src foo bar ts urgent'
    );
  });

  test('isDuplicateGoal detects exact normalized match', () => {
    const existing = new Set(['add retry to glm']);
    expect(isDuplicateGoal('Add Retry to GLM!', existing)).toBe(true);
    expect(isDuplicateGoal('fix bug', existing)).toBe(false);
  });

  test('isDuplicateGoal detects Jaccard ≥ 0.5 overlap', () => {
    const existing = new Set(['add retry to glm provider']);
    // 4 of 5 content words overlap → similarity ≈ 0.8
    expect(isDuplicateGoal('add retry logic to glm provider', existing)).toBe(true);
    // 1 of 5 overlap → similarity ≈ 0.2
    expect(isDuplicateGoal('fix caching in registry', existing)).toBe(false);
  });

  test('isDuplicateGoal handles empty/whitespace goals safely', () => {
    const existing = new Set<string>();
    expect(isDuplicateGoal('', existing)).toBe(false);
    expect(isDuplicateGoal('   ', existing)).toBe(false);
  });

  test('buildSucceededGoalSet filters to outcome=success', () => {
    const trace: TraceRecord[] = [
      {
        ts: 'a',
        waypoint_id: 'wp1',
        goal: 'g1',
        strategy: 'engineer',
        parent: null,
        outcome: 'success',
        checkpoint_sha: null,
        iterations_used: 1,
        tokens_consumed: { input: 0, output: 0 },
        verify_result: {},
        fail_reason: null,
        diff_summary: null,
      },
      {
        ts: 'b',
        waypoint_id: 'wp2',
        goal: 'g2',
        strategy: 'engineer',
        parent: null,
        outcome: 'failure',
        checkpoint_sha: null,
        iterations_used: 1,
        tokens_consumed: { input: 0, output: 0 },
        verify_result: {},
        fail_reason: 'oops',
        diff_summary: null,
      },
      {
        ts: 'c',
        waypoint_id: 'wp3',
        goal: 'g3',
        strategy: 'engineer',
        parent: null,
        outcome: 'success',
        checkpoint_sha: null,
        iterations_used: 1,
        tokens_consumed: { input: 0, output: 0 },
        verify_result: {},
        fail_reason: null,
        diff_summary: null,
      },
    ];
    const set = buildSucceededGoalSet(trace);
    expect(set.size).toBe(2);
    expect(set.has('g1')).toBe(true);
    expect(set.has('g3')).toBe(true);
    expect(set.has('g2')).toBe(false);
  });
});
