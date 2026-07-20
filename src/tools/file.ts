import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Tool, ToolContext, ToolResult } from './types.js';

export class FileReadTool implements Tool {
  readonly name = 'file-read';
  readonly description = 'Read the contents of a file at the given path (UTF-8).';
  readonly parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or cwd-relative path to read' },
    },
    required: ['path'],
  };

  mutates(): boolean {
    return false;
  }

  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const path = String(args.path ?? '');
    if (!path) return { ok: false, error: 'path required' };
    try {
      const content = await readFile(path, 'utf8');
      return { ok: true, value: content };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
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
