import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { truncateForLLM } from '../util/truncate.js';
import { quarantineExternalContent } from '../util/quarantine.js';
/**
 * Iteration 29 — default line/char caps on file-read.
 *
 * Prior to this change, file-read returned entire files verbatim. A
 * single read of `orchestrator.ts` (1542 lines, 62kb, ~15k tokens)
 * permanently added that to conversation history, multiplied across
 * every subsequent iteration. Token trace: 70 waypoints burned 40M
 * input tokens (avg 571k/waypoint). Bounding file-read at the source
 * caps the per-iteration growth rate.
 *
 * Defaults: 1000 lines, 20k chars (~5k tokens). Override with
 * `offset` (0-indexed line) and `limit` for pagination. The truncation
 * notice tells the LLM exactly what was elided and how to read more.
 */
const DEFAULT_LINE_LIMIT = 1000;
const DEFAULT_CHAR_CAP = 20_000;
/**
 * Declared contract: paths may be absolute or cwd-relative — where cwd is
 * the AGENT's working directory (ToolContext.cwd), never the driver
 * process's process.cwd(). Found by the first live-model baseline (the
 * model writes 'hello.ts', the file landed outside the repo, the progress
 * verify correctly failed the actually-successful waypoint). bash/git
 * already honor ctx.cwd; the file tools must too.
 */
function resolveInCtx(path, ctx) {
    return isAbsolute(path) ? path : join(ctx.cwd, path);
}
export class FileReadTool {
    name = 'file-read';
    description = 'Read the contents of a file at the given path (UTF-8). Returns up to `limit` lines ' +
        'starting from `offset` (0-indexed). Default limit 1000 lines, 20k chars — if the file ' +
        'exceeds either, a truncation notice explains how to paginate with offset/limit.';
    parameters = {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Absolute or cwd-relative path to read' },
            offset: {
                type: 'number',
                description: '0-indexed line to start reading from (default 0).',
            },
            limit: {
                type: 'number',
                description: `Max lines to return (default ${DEFAULT_LINE_LIMIT}).`,
            },
        },
        required: ['path'],
    };
    mutates() {
        return false;
    }
    async execute(args, ctx) {
        const rawPath = String(args.path ?? '');
        if (!rawPath)
            return { ok: false, error: 'path required' };
        const path = resolveInCtx(rawPath, ctx);
        const offset = parseNonNegativeInt(args.offset, 0);
        const limit = parseNonNegativeInt(args.limit, DEFAULT_LINE_LIMIT);
        try {
            const content = await readFile(path, 'utf8');
            const lines = content.split('\n');
            const totalLines = lines.length;
            const sliced = lines.slice(offset, offset + limit);
            const joined = sliced.join('\n');
            const truncated = truncateForLLM(joined, {
                maxChars: DEFAULT_CHAR_CAP,
                label: `file ${path} (lines ${offset}..${Math.min(offset + limit, totalLines)} of ${totalLines})`,
            });
            // P3 injection defense: file content is EXTERNAL data — it enters the
            // prompt inside a nonce quarantine so embedded instructions stay data.
            return {
                ok: true,
                value: quarantineExternalContent(truncated.content, {
                    origin: 'file-read',
                    provenance: `path=${path}`,
                }),
            };
        }
        catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }
}
function parseNonNegativeInt(value, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
        return fallback;
    return Math.floor(value);
}
export class FileWriteTool {
    name = 'file-write';
    description = 'Write content to a file, creating parent directories if needed.';
    parameters = {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Path to write' },
            content: { type: 'string', description: 'Full content to write' },
        },
        required: ['path', 'content'],
    };
    async execute(args, ctx) {
        const rawPath = String(args.path ?? '');
        if (!rawPath)
            return { ok: false, error: 'path required' };
        const path = resolveInCtx(rawPath, ctx);
        const content = String(args.content ?? '');
        try {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, content, 'utf8');
            return { ok: true, value: `wrote ${content.length} bytes to ${path}` };
        }
        catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }
}
export class FileEditTool {
    name = 'file-edit';
    description = 'Replace the single occurrence of oldString with newString. Errors if zero or multiple matches.';
    parameters = {
        type: 'object',
        properties: {
            path: { type: 'string' },
            oldString: { type: 'string' },
            newString: { type: 'string' },
        },
        required: ['path', 'oldString', 'newString'],
    };
    async execute(args, ctx) {
        const rawPath = String(args.path ?? '');
        if (!rawPath)
            return { ok: false, error: 'path and oldString required' };
        const path = resolveInCtx(rawPath, ctx);
        const oldString = String(args.oldString ?? '');
        const newString = String(args.newString ?? '');
        if (!path || !oldString)
            return { ok: false, error: 'path and oldString required' };
        try {
            const original = await readFile(path, 'utf8');
            const occurrences = original.split(oldString).length - 1;
            if (occurrences === 0) {
                return { ok: false, error: `oldString not found in ${path}` };
            }
            if (occurrences > 1) {
                return {
                    ok: false,
                    error: `oldString ambiguous: ${occurrences} matches in ${path}. Use file-write or include more context.`,
                };
            }
            const updated = original.replace(oldString, newString);
            await writeFile(path, updated, 'utf8');
            return { ok: true, value: `edited ${path}` };
        }
        catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }
}
//# sourceMappingURL=file.js.map