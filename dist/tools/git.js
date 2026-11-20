import { execFileNoThrow } from '../util/exec.js';
export class GitTool {
    name = 'git';
    description = 'Git wrapper. Operations: commit, log, status, rev-parse, diff. Uses execFile (no shell). ' +
        'Note: git reset is intentionally NOT exposed — the Cerebellum orchestrator owns rollback via the session-scoped rollbackTo primitive (design spec Section 6.1, zeroth law).';
    parameters = {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['commit', 'log', 'status', 'rev-parse', 'diff'],
            },
            message: { type: 'string', description: 'commit message (operation=commit)' },
            addAll: { type: 'boolean', description: 'git add -A before commit (operation=commit)' },
            target: { type: 'string', description: 'SHA or ref (operation=diff)' },
            limit: { type: 'number', description: 'commit count (operation=log)' },
            rev: { type: 'string', description: 'revision (operation=rev-parse, default HEAD)' },
        },
        required: ['operation'],
    };
    /**
     * Only `commit` mutates the repo. log/status/rev-parse/diff are read-only
     * and safe to run without a checkpoint, which lets the orchestrator skip
     * the git tax for read-only conversational turns (e.g. "what's in the log?").
     */
    mutates(args) {
        return String(args.operation ?? '') === 'commit';
    }
    async execute(args, ctx) {
        const op = String(args.operation ?? '');
        try {
            switch (op) {
                case 'commit':
                    return await this.commit(args, ctx);
                case 'log':
                    return await this.log(args, ctx);
                case 'status':
                    return await this.status(ctx);
                case 'rev-parse':
                    return await this.revParse(args, ctx);
                case 'diff':
                    return await this.diff(args, ctx);
                default:
                    return { ok: false, error: `Unknown git operation: ${op}` };
            }
        }
        catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }
    async commit(args, ctx) {
        const message = String(args.message ?? '');
        if (!message)
            return { ok: false, error: 'commit message required' };
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
    async log(args, ctx) {
        const limit = Number(args.limit ?? 10);
        const result = await execFileNoThrow('git', ['log', '--pretty=format:%h %s', '-n', String(Math.max(1, Math.floor(limit)))], { cwd: ctx.cwd });
        if (result.exitCode !== 0) {
            return { ok: false, error: `git log failed: ${result.stderr}` };
        }
        return { ok: true, value: result.stdout };
    }
    async status(ctx) {
        const result = await execFileNoThrow('git', ['status', '--porcelain'], { cwd: ctx.cwd });
        if (result.exitCode !== 0) {
            return { ok: false, error: `git status failed: ${result.stderr}` };
        }
        if (result.stdout.trim() === '') {
            return { ok: true, value: 'nothing to commit, working tree clean' };
        }
        return { ok: true, value: result.stdout };
    }
    async revParse(args, ctx) {
        const rev = String(args.rev ?? 'HEAD');
        const result = await execFileNoThrow('git', ['rev-parse', rev], { cwd: ctx.cwd });
        if (result.exitCode !== 0) {
            return { ok: false, error: `git rev-parse failed: ${result.stderr}` };
        }
        return { ok: true, value: result.stdout.trim() };
    }
    async diff(args, ctx) {
        const target = args.target ? String(args.target) : 'HEAD';
        const result = await execFileNoThrow('git', ['diff', '--stat', target], { cwd: ctx.cwd });
        if (result.exitCode !== 0) {
            return { ok: false, error: `git diff failed: ${result.stderr}` };
        }
        return { ok: true, value: result.stdout };
    }
}
//# sourceMappingURL=git.js.map