import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  serializeEntry,
  splitSections,
  parseEntry,
  type ParsedSection,
} from '../../src/cerebellum/memory-parse.js';
import type { MemoryEntry } from '../../src/cerebellum/memory.js';

/**
 * Direct unit tests for the pure markdown (de)serialization module
 * extracted from memory.ts in Iteration 53.
 *
 * These tests exercise the parser without touching the filesystem,
 * which makes them fast and deterministic. Round-trip coverage via
 * the storage API still lives in memory.test.ts.
 */

const sampleEntry: MemoryEntry = {
  id: 'mem_abc12345',
  category: 'lessons',
  title: 'never edit orchestrator.ts without manual review',
  source: 'failure',
  body: 'The safety perimeter exists for a reason. Touching it bypasses the checkpoint.',
  ts: '2026-07-21T10:00:00Z',
  tags: ['safety', 'sacred-file'],
  relatedWaypointId: 'wp_abc',
};

describe('serializeEntry', () => {
  test('produces a markdown section starting with ## header', () => {
    const md = serializeEntry(sampleEntry);
    expect(md.startsWith('## [2026-07-21T10:00:00Z] ')).toBe(true);
    expect(md).toContain(sampleEntry.title);
  });

  test('includes id and source metadata lines', () => {
    const md = serializeEntry(sampleEntry);
    expect(md).toContain(`- **id**: ${sampleEntry.id}`);
    expect(md).toContain(`- **source**: ${sampleEntry.source}`);
  });

  test('includes optional metadata when present', () => {
    const md = serializeEntry(sampleEntry);
    expect(md).toContain(`- **tags**: ${sampleEntry.tags!.join(', ')}`);
    expect(md).toContain(`- **related**: ${sampleEntry.relatedWaypointId}`);
  });

  test('omits optional metadata lines when absent', () => {
    const minimal: MemoryEntry = {
      id: 'mem_x',
      category: 'patterns',
      title: 'x',
      source: 'system',
      body: 'y',
      ts: '2026-07-21T10:00:00Z',
    };
    const md = serializeEntry(minimal);
    expect(md).not.toContain('- **tags**');
    expect(md).not.toContain('- **related**');
  });

  test('collapses newlines in title to single-line', () => {
    const entry: MemoryEntry = {
      ...sampleEntry,
      title: 'multi\nline\ntitle',
    };
    const md = serializeEntry(entry);
    // Header must be a single line so splitSections can parse it back.
    const headerLine = md.split('\n')[0]!;
    expect(headerLine).not.toContain('\n');
    expect(headerLine).toContain('multi line title');
  });
});

describe('splitSections + parseEntry round-trip', () => {
  test('serialized entry parses back to the same shape', () => {
    const md = serializeEntry(sampleEntry) + '\n';
    const sections = splitSections(md);
    expect(sections.length).toBe(1);
    const parsed = parseEntry(sections[0]!, 'lessons');
    expect(parsed).toEqual(sampleEntry);
  });

  test('multiple entries split into independent sections', () => {
    const entryA: MemoryEntry = { ...sampleEntry, id: 'mem_aaaa0001' };
    const entryB: MemoryEntry = {
      ...sampleEntry,
      id: 'mem_bbbb0002',
      title: 'second entry',
      body: 'different body',
    };
    const md = serializeEntry(entryA) + '\n' + serializeEntry(entryB) + '\n';
    const sections = splitSections(md);
    expect(sections.length).toBe(2);
    const parsedA = parseEntry(sections[0]!, 'lessons');
    const parsedB = parseEntry(sections[1]!, 'lessons');
    expect(parsedA?.id).toBe('mem_aaaa0001');
    expect(parsedB?.id).toBe('mem_bbbb0002');
  });

  test('prelude before first ## section is skipped', () => {
    const md = `# Memory: lessons\n\nThis is a header prelude.\n\n${serializeEntry(sampleEntry)}`;
    const sections = splitSections(md);
    expect(sections.length).toBe(1);
    expect(sections[0]!.header).toContain(sampleEntry.title);
  });

  test('section missing id metadata returns null (tolerant of corruption)', () => {
    const md = `## [2026-07-21T10:00:00Z] corrupt entry\n\nNo metadata here.\n`;
    const sections = splitSections(md);
    expect(sections.length).toBe(1);
    const parsed = parseEntry(sections[0]!, 'lessons');
    expect(parsed).toBeNull();
  });

  test('section with bad header returns null', () => {
    const md = `## no bracket-prefix here\n- **id**: mem_x\n- **source**: system\n\nbody\n`;
    const sections = splitSections(md);
    expect(sections.length).toBe(1);
    const parsed = parseEntry(sections[0]!, 'lessons');
    expect(parsed).toBeNull();
  });

  test('body with blank-line-delimited metadata parses correctly', () => {
    const entry: MemoryEntry = {
      ...sampleEntry,
      body: 'first paragraph\n\nsecond paragraph',
    };
    const md = serializeEntry(entry) + '\n';
    const sections = splitSections(md);
    const parsed = parseEntry(sections[0]!, 'lessons');
    expect(parsed?.body).toBe('first paragraph\n\nsecond paragraph');
  });
});

