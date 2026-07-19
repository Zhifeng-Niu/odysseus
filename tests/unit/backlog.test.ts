import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  enqueueBacklog,
  dequeueBacklog,
  peekBacklog,
  sizeBacklog,
  listBacklog,
  removeBacklogItem,
} from '../../src/cerebellum/backlog.js';

describe('backlog queue', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-bl-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('enqueue assigns default priority by origin (user=50, reflect=75, dream=100)', async () => {
    const user = await enqueueBacklog(rootDir, 'u', 'user');
    const reflect = await enqueueBacklog(rootDir, 'r', 'reflect');
    const dream = await enqueueBacklog(rootDir, 'd', 'dream');
    expect(user.priority).toBe(50);
    expect(reflect.priority).toBe(75);
    expect(dream.priority).toBe(100);
  });

  test('dequeue returns highest-priority (lowest number) first', async () => {
    await enqueueBacklog(rootDir, 'dream item', 'dream');
    await enqueueBacklog(rootDir, 'user item', 'user');
    await enqueueBacklog(rootDir, 'reflect item', 'reflect');

    const first = await dequeueBacklog(rootDir);
    expect(first?.goal).toBe('user item');

    const second = await dequeueBacklog(rootDir);
    expect(second?.goal).toBe('reflect item');

    const third = await dequeueBacklog(rootDir);
    expect(third?.goal).toBe('dream item');
  });

  test('equal priority preserves FIFO (insertion) order', async () => {
    // Three dream items — all priority 100.
    await enqueueBacklog(rootDir, 'first', 'dream');
    await enqueueBacklog(rootDir, 'second', 'dream');
    await enqueueBacklog(rootDir, 'third', 'dream');

    const first = await dequeueBacklog(rootDir);
    expect(first?.goal).toBe('first');

    const second = await dequeueBacklog(rootDir);
    expect(second?.goal).toBe('second');
  });

  test('peek returns next item without removing it', async () => {
    await enqueueBacklog(rootDir, 'visible', 'user');
    const beforePeek = await sizeBacklog(rootDir);
    expect(beforePeek).toBe(1);

    const peeked = await peekBacklog(rootDir);
    expect(peeked?.goal).toBe('visible');

    const afterPeek = await sizeBacklog(rootDir);
    expect(afterPeek).toBe(1); // still there
  });

  test('dequeue on empty queue returns null (not an error)', async () => {
    const result = await dequeueBacklog(rootDir);
    expect(result).toBeNull();
  });

  test('explicit priority overrides origin default', async () => {
    const item = await enqueueBacklog(rootDir, 'pinned dream', 'dream', {
      priority: 10,
    });
    expect(item.priority).toBe(10);

    // Should dequeue before user (default 50).
    await enqueueBacklog(rootDir, 'user item', 'user');
    const next = await dequeueBacklog(rootDir);
    expect(next?.goal).toBe('pinned dream');
  });

  test('empty goal throws (cannot enqueue void)', async () => {
    await expect(enqueueBacklog(rootDir, '', 'user')).rejects.toThrow(/empty/);
    await expect(enqueueBacklog(rootDir, '   ', 'user')).rejects.toThrow(/empty/);
  });

  test('listBacklog returns all items sorted by priority then time', async () => {
    await enqueueBacklog(rootDir, 'c-dream', 'dream');
    await enqueueBacklog(rootDir, 'a-user', 'user');
    await enqueueBacklog(rootDir, 'b-reflect', 'reflect');

    const list = await listBacklog(rootDir);
    expect(list.map((i) => i.goal)).toEqual(['a-user', 'b-reflect', 'c-dream']);
  });

  test('removeBacklogItem removes by id, returns false for unknown id', async () => {
    const item = await enqueueBacklog(rootDir, 'will remove', 'user');
    const removed = await removeBacklogItem(rootDir, item.id);
    expect(removed).toBe(true);
    expect(await sizeBacklog(rootDir)).toBe(0);

    const missing = await removeBacklogItem(rootDir, 'bl_doesnotexist');
    expect(missing).toBe(false);
  });

  test('persistence survives across calls (writes to JSON file)', async () => {
    await enqueueBacklog(rootDir, 'persisted', 'user');
    const raw = await readFile(join(rootDir, 'backlog.json'), 'utf8');
    expect(raw).toContain('persisted');
    expect(raw).toContain('"version": 1');
  });

  test('item id and createdAt are preserved when explicit', async () => {
    const item = await enqueueBacklog(rootDir, 'pinned', 'user', {
      id: 'bl_fixed',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(item.id).toBe('bl_fixed');
    expect(item.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  test('sourceWaypointId provenance round-trips', async () => {
    const item = await enqueueBacklog(rootDir, 'post-mortem', 'reflect', {
      sourceWaypointId: 'wp_failed001',
    });
    expect(item.sourceWaypointId).toBe('wp_failed001');

    const dequeued = await dequeueBacklog(rootDir);
    expect(dequeued?.sourceWaypointId).toBe('wp_failed001');
  });

  test('corrupt JSON file is treated as empty queue (not an error)', async () => {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(rootDir, 'backlog.json'), '{not valid json', 'utf8');
    const size = await sizeBacklog(rootDir);
    expect(size).toBe(0);
    // Subsequent enqueue should work (overwrites the corrupt file).
    const item = await enqueueBacklog(rootDir, 'fresh start', 'user');
    expect(item.id).toMatch(/^bl_/);
  });
});
