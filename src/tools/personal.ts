/**
 * M3 生活工具面 v0 — personal agent 的第一对非编码工具。
 *
 * ReminderTool（add|list|done）与 NoteTool（write|read），文件后端、本地
 * 机械操作、无网络。后端路径由构造器注入（默认 ~/.odysseus/ 下），测试
 * 传 tmp 路径。
 *
 * Boundary note: 这些工具的内容源自 agent/用户自身（内部数据），输出不进
 * quarantine——quarantine 契约只针对外部内容（file-read/MCP/检索命中，
 * 见 util/quarantine.ts）。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { Tool, ToolContext, ToolResult } from './types.js';

function err(message: string): ToolResult {
  return { ok: false, error: message };
}

interface ReminderItem {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
  readonly createdAt: string;
}

interface ReminderStore {
  readonly items: readonly ReminderItem[];
}

function defaultStorePath(): string {
  return join(homedir(), '.odysseus', 'reminders.json');
}

async function readReminders(path: string): Promise<ReminderStore> {
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as { items?: ReminderItem[] };
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { items: [] }; // missing/corrupt store = empty, not an error
  }
}

async function writeReminders(path: string, store: ReminderStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

export class ReminderTool implements Tool {
  readonly name = 'reminder';
  readonly description =
    'Personal reminders: add a reminder, list open ones, mark one done. ' +
    'Backed by a local JSON store (~/.odysseus/reminders.json).';
  readonly parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'list', 'done'] },
      text: { type: 'string', description: '提醒内容（add 必填）' },
      id: { type: 'string', description: '提醒 id（done 必填，从 list 获取）' },
    },
    required: ['action'],
  };

  constructor(private readonly storePath: string = defaultStorePath()) {}

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const action = String(args.action ?? '');
    const store = await readReminders(this.storePath);

    if (action === 'add') {
      const text = String(args.text ?? '').trim();
      if (!text) return err('text required for add');
      const id = `rem_${Date.now().toString(16).slice(-6)}${Math.floor(Math.random() * 0xffff)
        .toString(16)
        .padStart(4, '0')}`;
      const item: ReminderItem = { id, text, done: false, createdAt: new Date().toISOString() };
      await writeReminders(this.storePath, { items: [...store.items, item] });
      return { ok: true, value: `已添加提醒 [${id}] ${text}` };
    }

    if (action === 'list') {
      const open = store.items.filter((item) => !item.done);
      if (open.length === 0) return { ok: true, value: '（空）当前没有待办提醒。' };
      const lines = open.map((item) => `[${item.id}] ${item.text}（${item.createdAt.slice(0, 10)}）`);
      return { ok: true, value: `待办提醒 ${open.length} 条：\n${lines.join('\n')}` };
    }

    if (action === 'done') {
      const id = String(args.id ?? '').trim();
      if (!id) return err('id required for done');
      const target = store.items.find((item) => item.id === id);
      if (!target) return err(`no reminder with id ${id}`);
      await writeReminders(this.storePath, {
        items: store.items.map((item) => (item.id === id ? { ...item, done: true } : item)),
      });
      return { ok: true, value: `已完成：${target.text}` };
    }

    return err(`unknown action: ${action}（add | list | done）`);
  }
}

function defaultNotesDir(): string {
  return join(homedir(), '.odysseus', 'notes');
}

function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

export class NoteTool implements Tool {
  readonly name = 'note';
  readonly description =
    'Personal notes: write a titled markdown note, read one back. ' +
    'Stored as .md files under ~/.odysseus/notes/.';
  readonly parameters = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['write', 'read'] },
      title: { type: 'string', description: '笔记标题（作为文件名 slug）' },
      content: { type: 'string', description: '笔记内容（write 必填）' },
    },
    required: ['action', 'title'],
  };

  constructor(private readonly notesDir: string = defaultNotesDir()) {}

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const action = String(args.action ?? '');
    const title = String(args.title ?? '').trim();
    if (!title) return err('title required');

    const slug = slugify(title);
    if (!slug) return err('title must contain letters or numbers');
    const path = join(this.notesDir, `${slug}.md`);

    if (action === 'write') {
      const content = String(args.content ?? '');
      if (!content) return err('content required for write');
      await mkdir(this.notesDir, { recursive: true });
      await writeFile(path, `# ${title}\n\n${content}\n`, 'utf8');
      return { ok: true, value: `已写入笔记 ${path}` };
    }

    if (action === 'read') {
      try {
        const raw = await readFile(path, 'utf8');
        return { ok: true, value: raw };
      } catch {
        return err(`no note titled "${title}"（${path}）`);
      }
    }

    return err(`unknown action: ${action}（write | read）`);
  }
}
