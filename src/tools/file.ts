import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './types.js';
import { truncateForLLM } from '../util/truncate.js';

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

export class FileReadTool implements Tool {
  readonly name = 'file-read';
  readonly description =
    'Read the contents of a file at the given path (UTF-8). Returns up to `limit` lines ' +
    'starting from `offset` (0-indexed). Default limit 1000 lines, 20k chars — if the file ' +
    'exceeds either, a truncation notice explains how to paginate with offset/limit.';
  readonly parameters = {
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

  mutates(): boolean {
    return false;
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const path = String(args.path ?? '');
    if (!path) return { ok: false, error: 'path required' };
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
      return { ok: true, value: truncated.content };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

export class FileWriteTool implements Tool {
  readonly name = 'file-write';
  readonly description = 'Write content to a file, creating parent directories if needed.';
  readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to write' },
      content: { type: 'string', description: 'Full content to write' },
    },
    required: ['path', 'content'],
  };

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const path = String(args.path ?? '');
    const content = String(args.content ?? '');
    if (!path) return { ok: false, error: 'path required' };
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, 'utf8');
      return { ok: true, value: `wrote ${content.length} bytes to ${path}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class FileEditTool implements Tool {
  readonly name = 'file-edit';
  readonly description =
    'Replace the single occurrence of oldString with newString. Errors if zero or multiple matches.';
  readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string' },
      oldString: { type: 'string' },
      newString: { type: 'string' },
    },
    required: ['path', 'oldString', 'newString'],
  };

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const path = String(args.path ?? '');
    const oldString = String(args.oldString ?? '');
    const newString = String(args.newString ?? '');
    if (!path || !oldString) return { ok: false, error: 'path and oldString required' };

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
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
