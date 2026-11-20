/**
 * P1 learning element — verify-failure → structured lesson → long-term
 * memory. The recorder subscribes to the orchestrator event stream (the
 * orchestrator itself stays untouched — project rule) and, on a terminal
 * waypoint failure, writes a 症状/根因/修法方向 lesson into
 * `{memoryRoot}/memory/lessons.md`, which loadLongTermMemoryMarkdown
 * already injects into every subsequent waypoint prompt. Dedup via
 * `fp:` fingerprint tags.
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import { attachLessonRecorder, pruneAutolearnToCap } from '../../src/cerebellum/lesson-recorder.js';
import { readMemory, writeMemory } from '../../src/cerebellum/memory.js';
import type { OrchestratorEvent } from '../../src/orchestrator/events.js';

class FakeOrchestrator {
  private handler: ((e: OrchestratorEvent) => void) | null = null;
  on(_type: 'event', handler: (e: OrchestratorEvent) => void): void {
    this.handler = handler;
  }
  off(_type: 'event', handler: (e: OrchestratorEvent) => void): void {
    if (this.handler === handler) this.handler = null;
  }
  emit(e: OrchestratorEvent): void {
    this.handler?.(e);
  }
}

const SYNTAX_DETAIL = '--- syntax ---\nerror TS2321: Type "string" is not assignable to type "number".';

describe('attachLessonRecorder — terminal failure → structured lesson', () => {
  let root: string;
  let orch: FakeOrchestrator;
  let recorder: ReturnType<typeof attachLessonRecorder> | null = null;

  const memRoot = (): string => path.join(root, '.odysseus');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-rec-'));
    orch = new FakeOrchestrator();
  });

  afterEach(() => {
    recorder?.detach();
    recorder = null;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function emitFailureSequence(goal: string, detail: string, waypointId = 'wp1'): void {
    orch.emit({ type: 'waypoint-started', waypointId, goal, strategy: 'engineer', ts: Date.now() });
    orch.emit({
      type: 'verify-completed',
      waypointId,
      iteration: 1,
      passed: false,
      detail,
      ts: Date.now(),
    });
    orch.emit({
      type: 'waypoint-rolled-back',
      waypointId,
      reason: 'verify failed',
      iterationsUsed: 1,
      ts: Date.now(),
    });
  }

  test('rolled-back waypoint writes one structured lesson (症状/根因/修法方向)', async () => {
    recorder = attachLessonRecorder(orch, memRoot());
    emitFailureSequence('add a bash tool to the registry', SYNTAX_DETAIL);
    await recorder.pending();

    const lessons = await readMemory(memRoot(), 'lessons');
    expect(lessons).toHaveLength(1);
    const lesson = lessons[0]!;
    expect(lesson.source).toBe('failure');
    expect(lesson.category).toBe('lessons');
    expect(lesson.title).toContain('syntax');
    expect(lesson.title).toContain('add a bash tool');
    expect(lesson.body).toContain('**症状**');
    expect(lesson.body).toContain('**根因**');
    expect(lesson.body).toContain('**修法方向**');
    expect(lesson.body).toContain('TS2321');
    expect(lesson.tags?.some((t) => t.startsWith('fp:'))).toBe(true);
    expect(lesson.relatedWaypointId).toBe('wp1');
  });

  test('identical goal+detail across waypoints dedups to one lesson', async () => {
    recorder = attachLessonRecorder(orch, memRoot());
    emitFailureSequence('same goal', SYNTAX_DETAIL, 'wp1');
    await recorder.pending();
    emitFailureSequence('same goal', SYNTAX_DETAIL, 'wp2');
    await recorder.pending();

    const lessons = await readMemory(memRoot(), 'lessons');
    expect(lessons).toHaveLength(1);
  });

  test('different goal → separate lesson', async () => {
    recorder = attachLessonRecorder(orch, memRoot());
    emitFailureSequence('goal A', SYNTAX_DETAIL, 'wp1');
    await recorder.pending();
    emitFailureSequence('goal B', SYNTAX_DETAIL, 'wp2');
    await recorder.pending();

    const lessons = await readMemory(memRoot(), 'lessons');
    expect(lessons).toHaveLength(2);
  });

  test('no terminal failure → no lesson (verify pass + commit records nothing)', async () => {
    recorder = attachLessonRecorder(orch, memRoot());
    orch.emit({ type: 'waypoint-started', waypointId: 'wp1', goal: 'fine task', strategy: 'engineer', ts: Date.now() });
    orch.emit({ type: 'verify-completed', waypointId: 'wp1', iteration: 1, passed: true, ts: Date.now() });
    orch.emit({ type: 'waypoint-committed', waypointId: 'wp1', sha: 'abc1234', iterationsUsed: 1, ts: Date.now() });
    await recorder.pending();

    const lessons = await readMemory(memRoot(), 'lessons');
    expect(lessons).toHaveLength(0);
  });

  test('waypoint-failed (no rollback) also records, using event.error as fallback detail', async () => {
    recorder = attachLessonRecorder(orch, memRoot());
    orch.emit({ type: 'waypoint-started', waypointId: 'wp1', goal: 'crash goal', strategy: 'engineer', ts: Date.now() });
    orch.emit({ type: 'waypoint-failed', waypointId: 'wp1', error: 'provider socket died', ts: Date.now() });
    await recorder.pending();

    const lessons = await readMemory(memRoot(), 'lessons');
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.body).toContain('provider socket died');
    expect(lessons[0]!.title).toContain('unknown');
  });

  test('layer extraction: tests-layer detail yields tests title/body direction', async () => {
    recorder = attachLessonRecorder(orch, memRoot());
    const testsDetail = '--- tests ---\nFAIL tests/unit/x.test.ts > should work';
    emitFailureSequence('tests goal', testsDetail);
    await recorder.pending();

    const lessons = await readMemory(memRoot(), 'lessons');
    expect(lessons[0]!.title).toContain('tests');
    expect(lessons[0]!.body).toContain('失败用例');
  });

  test('oversized detail is truncated to a bounded body', async () => {
    recorder = attachLessonRecorder(orch, memRoot());
    const huge = `--- syntax ---\n${'error TS1005: x'.repeat(300)}`;
    emitFailureSequence('huge goal', huge);
    await recorder.pending();

    const lessons = await readMemory(memRoot(), 'lessons');
    expect(lessons[0]!.body.length).toBeLessThan(1200);
    expect(lessons[0]!.body).toContain('截断');
  });

  test('detach stops recording', async () => {
    recorder = attachLessonRecorder(orch, memRoot());
    recorder.detach();
    recorder = null;
    emitFailureSequence('after detach', SYNTAX_DETAIL);
    await new Promise((r) => setTimeout(r, 20));

    const lessons = await readMemory(memRoot(), 'lessons');
    expect(lessons).toHaveLength(0);
  });

  test('event source without working on() never breaks the caller', () => {
    const broken = {
      on: (): void => {
        throw new Error('no event support');
      },
    };
    expect(() => attachLessonRecorder(broken, memRoot())).not.toThrow();
  });
});

describe('fingerprint normalization — temp paths must not defeat dedup', () => {
  // lesson-loop-demo finding: the fingerprint hashes the raw detail, and
  // syntax details embed the absolute temp path — so the SAME failure in a
  // different repo/temp-dir produced a different fingerprint and escaped
  // dedup. Normalize temp dirs (and line/col drift) before hashing.
  let root: string;
  let orch: FakeOrchestrator;
  let recorder: ReturnType<typeof attachLessonRecorder> | null = null;

  const memRoot = (): string => path.join(root, '.odysseus');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-fp-'));
    orch = new FakeOrchestrator();
  });

  afterEach(() => {
    recorder?.detach();
    recorder = null;
    fs.rmSync(root, { recursive: true, force: true });
  });

  function emitFailure(goal: string, detail: string, waypointId: string): void {
    orch.emit({ type: 'waypoint-started', waypointId, goal, strategy: 'engineer', ts: Date.now() });
    orch.emit({ type: 'verify-completed', waypointId, iteration: 1, passed: false, detail, ts: Date.now() });
    orch.emit({ type: 'waypoint-rolled-back', waypointId, reason: 'verify failed', iterationsUsed: 1, ts: Date.now() });
  }

  test('same failure at different temp dirs dedups to one lesson', async () => {
    recorder = attachLessonRecorder(orch, memRoot());
    const detailA = '--- syntax ---\n/var/folders/xx/T/lesson-loop-AAAA/broken.ts(1,14): error TS2322: Type string is not assignable to type number.';
    const detailB = '--- syntax ---\n/var/folders/yy/T/lesson-loop-BBBB/broken.ts(1,14): error TS2322: Type string is not assignable to type number.';
    emitFailure('same goal', detailA, 'wp1');
    await recorder.pending();
    emitFailure('same goal', detailB, 'wp2');
    await recorder.pending();

    const lessons = await readMemory(memRoot(), 'lessons');
    expect(lessons).toHaveLength(1);
  });

  test('normalization keeps genuinely different failures distinct', async () => {
    recorder = attachLessonRecorder(orch, memRoot());
    const detailA = '--- syntax ---\n/tmp/repo-x/broken.ts(1,14): error TS2322: Type string is not assignable to type number.';
    const detailB = '--- syntax ---\n/tmp/repo-x/broken.ts(2,20): error TS2304: Cannot find name foo.';
    emitFailure('same goal', detailA, 'wp1');
    await recorder.pending();
    emitFailure('same goal', detailB, 'wp2');
    await recorder.pending();

    const lessons = await readMemory(memRoot(), 'lessons');
    expect(lessons).toHaveLength(2);
  });

  test('stored symptom body keeps the RAW detail (paths still visible)', async () => {
    recorder = attachLessonRecorder(orch, memRoot());
    const detail = '--- syntax ---\n/var/folders/xx/T/lesson-loop-AAAA/broken.ts(1,14): error TS2322: boom';
    emitFailure('raw detail goal', detail, 'wp1');
    await recorder.pending();

    const lessons = await readMemory(memRoot(), 'lessons');
    expect(lessons[0]!.body).toContain('/var/folders/xx/T/lesson-loop-AAAA/broken.ts');
  });
});

describe('pruneAutolearnToCap — the first explicit forgetting operation', () => {
  // Live baselines feed real lessons into the store; the repo's memory-size
  // gate keeps the injected prompt bounded. Forgetting must be explicit and
  // selective: autolearn entries go oldest-first; human/dream lessons never.
  let root: string;

  const memRoot = (): string => path.join(root, '.odysseus');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-prune-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('prunes oldest autolearn first, never touches user lessons', async () => {
    await writeMemory(memRoot(), {
      category: 'lessons', source: 'user', title: 'user lesson (old, big)',
      body: 'u'.repeat(400), ts: '2026-01-01T00:00:00Z',
    });
    await writeMemory(memRoot(), {
      category: 'lessons', source: 'failure', title: 'auto A (oldest autolearn)',
      body: 'a'.repeat(400), tags: ['autolearn', 'fp:aaa'], ts: '2026-01-02T00:00:00Z',
    });
    await writeMemory(memRoot(), {
      category: 'lessons', source: 'failure', title: 'auto B (newest)',
      body: 'b'.repeat(400), tags: ['autolearn', 'fp:bbb'], ts: '2026-01-03T00:00:00Z',
    });

    // cap 1100: user(~500)+B(~520) fits, so ONLY the oldest autolearn (A)
    // goes — this pins selectivity, not just aggressive shrinking.
    const removed = await pruneAutolearnToCap(memRoot(), 1100);
    const lessons = await readMemory(memRoot(), 'lessons');
    const raw = await readFile(path.join(memRoot(), 'memory', 'lessons.md'), 'utf8');

    expect(raw.length).toBeLessThanOrEqual(1100);
    expect(removed).toBe(1);
    expect(lessons.find((l) => l.title.includes('user lesson'))).toBeDefined();
    expect(lessons.find((l) => l.title.includes('auto A'))).toBeUndefined();
    expect(lessons.find((l) => l.title.includes('auto B'))).toBeDefined();
  });

  test('already under cap → no-op, returns 0', async () => {
    await writeMemory(memRoot(), {
      category: 'lessons', source: 'user', title: 'small', body: 'tiny',
    });
    const removed = await pruneAutolearnToCap(memRoot(), 5000);
    expect(removed).toBe(0);
    expect((await readMemory(memRoot(), 'lessons'))).toHaveLength(1);
  });

  test('never prunes the last resort: autolearn-only store can go to zero but no crash', async () => {
    await writeMemory(memRoot(), {
      category: 'lessons', source: 'failure', title: 'only autolearn',
      body: 'x'.repeat(600), tags: ['autolearn', 'fp:xxx'],
    });
    const removed = await pruneAutolearnToCap(memRoot(), 100);
    const lessons = await readMemory(memRoot(), 'lessons');
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(lessons).toHaveLength(0); // cap 100 < one entry: everything autolearn goes
  });
});
