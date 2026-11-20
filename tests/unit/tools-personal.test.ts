/**
 * M3 生活工具面 v0 — reminder 与 note 两个本地机械工具（personal agent 的
 * 第一对非编码工具）。文件后端可注入（测试用 tmp 路径），无网络；
 * 产物内容源自 agent/用户自身（内部数据，不走 quarantine——与 file-read/
 * MCP 的外部内容契约不同，模块注释里钉了这条边界）。
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReminderTool, NoteTool } from '../../src/tools/personal.js';
import type { ToolContext } from '../../src/tools/types.js';

let storeDir: string;
const ctx: ToolContext = { cwd: '/' };

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), 'personal-tools-'));
});

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true });
});

describe('ReminderTool — add | list | done', () => {
  const tool = () => new ReminderTool(join(storeDir, 'reminders.json'));

  test('add → list shows it with an id; done removes it from open list', async () => {
    const t = tool();
    const add = await t.execute({ action: 'add', text: '明早 7 点跑步' }, ctx);
    expect(add.ok).toBe(true);

    const list = await t.execute({ action: 'list' }, ctx);
    if (list.ok) {
      expect(list.value).toContain('明早 7 点跑步');
    }

    // done needs the id — grab it from the store file
    const store = JSON.parse(readFileSync(join(storeDir, 'reminders.json'), 'utf8')) as {
      items: Array<{ id: string; text: string; done: boolean }>;
    };
    expect(store.items).toHaveLength(1);
    expect(store.items[0]!.done).toBe(false);

    const done = await t.execute({ action: 'done', id: store.items[0]!.id }, ctx);
    expect(done.ok).toBe(true);

    const list2 = await t.execute({ action: 'list' }, ctx);
    if (list2.ok) {
      expect(list2.value).not.toContain('明早 7 点跑步');
    }
  });

  test('list on empty store → friendly empty message (no crash)', async () => {
    const r = await tool().execute({ action: 'list' }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toContain('（空）');
  });

  test('missing text on add → error; unknown action → error', async () => {
    const t = tool();
    const noText = await t.execute({ action: 'add' }, ctx);
    expect(noText.ok).toBe(false);
    const badAction = await t.execute({ action: 'explode' }, ctx);
    expect(badAction.ok).toBe(false);
  });
});

describe('NoteTool — write | read', () => {
  const tool = () => new NoteTool(join(storeDir, 'notes'));

  test('write then read round-trips (slug filename)', async () => {
    const t = tool();
    const w = await t.execute({ action: 'write', title: 'meeting-notes', content: '结论：基线扩样 9/10' }, ctx);
    expect(w.ok).toBe(true);

    const r = await t.execute({ action: 'read', title: 'meeting-notes' }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toContain('基线扩样 9/10');
    expect(existsSync(join(storeDir, 'notes', 'meeting-notes.md'))).toBe(true);
  });

  test('read missing note → error naming the title', async () => {
    const r = await tool().execute({ action: 'read', title: 'nope' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('nope');
  });

  test('write overwrites an existing note (latest wins)', async () => {
    const t = tool();
    await t.execute({ action: 'write', title: 'daily', content: 'v1' }, ctx);
    await t.execute({ action: 'write', title: 'daily', content: 'v2 final' }, ctx);
    const r = await t.execute({ action: 'read', title: 'daily' }, ctx);
    if (r.ok) expect(r.value).toContain('v2 final');
  });
});
