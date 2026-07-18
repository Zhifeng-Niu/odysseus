import { execFileNoThrow } from '../util/exec.js';
import type { Tool, ToolContext, ToolResult } from './types.js';

type GitOperation = 'commit' | 'log' | 'reset' | 'status' | 'rev-parse' | 'diff';

export class GitTool implements Tool {
  readonly name = 'git';
  readonly description =
    'Git wrapper. Operations: commit, log, reset, status, rev-parse, diff. Uses execFile (no shell).';
  readonly parameters = {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['commit', 'log', 'reset', 'status', 'rev-parse', 'diff'],
      },
      message: { type: 'string', description: 'commit message (operation=commit)' },
      addAll: { type: 'boolean', description: 'git add -A before commit (operation=commit)' },
      target: { type: 'string', description: 'SHA or ref (operation=reset/diff)' },
      hard: { type: 'boolean', description: '--hard flag (operation=reset)' },
      limit: { type: 'number', description: 'commit count (operation=log)' },
      rev: { type: 'string', description: 'revision (operation=rev-parse, default HEAD)' },
    },
    required: ['operation'],
  };

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const op = String(args.operation ?? '') as GitOperation;
    try {
      switch (op) {
        case 'commit':
          return await this.commit(args, ctx);
        case 'log':
          return await this.log(args, ctx);
        case 'reset':
          return await this.reset(args, ctx);
        case 'status':
          return await this.status(ctx);
        case 'rev-parse':
          return await this.revParse(args, ctx);
        case 'diff':
          return await this.diff(args, ctx);
        default:
          return { ok: false, error: `Unknown git operation: ${op}` };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async commit(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const message = String(args.message ?? '');
    if (!message) return { ok: false, error: 'commit message required' };

    if (args.addAll) {
      const addResult = await execFileNoThrow('git', ['add', '-A'], { cwd: ctx.cwd });
      if (addResult.exitCode !== 0) {
        return { ok: false, error: `git add failed: ${addResult.stderr}` };
      }
    }

    const diffResult = await execFileNoThrow('git', ['diff', '--cached', '--quiet'], {
      cwd: ctx.cwd,
    });
    if (diffResult.exitCode === 0) {
      return { ok: false, error: 'nothing staged to commit' };
    }

    const commitResult = await execFileNoThrow('git', ['commit', '-m', message], {
      cwd: ctx.cwd,
    });
    if (commitResult.exitCode !== 0) {
      return { ok: false, error: `git commit failed: ${commitResult.stderr}` };
    }

    const shaResult = await execFileNoThrow('git', ['rev-parse', 'HEAD'], { cwd: ctx.cwd });
    if (shaResult.exitCode !== 0) {
      return { ok: false, error: `git rev-parse failed: ${shaResult.stderr}` };
    }

    return { ok: true, value: shaResult.stdout.trim() };
  }

  private async log(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const limit = Number(args.limit ?? 10);
    const result = await execFileNoThrow(
      'git',
      ['log', '--pretty=format:%h %s', '-n', String(Math.max(1, Math.floor(limit)))],
      { cwd: ctx.cwd }
    );
    if (result.exitCode !== 0) {
      return { ok: false, error: `git log failed: ${result.stderr}` };
    }
    return { ok: true, value: result.stdout };
  }

  private async reset(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const target = String(args.target ?? 'HEAD');
    const cmd = args.hard ? ['reset', '--hard', target] : ['reset', target];
    const result = await execFileNoThrow('git', cmd, { cwd: ctx.cwd });
    if (result.exitCode !== 0) {
      return { ok: false, error: `git reset failed: ${result.stderr}` };
    }
    return { ok: true, value: `reset to ${target}` };
  }

  private async status(ctx: ToolContext): Promise<ToolResult> {
    const result = await execFileNoThrow('git', ['status', '--porcelain'], { cwd: ctx.cwd });
    if (result.exitCode !== 0) {
      return { ok: false, error: `git status failed: ${result.stderr}` };
    }
    if (result.stdout.trim() === '') {
      return { ok: true, value: 'nothing to commit, working tree clean' };
    }
    return { ok: true, value: result.stdout };
  }

  private async revParse(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const rev = String(args.rev ?? 'HEAD');
    const result = await execFileNoThrow('git', ['rev-parse', rev], { cwd: ctx.cwd });
    if (result.exitCode !== 0) {
      return { ok: false, error: `git rev-parse failed: ${result.stderr}` };
    }
    return { ok: true, value: result.stdout.trim() };
  }

  private async diff(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const target = args.target ? String(args.target) : 'HEAD';
    const result = await execFileNoThrow('git', ['diff', '--stat', target], { cwd: ctx.cwd });
    if (result.exitCode !== 0) {
      return { ok: false, error: `git diff failed: ${result.stderr}` };
    }
    return { ok: true, value: result.stdout };
  }
}
