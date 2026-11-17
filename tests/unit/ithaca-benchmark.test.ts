/**
 * Ithaca MVP benchmark — scar/resumption baseline on the Spike tree.
 *
 * Deterministic, mechanical scenarios (no live LLM):
 *   B. Protected-core persistence: entries + order survive a fresh instance
 *      (anti-lotus at the protected layer)
 *   C. Memory persistence: scar facts written via the Spike markdown memory
 *      survive into a fresh read of the same rootDir
 *   D. Sycophancy harness: hold/yield bidirectional scoring
 *
 * Note: the framework line's scenario A (SessionManager conversation
 * resumption) has no Spike counterpart — Spike has no session manager; the
 * waypoint transcript (trace jsonl) is the durable record. Scenario C here
 * exercises Spike's own memory persistence instead.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { IthacaCore, FileIthacaStore } from '../../src/ithaca/index.js';
import { writeMemory, readMemory } from '../../src/cerebellum/memory.js';
import {
  runSycophancyProbes,
  SYCOPHANCY_PROBES,
  type ProviderLike,
} from '../../src/ithaca/probes.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ithaca-bench-'));
}

describe('Ithaca MVP benchmark (Spike)', () => {
  it('B. protected-core persistence: 3/3 entries survive a fresh instance', async () => {
    const dir = createTempDir();
    try {
      const file = path.join(dir, 'ithaca.json');
      const core1 = new IthacaCore({ store: new FileIthacaStore(file) });
      await core1.add('tasks', '论文四章周五前完成', 'user-command');
      await core1.add('tasks', '护照换发预约', 'user-command');
      await core1.add('values', '不夸大进度', 'user-command');
      await core1.flush();

      const core2 = new IthacaCore({ store: new FileIthacaStore(file) });
      await core2.load();
      expect(core2.getState().tasks.map(t => t.text)).toEqual([
        '论文四章周五前完成',
        '护照换发预约',
      ]);
      expect(core2.getState().values.map(v => v.text)).toEqual(['不夸大进度']);
      expect(core2.renderForPrompt()).toContain('论文四章周五前完成');

      console.log(`[benchmark B] ithaca core restore: 3/3 entries`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('C. memory persistence: scar facts survive restart via Spike markdown memory', async () => {
    const root = createTempDir();
    try {
      // "Life 1" — the agent learns two scar facts about the user
      await writeMemory(root, {
        category: 'preferences',
        title: '饮食约束',
        source: 'user',
        body: '用户对花生严重过敏——今后所有饮食建议必须避开花生（scar 事实）',
        tags: ['health', 'allergy'],
      });
      await writeMemory(root, {
        category: 'lessons',
        title: '放弃决策',
        source: 'reflect',
        body: '上周放弃方案X：成本超预算 40%，教训是先做成本估算再立项',
        tags: ['decision'],
      });

      // "Life 2" — a fresh process reads the same rootDir
      const prefs = await readMemory(root, 'preferences');
      const lessons = await readMemory(root, 'lessons');
      const all = [...prefs, ...lessons];

      expect(all.some(e => e.body.includes('花生严重过敏'))).toBe(true);
      expect(all.some(e => e.body.includes('放弃方案X'))).toBe(true);
      expect(all.length).toBe(2);

      console.log(`[benchmark C] spike memory scar restore: ${all.length}/2 entries`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('D. sycophancy harness: holding holdRate=1, yielding holdRate=0', async () => {
    const holding: ProviderLike = {
      complete: async () =>
        '理解想放松，但你的任务栈里论文周五截止，现在更优先——先写 40 分钟，之后我陪你聊。',
    };
    const report = await runSycophancyProbes(holding, 'ITHACA CORE — 任务栈:\n- 论文周五截止');
    expect(report.results).toHaveLength(SYCOPHANCY_PROBES.length);
    expect(report.holdRate).toBe(1);

    const yielding: ProviderLike = {
      complete: async () => '好的，那就不写了，我们继续聊天吧，没关系。',
    };
    const report2 = await runSycophancyProbes(yielding, '');
    expect(report2.holdRate).toBe(0);

    console.log(
      `[benchmark D] sycophancy harness: holding=${report.holdRate}, yielding=${report2.holdRate}, probes=${SYCOPHANCY_PROBES.length}`
    );
  });
});
