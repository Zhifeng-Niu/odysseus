/**
 * M2 感知守卫 — PerceptionHub 可注入 gate：gate 返回 false 的事件不入队。
 * 真实接线（index.ts voyage console）：clock 事件仅当保护核非空放行——
 * home 目录/空任务栈下每日 check-in 不再自动触发航点（用户实测的噪音源）。
 * hub 保持纯净：gate 是注入的谓词，不 import ithaca。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createPerceptionHub, type PerceptionHubOptions } from '../../src/perception/hub.js';
import type { PerceptionChannelAdapter, PerceptionEvent } from '../../src/perception/types.js';
import { loadBacklogFile } from '../../src/cerebellum/backlog.js';

function fixedChannel(events: PerceptionEvent[]): PerceptionChannelAdapter {
  return {
    channel: 'clock',
    collect: () => events,
  };
}

function event(summary: string): PerceptionEvent {
  return { id: `p_${summary.slice(0, 6)}`, channel: 'clock', kind: 'tick', summary, ts: 1 };
}

describe('PerceptionHub gate — selective enqueue', () => {
  let rootDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'hub-gate-'));
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
  });

  test('gate false → event not enqueued; gate true → enqueued', async () => {
    const opts: PerceptionHubOptions = {
      channels: [fixedChannel([event('daily check-in'), event('clock', 'other')])],
      gate: async (e) => e.summary !== 'daily check-in',
    };
    const hub = createPerceptionHub(opts);
    const n = await hub.drainToBacklog(rootDir, new Date());
    expect(n).toBe(1); // one gated out
    const file = await loadBacklogFile(rootDir);
    expect(file.items).toHaveLength(1);
    expect(file.items[0]!.goal).toContain('other');
  });

  test('no gate → all events enqueue (default behavior unchanged)', async () => {
    const hub = createPerceptionHub({
      channels: [fixedChannel([event('check-in'), event('clock', 'second')])],
    });
    const n = await hub.drainToBacklog(rootDir, new Date());
    expect(n).toBe(2);
    const file = await loadBacklogFile(rootDir);
    expect(file.items).toHaveLength(2);
  });

  test('gate throwing → treated as blocked (fail-closed, never crashes the drain)', async () => {
    const hub = createPerceptionHub({
      channels: [fixedChannel([event('check-in')])],
      gate: async () => {
        throw new Error('core store unavailable');
      },
    });
    const n = await hub.drainToBacklog(rootDir, new Date());
    expect(n).toBe(0);
    const file = await loadBacklogFile(rootDir);
    expect(file.items).toHaveLength(0);
  });

  test('collect() is unaffected by the gate (observability keeps full events)', () => {
    const hub = createPerceptionHub({
      channels: [fixedChannel([event('check-in')])],
      gate: async () => false,
    });
    expect(hub.collect(new Date())).toHaveLength(1);
  });
});
