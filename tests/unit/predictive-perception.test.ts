/**
 * M4 predictive perception 最小版 — recurring failure patterns surface as
 * proactive backlog items. Signal: TypeScript error-code signature extracted
 * from verify details; when the count of stored lessons sharing that
 * signature CROSSES the threshold, exactly one 'perception'-origin backlog
 * item is enqueued (edge-triggered — crossing fires once, not every hit).
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  extractErrorSignature,
  maybeEnqueuePredictive,
  PREDICTIVE_THRESHOLD,
} from '../../src/cerebellum/predictive-perception.js';
import { writeMemory } from '../../src/cerebellum/memory.js';
import { loadBacklogFile } from '../../src/cerebellum/backlog.js';

function detailWith(code: string, goalSeed: string): string {
  return `--- syntax ---\n<repo>/${goalSeed}.ts(1,14): error ${code}: something broke`;
}

describe('extractErrorSignature', () => {
  test('pulls the TS error code out of a verify detail', () => {
    expect(extractErrorSignature('--- syntax ---\nx.ts(1,1): error TS2322: bad')).toBe('TS2322');
    expect(extractErrorSignature('x.ts: error TS2304: Cannot find name')).toBe('TS2304');
  });

  test('returns null when no TS error code is present', () => {
    expect(extractErrorSignature('--- progress ---\nwaypoint produced no file changes')).toBeNull();
    expect(extractErrorSignature('')).toBeNull();
  });
});

describe('maybeEnqueuePredictive — edge-triggered backlog item', () => {
  let root: string;

  const memRoot = (): string => path.join(root, '.odysseus');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'predictive-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('crossing the threshold enqueues exactly one perception item', async () => {
    // Threshold is 3: seed 2 lessons sharing TS2322, the new failure is #3.
    for (let i = 0; i < PREDICTIVE_THRESHOLD - 1; i++) {
      await writeMemory(memRoot(), {
        category: 'lessons',
        source: 'failure',
        title: `prior ${i}`,
        body: detailWith('TS2322', `old${i}`),
        tags: ['autolearn', `fp:${i}`],
      });
    }
    const enqueued = await maybeEnqueuePredictive(
      memRoot(),
      detailWith('TS2322', 'new'),
      'new goal'
    );
    expect(enqueued).toBe(true);
    const file = await loadBacklogFile(memRoot());
    const item = file.items.find((i) => i.origin === 'perception');
    expect(item).toBeDefined();
    expect(item!.goal).toContain('TS2322');
  });

  test('below threshold → no backlog item', async () => {
    await writeMemory(memRoot(), {
      category: 'lessons',
      source: 'failure',
      title: 'prior',
      body: detailWith('TS2322', 'old'),
      tags: ['autolearn', 'fp:old'],
    });
    const enqueued = await maybeEnqueuePredictive(memRoot(), detailWith('TS2322', 'new'), 'goal');
    expect(enqueued).toBe(false);
    const file = await loadBacklogFile(memRoot());
    expect(file.items.filter((i) => i.origin === 'perception')).toHaveLength(0);
  });

  test('edge-trigger: a second failure past the crossing does not re-enqueue', async () => {
    for (let i = 0; i < PREDICTIVE_THRESHOLD - 1; i++) {
      await writeMemory(memRoot(), {
        category: 'lessons',
        source: 'failure',
        title: `prior ${i}`,
        body: detailWith('TS2345', `old${i}`),
        tags: ['autolearn', `fp:${i}`],
      });
    }
    expect(await maybeEnqueuePredictive(memRoot(), detailWith('TS2345', 'new'), 'g1')).toBe(true);
    // Mirror the real recorder flow: the crossing lesson is WRITTEN before
    // the predictive check runs on the next failure, so the count advances.
    await writeMemory(memRoot(), {
      category: 'lessons',
      source: 'failure',
      title: 'the crossing lesson',
      body: detailWith('TS2345', 'new'),
      tags: ['autolearn', 'fp:new'],
    });
    expect(await maybeEnqueuePredictive(memRoot(), detailWith('TS2345', 'again'), 'g2')).toBe(false);
    const file = await loadBacklogFile(memRoot());
    expect(file.items.filter((i) => i.origin === 'perception')).toHaveLength(1);
  });

  test('no signature in detail → false, no crash', async () => {
    expect(await maybeEnqueuePredictive(memRoot(), '--- progress ---\nno changes', 'g')).toBe(false);
  });
});
