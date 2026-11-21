/**
 * M2 感知守卫 — voyage console 的感知引导：通道 + 可注入 gate 一次装配。
 *
 * gate 语义：clock 的每日 check-in 只在保护核非空时放行——空任务栈
 * （home 目录裸跑/尚未 /ithaca add）下 check-in 没有可对照的现实，自动
 * 触发只会产生噪音航点（用户实测 2026-11-20）。file-watcher 事件不受
 * gate 影响。gate 抛错按 fail-closed 处理（hub 已兜底）。
 */
import { resolve } from 'node:path';
import { createFileWatcher } from './file-watcher.js';
import { createClockChannel } from './clock.js';
import { createPerceptionHub } from './hub.js';
import type { PerceptionHub } from './hub.js';
import type { PerceptionEvent } from './types.js';
import { ensureIthacaLoaded } from '../ithaca/commands.js';

export async function createVoyagePerceptionHub(cwd: string): Promise<PerceptionHub> {
  const rootDir = resolve(cwd, '.odysseus');
  return createPerceptionHub({
    channels: [
      createFileWatcher([resolve(process.cwd(), 'src')]),
      createClockChannel(['08:00']),
    ],
    gate: async (event: PerceptionEvent) => {
      if (event.channel !== 'clock') return true;
      try {
        const core = await ensureIthacaLoaded(rootDir);
        return core.renderForPrompt().length > 0;
      } catch {
        return false;
      }
    },
  });
}
