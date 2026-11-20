import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileReadTool, FileWriteTool, FileEditTool } from '../../src/tools/file.js';

/**
 * P3 injection defense: file-read output is quarantined (nonce BEGIN/END
 * markers around the content, provenance in the header). These tests assert
 * the PAYLOAD semantics, so they strip the two marker lines first — the
 * wrapper itself is covered by p3-quarantine.test.ts.
 */
function quarantineInner(value: string): string {
  const lines = value.split('\n');
  return lines.slice(1, -1).join('\n');
}

describe('file tools — relative paths resolve against ctx.cwd', () => {
  // Live-baseline bug (2026-11-20): GLM wrote 'hello.ts' (relative) and the
  // file landed in the DRIVER's process.cwd() instead of the agent's repo —
  // git status stayed clean, the progress verify failed a correct waypoint,
  // and the rollback erased nothing because nothing was ever in the repo.
  // The declared contract ("Absolute or cwd-relative path") means cwd =
  // ToolContext.cwd. bash/git already honor ctx.cwd; file tools must too.
  test('file-write + file-read with relative path land inside ctx.cwd', async () => {
    const agentRoot = await mkdtemp(join(tmpdir(), 'ody-ctxcwd-'));
    try {
      const write = new FileWriteTool();
      const w = await write.execute({ path: 'rel/hello.ts', content: 'x' }, { cwd: agentRoot });
      expect(w.ok).toBe(true);
      expect(await readFile(join(agentRoot, 'rel', 'hello.ts'), 'utf8')).toBe('x');

      const read = new FileReadTool();
      const r = await read.execute({ path: 'rel/hello.ts' }, { cwd: agentRoot });
      expect(r.ok).toBe(true);
      if (r.ok) expect(quarantineInner(r.value)).toBe('x');
    } finally {
      await rm(agentRoot, { recursive: true, force: true });
    }
  });

  test('file-edit resolves oldString/newString against ctx.cwd', async () => {
    const agentRoot = await mkdtemp(join(tmpdir(), 'ody-ctxcwd-'));
    try {
      await (new FileWriteTool()).execute(
        { path: 'edit-me.txt', content: 'foo bar' },
        { cwd: agentRoot }
      );
      const edit = new FileEditTool();
      const r = await edit.execute(
        { path: 'edit-me.txt', oldString: 'bar', newString: 'qux' },
        { cwd: agentRoot }
      );
      expect(r.ok).toBe(true);
      expect(await readFile(join(agentRoot, 'edit-me.txt'), 'utf8')).toBe('foo qux');
    } finally {
      await rm(agentRoot, { recursive: true, force: true });
    }
  });

  test('absolute paths keep working unchanged', async () => {
    const agentRoot = await mkdtemp(join(tmpdir(), 'ody-ctxcwd-'));
    try {
      const absolute = join(agentRoot, 'abs.txt');
      const w = await (new FileWriteTool()).execute({ path: absolute, content: 'abs' }, { cwd: agentRoot });
      expect(w.ok).toBe(true);
      expect(await readFile(absolute, 'utf8')).toBe('abs');
    } finally {
      await rm(agentRoot, { recursive: true, force: true });
    }
  });
});

