/**
 * Perception layer — the agent's sensory channels feeding the existing
 * backlog → wakeful-waypoint loop.
 *
 * Consensus template: perception collects data from the environment to
 * build state representation. Spike-idiomatic design: channels produce
 * PerceptionEvents; the hub drains them into the backlog (origin
 * 'perception'), so the proven dream/idle-voyage machinery consumes them.
 *
 * Determinism: file-watcher is snapshot-based (scan() compares mtimes —
 * no fs.watch flakiness in tests); clock takes an injected `now`.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createFileWatcher } from '../../src/perception/file-watcher.js';
import { createClockChannel } from '../../src/perception/clock.js';
import { createPerceptionHub } from '../../src/perception/hub.js';
import { listBacklog } from '../../src/cerebellum/backlog.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'perception-test-'));
}

describe('file-watcher channel', () => {
  it('first scan builds the baseline silently; later scans report changes', () => {
    const dir = createTempDir();
    try {
      fs.writeFileSync(path.join(dir, 'a.ts'), 'x');
      fs.writeFileSync(path.join(dir, 'b.ts'), 'y');

      const watcher = createFileWatcher([dir]);
      const t0 = new Date('2026-01-01T00:00:00Z');

      // First scan: baseline snapshot, no events (avoid project-wide noise).
      expect(watcher.collect(t0)).toEqual([]);

      // No change → no events.
      expect(watcher.collect(new Date('2026-01-01T00:05:00Z'))).toEqual([]);

      // Modified file → one changed event naming the file.
      fs.utimesSync(path.join(dir, 'b.ts'), t0, new Date('2026-01-01T00:10:00Z'));
      const changed = watcher.collect(new Date('2026-01-01T00:11:00Z'));
      expect(changed).toHaveLength(1);
      expect(changed[0].channel).toBe('file');
      expect(changed[0].kind).toBe('changed');
      expect(changed[0].summary).toContain('b.ts');

      // New file → one created event.
      fs.writeFileSync(path.join(dir, 'c.ts'), 'z');
      fs.utimesSync(path.join(dir, 'c.ts'), t0, new Date('2026-01-01T00:20:00Z'));
      const created = watcher.collect(new Date('2026-01-01T00:21:00Z'));
      expect(created).toHaveLength(1);
      expect(created[0].kind).toBe('created');
      expect(created[0].summary).toContain('c.ts');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('excludes ignored directories (node_modules/.git/dist) and files', () => {
    const dir = createTempDir();
    try {
      fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'x');
      fs.writeFileSync(path.join(dir, 'keep.ts'), 'y');

      const watcher = createFileWatcher([dir]);
      watcher.collect(new Date('2026-01-01T00:00:00Z'));

      fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'index.js'), 'changed');
      fs.utimesSync(
        path.join(dir, 'node_modules', 'pkg', 'index.js'),
        new Date('2026-01-01T00:00:00Z'),
        new Date('2026-01-01T00:10:00Z')
      );
      const events = watcher.collect(new Date('2026-01-01T00:11:00Z'));
      expect(events).toEqual([]); // node_modules is ignored
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('clock channel', () => {
  it('fires once per configured time per day (injected now, no timers)', () => {
    const clock = createClockChannel(['08:00']);

    // Crossed 08:00 today → fire.
    const fired = clock.collect(new Date('2026-01-01T08:30:00'));
    expect(fired).toHaveLength(1);
    expect(fired[0].channel).toBe('clock');
    expect(fired[0].kind).toBe('tick');

    // Same day again → no duplicate.
    expect(clock.collect(new Date('2026-01-01T09:00:00'))).toEqual([]);

    // Before the configured time → nothing.
    expect(clock.collect(new Date('2026-01-01T07:00:00'))).toEqual([]);

    // Next day → fires again.
    expect(clock.collect(new Date('2026-01-02T08:05:00'))).toHaveLength(1);
  });
});

describe('perception hub', () => {
  it('collects across channels in stable order', () => {
    const hub = createPerceptionHub({
      channels: [
        {
          channel: 'clock',
          collect: () => [
            { id: 'c1', channel: 'clock', kind: 'tick', summary: 'daily check-in', ts: 1 },
          ],
        },
        {
          channel: 'file',
          collect: () => [
            { id: 'f1', channel: 'file', kind: 'changed', summary: 'a.ts', ts: 2 },
          ],
        },
      ],
    });
    const events = hub.collect(new Date());
    expect(events.map(e => e.id)).toEqual(['c1', 'f1']);
  });

  it('drainToBacklog writes events into the backlog with origin perception', async () => {
    const root = createTempDir();
    try {
      const hub = createPerceptionHub({
        channels: [
          {
            channel: 'file',
            collect: () => [
              {
                id: 'f1',
                channel: 'file',
                kind: 'changed',
                summary: 'file changed: src/agent/loop.ts',
                ts: 1,
              },
            ],
          },
        ],
      });

      const drained = await hub.drainToBacklog(root, new Date());
      expect(drained).toBe(1);

      const items = await listBacklog(root);
      const perceptionItems = items.filter(i => i.origin === 'perception');
      expect(perceptionItems).toHaveLength(1);
      expect(perceptionItems[0].goal).toContain('[perception:file]');
      expect(perceptionItems[0].goal).toContain('src/agent/loop.ts');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('drainToBacklog is a no-op when nothing was perceived', async () => {
    const root = createTempDir();
    try {
      const hub = createPerceptionHub({ channels: [] });
      expect(await hub.drainToBacklog(root, new Date())).toBe(0);
      expect(await listBacklog(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
