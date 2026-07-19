import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  readMemory,
  writeMemory,
  listMemory,
  readMemoryAsPromptContext,
  type MemoryEntry,
} from '../../src/cerebellum/memory.js';

describe('memory store', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-mem-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('write then read round-trips entry fields', async () => {
    const result = await writeMemory(rootDir, {
      category: 'lessons',
      title: 'never disable the safety perimeter',
      source: 'failure',
      body: 'The orchestrator rolled back because we touched orchestrator.ts without manual review.',
      tags: ['safety', 'sacred-file'],
      relatedWaypointId: 'wp_abc123',
    });

    expect(result.id).toMatch(/^mem_[0-9a-f]{10}$/);
    expect(result.bytesWritten).toBeGreaterThan(0);

    const entries = await readMemory(rootDir, 'lessons');
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry.id).toBe(result.id);
    expect(entry.category).toBe('lessons');
    expect(entry.title).toBe('never disable the safety perimeter');
    expect(entry.source).toBe('failure');
    expect(entry.body).toContain('orchestrator rolled back');
    expect(entry.tags).toEqual(['safety', 'sacred-file']);
    expect(entry.relatedWaypointId).toBe('wp_abc123');
  });

  test('multiple writes append (never overwrite)', async () => {
    await writeMemory(rootDir, {
      category: 'patterns',
      title: 'first',
      source: 'system',
      body: 'A',
    });
    await writeMemory(rootDir, {
      category: 'patterns',
      title: 'second',
      source: 'system',
      body: 'B',
    });

    const entries = await readMemory(rootDir, 'patterns');
    expect(entries.length).toBe(2);
    expect(entries[0]!.title).toBe('first');
    expect(entries[1]!.title).toBe('second');
  });

  test('read on missing category returns [] (not an error)', async () => {
    const entries = await readMemory(rootDir, 'dreams');
    expect(entries).toEqual([]);
  });

  test('optional fields (tags, relatedWaypointId) round-trip when absent', async () => {
    await writeMemory(rootDir, {
      category: 'preferences',
      title: 'use Catppuccin Mocha',
      source: 'user',
      body: 'User prefers the Mocha palette for TUI rendering.',
    });

    const entries = await readMemory(rootDir, 'preferences');
    expect(entries.length).toBe(1);
    const entry = entries[0]!;
    expect(entry.tags).toBeUndefined();
    expect(entry.relatedWaypointId).toBeUndefined();
  });

  test('explicit id + ts are preserved (not regenerated)', async () => {
    await writeMemory(rootDir, {
      id: 'mem_fixedid',
      category: 'patterns',
      title: 'pinned entry',
      source: 'system',
      body: 'body',
      ts: '2026-01-01T00:00:00.000Z',
    });

    const entries = await readMemory(rootDir, 'patterns');
    expect(entries[0]!.id).toBe('mem_fixedid');
    expect(entries[0]!.ts).toBe('2026-01-01T00:00:00.000Z');
  });

  test('listMemory reports per-category entryCount + bytes', async () => {
    await writeMemory(rootDir, {
      category: 'lessons',
      title: 'lesson 1',
      source: 'failure',
      body: 'x',
    });
    await writeMemory(rootDir, {
      category: 'lessons',
      title: 'lesson 2',
      source: 'failure',
      body: 'y',
    });
    await writeMemory(rootDir, {
      category: 'dreams',
      title: 'a dream',
      source: 'dream',
      body: 'z',
    });

    const list = await listMemory(rootDir);
    expect(list.length).toBe(4); // 4 categories

    const lessons = list.find((e) => e.category === 'lessons');
    const dreams = list.find((e) => e.category === 'dreams');
    const patterns = list.find((e) => e.category === 'patterns');
    expect(lessons?.entryCount).toBe(2);
    expect(lessons?.bytes).toBeGreaterThan(0);
    expect(dreams?.entryCount).toBe(1);
    expect(patterns?.entryCount).toBe(0);
    expect(patterns?.bytes).toBe(0);
  });

  test('corrupt section is skipped, valid sections still parsed', async () => {
    // Manually write a malformed file: prelude + bad section + good section
    const path = join(rootDir, 'memory', 'lessons.md');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      [
        '# Prelude (should be ignored)\n',
        '## malformed section without metadata',
        'no id/source here',
        '',
        '## [2026-07-19T00:00:00.000Z] real entry',
        '- **id**: mem_real',
        '- **source**: system',
        '',
        'real body content',
        '',
      ].join('\n'),
      'utf8'
    );

    const entries = await readMemory(rootDir, 'lessons');
    expect(entries.length).toBe(1);
    expect(entries[0]!.id).toBe('mem_real');
    expect(entries[0]!.title).toBe('real entry');
    expect(entries[0]!.body).toContain('real body content');
  });

  test('readMemoryAsPromptContext returns "" for empty category', async () => {
    const ctx = await readMemoryAsPromptContext(rootDir, 'dreams');
    expect(ctx).toBe('');
  });

  test('readMemoryAsPromptContext formats entries with markdown header', async () => {
    // Two entries so the --- separator between them appears.
    await writeMemory(rootDir, {
      category: 'preferences',
      title: 'commit messages in Chinese',
      source: 'user',
      body: 'User asked for 中文 commit messages on 2026-07-19.',
    });
    await writeMemory(rootDir, {
      category: 'preferences',
      title: 'use semantic prefixes',
      source: 'user',
      body: 'feat/fix/refactor/docs/test/chore.',
    });

    const ctx = await readMemoryAsPromptContext(rootDir, 'preferences');
    expect(ctx.startsWith('# Memory: preferences')).toBe(true);
    expect(ctx).toContain('## commit messages in Chinese');
    expect(ctx).toContain('中文 commit messages');
    expect(ctx).toContain('---'); // separator between the two entries
    expect(ctx).toContain('## use semantic prefixes');
  });

  test('memory file is plain markdown (operator can cat it)', async () => {
    await writeMemory(rootDir, {
      category: 'patterns',
      title: 'use execFileNoThrow',
      source: 'system',
      body: 'Never spawn a shell for subprocess calls — use execFile to avoid injection.',
    });

    const path = join(rootDir, 'memory', 'patterns.md');
    const raw = await readFile(path, 'utf8');
    expect(raw.startsWith('## [')).toBe(true);
    expect(raw).toContain('**id**:');
    expect(raw).toContain('**source**: system');
    expect(raw).toContain('execFile');
  });

  test('entry with markdown in body is preserved verbatim', async () => {
    const bodyWithMarkdown = [
      'Context:',
      '',
      '- bullet one',
      '- bullet two',
      '',
      '```ts',
      'const x = 1;',
      '```',
    ].join('\n');

    await writeMemory(rootDir, {
      category: 'patterns',
      title: 'code in body',
      source: 'system',
      body: bodyWithMarkdown,
    });

    const entries = await readMemory(rootDir, 'patterns');
    expect(entries[0]!.body).toBe(bodyWithMarkdown);
  });

  test('tags with commas are split correctly', async () => {
    await writeMemory(rootDir, {
      category: 'lessons',
      title: 'comma test',
      source: 'system',
      body: 'x',
      tags: ['one', 'two', 'three'],
    });

    const entries = await readMemory(rootDir, 'lessons');
    expect(entries[0]!.tags).toEqual(['one', 'two', 'three']);
  });
});

// Type-level sanity check (compile-time only): MemoryEntry is fully readonly.
// If anyone tries to mutate, tsc fails. Kept as a no-op variable for clarity.
const _typeCheck: MemoryEntry = {
  id: 'mem_x',
  category: 'patterns',
  title: 't',
  source: 'system',
  body: 'b',
  ts: '2026-01-01T00:00:00.000Z',
};
void _typeCheck;
