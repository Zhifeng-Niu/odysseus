import { describe, test, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Size caps for `.odysseus/memory/*.md`.
 *
 * Why this test exists: patterns.md and lessons.md are injected into the
 * system prompt of EVERY LLM iteration (via loadLongTermMemoryMarkdown in
 * src/cerebellum/strategy.ts). Pre-Iteration-31 they had grown to 16k +
 * 7k chars respectively (~6k tokens per iteration). The memory.ts module
 * is append-only by design ("forgetting not implemented yet; YAGNI"), so
 * patterns accumulated without bound — including many describing problems
 * that subsequent iterations had already fixed.
 *
 * The caps are set with headroom for 2-3 new entries before forcing a
 * prune pass. When the test fails, the fix is to prune entries that
 * describe already-fixed problems (verify by code inspection), not to
 * raise the cap. See Iteration 31 commit for the prune criteria:
 *   - Entry describes a problem that has a corresponding fix in code → remove
 *   - Entry is still actionable but verbose → compress
 *   - Entry duplicates another entry's lesson → keep the more actionable one
 *
 * Historical note: pre-Iteration-31 the files held 28 + 19 entries.
 * Many described the missing-completion-gate, missing-recovery-path, or
 * missing-self-model bugs that iterations 6-15 fixed. Those entries were
 * removed because the LLM was paying token tax on patterns it could no
 * longer benefit from — the underlying conditions no longer occur.
 */

const MEMORY_DIR = join(process.cwd(), '.odysseus', 'memory');

const PATTERNS_PATH = join(MEMORY_DIR, 'patterns.md');
const LESSONS_PATH = join(MEMORY_DIR, 'lessons.md');

// patterns.md holds more entries than lessons.md (dreamer writes more
// patterns than lessons), so its cap is higher.
const PATTERNS_CHAR_CAP = 8_000;
const PATTERNS_LINE_CAP = 120;
const PATTERNS_ENTRY_CAP = 20;

const LESSONS_CHAR_CAP = 5_000;
const LESSONS_LINE_CAP = 80;
const LESSONS_ENTRY_CAP = 15;

function countEntries(path: string): number {
  try {
    const content = readFileSync(path, 'utf8');
    return (content.match(/^## /gm) ?? []).length;
  } catch {
    return 0;
  }
}

describe('.odysseus/memory/patterns.md size cap', () => {
  test('file exists', () => {
    const stat = statSync(PATTERNS_PATH);
    expect(stat.isFile()).toBe(true);
  });

  test('stays under 8k chars', () => {
    const content = readFileSync(PATTERNS_PATH, 'utf8');
    expect(
      content.length,
      `patterns.md is ${content.length} chars (cap ${PATTERNS_CHAR_CAP}). ` +
        `Injected into every LLM iteration via loadLongTermMemoryMarkdown. ` +
        `Prune entries describing already-fixed problems (verify by code ` +
        `inspection), or compress verbose entries to 2-3 lines.`
    ).toBeLessThan(PATTERNS_CHAR_CAP);
  });

  test('stays under 120 lines', () => {
    const content = readFileSync(PATTERNS_PATH, 'utf8');
    const lines = content.split('\n').length;
    expect(lines).toBeLessThan(PATTERNS_LINE_CAP);
  });

  test('stays under 20 entries', () => {
    const entryCount = countEntries(PATTERNS_PATH);
    expect(
      entryCount,
      `patterns.md has ${entryCount} entries (cap ${PATTERNS_ENTRY_CAP}). ` +
        `Each entry = ~6 lines minimum. Prune fixed/historical entries ` +
        `before adding new ones.`
    ).toBeLessThan(PATTERNS_ENTRY_CAP);
  });
});

describe('.odysseus/memory/lessons.md size cap', () => {
  test('file exists', () => {
    const stat = statSync(LESSONS_PATH);
    expect(stat.isFile()).toBe(true);
  });

  test('stays under 5k chars', () => {
    const content = readFileSync(LESSONS_PATH, 'utf8');
    expect(
      content.length,
      `lessons.md is ${content.length} chars (cap ${LESSONS_CHAR_CAP}). ` +
        `Prune fixed/historical entries; compress verbose ones.`
    ).toBeLessThan(LESSONS_CHAR_CAP);
  });

  test('stays under 80 lines', () => {
    const content = readFileSync(LESSONS_PATH, 'utf8');
    const lines = content.split('\n').length;
    expect(lines).toBeLessThan(LESSONS_LINE_CAP);
  });

  test('stays under 15 entries', () => {
    const entryCount = countEntries(LESSONS_PATH);
    expect(entryCount).toBeLessThan(LESSONS_ENTRY_CAP);
  });
});

describe('memory entry format invariants', () => {
  test('every patterns.md entry has id + source metadata', () => {
    const content = readFileSync(PATTERNS_PATH, 'utf8');
    const entries = content.split(/^## /m).slice(1);
    for (const entry of entries) {
      const firstLines = entry.split('\n').slice(0, 4).join('\n');
      expect(firstLines, `Entry missing metadata:\n${firstLines}`).toMatch(/- \*\*id\*\*:/);
      expect(firstLines, `Entry missing source:\n${firstLines}`).toMatch(/- \*\*source\*\*:/);
    }
  });

  test('every lessons.md entry has id + source metadata', () => {
    const content = readFileSync(LESSONS_PATH, 'utf8');
    const entries = content.split(/^## /m).slice(1);
    for (const entry of entries) {
      const firstLines = entry.split('\n').slice(0, 4).join('\n');
      expect(firstLines, `Entry missing metadata:\n${firstLines}`).toMatch(/- \*\*id\*\*:/);
      expect(firstLines, `Entry missing source:\n${firstLines}`).toMatch(/- \*\*source\*\*:/);
    }
  });

  test('no duplicate entry IDs within patterns.md', () => {
    const content = readFileSync(PATTERNS_PATH, 'utf8');
    const ids = content.match(/- \*\*id\*\*: (mem_[a-f0-9]+)/g) ?? [];
    const idValues = ids.map((s) => s.replace(/- \*\*id\*\*: /, ''));
    expect(new Set(idValues).size, `Duplicate IDs: ${idValues}`).toBe(idValues.length);
  });

  test('no duplicate entry IDs within lessons.md', () => {
    const content = readFileSync(LESSONS_PATH, 'utf8');
    const ids = content.match(/- \*\*id\*\*: (mem_[a-f0-9]+)/g) ?? [];
    const idValues = ids.map((s) => s.replace(/- \*\*id\*\*: /, ''));
    expect(new Set(idValues).size, `Duplicate IDs: ${idValues}`).toBe(idValues.length);
  });
});
