/**
 * P0 eval layer — batched task-completion suite over the REAL orchestrator.
 *
 * Each case drives a fresh CerebellumOrchestrator in a throwaway git repo
 * with a scripted provider (same deterministic fixture pattern as the
 * e2e-task-completion tests, lifted from test fixtures into src so live
 * scripts can run the same suite). Aggregates success/error rate, token
 * cost, and latency — the task-specific metrics from IBM's
 * ai-agent-evaluation page.
 *
 * "success" requires BOTH the orchestrator outcome and the case's own
 * artifact verification: a waypoint that ends 'success' but did not
 * produce the claimed artifact is not task completion.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileNoThrow } from '../util/exec.js';
import { CerebellumOrchestrator } from '../cerebellum/orchestrator.js';
import { ToolRegistry } from '../tools/registry.js';
import { FileReadTool, FileWriteTool, FileEditTool } from '../tools/file.js';
import { GitTool } from '../tools/git.js';
import { BashTool } from '../tools/bash.js';
export async function runTaskSuite(cases) {
    const results = [];
    for (const taskCase of cases) {
        results.push(await runSingleCase(taskCase));
    }
    const total = results.length;
    const succeeded = results.filter((r) => r.success).length;
    const failed = total - succeeded;
    const totalTokens = results.reduce((acc, r) => acc + r.tokens, 0);
    const totalLatency = results.reduce((acc, r) => acc + r.latencyMs, 0);
    return {
        results,
        total,
        succeeded,
        failed,
        successRate: total > 0 ? succeeded / total : 0,
        errorRate: total > 0 ? failed / total : 0,
        totalTokens,
        avgLatencyMs: total > 0 ? totalLatency / total : 0,
    };
}
async function runSingleCase(taskCase) {
    const root = await makeGitRepo();
    const startedAt = Date.now();
    const steps = taskCase.steps(root);
    if (steps.length === 0) {
        await fs.rm(root, { recursive: true, force: true });
        throw new Error(`task case ${taskCase.id} has no scripted steps`);
    }
    let step = 0;
    let tokens = 0;
    const provider = {
        async complete() {
            const current = steps[Math.min(step, steps.length - 1)];
            if (!current)
                throw new Error('scripted provider ran out of steps');
            step += 1;
            tokens += current.usage.inputTokens + current.usage.outputTokens;
            return current;
        },
        async *stream() {
            yield '';
        },
        getModel() {
            return 'scripted';
        },
    };
    const registry = new ToolRegistry();
    registry.register(new FileWriteTool());
    registry.register(new FileReadTool());
    // M4: scripted 多步任务（write+edit 等）需要与生产面一致的编辑能力——
    // 缺 file-edit 时 edit 步骤报 Unknown tool，假 DONE 直接通过（0.73 假低分
    // 的根因）。Git/Bash 仅供透传（scripted 套件不触发）。
    registry.register(new FileEditTool());
    // 生产面对齐：scripted 任务的 bash/git 步骤同样需要这两个工具在册。
    registry.register(new GitTool());
    registry.register(new BashTool());
    const tracePath = path.join(root, '.odysseus', 'trace.jsonl');
    await fs.mkdir(path.dirname(tracePath), { recursive: true });
    // M4: declared acceptance lands BEFORE the waypoint runs — the artifact
    // verify layer reads it at gate time (declared, not self-graded).
    if (taskCase.acceptance) {
        await fs.mkdir(path.join(root, '.odysseus'), { recursive: true });
        await fs.writeFile(path.join(root, '.odysseus', 'acceptance.json'), JSON.stringify(taskCase.acceptance, null, 2) + '\n', 'utf8');
    }
    const orch = new CerebellumOrchestrator({
        cwd: root,
        provider,
        registry,
        tracePath,
        verifyLayers: taskCase.verifyLayers ?? ['syntax'],
        autoApprove: true,
    });
    const toolErrors = [];
    orch.on('event', (event) => {
        if (event.type === 'tool-call-completed' && !event.ok) {
            toolErrors.push(`${event.result ?? event.callId}`);
        }
    });
    let outcome = 'abandoned';
    let iterationsUsed = 0;
    const result = await orch.runWaypoint({ goal: taskCase.goal });
    outcome = result.outcome;
    iterationsUsed = result.iterationsUsed;
    // A throwing verifier counts as artifact-mismatch, never a suite crash —
    // found by the first live baseline (real models don't always create the
    // expected filename; ENOENT is a verdict, not an error).
    const artifactOk = outcome === 'success'
        ? await Promise.resolve()
            .then(() => taskCase.verify(root))
            .then((ok) => Boolean(ok))
            .catch(() => false)
        : false;
    const latencyMs = Date.now() - startedAt;
    await fs.rm(root, { recursive: true, force: true });
    return {
        id: taskCase.id,
        outcome,
        artifactOk,
        success: outcome === 'success' && artifactOk,
        tokens,
        latencyMs,
        iterationsUsed,
        toolErrors,
    };
}
/** Throwaway git repo per case — mirrors the e2e fixture, via execFileNoThrow. */
async function makeGitRepo() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eval-task-'));
    const git = async (args) => {
        const r = await execFileNoThrow('git', args, { cwd: dir });
        if (r.exitCode !== 0) {
            throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
        }
    };
    await git(['init']);
    await git(['config', 'user.email', 'test@odysseus.local']);
    await git(['config', 'user.name', 'odysseus-test']);
    await fs.writeFile(path.join(dir, 'README.md'), '# task fixture\n', 'utf8');
    await git(['add', '-A']);
    await git(['commit', '-m', 'init']);
    return dir;
}
//# sourceMappingURL=task-suite.js.map