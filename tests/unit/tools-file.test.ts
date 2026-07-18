import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileReadTool, FileWriteTool, FileEditTool } from '../../src/tools/file.js';

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
    if (result.ok) expect(result.value).toBe('data');
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
});
