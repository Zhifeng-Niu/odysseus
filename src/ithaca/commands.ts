/**
 * /ithaca command surface — the ONLY explicit write channel into the
 * protected core (user's task stack / values / identity facts).
 *
 * Conversation and reasoning paths never reach this module: they only ever
 * hold the readonly view from `getReadonlyView()`. Every mutation must go
 * through an explicit user command here (CLI `/ithaca ...` or the TUI slash
 * command), which forwards the `user-command` channel.
 *
 * The core persists at `{rootDir}/ithaca.json`; delta exports land at
 * `{rootDir}/ithaca-delta.json` by default (provider/model-agnostic,
 * portable across framework generations).
 *
 * Commands:
 *   /ithaca                                show the core
 *   /ithaca add tasks|values|identity <text>   write an entry
 *   /ithaca rm tasks|values|identity <idPrefix>  remove an entry
 *   /ithaca export [file]                  export personal-layer delta
 *   /ithaca import <file> [merge|replace]  import a delta (merge dedupes by id)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { IthacaCore, FileIthacaStore, type IthacaSection } from './index.js';

const SECTIONS: readonly IthacaSection[] = ['tasks', 'values', 'identity'];
const SECTION_LABELS: Record<IthacaSection, string> = {
  tasks: '任务栈',
  values: '价值观',
  identity: '身份',
};

const USAGE = [
  '用法:',
  '  /ithaca                                查看保护核',
  '  /ithaca add tasks|values|identity <text>    写入条目（显式命令，agent 对话不可改写）',
  '  /ithaca rm tasks|values|identity <id前缀>   删除条目',
  '  /ithaca export [file]                  导出个人层 delta（模型/框架迁移用）',
  '  /ithaca import <file> [merge|replace]  导入个人层 delta（默认 merge 按 id 去重）',
].join('\n');

interface CoreEntry {
  readonly core: IthacaCore;
  /** Load exactly once per process per rootDir; mutations auto-persist. */
  readonly loaded: Promise<void>;
}

const coreCache = new Map<string, CoreEntry>();

/**
 * Per-rootDir singleton. A corrupt ithaca.json rejects the load here —
 * the command surface then reports it loudly instead of silently starting
 * from an empty core (a silently-emptied core IS the lotus-eaters).
 */
export async function ensureIthacaLoaded(rootDir: string): Promise<IthacaCore> {
  let entry = coreCache.get(rootDir);
  if (!entry) {
    const core = new IthacaCore({ store: new FileIthacaStore(join(rootDir, 'ithaca.json')) });
    entry = { core, loaded: core.load() };
    coreCache.set(rootDir, entry);
  }
  await entry.loaded;
  return entry.core;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function renderCore(core: IthacaCore): string {
  const state = core.getState();
  const lines: string[] = [`🧭 ITHACA CORE (rev ${state.revision})`];
  let empty = true;
  for (const section of SECTIONS) {
    const entries = state[section];
    lines.push(`  ${SECTION_LABELS[section]}:`);
    if (entries.length === 0) {
      lines.push('    （空）');
      continue;
    }
    empty = false;
    for (const entry of entries) {
      lines.push(`    - [${shortId(entry.id)}] ${entry.text}`);
    }
  }
  if (empty) {
    lines.push('');
    lines.push('（空核 — /ithaca add tasks <目标> 写入第一条任务栈条目）');
  }
  return lines.join('\n');
}

function parseSection(raw: string | undefined): IthacaSection | null {
  if (raw === 'tasks' || raw === 'values' || raw === 'identity') {
    return raw;
  }
  return null;
}

/**
 * CLI entry: execute a `/ithaca ...` argv string and print the result.
 * Returns after printing; never enters the LLM path.
 */
export async function runIthacaCli(userInput: string): Promise<void> {
  console.log(await handleIthacaCommand(join(process.cwd(), '.odysseus'), userInput));
}

export async function handleIthacaCommand(rootDir: string, rawArgs: string): Promise<string> {
  const parts = rawArgs.trim().split(/\s+/).filter(Boolean);
  const sub = (parts[0] === '/ithaca' ? parts[1] : parts[0]) ?? 'show';
  // Allow both "/ithaca add tasks x" (TUI passes full text) and "add tasks x" (CLI trims the prefix).
  const rest = parts[0] === '/ithaca' ? parts.slice(1) : parts;

  try {
    const core = await ensureIthacaLoaded(rootDir);

    switch (sub) {
      case 'show':
      case 'help': {
        if (sub === 'help') return USAGE;
        return renderCore(core);
      }

      case 'add': {
        const section = parseSection(rest[1]);
        if (!section) {
          return `✗ 分区无效：${rest[1] ?? '(缺省)'}。可用: tasks / values / identity`;
        }
        const text = rest.slice(2).join(' ').trim();
        if (!text) {
          return `✗ 用法: /ithaca add ${String(section)} <text>`;
        }
        const entry = await core.add(section, text, 'user-command');
        await core.flush();
        return `✓ 已写入保护核 [${SECTION_LABELS[section]}] [${shortId(entry.id)}] ${text}`;
      }

      case 'rm': {
        const section = parseSection(rest[1]);
        if (!section) {
          return `✗ 分区无效：${rest[1] ?? '(缺省)'}。可用: tasks / values / identity`;
        }
        const idPrefix = rest[2] ?? '';
        if (!idPrefix) {
          return '✗ 用法: /ithaca rm <section> <id前缀>';
        }
        const matches = core.getState()[section].filter(e => e.id.startsWith(idPrefix));
        if (matches.length === 0) {
          return `✗ ${SECTION_LABELS[section]} 中没有 id 前缀为 "${idPrefix}" 的条目`;
        }
        if (matches.length > 1) {
          return `✗ id 前缀 "${idPrefix}" 匹配到 ${matches.length} 条，请用更长的前缀:\n${matches
            .map(e => `    [${shortId(e.id)}] ${e.text}`)
            .join('\n')}`;
        }
        const target = matches[0];
        if (!target) {
          return '✗ 删除失败（条目不存在）';
        }
        const removed = await core.remove(section, target.id, 'user-command');
        await core.flush();
        return removed
          ? `✓ 已删除 [${SECTION_LABELS[section]}] [${shortId(target.id)}] ${target.text}`
          : '✗ 删除失败（条目不存在）';
      }

      case 'export': {
        const file = rest[1] ? resolve(rest[1]) : join(rootDir, 'ithaca-delta.json');
        const delta = core.exportDelta('odysseus-spike');
        mkdirSync(resolve(rootDir), { recursive: true });
        writeFileSync(file, JSON.stringify(delta, null, 2), 'utf-8');
        const count =
          delta.core.tasks.length + delta.core.values.length + delta.core.identity.length;
        return `✓ 已导出 ${count} 条个人层 delta (schema ${delta.schema}) → ${file}`;
      }

      case 'import': {
        const file = rest[1] ? resolve(rest[1]) : null;
        if (!file) {
          return '✗ 用法: /ithaca import <file> [merge|replace]';
        }
        if (!existsSync(file)) {
          return `✗ 文件不存在: ${file}`;
        }
        const mode = rest[2] === 'replace' ? 'replace' : 'merge';
        const raw = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
        const result = await core.importDelta(raw, mode, 'delta-import');
        await core.flush();
        return `✓ delta 导入完成 (${mode})：新增 ${result.added}，跳过 ${result.skipped}`;
      }

      default:
        return `✗ 未知子命令 "${sub}"\n${USAGE}`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `✗ Ithaca: ${message}`;
  }
}