describe('file tools', () => {
  let workdir: string;
  const writeTool = new FileWriteTool();

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-test-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('file-write writes content to a file', async () => {
    const path = join(workdir, 'hello.txt');
    const result = await writeTool.execute({ path, content: 'hello' }, { cwd: workdir });
    expect(result.ok).toBe(true);
    const written = await readFile(path, 'utf8');
    expect(written).toBe('hello');
  });

  test('file-read reads file content', async () => {
    const path = join(workdir, 'read.txt');
    await writeTool.execute({ path, content: 'data' }, { cwd: workdir });
    const tool = new FileReadTool();
    const result = await tool.execute({ path }, { cwd: workdir });
    expect(result.ok).toBe(true);
    if (result.ok) expect(quarantineInner(result.value)).toBe('data');
  });

  test('file-read returns error on missing file', async () => {
    const tool = new FileReadTool();
    const result = await tool.execute({ path: join(workdir, 'nope.txt') }, { cwd: workdir });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no such file|ENOENT/i);
  });

  test('file-edit replaces exact string match', async () => {
    const path = join(workdir, 'edit.txt');
    await writeTool.execute({ path, content: 'foo bar baz' }, { cwd: workdir });
    const tool = new FileEditTool();
    const result = await tool.execute(
      { path, oldString: 'bar', newString: 'qux' },
      { cwd: workdir }
    );
    expect(result.ok).toBe(true);
    const updated = await readFile(path, 'utf8');
    expect(updated).toBe('foo qux baz');
  });

  test('file-edit errors when oldString not found', async () => {
    const path = join(workdir, 'edit2.txt');
    await writeTool.execute({ path, content: 'unchanged' }, { cwd: workdir });
    const tool = new FileEditTool();
    const result = await tool.execute(
      { path, oldString: 'missing', newString: 'whatever' },
      { cwd: workdir }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/i);
  });

  test('file-edit errors on ambiguous (multiple) match', async () => {
    const path = join(workdir, 'ambig.txt');
    await writeTool.execute({ path, content: 'x x x' }, { cwd: workdir });
    const tool = new FileEditTool();
    const result = await tool.execute(
      { path, oldString: 'x', newString: 'y' },
      { cwd: workdir }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/multiple|ambiguous/i);
  });

  // ---------------------------------------------------------------------
  // Iteration 29 — line/char caps + offset/limit pagination. Without
  // these, file-read returned entire files verbatim — a single read of
  // orchestrator.ts (1542 lines, ~15k tokens) permanently added that
  // to conversation history.
  // ---------------------------------------------------------------------

  describe('Iteration 29 — caps and pagination', () => {
    test('default limit returns up to 1000 lines without truncation notice', async () => {
      // 500 lines is well under default cap — should return verbatim.
      const path = join(workdir, 'medium.txt');
      const content = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
      await writeTool.execute({ path, content }, { cwd: workdir });
      const tool = new FileReadTool();
      const result = await tool.execute({ path }, { cwd: workdir });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(quarantineInner(result.value)).toBe(content);
        expect(quarantineInner(result.value)).not.toContain('[truncated:');
      }
    });

    test('line limit > file size returns all lines (no truncation)', async () => {
      const path = join(workdir, 'small.txt');
      await writeTool.execute({ path, content: 'one\ntwo\nthree' }, { cwd: workdir });
      const tool = new FileReadTool();
      const result = await tool.execute({ path }, { cwd: workdir });
      expect(result.ok).toBe(true);
      if (result.ok) expect(quarantineInner(result.value)).toBe('one\ntwo\nthree');
    });

    test('offset skips the first N lines', async () => {
      const path = join(workdir, 'paginated.txt');
      const content = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
      await writeTool.execute({ path, content }, { cwd: workdir });
      const tool = new FileReadTool();
      const result = await tool.execute({ path, offset: 3, limit: 2 }, { cwd: workdir });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(quarantineInner(result.value)).toBe('line 3\nline 4');
      }
    });

    test('limit caps the line count, notice explains the file is larger', async () => {
      const path = join(workdir, 'large.txt');
      const content = Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n');
      await writeTool.execute({ path, content }, { cwd: workdir });
      const tool = new FileReadTool();
      const result = await tool.execute({ path }, { cwd: workdir });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Default limit 1000 lines → returns 1000 lines + char-cap notice
        // (since 1000 lines × ~7 chars = 7k chars, under char cap, so the
        // truncation here comes from the line cap, not the char cap).
        // Actually wait — 1000 lines × ~7 chars = 7k chars < 20k cap, so
        // no char-cap notice fires. The line-cap path returns silently.
        expect(result.value).toContain('line 999');
        expect(result.value).not.toContain('line 1000');
      }
    });

    test('char cap fires when individual lines are long', async () => {
      // 10 lines, each 5k chars → 50k total, well over the 20k char cap.
      const path = join(workdir, 'wide.txt');
      const longLine = 'x'.repeat(5000);
      const content = Array.from({ length: 10 }, () => longLine).join('\n');
      await writeTool.execute({ path, content }, { cwd: workdir });
      const tool = new FileReadTool();
      const result = await tool.execute({ path }, { cwd: workdir });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toContain('[truncated:');
        expect(result.value).toContain('was 50009 chars'); // 10*5000 + 9 newlines
        expect(result.value).toContain('use offset/limit');
      }
    });

    test('offset beyond end of file returns empty string (no error)', async () => {
      const path = join(workdir, 'short.txt');
      await writeTool.execute({ path, content: 'one\ntwo' }, { cwd: workdir });
      const tool = new FileReadTool();
      const result = await tool.execute({ path, offset: 100 }, { cwd: workdir });
      expect(result.ok).toBe(true);
      if (result.ok) expect(quarantineInner(result.value)).toBe('');
    });

    test('explicit limit overrides the default', async () => {
      const path = join(workdir, 'twenty.txt');
      const content = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
      await writeTool.execute({ path, content }, { cwd: workdir });
      const tool = new FileReadTool();
      const result = await tool.execute({ path, limit: 5 }, { cwd: workdir });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(quarantineInner(result.value)).toBe(
          'line 0\nline 1\nline 2\nline 3\nline 4'
        );
      }
    });

    test('negative offset is rejected, falls back to 0', async () => {
      const path = join(workdir, 'neg.txt');
      await writeTool.execute({ path, content: 'a\nb\nc' }, { cwd: workdir });
      const tool = new FileReadTool();
      // @ts-expect-error — testing runtime guard against bad input
      const result = await tool.execute({ path, offset: -5 }, { cwd: workdir });
      expect(result.ok).toBe(true);
      if (result.ok) expect(quarantineInner(result.value).startsWith('a')).toBe(true);
    });

    test('non-numeric limit falls back to default', async () => {
      const path = join(workdir, 'badlimit.txt');
      await writeTool.execute({ path, content: 'x\ny\nz' }, { cwd: workdir });
      const tool = new FileReadTool();
      // @ts-expect-error — testing runtime guard against bad input
      const result = await tool.execute({ path, limit: 'many' }, { cwd: workdir });
      expect(result.ok).toBe(true);
      if (result.ok) expect(quarantineInner(result.value)).toBe('x\ny\nz');
    });
  });
});
