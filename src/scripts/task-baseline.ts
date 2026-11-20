#!/usr/bin/env node
/**
 * Live task-completion baseline — the P0 eval layer against the REAL model.
 *
 *   npx tsx src/scripts/task-baseline.ts
 *   (or: npm run build && node dist/scripts/task-baseline.js)
 *
 * N small deterministic tasks, each driven through the REAL orchestrator
 * (lazy checkpoint → act → progress/syntax/tests verify → commit/rollback)
 * by GLMProvider, in a throwaway git repo, with the production tool surface
 * (file-read/write/edit + git + bash). Reports per-task outcome, artifact
 * verification, token cost, and latency — the first real-model numbers for
 * "能完成 task". Pair with probe-*.ts for the full model-selection picture.
 */
import { join } from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { execFileNoThrow } from '../util/exec.js';
import { GLMProvider } from '../llm/glm.js';
import { loadConfig } from '../config.js';
import { loadDotenv } from '../util/dotenv.js';
import { CerebellumOrchestrator } from '../cerebellum/orchestrator.js';
import { ToolRegistry } from '../tools/registry.js';
import { FileReadTool, FileWriteTool, FileEditTool } from '../tools/file.js';
import { GitTool } from '../tools/git.js';
import { BashTool } from '../tools/bash.js';
import type { LLMProvider } from '../llm/provider.js';

interface LiveTask {
  readonly id: string;
  readonly goal: string;
  readonly verify: (root: string) => Promise<boolean>;
}

const TASKS: readonly LiveTask[] = [
  {
    id: 'hello-export',
    goal: '创建文件 hello.ts，内容恰好为一行：export const greeting = "hello odysseus";',
    verify: async (root) =>
      (await fs.readFile(join(root, 'hello.ts'), 'utf8')).includes('hello odysseus'),
  },
  {
    id: 'two-modules',
    goal: '创建两个文件：a.ts 内容为 export const a = 1; ，b.ts 内容为 export const b = 2;',
    verify: async (root) => {
      const a = await fs.readFile(join(root, 'a.ts'), 'utf8');
      const b = await fs.readFile(join(root, 'b.ts'), 'utf8');
      return a.includes('const a = 1') && b.includes('const b = 2');
    },
  },
  {
    id: 'inc-function',
    goal: '创建 counter.ts，实现并导出函数 inc(n: number): number，返回 n + 1。',
    verify: async (root) => {
      const c = await fs.readFile(join(root, 'counter.ts'), 'utf8');
      return c.includes('export function inc') && c.includes('n + 1');
    },
  },
];

interface TaskRow {
  readonly id: string;
  readonly outcome: string;
  readonly artifactOk: boolean;
  readonly success: boolean;
  readonly tokens: number;
  readonly latencyMs: number;
}

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'task-baseline-'));
  const git = async (args: readonly string[]): Promise<void> => {
    const r = await execFileNoThrow('git', args, { cwd: dir });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  };
  await git(['init']);
  await git(['config', 'user.email', 'baseline@odysseus.local']);
  await git(['config', 'user.name', 'odysseus-baseline']);
  await fs.writeFile(join(dir, 'README.md'), '# live baseline task\n', 'utf8');
  await git(['add', '-A']);
  await git(['commit', '-m', 'init']);
  return dir;
}

async function main(): Promise<void> {
  loadDotenv(join(process.cwd(), '.env'));
  const cfg = loadConfig();
  console.log(`model: ${cfg.model} @ ${cfg.baseUrl}`);
  console.log(`tasks: ${TASKS.length} (verifyLayers: progress/syntax/tests, production tool surface)\n`);

  const glm = new GLMProvider({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl });
  let tokens = 0;
  let calls = 0;
  const counting: LLMProvider = {
    async complete(prompt, options) {
      const completion = await glm.complete(prompt, options);
      calls += 1;
      tokens += completion.usage.inputTokens + completion.usage.outputTokens;
      return completion;
    },
    stream: glm.stream.bind(glm),
    getModel: () => glm.getModel(),
  };

  const rows: TaskRow[] = [];
  for (const task of TASKS) {
    process.stdout.write(`▶ ${task.id}: ${task.goal}\n`);
    const root = await makeRepo();
    const startedAt = Date.now();
    const tokensBefore = tokens;

    const registry = new ToolRegistry();
    registry.register(new FileReadTool());
    registry.register(new FileWriteTool());
    registry.register(new FileEditTool());
    registry.register(new GitTool());
    registry.register(new BashTool());

    const orch = new CerebellumOrchestrator({
      cwd: root,
      provider: counting,
      registry,
      tracePath: join(root, '.odysseus', 'trace.jsonl'),
      verifyLayers: ['progress', 'syntax', 'tests'],
      autoApprove: true,
    });

    const result = await orch.runWaypoint({ goal: task.goal });
    const artifactOk =
      result.outcome === 'success' ? await task.verify(root) : false;
    const row: TaskRow = {
      id: task.id,
      outcome: result.outcome,
      artifactOk,
      success: result.outcome === 'success' && artifactOk,
      tokens: tokens - tokensBefore,
      latencyMs: Date.now() - startedAt,
    };
    rows.push(row);
    console.log(
      `  outcome=${result.outcome} artifact=${artifactOk ? 'ok' : 'MISMATCH'} ` +
        `iters=${result.iterationsUsed} tokens=${row.tokens} ` +
        `latency=${(row.latencyMs / 1000).toFixed(1)}s\n`
    );
    await fs.rm(root, { recursive: true, force: true });
  }

  const succeeded = rows.filter((r) => r.success).length;
  const total = rows.length;
  const totalLatency = rows.reduce((acc, r) => acc + r.latencyMs, 0);
  console.log('──────────────────────────────────────────');
  console.log(`successRate: ${succeeded}/${total} = ${total > 0 ? (succeeded / total).toFixed(2) : 'n/a'}`);
  console.log(`errorRate:   ${(total > 0 ? (total - succeeded) / total : 0).toFixed(2)}`);
  console.log(`tokens:      ${tokens} across ${calls} LLM calls`);
  console.log(`avgLatency:  ${total > 0 ? (totalLatency / total / 1000).toFixed(1) : 'n/a'}s per task`);
  for (const r of rows) {
    console.log(`  [${r.success ? 'PASS' : 'FAIL'}] ${r.id} — ${r.outcome}, artifact=${r.artifactOk ? 'ok' : 'mismatch'}, ${(r.latencyMs / 1000).toFixed(1)}s`);
  }
}

void main().catch((e: unknown) => {
  console.error('task-baseline failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
