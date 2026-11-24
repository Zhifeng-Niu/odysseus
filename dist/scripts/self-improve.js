#!/usr/bin/env node
/**
 * RSI 闭环 · self-improve CLI — Odysseus 递归自我改进的入口。
 *
 *   npx tsx src/scripts/self-improve.ts --goal "为 X 增加能力 Y"
 *   npx tsx src/scripts/self-improve.ts --goal "..." --loop 3
 *
 * 一圈 = M2 状态机（measure before → 自改航点（跑在当前 checkout，
 * checkpoint/rollback 保护真仓库）→ 控制面守卫 → measure after → 留优汰劣）
 * + M3 曲线记录（rsi-curve.jsonl 追加）。
 *
 * 铁律（2026-11-21 dry 演练的教训）：循环必须在干净树上跑——revert 的
 * `git clean -fd` 会清除一切未跟踪文件；未提交的新源文件会被自己吃掉。
 * pre-flight 守卫强制执行；rsi-curve.jsonl 已入 .gitignore 免受其害。
 */
import { resolve } from 'node:path';
import { execFileNoThrow } from '../util/exec.js';
import { GLMProvider } from '../llm/glm.js';
import { loadConfig } from '../config.js';
import { loadDotenv } from '../util/dotenv.js';
import { CerebellumOrchestrator } from '../cerebellum/orchestrator.js';
import { ToolRegistry } from '../tools/registry.js';
import { FileReadTool, FileWriteTool, FileEditTool } from '../tools/file.js';
import { GitTool } from '../tools/git.js';
import { BashTool } from '../tools/bash.js';
import { ReminderTool, NoteTool } from '../tools/personal.js';
import { loadBacklogFile } from '../cerebellum/backlog.js';
import { runSelfImprovementCycle } from '../eval/self-improve-core.js';
import { measureFitness } from '../eval/fitness.js';
import { appendCurveEntry, curveSummary, readCurve } from '../eval/rsi-curve.js';
const CURVE_PATH = 'rsi-curve.jsonl';
async function gitRevHead(cwd) {
    const r = await execFileNoThrow('git', ['rev-parse', 'HEAD'], { cwd });
    return r.stdout.trim();
}
async function changedFilesSince(cwd, sha) {
    const r = await execFileNoThrow('git', ['diff', '--name-only', `${sha}..HEAD`], { cwd });
    return r.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}
async function assertCleanTree(cwd) {
    const r = await execFileNoThrow('git', ['status', '--porcelain'], { cwd });
    if (r.stdout.trim().length > 0) {
        throw new Error('工作树不干净（RSI 铁律：revert 的 clean -fd 会清除未跟踪文件）。' +
            '先 commit/stash 再跑自改循环。');
    }
}
async function main() {
    loadDotenv(resolve(process.cwd(), '.env'));
    const cfg = loadConfig();
    const args = process.argv.slice(2).filter((a) => a !== '');
    const flag = (name) => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const loopCount = Number(flag('--loop') ?? 1);
    const dry = args.includes('--dry');
    await assertCleanTree(process.cwd());
    let proposals = [];
    const goalFlag = flag('--goal');
    if (goalFlag) {
        proposals = [goalFlag];
    }
    else {
        const file = await loadBacklogFile(resolve(process.cwd(), '.odysseus'));
        proposals = file.items
            .filter((item) => item.origin === 'perception')
            .map((item) => item.goal);
    }
    const maxCycles = Math.min(loopCount, proposals.length);
    console.log(`RSI loop: ${maxCycles} cycle(s) on ${process.cwd()}`);
    if (proposals.length === 0) {
        console.log('无提案（--goal 直给，或 backlog 需有 origin=perception 条目）。');
        return;
    }
    const glm = new GLMProvider({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl });
    const registry = new ToolRegistry();
    registry.register(new FileReadTool());
    registry.register(new FileWriteTool());
    registry.register(new FileEditTool());
    registry.register(new GitTool());
    registry.register(new BashTool());
    registry.register(new ReminderTool());
    registry.register(new NoteTool());
    const curvePath = resolve(process.cwd(), CURVE_PATH);
    for (let c = 0; c < maxCycles; c++) {
        const proposal = proposals[c];
        console.log(`\n▶ cycle ${c + 1}/${maxCycles}: ${proposal.slice(0, 90)}`);
        const preSha = await gitRevHead(process.cwd());
        const deps = {
            runWaypoint: async (goal) => {
                if (dry) {
                    return { outcome: 'success', iterationsUsed: 0 };
                }
                const orch = new CerebellumOrchestrator({
                    cwd: process.cwd(),
                    provider: glm,
                    registry,
                    tracePath: resolve(process.cwd(), '.odysseus', 'trace.jsonl'),
                    verifyLayers: ['progress', 'syntax', 'tests'],
                    autoApprove: true,
                });
                return await orch.runWaypoint({ goal });
            },
            changedFilesSinceCheckpoint: async () => changedFilesSince(process.cwd(), preSha),
            revertToCheckpoint: async () => {
                await execFileNoThrow('git', ['reset', '--hard', preSha], { cwd: process.cwd() });
                await execFileNoThrow('git', ['clean', '-fd'], { cwd: process.cwd() });
            },
            measure: async () => {
                const report = await measureFitness(process.cwd());
                return report.score;
            },
        };
        const result = await runSelfImprovementCycle(proposal, deps, {
            controlPlane: true,
        });
        const kept = result.verdict === 'improved';
        const entry = {
            ts: new Date().toISOString(),
            proposal: proposal.slice(0, 200),
            verdict: result.verdict,
            fitnessBefore: result.fitnessBefore,
            ...(result.fitnessAfter !== undefined ? { fitnessAfter: result.fitnessAfter } : {}),
            ...(result.delta !== undefined ? { delta: result.delta } : {}),
            ...(kept ? { commit: await gitRevHead(process.cwd()) } : {}),
        };
        appendCurveEntry(curvePath, entry);
        console.log(`  verdict=${result.verdict} ` +
            (result.delta !== undefined ? `delta=${result.delta.toFixed(2)} ` : '') +
            (kept ? `kept @ ${entry.commit ?? ''}` : 'reverted'));
    }
    const summary = curveSummary(readCurve(curvePath));
    console.log('\n── RSI curve ──');
    console.log(`cycles=${summary.cycles} improved=${summary.improved} worse=${summary.worse} ` +
        `neutral=${summary.neutral} rejected=${summary.rejected} netDelta=${summary.netDelta.toFixed(2)}`);
}
void main().catch((e) => {
    console.error('self-improve failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
});
//# sourceMappingURL=self-improve.js.map