/**
 * Invariants for src/tools/file.ts.
 *
 * Three tool classes in one file: FileReadTool, FileWriteTool,
 * FileEditTool. Behavior tests (tools-file.test.ts) cover happy paths;
 * this file pins the structural contracts that those tests rely on
 * but don't make explicit.
 *
 * Load-bearing contracts:
 *
 *   1. FILE-READ CAPS — DEFAULT_LINE_LIMIT=1000, DEFAULT_CHAR_CAP=20_000.
 *      Iteration 29 finding: a single read of orchestrator.ts (1542
 *      lines, 62kb, ~15k tokens) permanently added that to history
 *      across every subsequent iteration. 70 waypoints burned 40M
 *      input tokens (avg 571k/waypoint).
 *
 *   2. FILE-READ IS READ-ONLY — mutates() returns false. The
 *      orchestrator skips checkpoints for file-read, which is why
 *      conversational turns pay zero git tax.
 *
 *   3. FILE-WRITE CREATES PARENT DIRS — mkdir(recursive: true). Callers
 *      can write to paths whose parent dirs don't exist yet.
 *
 *   4. FILE-EDIT IS UNAMBIGUOUS — errors if oldString appears 0 or >1
 *      times. Refuses to guess; caller must include more context.
 *
 *   5. ERROR ISOLATION — every execute() is wrapped in try/catch.
 *      Errors surface as { ok: false, error }, never thrown.
 *
 * Also pins:
 *   - Each tool's name, description, parameters schema.
 *   - Return value formats ('wrote N bytes', 'edited PATH').
 *   - parseNonNegativeInt clamps non-finite/negative to fallback.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileReadTool, FileWriteTool, FileEditTool } from '../../src/tools/file.js';
import type { Tool, ToolResult } from '../../src/tools/types.js';

// ---------------------------------------------------------------------------
// Helpers — temp dir per test
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ody-file-inv-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Source-level constants
// ---------------------------------------------------------------------------

describe('file.ts — constants', () => {
  test('DEFAULT_LINE_LIMIT = 1000', async () => {
    const src = await readFile('src/tools/file.ts', 'utf8');
    expect(src).toContain('DEFAULT_LINE_LIMIT = 1000');
  });

  test('DEFAULT_CHAR_CAP = 20_000', async () => {
    const src = await readFile('src/tools/file.ts', 'utf8');
    expect(src).toContain('DEFAULT_CHAR_CAP = 20_000');
  });

  test('source documents the Iteration 29 rationale', async () => {
    const src = await readFile('src/tools/file.ts', 'utf8');
    expect(src).toContain('Iteration 29');
    // The token-burn finding must remain in the source so future
    // "let's bump the cap" PRs have to acknowledge the cost.
    expect(src).toMatch(/40M|40,?000,000/);
  });
});

// ---------------------------------------------------------------------------
// FileReadTool — Tool interface
// ---------------------------------------------------------------------------

describe('FileReadTool — Tool interface', () => {
  test('name is "file-read"', () => {
    const tool = new FileReadTool();
    expect(tool.name).toBe('file-read');
  });

  test('name is readonly', async () => {
    const src = await readFile('src/tools/file.ts', 'utf8');
    expect(src).toMatch(/readonly\s+name\s*=\s*['"]file-read['"]/);
  });

  test('description mentions default limits', () => {
    const tool = new FileReadTool();
    // The LLM needs to know the cap exists.
    expect(tool.description).toMatch(/1000|20k/i);
  });

  test('description mentions pagination via offset/limit', () => {
    const tool = new FileReadTool();
    expect(tool.description.toLowerCase()).toMatch(/offset|pagina/i);
  });

  test('parameters.required is ["path"]', () => {
    const tool = new FileReadTool();
    expect(tool.parameters.required).toEqual(['path']);
  });

  test('parameters has path, offset, limit properties', () => {
    const tool = new FileReadTool();
    const props = tool.parameters.properties as Record<string, unknown>;
    expect(props.path).toBeDefined();
    expect(props.offset).toBeDefined();
    expect(props.limit).toBeDefined();
  });

  test('offset and limit are NOT in required (optional)', () => {
    const tool = new FileReadTool();
    expect(tool.parameters.required).not.toContain('offset');
    expect(tool.parameters.required).not.toContain('limit');
  });

  test('FileReadTool satisfies Tool interface', () => {
    const tool: Tool = new FileReadTool();
    expect(tool.name).toBe('file-read');
  });
});

// ---------------------------------------------------------------------------
// FileReadTool — mutates contract
// ---------------------------------------------------------------------------

describe('FileReadTool — mutates() returns false', () => {
  test('mutates returns false for empty args', () => {
    const tool = new FileReadTool();
    expect(tool.mutates({})).toBe(false);
  });

  test('mutates returns false regardless of args', () => {
    const tool = new FileReadTool();
    expect(tool.mutates({ path: '/etc/passwd' })).toBe(false);
    expect(tool.mutates({ path: 'anything' })).toBe(false);
  });

  test('source defines mutates() returning false', async () => {
    const src = await readFile('src/tools/file.ts', 'utf8');
    // The hardcoded false is load-bearing — file-read is read-only,
    // and the orchestrator's checkpoint optimization depends on it.
    const match = src.match(/class\s+FileReadTool[\s\S]*?mutates\(\):\s*boolean\s*\{\s*return\s*false;/);
    expect(match).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FileReadTool — error isolation
// ---------------------------------------------------------------------------

describe('FileReadTool — error isolation', () => {
  test('empty path returns ok:false "path required"', async () => {
    const tool = new FileReadTool();
    const result = await tool.execute({ path: '' }, { cwd: tempDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('path required');
    }
  });

  test('missing path returns ok:false', async () => {
    const tool = new FileReadTool();
    const result = await tool.execute({}, { cwd: tempDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('path required');
    }
  });

  test('nonexistent file returns ok:false with filesystem error', async () => {
    const tool = new FileReadTool();
    const result = await tool.execute(
      { path: join(tempDir, 'does-not-exist.txt') },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/ENOENT|no such file/i);
    }
  });

  test('ToolResult runtime shape on failure', async () => {
    const tool = new FileReadTool();
    const result: ToolResult = await tool.execute({ path: '' }, { cwd: tempDir });
    expect(Object.keys(result).sort()).toEqual(['error', 'ok']);
  });

  test('ToolResult runtime shape on success', async () => {
    const path = join(tempDir, 'f.txt');
    await writeFile(path, 'hello');
    const tool = new FileReadTool();
    const result: ToolResult = await tool.execute({ path }, { cwd: tempDir });
    expect(Object.keys(result).sort()).toEqual(['ok', 'value']);
  });
});

// ---------------------------------------------------------------------------
// FileReadTool — pagination
// ---------------------------------------------------------------------------

describe('FileReadTool — pagination', () => {
  test('default limit returns up to 1000 lines', async () => {
    const path = join(tempDir, 'many-lines.txt');
    const content = Array.from({ length: 5 }, (_, i) => `line-${i}`).join('\n');
    await writeFile(path, content);
    const tool = new FileReadTool();
    const result = await tool.execute({ path }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = result.value.split('\n');
      expect(lines.length).toBe(5);
    }
  });

  test('offset skips leading lines', async () => {
    const path = join(tempDir, 'offset-test.txt');
    const content = 'first\nsecond\nthird\nfourth';
    await writeFile(path, content);
    const tool = new FileReadTool();
    const result = await tool.execute({ path, offset: 2 }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsWith('third')).toBe(true);
    }
  });

  test('limit restricts line count', async () => {
    const path = join(tempDir, 'limit-test.txt');
    const content = 'l1\nl2\nl3\nl4\nl5';
    await writeFile(path, content);
    const tool = new FileReadTool();
    const result = await tool.execute({ path, limit: 2 }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = result.value.split('\n');
      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('l1');
      expect(lines[1]).toBe('l2');
    }
  });

  test('offset + limit combination works', async () => {
    const path = join(tempDir, 'combo.txt');
    const content = 'a\nb\nc\nd\ne';
    await writeFile(path, content);
    const tool = new FileReadTool();
    const result = await tool.execute(
      { path, offset: 1, limit: 2 },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = result.value.split('\n');
      expect(lines).toEqual(['b', 'c']);
    }
  });

  test('offset beyond EOF returns empty content', async () => {
    const path = join(tempDir, 'short.txt');
    await writeFile(path, 'one\ntwo');
    const tool = new FileReadTool();
    const result = await tool.execute({ path, offset: 100 }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// FileReadTool — char cap and truncation
// ---------------------------------------------------------------------------

describe('FileReadTool — char cap (20k)', () => {
  test('large file triggers truncation notice', async () => {
    const path = join(tempDir, 'large.txt');
    // 30000 chars across 1000 lines.
    const content = Array.from({ length: 1000 }, () => '0123456789'.repeat(3)).join('\n');
    await writeFile(path, content);
    const tool = new FileReadTool();
    const result = await tool.execute({ path }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatch(/\[truncated:/);
    }
  });

  test('small file under cap does NOT have truncation notice', async () => {
    const path = join(tempDir, 'small.txt');
    await writeFile(path, 'short content');
    const tool = new FileReadTool();
    const result = await tool.execute({ path }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toMatch(/\[truncated:/);
    }
  });

  test('truncation label includes path and line range', async () => {
    const path = join(tempDir, 'label.txt');
    // Generate 10 lines of 3000 chars each — total 30k within the
    // limit=10 window, exceeding the 20k cap.
    const content = Array.from({ length: 20 }, () => 'x'.repeat(3000)).join('\n');
    await writeFile(path, content);
    const tool = new FileReadTool();
    const result = await tool.execute({ path, offset: 5, limit: 10 }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The label should include the path and a line-range like "5..15".
      expect(result.value).toMatch(/\[truncated:.*label\.txt.*5\.\.\d+/);
    }
  });
});

// ---------------------------------------------------------------------------
// FileReadTool — parseNonNegativeInt clamping
// ---------------------------------------------------------------------------

describe('FileReadTool — parseNonNegativeInt clamping', () => {
  test('NaN offset falls back to 0', async () => {
    const path = join(tempDir, 'nan.txt');
    await writeFile(path, 'a\nb\nc');
    const tool = new FileReadTool();
    const result = await tool.execute(
      { path, offset: Number.NaN },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Offset falls back to 0, so we read from line 0.
      expect(result.value.startsWith('a')).toBe(true);
    }
  });

  test('negative offset falls back to 0', async () => {
    const path = join(tempDir, 'neg.txt');
    await writeFile(path, 'a\nb\nc');
    const tool = new FileReadTool();
    const result = await tool.execute(
      { path, offset: -10 },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsWith('a')).toBe(true);
    }
  });

  test('non-number offset (string) falls back to 0', async () => {
    const path = join(tempDir, 'str.txt');
    await writeFile(path, 'a\nb\nc');
    const tool = new FileReadTool();
    const result = await tool.execute(
      { path, offset: 'not-a-number' as unknown as number },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.startsWith('a')).toBe(true);
    }
  });

  test('NaN limit falls back to DEFAULT_LINE_LIMIT', async () => {
    const path = join(tempDir, 'nanlim.txt');
    await writeFile(path, 'a\nb\nc');
    const tool = new FileReadTool();
    const result = await tool.execute(
      { path, limit: Number.NaN },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // All 3 lines fit well under the 1000 default.
      expect(result.value.split('\n').length).toBe(3);
    }
  });

  test('fractional offset is floored', async () => {
    const path = join(tempDir, 'frac.txt');
    await writeFile(path, 'a\nb\nc\nd\ne');
    const tool = new FileReadTool();
    const result = await tool.execute(
      { path, offset: 1.9 },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Math.floor(1.9) = 1, so we read from line 1 ('b').
      expect(result.value.startsWith('b')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// FileWriteTool — Tool interface
// ---------------------------------------------------------------------------

describe('FileWriteTool — Tool interface', () => {
  test('name is "file-write"', () => {
    const tool = new FileWriteTool();
    expect(tool.name).toBe('file-write');
  });

  test('parameters.required is ["path", "content"]', () => {
    const tool = new FileWriteTool();
    expect(tool.parameters.required).toEqual(['path', 'content']);
  });

  test('FileWriteTool satisfies Tool interface', () => {
    const tool: Tool = new FileWriteTool();
    expect(tool.name).toBe('file-write');
  });

  test('description mentions parent dir creation', () => {
    const tool = new FileWriteTool();
    // mkdir(recursive: true) is a load-bearing feature — callers
    // rely on being able to write to paths whose parent dirs don't
    // exist yet.
    expect(tool.description.toLowerCase()).toMatch(/parent|director/i);
  });
});

// ---------------------------------------------------------------------------
// FileWriteTool — mutates is conservative-default true
// ---------------------------------------------------------------------------

describe('FileWriteTool — mutates', () => {
  test('omits mutates (orchestrator treats as mutating by default)', async () => {
    const src = await readFile('src/tools/file.ts', 'utf8');
    // FileWriteTool doesn't override mutates, so the ToolRegistry's
    // default (conservative true) kicks in. The orchestrator WILL
    // checkpoint before file-write.
    const classBlock = src.match(/class\s+FileWriteTool[\s\S]*?^}/m);
    expect(classBlock).not.toBeNull();
    expect(classBlock![0]).not.toMatch(/\bmutates\s*\(/);
  });
});

// ---------------------------------------------------------------------------
// FileWriteTool — error isolation and behavior
// ---------------------------------------------------------------------------

describe('FileWriteTool — error isolation', () => {
  test('empty path returns ok:false "path required"', async () => {
    const tool = new FileWriteTool();
    const result = await tool.execute({ path: '', content: 'x' }, { cwd: tempDir });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('path required');
    }
  });

  test('missing path returns ok:false', async () => {
    const tool = new FileWriteTool();
    const result = await tool.execute({ content: 'x' }, { cwd: tempDir });
    expect(result.ok).toBe(false);
  });

  test('missing content defaults to empty string (still succeeds)', async () => {
    const path = join(tempDir, 'empty.txt');
    const tool = new FileWriteTool();
    const result = await tool.execute({ path }, { cwd: tempDir });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const written = await readFile(path, 'utf8');
      expect(written).toBe('');
    }
  });
});

describe('FileWriteTool — file creation', () => {
  test('writes content to a file', async () => {
    const path = join(tempDir, 'new.txt');
    const tool = new FileWriteTool();
    const result = await tool.execute(
      { path, content: 'new content' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const written = await readFile(path, 'utf8');
      expect(written).toBe('new content');
    }
  });

  test('creates parent directories recursively', async () => {
    const path = join(tempDir, 'subdir1', 'subdir2', 'file.txt');
    const tool = new FileWriteTool();
    const result = await tool.execute(
      { path, content: 'nested' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const written = await readFile(path, 'utf8');
      expect(written).toBe('nested');
    }
  });

  test('return value reports byte count and path', async () => {
    const path = join(tempDir, 'report.txt');
    const tool = new FileWriteTool();
    const result = await tool.execute(
      { path, content: '1234567890' }, // 10 bytes
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatch(/wrote\s+10\s+bytes/);
      expect(result.value).toContain(path);
    }
  });

  test('overwrites existing file', async () => {
    const path = join(tempDir, 'overwrite.txt');
    await writeFile(path, 'original');
    const tool = new FileWriteTool();
    const result = await tool.execute(
      { path, content: 'replaced' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    const written = await readFile(path, 'utf8');
    expect(written).toBe('replaced');
  });
});

// ---------------------------------------------------------------------------
// FileEditTool — Tool interface
// ---------------------------------------------------------------------------

describe('FileEditTool — Tool interface', () => {
  test('name is "file-edit"', () => {
    const tool = new FileEditTool();
    expect(tool.name).toBe('file-edit');
  });

  test('parameters.required is ["path", "oldString", "newString"]', () => {
    const tool = new FileEditTool();
    expect(tool.parameters.required).toEqual(['path', 'oldString', 'newString']);
  });

  test('FileEditTool satisfies Tool interface', () => {
    const tool: Tool = new FileEditTool();
    expect(tool.name).toBe('file-edit');
  });

  test('description mentions single-occurrence contract', () => {
    const tool = new FileEditTool();
    // The unambiguity contract is load-bearing — the LLM needs to
    // know that file-edit refuses to guess.
    expect(tool.description.toLowerCase()).toMatch(/single occurrence|ambiguous|exactly one/);
  });
});

// ---------------------------------------------------------------------------
// FileEditTool — unambiguity contract
// ---------------------------------------------------------------------------

describe('FileEditTool — unambiguity contract', () => {
  test('errors when oldString not found', async () => {
    const path = join(tempDir, 'f.txt');
    await writeFile(path, 'hello world');
    const tool = new FileEditTool();
    const result = await tool.execute(
      { path, oldString: 'missing', newString: 'x' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not found/i);
      expect(result.error).toContain(path);
    }
  });

  test('errors when oldString appears multiple times', async () => {
    const path = join(tempDir, 'multi.txt');
    await writeFile(path, 'dup dup dup');
    const tool = new FileEditTool();
    const result = await tool.execute(
      { path, oldString: 'dup', newString: 'x' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/ambiguous/i);
      expect(result.error).toMatch(/3 matches/);
    }
  });

  test('succeeds with exactly one occurrence', async () => {
    const path = join(tempDir, 'one.txt');
    await writeFile(path, 'before unique after');
    const tool = new FileEditTool();
    const result = await tool.execute(
      { path, oldString: 'unique', newString: 'replaced' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const written = await readFile(path, 'utf8');
      expect(written).toBe('before replaced after');
    }
  });

  test('return value is "edited PATH"', async () => {
    const path = join(tempDir, 'edit.txt');
    await writeFile(path, 'foo bar baz');
    const tool = new FileEditTool();
    const result = await tool.execute(
      { path, oldString: 'bar', newString: 'qux' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(`edited ${path}`);
    }
  });
});

describe('FileEditTool — argument validation', () => {
  test('empty path returns ok:false "path and oldString required"', async () => {
    const tool = new FileEditTool();
    const result = await tool.execute(
      { path: '', oldString: 'x', newString: 'y' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('path and oldString required');
    }
  });

  test('empty oldString returns ok:false', async () => {
    const tool = new FileEditTool();
    const result = await tool.execute(
      { path: '/tmp/x', oldString: '', newString: 'y' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('path and oldString required');
    }
  });

  test('newString can be empty (deletion)', async () => {
    const path = join(tempDir, 'delete.txt');
    await writeFile(path, 'keep removeme keep');
    const tool = new FileEditTool();
    const result = await tool.execute(
      { path, oldString: 'removeme ', newString: '' },
      { cwd: tempDir },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const written = await readFile(path, 'utf8');
      expect(written).toBe('keep keep');
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism — same input produces same output', () => {
  test('FileReadTool is deterministic', async () => {
    const path = join(tempDir, 'det.txt');
    await writeFile(path, 'deterministic\ncontent');
    const tool = new FileReadTool();
    const a = await tool.execute({ path }, { cwd: tempDir });
    const b = await tool.execute({ path }, { cwd: tempDir });
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('file.ts — module exports', () => {
  test('FileReadTool, FileWriteTool, FileEditTool are all exported', async () => {
    const src = await readFile('src/tools/file.ts', 'utf8');
    expect(src).toMatch(/export\s+class\s+FileReadTool/);
    expect(src).toMatch(/export\s+class\s+FileWriteTool/);
    expect(src).toMatch(/export\s+class\s+FileEditTool/);
  });

  test('source exports exactly 3 classes', async () => {
    const src = await readFile('src/tools/file.ts', 'utf8');
    const classExports = src.match(/^export\s+class\s+(\w+)/gm) ?? [];
    expect(classExports.length).toBe(3);
  });

  test('parseNonNegativeInt is NOT exported (module-private)', async () => {
    const src = await readFile('src/tools/file.ts', 'utf8');
    // The helper is module-private — not part of the public API.
    expect(src).toMatch(/^function\s+parseNonNegativeInt/m);
    expect(src).not.toMatch(/^export\s+function\s+parseNonNegativeInt/);
  });
});
