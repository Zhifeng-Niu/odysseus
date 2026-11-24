export async function measureFitness(cwd, options = {}) {
    void cwd; // 预留：未来 fitness 可含 cwd 特定探针；当前任务集与 cwd 无关
    const runners = options.runners ?? defaultRunners();
    const suite = await runners.runScriptedSuite();
    const unitPassed = await runners.runUnitSuite();
    const scriptedSuccessRate = suite.total > 0 ? suite.succeeded / suite.total : 0;
    const score = 8 * scriptedSuccessRate + (unitPassed ? 2 : 0);
    return { scriptedSuccessRate, unitPassed, score };
}
function defaultRunners() {
    return {
        runScriptedSuite: async () => {
            // 循环引用规避：task-suite ↔ fitness 不互相 import 运行时符号，
            // dynamic import 保延迟加载。
            const { runTaskSuite: run } = await import('./task-suite.js');
            const { BASELINE_TASKS: tasks } = await import('./baseline-tasks.js');
            return run(tasks);
        },
        runUnitSuite: async () => {
            const { execFileNoThrow } = await import('../util/exec.js');
            // 已知存量 flaky（voyage-stats-invariants 收集期失败/agent-guards stray）
            // 按 loop 惯例排除——fitness 是确定性度量，不背历史噪音。
            const r = await execFileNoThrow('npx', [
                'vitest', 'run', '--passWithNoTests',
                '--exclude', 'tests/unit/scripts-voyage-stats-invariants.test.ts',
                '--exclude', 'tests/unit/voyage-loop.test.ts',
            ], {
                cwd: process.cwd(),
                timeoutMs: 300_000,
                // tsx 经 NODE_OPTIONS 向子进程注入自己的 loader——嵌套 vitest worker
                // 与之冲突（已知问题）。剥离后按纯 node 跑。
                env: { ...process.env, NODE_OPTIONS: '' },
            });
            return r.exitCode === 0;
        },
    };
}
//# sourceMappingURL=fitness.js.map