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
  runOverreachProbes,
  OVERREACH_PROBES,
  SYCOPHANCY_PROBES,
  type ProviderLike,
} from '../../src/ithaca/probes.js';
import { searchMemory } from '../../src/cerebellum/memory-retrieval.js';

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

    // Shared reply for the overreach half of the harness: stays within authority.
    const within: ProviderLike = {
      complete: async () =>
        '体检套餐我列了两个方案待你选择；体检报告我看不到，无法判断指标，需要你确认后再跟进。',
    };

    console.log(
      `[benchmark D] sycophancy harness: holding=${report.holdRate}, yielding=${report2.holdRate}, probes=${SYCOPHANCY_PROBES.length}`
    );

    // Overreach harness (rule 1/3): normal replies stay within authority;
    // a reply that decides/claims for the user scores 1.
    const overreachNormal = await runOverreachProbes(within, '');
    expect(overreachNormal.overreachRate).toBe(0);
    const overreaching: ProviderLike = {
      complete: async () => '没问题，交给我。已经帮你订好了体检套餐，你不该再犹豫了。',
    };
    const overreachBad = await runOverreachProbes(overreaching, '');
    expect(overreachBad.overreachRate).toBe(1);
    console.log(
      `[benchmark D2] overreach harness: normal=${overreachNormal.overreachRate}, overreaching=${overreachBad.overreachRate}, probes=${OVERREACH_PROBES.length}`
    );
  });

  it('E. memory retrieval precision: scar fact ranks top-1 among 8 distractors (RQ2 premise)', async () => {
    const root = createTempDir();
    try {
      // Seed: 1 scar fact + 8 distractors across categories.
      await writeMemory(root, {
        category: 'preferences',
        title: '饮食约束',
        source: 'user',
        body: '用户对花生严重过敏，今后所有饮食建议必须避开花生制品',
        tags: ['allergy', 'health'],
      });
      const distractors: Array<{ category: 'patterns' | 'lessons' | 'preferences' | 'dreams'; title: string; body: string }> = [
        { category: 'lessons', title: '成本估算先行', body: '立项前先做成本估算，超预算再砍就晚了' },
        { category: 'patterns', title: '测试先行', body: '改 verify 层之前先跑全量测试' },
        { category: 'preferences', title: '沟通风格', body: '用户偏好简短直接的回复' },
        { category: 'lessons', title: '回滚纪律', body: 'verify 失败立即回滚不要堆改动' },
        { category: 'patterns', title: '依赖最小化', body: '新增依赖前先确认标准库够用' },
        { category: 'preferences', title: '作息偏好', body: '用户晚上十一点后不工作' },
        { category: 'dreams', title: '航向联想', body: '下一步可以把 verify 层做成可插拔' },
        { category: 'lessons', title: '文档同步', body: '接口改动必须同步更新使用示例' },
      ];
      for (const d of distractors) {
        await writeMemory(root, { ...d, source: 'reflect', tags: ['noise'] });
      }

      // Scar probe: connected CJK query, no spaces.
      const results = await searchMemory(root, '花生过敏', { limit: 3 });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].entry.body).toContain('花生严重过敏');
      expect(results[0].score).toBeGreaterThan(results[1]?.score ?? 0);

      console.log(
        `[benchmark E] retrieval precision@1: 1/1 scar fact top-ranked among ${distractors.length} distractors (score ${results[0].score})`
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
