#!/usr/bin/env node
/**
 * WP2 evidence harness — the learning element's LIVE closed loop:
 *
 *   Phase A: run a guaranteed-to-fail waypoint (task demands a file that
 *            cannot pass the syntax layer) with attachLessonRecorder wired.
 *            Terminal failure → structured lesson written to memory.
 *   Phase B: prove the injection side mechanically —
 *            loadLongTermMemoryMarkdown(root) must now contain the lesson.
 *
 * Run: npx tsx src/scripts/lesson-loop-demo.ts
 *
 * Every rerun must show: new lesson (different fingerprint) OR dedup hit on
 * an identical failure — both are correct loop behavior; floods are not.
 */
import { join, resolve } from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { execFileNoThrow } from '../util/exec.js';
import { GLMProvider } from '../llm/glm.js';
import { loadConfig } from '../config.js';
import { loadDotenv } from '../util/dotenv.js';
import { CerebellumOrchestrator } from '../cerebellum/orchestrator.js';
import { attachLessonRecorder } from '../cerebellum/lesson-recorder.js';
import { loadLongTermMemoryMarkdown } from '../cerebellum/strategy-prompt.js';
import { readMemory } from '../cerebellum/memory.js';
import { ToolRegistry } from '../tools/registry.js';
import { FileReadTool, FileWriteTool, FileEditTool } from '../tools/file.js';
import { GitTool } from '../tools/git.js';
import { BashTool } from '../tools/bash.js';

async function makeRepo(): Promise<string> {
  const dir = await fs.mkdtemp(join(os.tmpdir(), 'lesson-loop-'));
  const git = async (args: readonly string[]): Promise<void> => {
    const r = await execFileNoThrow('git', args, { cwd: dir });
    if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  };
  await git(['init']);
  await git(['config', 'user.email', 'lesson-loop@odysseus.local']);
  await git(['config', 'user.name', 'odysseus-lesson-loop']);
  await fs.writeFile(join(dir, 'README.md'), '# lesson loop demo\n', 'utf8');
  await git(['add', '-A']);
  await git(['commit', '-m', 'init']);
  return dir;
}

async function main(): Promise<void> {
  loadDotenv(join(process.cwd(), '.env'));
  const cfg = loadConfig();
  console.log(`model: ${cfg.model} @ ${cfg.baseUrl}`);

  const memoryRoot = resolve(process.cwd(), '.odysseus');
  const lessonsBefore = (await readMemory(memoryRoot, 'lessons')).length;
  console.log(`lessons.md before: ${lessonsBefore} entries\n`);

  const root = await makeRepo();
  const registry = new ToolRegistry();
  registry.register(new FileReadTool());
  registry.register(new FileWriteTool());
  registry.register(new FileEditTool());
  registry.register(new GitTool());
  registry.register(new BashTool());

  const glm = new GLMProvider({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl });
  const orch = new CerebellumOrchestrator({
    cwd: root,
    provider: glm,
    registry,
    tracePath: join(root, '.odysseus', 'trace.jsonl'),
    verifyLayers: ['progress', 'syntax', 'tests'],
    autoApprove: true,
  });
  const recorder = attachLessonRecorder(orch, memoryRoot);

  // Phase A — a waypoint that can NEVER pass the syntax layer on purpose:
  // the task explicitly forbids fixing the type error, so the loop must end
  // in a terminal failure and the recorder must write a lesson.
  console.log('▶ Phase A: deliberately unfixable waypoint (task demands broken code)...');
  const result = await orch.runWaypoint({
    goal:
      '创建 broken.ts，内容恰好为一行：export const v: number = "这是故意的类型错误"; ' +
      '这个类型错误是本次任务的验收要求，不要修复它，也不要做任何其他修改。完成后回复 DONE。',
  });
  recorder.detach();
  console.log(
    `  outcome=${result.outcome} iters=${result.iterationsUsed} ` +
      `failReason=${(result.failReason ?? '(none)').slice(0, 120)}\n`
  );
  await fs.rm(root, { recursive: true, force: true });
  await recorder.pending();

  const lessonsAfter = await readMemory(memoryRoot, 'lessons');
  console.log(`lessons.md after: ${lessonsAfter.length} entries (delta +${lessonsAfter.length - lessonsBefore})`);
  const fresh = lessonsAfter.slice(lessonsBefore);
  for (const lesson of fresh) {
    console.log(`\n── new lesson [${lesson.id}] source=${lesson.source} tags=${(lesson.tags ?? []).join(',')}`);
    console.log(`   title: ${lesson.title}`);
    console.log(`   body:  ${lesson.body.replace(/\n/g, ' | ').slice(0, 400)}`);
  }

  // Phase B — mechanical proof of the injection side: the very next waypoint
  // prompt (any task, any model) will carry these lessons via
  // loadLongTermMemoryMarkdown, which reads the same file.
  console.log('\n▶ Phase B: injection-side check (loadLongTermMemoryMarkdown content)...');
  const injected = loadLongTermMemoryMarkdown(process.cwd());
  const lessonsSection = injected.split('## lessons')[1] ?? '';
  const hasFresh = fresh.every((lesson) => lessonsSection.includes(lesson.title));
  console.log(
    `  lessons section present: ${injected.includes('## lessons')}, fresh lessons carried: ${hasFresh}`
  );
  if (fresh.length > 0) {
    console.log(`  excerpt: ${lessonsSection.slice(0, 300).replace(/\n/g, ' | ')}`);
  }

  console.log('\nverdict: ' + (fresh.length > 0 && hasFresh ? 'LOOP CLOSED (failure → lesson → injection-ready)' : 'LOOP NOT CLOSED — inspect above'));
}

void main().catch((e: unknown) => {
  console.error('lesson-loop-demo failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
