/**
 * Memory retrieval layer — precision-at-need over the markdown memory store.
 *
 * Consensus template (IBM memory page / CoALA): LTM retrieval is the core
 * challenge — store relevant, recall at need, low latency. Spike's gap:
 * patterns/lessons are injected WHOLESALE into every waypoint prompt
 * (the token tax that forced the memory-size caps). This layer adds
 * lexical retrieval with CJK bigram handling (Chinese queries have no
 * spaces), so recall can become relevance-filtered.
 *
 * Honest scope: this is lexical scoring (tag > title > body, CJK bigram
 * coverage), NOT semantic embeddings — embedding recall is the upgrade
 * path. It solves precision-at-need now; latency indexing is YAGNI at
 * current store sizes (KB-scale markdown).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeMemory } from '../../src/cerebellum/memory.js';
import {
  searchMemory,
  recallMemoryAsPromptContext,
} from '../../src/cerebellum/memory-retrieval.js';

async function seed(root: string): Promise<void> {
  // 1 scar fact + 7 distractors across categories.
  await writeMemory(root, {
    category: 'preferences',
    title: '饮食约束',
    source: 'user',
    body: '用户对花生严重过敏，今后所有饮食建议必须避开花生制品',
    tags: ['allergy', 'health'],
  });
  await writeMemory(root, {
    category: 'lessons',
    title: '成本估算先行',
    source: 'reflect',
    body: '放弃方案X的教训：立项前先做成本估算，超预算40%再砍就晚了',
    tags: ['decision'],
  });
  await writeMemory(root, {
    category: 'patterns',
    title: '测试先行',
    source: 'system',
    body: '改 verify 层之前先跑全量测试，避免假绿',
    tags: ['workflow'],
  });
  await writeMemory(root, {
    category: 'preferences',
    title: '沟通风格',
    source: 'user',
    body: '用户偏好简短直接的回复，不要寒暄',
    tags: ['communication'],
  });
  await writeMemory(root, {
    category: 'lessons',
    title: '回滚纪律',
    source: 'failure',
    body: 'verify 失败立即回滚，不要在坏状态上继续堆改动',
    tags: ['workflow'],
  });
  await writeMemory(root, {
    category: 'patterns',
    title: '依赖最小化',
    source: 'system',
    body: '新增依赖前先确认标准库是否够用',
    tags: ['design'],
  });
  await writeMemory(root, {
    category: 'preferences',
    title: '作息偏好',
    source: 'user',
    body: '用户晚上十一点后不工作，日程安排避开深夜',
    tags: ['schedule'],
  });
  await writeMemory(root, {
    category: 'lessons',
    title: '文档同步',
    source: 'reflect',
    body: '接口改动必须同步更新使用示例，否则示例变成误导',
    tags: ['docs'],
  });
}

describe('searchMemory', () => {
  it('precision@1: scar fact ranks first among 7 distractors (space-separated query)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memret-'));
    try {
      await seed(root);
      const results = await searchMemory(root, '花生 过敏');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.title).toBe('饮食约束');
      expect(results[0].entry.body).toContain('花生');
      expect(results[0].score).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('CJK bigram: connected query without spaces still matches (coverage >= 0.5)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memret-'));
    try {
      await seed(root);
      // "花生过敏" as one CJK run: bigrams 花生/生过/过敏 — body contains
      // 花生 ✓ and 过敏 ✓ (生过 absent) → coverage 2/3 ≥ 0.5.
      const results = await searchMemory(root, '花生过敏');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.title).toBe('饮食约束');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('tag hits outrank body hits', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memret-'));
    try {
      await writeMemory(root, {
        category: 'preferences',
        title: '食物禁忌表',
        source: 'user',
        body: '维护一份食物禁忌清单',
        tags: ['allergy'],
      });
      await writeMemory(root, {
        category: 'lessons',
        title: '无关教训',
        source: 'reflect',
        body: '讨论 allergy 一词在代码注释里的用法',
        tags: ['docs'],
      });
      const results = await searchMemory(root, 'allergy');
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].entry.tags).toContain('allergy');
      expect(results[0].matchedBy).toContain('tag');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('freshness: entries written after a search are visible to the next search', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memret-'));
    try {
      await seed(root);
      const before = await searchMemory(root, '护照换发');
      expect(before).toEqual([]);

      await writeMemory(root, {
        category: 'tasks',
        title: '证件任务',
        source: 'user',
        body: '护照换发预约下周三办理',
        tags: ['admin'],
      });
      const after = await searchMemory(root, '护照换发');
      expect(after.length).toBe(1);
      expect(after[0].entry.body).toContain('护照换发');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('no match returns empty; limit caps results; categories filter', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memret-'));
    try {
      await seed(root);
      expect(await searchMemory(root, '量子纠缠')).toEqual([]);

      const limited = await searchMemory(root, '测试', { limit: 2 });
      expect(limited.length).toBeLessThanOrEqual(2);

      const onlyPrefs = await searchMemory(root, '花生', { categories: ['lessons'] });
      expect(onlyPrefs).toEqual([]); // scar fact lives in preferences
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('recallMemoryAsPromptContext', () => {
  it('returns only top-k relevant entries formatted for prompt injection', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memret-'));
    try {
      await seed(root);
      const block = await recallMemoryAsPromptContext(root, '花生 过敏', { maxEntries: 2 });
      expect(block).toContain('饮食约束');
      expect(block).toContain('花生');
      expect(block).not.toContain('成本估算先行');
      expect(block).not.toContain('作息偏好');

      // maxEntries respected
      const one = await recallMemoryAsPromptContext(root, '花生 过敏', { maxEntries: 1 });
      expect(one).toContain('饮食约束');
      expect(one.split('## ')).toHaveLength(2); // header + 1 entry section
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns empty string when nothing matches (no blind injection)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memret-'));
    try {
      await seed(root);
      expect(await recallMemoryAsPromptContext(root, '量子纠缠', { maxEntries: 3 })).toBe('');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
