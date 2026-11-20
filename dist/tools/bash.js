import { execFileNoThrow } from '../util/exec.js';
import { truncateForLLM } from '../util/truncate.js';
const DEFAULT_TIMEOUT_MS = 30_000;
/**
 * Iteration 29 — output cap on bash stdout.
 *
 * Unbounded stdout was the second-biggest per-iteration history growth
 * source (after file-read). A single `git log` or `find` could dump
 * tens of thousands of chars into history permanently. Cap at 20k
 * chars (~5k tokens); the truncation notice tells the LLM the original
 * size so it can narrow the query (e.g. `git log -n 20` instead of
 * full history).
 */
const DEFAULT_STDOUT_CAP = 20_000;
export class BashTool {
    name = 'bash';
    description = 'Run a shell command via `bash -c`. Returns combined stdout (capped at 20k chars; ' +
        'if exceeded, a notice explains what was elided). Use for arbitrary one-off shell tasks ' +
        '(build, test, scripts). Prefer the dedicated file/git tools when they fit. ' +
        'Long-running commands are bounded by a timeout (default 30s).';
    parameters = {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: 'The bash command string to execute.',
            },
            timeoutMs: {
                type: 'number',
                description: 'Optional max runtime in milliseconds (default 30000).',
            },
        },
        required: ['command'],
    };
    async execute(args, ctx) {
        const command = String(args.command ?? '');
        if (!command.trim()) {
            return { ok: false, error: 'command required' };
        }
        const timeoutMs = typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
            ? Math.max(0, Math.floor(args.timeoutMs))
            : DEFAULT_TIMEOUT_MS;
        const result = await execFileNoThrow('bash', ['-c', command], {
            cwd: ctx.cwd,
            timeoutMs,
            ...(ctx.env !== undefined ? { env: ctx.env } : {}),
            ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
        });
        if (result.exitCode !== 0) {
            const stderr = result.stderr.trim();
            const cappedStderr = truncateForLLM(stderr, {
                maxChars: DEFAULT_STDOUT_CAP,
                label: `stderr of: ${command}`,
            });
            return {
                ok: false,
                error: `exit ${result.exitCode}: ${cappedStderr.content}`,
            };
        }
        const capped = truncateForLLM(result.stdout, {
            maxChars: DEFAULT_STDOUT_CAP,
            label: `stdout of: ${command}`,
        });
        return { ok: true, value: capped.content };
    }
}
//# sourceMappingURL=bash.js.map