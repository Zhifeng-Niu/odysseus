#!/usr/bin/env node
/**
 * Live task-completion baseline — the P0 eval layer against the REAL model.
 *
 *   npx tsx src/scripts/task-baseline.ts
 *   (or: npm run build && node dist/scripts/task-baseline.js)
 *
 * 10 mixed-difficulty tasks (M3 扩样, definitions in eval/baseline-tasks),
 * each driven through the REAL orchestrator (lazy checkpoint → act →
 * progress/syntax/tests verify → commit/rollback) by GLMProvider, in a
 * throwaway git repo, with the production tool surface. Terminal failures
 * feed the LIVE lesson store (attachLessonRecorder → .odysseus/memory/
 * lessons.md) so real-model mistakes compound across baseline runs; the
 * store is pruned back under its injection budget after the run
 * (pruneAutolearnToCap).
 */
import { join, resolve } from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { execFileNoThrow } from '../util/exec.js';
import { GLMProvider } from '../llm/glm.js';
import { loadConfig } from '../config.js';
import { loadDotenv } from '../util/dotenv.js';
import { CerebellumOrchestrator } from '../cerebellum/orchestrator.js';
import { attachLessonRecorder, pruneAutolearnToCap, LESSONS_CAP_CHARS } from '../cerebellum/lesson-recorder.js';
import { ToolRegistry } from '../tools/registry.js';
import { FileReadTool, FileWriteTool, FileEditTool } from '../tools/file.js';
import { GitTool } from '../tools/git.js';
import { BashTool } from '../tools/bash.js';
import { BASELINE_TASKS } from '../eval/baseline-tasks.js';
async function makeRepo() {
    const dir = await fs.mkdtemp(join(os.tmpdir(), 'task-baseline-'));
    const git = async (args) => {
        const r = await execFileNoThrow('git', args, { cwd: dir });
        if (r.exitCode !== 0) {
            throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
        }
    };
    await git(['init']);
    await git(['config', 'user.email', 'baseline@odysseus.local']);
    await git(['config', 'user.name', 'odysseus-baseline']);
    await fs.writeFile(join(dir, 'README.md'), '# live baseline task\n', 'utf8');
    await git(['add', '-A']);
    await git(['commit', '-m', 'init']);
    return dir;
}
async function main() {
    loadDotenv(join(process.cwd(), '.env'));
    const cfg = loadConfig();
    const liveMemoryRoot = resolve(process.cwd(), '.odysseus');
    console.log(`model: ${cfg.model} @ ${cfg.baseUrl}`);
    console.log(`tasks: ${BASELINE_TASKS.length} (verifyLayers: progress/syntax/tests; failures → live lessons @ ${liveMemoryRoot})\n`);
    const glm = new GLMProvider({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl });
    let tokens = 0;
    let calls = 0;
    const counting = {
        async complete(prompt, options) {
            const completion = await glm.complete(prompt, options);
            calls += 1;
            tokens += completion.usage.inputTokens + completion.usage.outputTokens;
            return completion;
        },
        stream: glm.stream.bind(glm),
        getModel: () => glm.getModel(),
    };
    const rows = [];
    for (const task of BASELINE_TASKS) {
        process.stdout.write(`▶ ${task.id}: ${task.goal.slice(0, 80)}\n`);
        const root = await makeRepo();
        const startedAt = Date.now();
        const tokensBefore = tokens;
        const registry = new ToolRegistry();
        registry.register(new FileReadTool());
        registry.register(new FileWriteTool());
        registry.register(new FileEditTool());
        registry.register(new GitTool());
        registry.register(new BashTool());
        if (task.acceptance) {
            await fs.mkdir(join(root, '.odysseus'), { recursive: true });
            await fs.writeFile(join(root, '.odysseus', 'acceptance.json'), JSON.stringify(task.acceptance, null, 2) + '\n', 'utf8');
        }
        const orch = new CerebellumOrchestrator({
            cwd: root,
            provider: counting,
            registry,
            tracePath: join(root, '.odysseus', 'trace.jsonl'),
            verifyLayers: task.verifyLayers ?? ['progress', 'syntax', 'tests'],
            autoApprove: true,
        });
        // Failures compound into the LIVE lesson store (not the throwaway repo).
        const recorder = attachLessonRecorder(orch, liveMemoryRoot);
        const result = await orch.runWaypoint({ goal: task.goal });
        recorder.detach();
        // Throwing verifier = artifact mismatch (live models may skip the
        // expected filename); a baseline harness must never crash on a verdict.
        const artifactOk = result.outcome === 'success'
            ? await Promise.resolve()
                .then(() => task.verify(root))
                .then((ok) => Boolean(ok))
                .catch(() => false)
            : false;
        const row = {
            id: task.id,
            outcome: result.outcome,
            artifactOk,
            success: result.outcome === 'success' && artifactOk,
            tokens: tokens - tokensBefore,
            latencyMs: Date.now() - startedAt,
        };
        rows.push(row);
        console.log(`  outcome=${result.outcome} artifact=${artifactOk ? 'ok' : 'MISMATCH'} ` +
            `iters=${result.iterationsUsed} tokens=${row.tokens} ` +
            `latency=${(row.latencyMs / 1000).toFixed(1)}s\n`);
        await fs.rm(root, { recursive: true, force: true });
    }
    const succeeded = rows.filter((r) => r.success).length;
    const total = rows.length;
    const totalLatency = rows.reduce((acc, r) => acc + r.latencyMs, 0);
    const pruned = await pruneAutolearnToCap(liveMemoryRoot, LESSONS_CAP_CHARS);
    console.log('──────────────────────────────────────────');
    console.log(`successRate: ${succeeded}/${total} = ${total > 0 ? (succeeded / total).toFixed(2) : 'n/a'}`);
    console.log(`errorRate:   ${(total > 0 ? (total - succeeded) / total : 0).toFixed(2)}`);
    console.log(`tokens:      ${tokens} across ${calls} LLM calls`);
    console.log(`avgLatency:  ${total > 0 ? (totalLatency / total / 1000).toFixed(1) : 'n/a'}s per task`);
    console.log(`lessonStore: pruned ${pruned} autolearn entries to fit the ${LESSONS_CAP_CHARS}-char cap`);
    for (const r of rows) {
        console.log(`  [${r.success ? 'PASS' : 'FAIL'}] ${r.id} — ${r.outcome}, artifact=${r.artifactOk ? 'ok' : 'mismatch'}, ${(r.latencyMs / 1000).toFixed(1)}s`);
    }
}
void main().catch((e) => {
    console.error('task-baseline failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
});
//# sourceMappingURL=task-baseline.js.map