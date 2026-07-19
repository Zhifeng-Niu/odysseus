import { execFileNoThrow } from '../util/exec.js';
import type { Tool, ToolContext, ToolResult } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class BashTool implements Tool {
  readonly name = 'bash';
  readonly description =
    'Run a shell command via `bash -c`. Returns combined stdout. Use for arbitrary one-off ' +
    'shell tasks (build, test, scripts). Prefer the dedicated file/git tools when they fit. ' +
    'Long-running commands are bounded by a timeout (default 30s).';
  readonly parameters = {
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

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const command = String(args.command ?? '');
    if (!command.trim()) {
      return { ok: false, error: 'command required' };
    }

    const timeoutMs =
      typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
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
      return {
        ok: false,
        error: `exit ${result.exitCode}${stderr ? `: ${stderr}` : ''}`,
      };
    }

    return { ok: true, value: result.stdout };
  }
}