describe('splitSections indexes', () => {
  test('startIndex and endIndex point to line ranges in source markdown', () => {
    // Trailing newline produces a trailing empty-string entry in split('\n'),
    // so endIndex of the final section equals lines.length (6, not 5).
    const md = `## header one\nbody-one\n\n## header two\nbody-two\n`;
    const sections = splitSections(md);
    expect(sections.length).toBe(2);
    expect(sections[0]!.startIndex).toBe(0);
    expect(sections[0]!.endIndex).toBe(3);
    expect(sections[1]!.startIndex).toBe(3);
    expect(sections[1]!.endIndex).toBe(6);
  });
});

describe('memory-parse extraction (Iteration 53)', () => {
  // Iteration 53 moved serializeEntry + splitSections + parseEntry +
  // ParsedSection from memory.ts to memory-parse.ts (mirrors Iter 42
  // planner-policy, Iter 44 curiosity-prompt, Iter 47 dreamer-prompt,
  // Iter 48 self-monitor-patterns, Iter 51 strategy-prompt). These
  // tests pin the extraction so a future refactor cannot silently
  // re-inline the code.

  test('parser symbols live in memory-parse.ts', async () => {
    const parseSrc = await readFile(
      'src/cerebellum/memory-parse.ts',
      'utf8',
    );
    const memorySrc = await readFile(
      'src/cerebellum/memory.ts',
      'utf8',
    );
    expect(parseSrc).toContain('export function serializeEntry');
    expect(parseSrc).toContain('export function splitSections');
    expect(parseSrc).toContain('export function parseEntry');
    expect(parseSrc).toContain('export interface ParsedSection');
    // Must NOT be re-defined in memory.ts.
    expect(memorySrc).not.toContain('function serializeEntry');
    expect(memorySrc).not.toContain('function splitSections');
    expect(memorySrc).not.toContain('function parseEntry');
    expect(memorySrc).not.toContain('interface ParsedSection');
  });

  test('memory.ts imports the parser symbols (not re-defines them)', async () => {
    const memorySrc = await readFile(
      'src/cerebellum/memory.ts',
      'utf8',
    );
    expect(memorySrc).toContain("from './memory-parse.js'");
  });

  test('memory.ts re-exports the extracted symbols for backwards compat', async () => {
    // memory.test.ts and external consumers import readMemory etc from
    // memory.ts. The parser symbols are re-exported so callers that
    // previously reached into memory.ts for them (if any future test
    // does) do not break. Mirrors Iter 42 planner-policy re-export.
    const memorySrc = await readFile(
      'src/cerebellum/memory.ts',
      'utf8',
    );
    expect(memorySrc).toContain(
      "serializeEntry,\n  splitSections,\n  parseEntry,\n} from './memory-parse.js';",
    );
  });
});
