/**
 * M3 扩样后的 live 基线任务定义（10 个混合难度任务）。
 *
 * Scripted steps live here so src/scripts/task-baseline.ts stays a thin
 * runner. Every task pairs a goal with mechanical artifact verification —
 * success requires the orchestrator outcome AND the artifact check.
 * inc-function is deliberately kept: it is the known-hard task from the
 * first live baseline (fake-completion caught by artifact verification).
 */
import { join } from 'node:path';
import * as fs from 'node:fs/promises';
function writeStep(filePath, content) {
    return {
        content: '',
        model: 'scripted',
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'tool_calls',
        toolCalls: [{
                id: `call-w-${Math.random().toString(16).slice(2, 8)}`,
                type: 'function',
                function: { name: 'file-write', arguments: JSON.stringify({ path: filePath, content }) },
            }],
    };
}
function editStep(filePath, oldString, newString) {
    return {
        content: '',
        model: 'scripted',
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'tool_calls',
        toolCalls: [{
                id: `call-e-${Math.random().toString(16).slice(2, 8)}`,
                type: 'function',
                function: {
                    name: 'file-edit',
                    arguments: JSON.stringify({ path: filePath, oldString, newString }),
                },
            }],
    };
}
function readStep(filePath) {
    return {
        content: '',
        model: 'scripted',
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'tool_calls',
        toolCalls: [{
                id: `call-r-${Math.random().toString(16).slice(2, 8)}`,
                type: 'function',
                function: { name: 'file-read', arguments: JSON.stringify({ path: filePath }) },
            }],
    };
}
function doneStep() {
    return {
        content: 'DONE',
        model: 'scripted',
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'stop',
    };
}
export const BASELINE_TASKS = [
    {
        id: 'hello-export',
        goal: '创建文件 hello.ts，内容恰好为一行：export const greeting = "hello odysseus";',
        steps: (root) => [
            writeStep(join(root, 'hello.ts'), 'export const greeting = "hello odysseus";\n'),
            doneStep(),
        ],
        verify: async (root) => (await fs.readFile(join(root, 'hello.ts'), 'utf8')).includes('hello odysseus'),
    },
    {
        id: 'two-modules',
        goal: '创建两个文件：a.ts 内容为 export const a = 1; ，b.ts 内容为 export const b = 2;',
        steps: (root) => [
            writeStep(join(root, 'a.ts'), 'export const a = 1;\n'),
            writeStep(join(root, 'b.ts'), 'export const b = 2;\n'),
            doneStep(),
        ],
        verify: async (root) => {
            const a = await fs.readFile(join(root, 'a.ts'), 'utf8');
            const b = await fs.readFile(join(root, 'b.ts'), 'utf8');
            return a.includes('const a = 1') && b.includes('const b = 2');
        },
    },
    {
        id: 'inc-function',
        goal: '创建 counter.ts，实现并导出函数 inc(n: number): number，返回 n + 1。',
        steps: (root) => [
            writeStep(join(root, 'counter.ts'), 'export function inc(n: number): number {\n  return n + 1;\n}\n'),
            doneStep(),
        ],
        verify: async (root) => {
            const c = await fs.readFile(join(root, 'counter.ts'), 'utf8');
            return c.includes('export function inc') && c.includes('n + 1');
        },
    },
    {
        id: 'notes-md',
        goal: '创建文件 notes.md，内容包含一行「Odysseus live baseline note」。',
        steps: (root) => [
            writeStep(join(root, 'notes.md'), '# notes\n\nOdysseus live baseline note\n'),
            doneStep(),
        ],
        verify: async (root) => (await fs.readFile(join(root, 'notes.md'), 'utf8')).includes('Odysseus live baseline note'),
    },
    {
        id: 'config-json',
        goal: '创建 config.json，内容为 JSON 对象，theme 字段为 "dark"，lang 字段为 "zh"。',
        steps: (root) => [
            writeStep(join(root, 'config.json'), '{\n  "theme": "dark",\n  "lang": "zh"\n}\n'),
            doneStep(),
        ],
        verify: async (root) => {
            const parsed = JSON.parse(await fs.readFile(join(root, 'config.json'), 'utf8'));
            return parsed.theme === 'dark' && parsed.lang === 'zh';
        },
    },
    {
        id: 'draft-edit',
        goal: '先创建 draft.txt，内容为一行 version-v1；然后用文件编辑把 v1 改成 v2。',
        steps: (root) => [
            writeStep(join(root, 'draft.txt'), 'version-v1\n'),
            editStep(join(root, 'draft.txt'), 'version-v1', 'version-v2'),
            doneStep(),
        ],
        verify: async (root) => {
            const c = await fs.readFile(join(root, 'draft.txt'), 'utf8');
            return c.includes('version-v2') && !c.includes('version-v1');
        },
    },
    {
        id: 'via-shell',
        goal: '用 bash 命令创建 via-shell.txt，内容为一行 shell-ok（不要用文件写入工具）。',
        steps: () => [
            {
                content: '',
                model: 'scripted',
                usage: { inputTokens: 10, outputTokens: 5 },
                finishReason: 'tool_calls',
                toolCalls: [{
                        id: 'call-bash-1',
                        type: 'function',
                        function: {
                            name: 'bash',
                            arguments: JSON.stringify({ command: 'echo shell-ok > via-shell.txt' }),
                        },
                    }],
            },
            doneStep(),
        ],
        verify: async (root) => (await fs.readFile(join(root, 'via-shell.txt'), 'utf8')).includes('shell-ok'),
    },
    {
        id: 'pair-import',
        goal: '创建 three.ts（export const three = 3;）和 four.ts（从 three 导入并导出 const four = three + 1）。',
        steps: (root) => [
            writeStep(join(root, 'three.ts'), 'export const three = 3;\n'),
            writeStep(join(root, 'four.ts'), "import { three } from './three.js';\n\nexport const four = three + 1;\n"),
            doneStep(),
        ],
        verify: async (root) => {
            const t = await fs.readFile(join(root, 'three.ts'), 'utf8');
            const f = await fs.readFile(join(root, 'four.ts'), 'utf8');
            return t.includes('const three = 3') && f.includes('three') && f.includes('four');
        },
    },
    {
        id: 'typo-fix',
        goal: '创建 typo.ts，内容为一行 export const mesage = "oops"; ，然后把 typo.ts 里的 mesage 修正为 message。',
        steps: (root) => [
            writeStep(join(root, 'typo.ts'), 'export const mesage = "oops";\n'),
            editStep(join(root, 'typo.ts'), 'mesage', 'message'),
            doneStep(),
        ],
        verify: async (root) => {
            const t = await fs.readFile(join(root, 'typo.ts'), 'utf8');
            return t.includes('const message') && !t.includes('mesage');
        },
    },
    {
        id: 'readme-append',
        // fixture README 首行是 '# task fixture'（task-suite 的 makeRepo 契约）——
        // goal/steps/verify 必须与该契约一致（此前假设 live runner 的 README
        // 内容，scripted 跑 edit 时 oldString not found → 假完成）。
        goal: 'README.md 已存在（首行是 # task fixture）。先读它，然后在末尾追加一行 baseline-run-note。',
        steps: (root) => [
            readStep(join(root, 'README.md')),
            editStep(join(root, 'README.md'), '# task fixture', '# task fixture\nbaseline-run-note'),
            doneStep(),
        ],
        verify: async (root) => {
            const r = await fs.readFile(join(root, 'README.md'), 'utf8');
            return r.includes('# task fixture') && r.includes('baseline-run-note');
        },
    },
    // ── M4 生活域任务（artifact 验收层，progress+artifact 双层验证）──
    lifeTask('life-weekly-report', '写本周周报 weekly-report.md，必须包含一行「本周完成：基线扩样 9/10」。', 'weekly-report.md', '本周完成：基线扩样 9/10'),
    lifeTask('life-expense-csv', '创建记账文件 expenses.csv，首行为表头「日期,金额,说明」，并补一行今日示例支出。', 'expenses.csv', '日期,金额,说明'),
    lifeTask('life-reminders', '创建提醒清单 reminders.md，包含三行：「提醒一：明早跑步」「提醒二：妈妈复查」「提醒三：还信用卡」。', 'reminders.md', '提醒一：明早跑步'),
    lifeTask('life-meeting-notes', '写会议纪要 meeting-notes.md，包含「会议纪要」标题和「行动项：跟进发布时间」一行。', 'meeting-notes.md', '行动项：跟进发布时间'),
    lifeTask('life-reading-notes', '写读书笔记 reading-notes.md，包含书名《奥德赛》和一句「摘要：归乡与身份的漫长试炼」。', 'reading-notes.md', '摘要：归乡与身份的漫长试炼'),
];
/**
 * 生活域任务工厂：goal + artifact 验收声明（path/contains），双层验证
 * progress+artifact（无 tsc——非代码产物），harness 级 verify 仍做
 * artifact 同判（outcome ∧ artifact 双验的 eval 契约不变）。
 */
function lifeTask(id, goal, file, marker) {
    return {
        id,
        goal,
        steps: (root) => [
            writeStep(join(root, file), `${marker}\n`),
            doneStep(),
        ],
        verify: async (root) => (await fs.readFile(join(root, file), 'utf8')).includes(marker),
        acceptance: { checks: [{ path: file, contains: marker }] },
        verifyLayers: ['progress', 'artifact'],
    };
}
//# sourceMappingURL=baseline-tasks.js.map