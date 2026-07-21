import { describe, test, expect } from 'vitest';
import {
  serializeEntry,
  splitSections,
  parseEntry,
  type ParsedSection,
} from '../../src/cerebellum/memory-parse.js';
import type { MemoryEntry } from '../../src/cerebellum/memory.js';

/**
 * memory-parse — structural invariants for markdown (de)serialization.
 *
 * memory-parse.test.ts covers behavior (serialize, parse, round-trip
 * on typical inputs). This file pins the STRUCTURAL contracts a
 * refactor could silently break:
 *
 *   - HEADER FORMAT: `## [${ts}] ${title}` — the ts is bracketed,
 *     title follows after a single space. parseEntry's regex anchors
 *     on this exact shape.
 *
 *   - TITLE NEWLINE FLATTENING: serializeEntry replaces `\n` with ' '
 *     in titles. A round-trip loses embedded newlines — pinning that
 *     data-loss as deliberate (newlines in headers break markdown).
 *
 *   - META LINE FORMAT: `- **id**: ${id}` (literal asterisks). The
 *     regex in parseEntry matches this exact form. Drift would break
 *     round-trip.
 *
 *   - OPTIONAL META LINES: tags and related are emitted ONLY when
 *     present (exactOptionalPropertyTypes style).
 *
 *   - BODY TRIM: serializeEntry trims body; parseEntry trims body.
 *     Round-trip loses leading/trailing whitespace.
 *
 *   - SECTION DETECTION: only `## ` (exactly 2 hashes + space) starts
 *     a section. `# `, `### `, `#### ` do NOT.
 *
 *   - PRELUDE SKIP: content before the first `## ` is dropped.
 *
 *   - PARSE TOLERANCE: corrupt/missing fields return null, not throw.
 *
 *   - HEADER REGEX: `/^\[(?<ts>[^\]]+)\]\s*(?<title>.+)$/`. The ts
 *     group is everything up to the first `]`, the title is the rest.
 *
 *   - BODY SPLIT: `indexOf('\n\n')` — first blank line after metadata.
 *
 *   - TAGS SPLIT: comma-separated, trimmed, filtered for empty.
 *
 * Each test pins one slice.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: 'mem_001',
    category: 'patterns',
    title: 'Default title',
    source: 'reflect',
    body: 'Default body content.',
    ts: '2026-07-21T10:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// serializeEntry — header line format
// ---------------------------------------------------------------------------

describe('serializeEntry — header line format', () => {
  test('header is `## [${ts}] ${title}`', () => {
    const md = serializeEntry(makeEntry({ ts: '2026-01-01', title: 'Hello' }));
    const firstLine = md.split('\n')[0]!;
    expect(firstLine).toBe('## [2026-01-01] Hello');
  });

  test('header starts with exactly `## ` (two hashes + space)', () => {
    const md = serializeEntry(makeEntry());
    expect(md.startsWith('## ')).toBe(true);
    expect(md.startsWith('### ')).toBe(false);
    expect(md.startsWith('# ')).toBe(false);
  });

  test('ts is enclosed in square brackets', () => {
    const md = serializeEntry(makeEntry({ ts: 'TS_VALUE' }));
    expect(md).toContain('[TS_VALUE]');
  });

  test('title follows `] ` (bracket-space)', () => {
    const md = serializeEntry(makeEntry({ title: 'My Title' }));
    expect(md).toContain('] My Title');
  });

  test('title with special characters is preserved', () => {
    const md = serializeEntry(makeEntry({ title: 'Fix bug #42 in `parser.ts`' }));
    expect(md).toContain('## [TS_VALUE] Fix bug #42 in `parser.ts`'.replace('TS_VALUE', '2026-07-21T10:00:00Z'));
  });
});

// ---------------------------------------------------------------------------
// serializeEntry — title newline flattening
// ---------------------------------------------------------------------------

describe('serializeEntry — title newline flattening', () => {
  test('single \\n in title becomes space', () => {
    const md = serializeEntry(makeEntry({ title: 'line1\nline2' }));
    expect(md).toContain('## [');
    expect(md).toContain('line1 line2');
    expect(md).not.toContain('line1\nline2');
  });

  test('multiple \\n in title become spaces', () => {
    const md = serializeEntry(makeEntry({ title: 'a\nb\nc\nd' }));
    expect(md).toContain('a b c d');
  });

  test('\\n at start/end of title gets trimmed (trim runs after replace)', () => {
    const md = serializeEntry(makeEntry({ title: '\nhello\n' }));
    // replace \n → ' ', then trim. '\nhello\n' → ' hello ' → 'hello'.
    const firstLine = md.split('\n')[0]!;
    expect(firstLine).toBe('## [2026-07-21T10:00:00Z] hello');
  });

  test('title with only newlines becomes empty after flatten + trim', () => {
    const md = serializeEntry(makeEntry({ title: '\n\n\n' }));
    const firstLine = md.split('\n')[0]!;
    // title = '' after flatten+trim
    expect(firstLine).toBe('## [2026-07-21T10:00:00Z] ');
  });
});

// ---------------------------------------------------------------------------
// serializeEntry — meta lines (id, source)
// ---------------------------------------------------------------------------

describe('serializeEntry — meta line format', () => {
  test('includes `- **id**: ${id}` on line 2', () => {
    const md = serializeEntry(makeEntry({ id: 'mem_xyz' }));
    const lines = md.split('\n');
    expect(lines[1]).toBe('- **id**: mem_xyz');
  });

  test('includes `- **source**: ${source}` on line 3', () => {
    const md = serializeEntry(makeEntry({ source: 'dream' }));
    const lines = md.split('\n');
    expect(lines[2]).toBe('- **source**: dream');
  });

  test('meta line uses literal double-asterisk for bold', () => {
    const md = serializeEntry(makeEntry());
    expect(md).toContain('**id**');
    expect(md).toContain('**source**');
  });

  test('id meta is always present (required field)', () => {
    const md = serializeEntry(makeEntry());
    expect(md).toMatch(/- \*\*id\*\*: \S+/);
  });

  test('source meta is always present (required field)', () => {
    const md = serializeEntry(makeEntry());
    expect(md).toMatch(/- \*\*source\*\*: \S+/);
  });
});

// ---------------------------------------------------------------------------
// serializeEntry — optional meta lines (tags, related)
// ---------------------------------------------------------------------------

describe('serializeEntry — optional meta lines', () => {
  test('tags emitted when present and non-empty', () => {
    const md = serializeEntry(makeEntry({ tags: ['bug', 'urgent'] }));
    expect(md).toContain('- **tags**: bug, urgent');
  });

  test('tags NOT emitted when undefined', () => {
    const md = serializeEntry(makeEntry({ tags: undefined }));
    expect(md).not.toContain('**tags**');
  });

  test('tags NOT emitted when empty array', () => {
    const md = serializeEntry(makeEntry({ tags: [] }));
    expect(md).not.toContain('**tags**');
  });

  test('tags single-element has no comma', () => {
    const md = serializeEntry(makeEntry({ tags: ['solo'] }));
    expect(md).toContain('- **tags**: solo');
    expect(md).not.toContain('solo,');
  });

  test('tags multiple elements joined by `, ` (comma + space)', () => {
    const md = serializeEntry(makeEntry({ tags: ['a', 'b', 'c'] }));
    expect(md).toContain('- **tags**: a, b, c');
  });

  test('related emitted when present (truthy)', () => {
    const md = serializeEntry(makeEntry({ relatedWaypointId: 'wp_abc' }));
    expect(md).toContain('- **related**: wp_abc');
  });

  test('related NOT emitted when undefined', () => {
    const md = serializeEntry(makeEntry({ relatedWaypointId: undefined }));
    expect(md).not.toContain('**related**');
  });

  test('related NOT emitted when empty string', () => {
    // The check is `if (entry.relatedWaypointId)` — empty string is falsy.
    const md = serializeEntry(makeEntry({ relatedWaypointId: '' }));
    expect(md).not.toContain('**related**');
  });

  test('meta block order: id, source, tags, related', () => {
    const md = serializeEntry(
      makeEntry({ tags: ['t'], relatedWaypointId: 'wp_x' }),
    );
    const lines = md.split('\n');
    const idIdx = lines.findIndex((l) => l.includes('**id**'));
    const sourceIdx = lines.findIndex((l) => l.includes('**source**'));
    const tagsIdx = lines.findIndex((l) => l.includes('**tags**'));
    const relatedIdx = lines.findIndex((l) => l.includes('**related**'));
    expect(idIdx).toBeLessThan(sourceIdx);
    expect(sourceIdx).toBeLessThan(tagsIdx);
    expect(tagsIdx).toBeLessThan(relatedIdx);
  });
});

// ---------------------------------------------------------------------------
// serializeEntry — body section
// ---------------------------------------------------------------------------

describe('serializeEntry — body section', () => {
  test('body is separated from meta by blank line', () => {
    const md = serializeEntry(makeEntry({ body: 'My body text.' }));
    expect(md).toContain('\n\nMy body text.');
  });

  test('body is trimmed (leading/trailing whitespace stripped)', () => {
    const md = serializeEntry(makeEntry({ body: '  \n  hello world  \n  ' }));
    expect(md).toContain('\n\nhello world\n');
    expect(md).not.toContain('  hello world');
  });

  test('body with embedded blank lines preserves them', () => {
    const md = serializeEntry(makeEntry({ body: 'para1\n\npara2' }));
    expect(md).toContain('para1\n\npara2');
  });

  test('body with markdown content is preserved verbatim', () => {
    const body = '## Subsection\n- bullet\n- another';
    const md = serializeEntry(makeEntry({ body }));
    expect(md).toContain(body);
  });

  test('output ends with a single newline', () => {
    const md = serializeEntry(makeEntry());
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  test('empty body becomes empty line after trim', () => {
    const md = serializeEntry(makeEntry({ body: '   ' }));
    // trim removes all whitespace, body becomes ''
    expect(md).toContain('\n\n\n');
  });
});

// ---------------------------------------------------------------------------
// splitSections — section detection
// ---------------------------------------------------------------------------

describe('splitSections — section detection rules', () => {
  test('empty markdown → empty array', () => {
    expect(splitSections('')).toEqual([]);
  });

  test('whitespace-only markdown → empty array', () => {
    expect(splitSections('   \n\n  ')).toEqual([]);
  });

  test('markdown with no `## ` → empty array', () => {
    expect(splitSections('just text\nno headers')).toEqual([]);
  });

  test('single `## ` section → array of 1', () => {
    const md = '## header\nbody';
    const sections = splitSections(md);
    expect(sections.length).toBe(1);
  });

  test('multiple `## ` sections → array of N', () => {
    const md = '## a\nbody1\n\n## b\nbody2\n\n## c\nbody3';
    expect(splitSections(md).length).toBe(3);
  });

  test('`# ` (single hash) does NOT start a section', () => {
    const md = '# H1 title\nbody';
    expect(splitSections(md)).toEqual([]);
  });

  test('`### ` (three hashes) does NOT start a section', () => {
    const md = '### H3 title\nbody';
    expect(splitSections(md)).toEqual([]);
  });

  test('`#### ` (four hashes) does NOT start a section', () => {
    const md = '#### H4 title\nbody';
    expect(splitSections(md)).toEqual([]);
  });

  test('`##` without trailing space does NOT start a section', () => {
    // `##noSpace` is not recognized — needs `## ` with the space.
    const md = '##noSpace\nbody';
    expect(splitSections(md)).toEqual([]);
  });

  test('content before first `## ` is dropped (prelude)', () => {
    const md = 'prelude line 1\nprelude line 2\n## real\nbody';
    const sections = splitSections(md);
    expect(sections.length).toBe(1);
    expect(sections[0]!.header).toBe('real');
  });

  test('section header is the text AFTER `## ` (slice(3))', () => {
    const md = '## my header text\nbody';
    const sections = splitSections(md);
    expect(sections[0]!.header).toBe('my header text');
  });

  test('consecutive `## ` lines create empty-body sections', () => {
    const md = '## a\n## b\n## c';
    const sections = splitSections(md);
    expect(sections.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// splitSections — body content and indices
// ---------------------------------------------------------------------------

describe('splitSections — body and indices', () => {
  test('section body INCLUDES the header line', () => {
    const md = '## header\nbody line';
    const sections = splitSections(md);
    expect(sections[0]!.body).toContain('## header');
    expect(sections[0]!.body).toContain('body line');
  });

  test('section body ends at the next `## ` line (exclusive)', () => {
    const md = '## a\nbody1\n## b\nbody2';
    const sections = splitSections(md);
    expect(sections[0]!.body).toBe('## a\nbody1');
  });

  test('last section body extends to end of input', () => {
    const md = '## a\nbody1\nbody2';
    const sections = splitSections(md);
    expect(sections[0]!.body).toBe('## a\nbody1\nbody2');
  });

  test('startIndex points to the `## ` line index', () => {
    const md = 'prelude\n## header\nbody';
    const sections = splitSections(md);
    // prelude is line 0, header is line 1.
    expect(sections[0]!.startIndex).toBe(1);
  });

  test('endIndex points to the next section start (exclusive)', () => {
    const md = '## a\nbody1\n## b\nbody2';
    const sections = splitSections(md);
    // line 0: ## a, line 1: body1, line 2: ## b, line 3: body2.
    expect(sections[0]!.startIndex).toBe(0);
    expect(sections[0]!.endIndex).toBe(2);
  });

  test('last section endIndex === total line count', () => {
    const md = '## a\nbody1\nbody2';
    const sections = splitSections(md);
    const totalLines = md.split('\n').length;
    expect(sections[0]!.endIndex).toBe(totalLines);
  });

  test('ParsedSection has exactly 4 keys: header, body, startIndex, endIndex', () => {
    const md = '## header\nbody';
    const sections = splitSections(md);
    expect(Object.keys(sections[0]!).sort()).toEqual(
      ['header', 'body', 'startIndex', 'endIndex'].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// parseEntry — header regex
// ---------------------------------------------------------------------------

describe('parseEntry — header regex', () => {
  test('header `[ts] title` → parses ts and title', () => {
    const md = serializeEntry(makeEntry({ ts: '2026-01-01', title: 'Hello' }));
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns');
    expect(entry?.ts).toBe('2026-01-01');
    expect(entry?.title).toBe('Hello');
  });

  test('header with extra whitespace between ] and title is tolerated (\\s*)', () => {
    // Manually craft a section with extra space.
    const md = '## [2026-01-01]    Hello\n- **id**: mem_1\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns');
    expect(entry?.title).toBe('Hello');
  });

  test('header without brackets → returns null', () => {
    // header is just "title" (no `[ts]` prefix).
    const md = '## just a title\n- **id**: mem_1\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')).toBeNull();
  });

  test('header with empty ts `[] title` → null (regex `[^\]]+` requires 1+ char)', () => {
    // The ts group `[^\]]+` requires at least one non-`]` character.
    // `[] Hello`: after `[`, the next char is `]` → `[^\]]+` fails →
    // no match → parseEntry returns null.
    const md = '## [] Hello\n- **id**: mem_1\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')).toBeNull();
  });

  test('header with only whitespace after ts `[ts] ` → parses with empty title (regex backtracks)', () => {
    // Header `[2026-01-01] ` (trailing space). The regex `\s*(?<title>.+)$`
    // looks like it requires non-empty title, but `\s*` BACKTRACKS so `.+`
    // can match the single space. Title becomes ` `, then `.trim()` → `''`.
    // This pins the backtrack behavior — it is NOT rejected.
    const md = '## [2026-01-01] \n- **id**: mem_1\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns');
    expect(entry).not.toBeNull();
    expect(entry?.ts).toBe('2026-01-01');
    expect(entry?.title).toBe('');
  });

  test('header with ts containing brackets: ts stops at first `]`, title is the remainder', () => {
    // `[2026]07] Hello` — `[^\]]+` is greedy but stops at first `]`.
    // ts = '2026', then `\]` consumes the `]`, `\s*` matches empty,
    // `(?<title>.+)$` matches '07] Hello'. The leading `]` of ']07]' is
    // ALREADY consumed as the delimiter — it does NOT appear in title.
    const md = '## [2026]07] Hello\n- **id**: mem_1\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns');
    expect(entry?.ts).toBe('2026');
    expect(entry?.title).toBe('07] Hello');
  });
});

// ---------------------------------------------------------------------------
// parseEntry — meta line regex
// ---------------------------------------------------------------------------

describe('parseEntry — meta line regex patterns', () => {
  test('parses id from `- **id**: ${id}`', () => {
    const md = '## [ts] title\n- **id**: mem_42\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.id).toBe('mem_42');
  });

  test('id regex captures only non-whitespace (\\S+)', () => {
    const md = '## [ts] title\n- **id**: mem with spaces\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.id).toBe('mem');
  });

  test('source regex captures only non-whitespace (\\S+)', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect extra\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.source).toBe('reflect');
  });

  test('missing id → returns null', () => {
    const md = '## [ts] title\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')).toBeNull();
  });

  test('missing source → returns null', () => {
    const md = '## [ts] title\n- **id**: mem\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')).toBeNull();
  });

  test('missing both id and source → returns null', () => {
    const md = '## [ts] title\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')).toBeNull();
  });

  test('tags regex captures until end of line ([^\\n]+)', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n- **tags**: a, b, c\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.tags).toEqual(['a', 'b', 'c']);
  });

  test('related regex captures only non-whitespace', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n- **related**: wp_abc def\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.relatedWaypointId).toBe('wp_abc');
  });

  test('id regex requires `- **id**: ` prefix (literal)', () => {
    // If the prefix is wrong (e.g. `- *id*: `), id is not found.
    const md = '## [ts] title\n- *id*: mem\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')).toBeNull();
  });

  test('source regex requires `- **source**: ` prefix', () => {
    const md = '## [ts] title\n- **id**: mem\n- *source*: reflect\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseEntry — body extraction
// ---------------------------------------------------------------------------

describe('parseEntry — body extraction', () => {
  test('body is content after `\\n\\n` separator', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n\nthis is the body';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.body).toBe('this is the body');
  });

  test('body is trimmed after extraction', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n\n  trimmed body  ';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.body).toBe('trimmed body');
  });

  test('body with multiple paragraphs preserves blank lines', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n\npara1\n\npara2';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.body).toBe('para1\n\npara2');
  });

  test('no `\\n\\n` separator → body is empty string', () => {
    // Meta block runs to end of section without blank line.
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.body).toBe('');
  });

  test('first `\\n\\n` is the separator (not later ones)', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n\nbody para1\n\nbody para2';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.body).toBe('body para1\n\nbody para2');
  });
});

// ---------------------------------------------------------------------------
// parseEntry — tags parsing
// ---------------------------------------------------------------------------

describe('parseEntry — tags splitting', () => {
  test('tags split by comma', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n- **tags**: a,b,c\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.tags).toEqual(['a', 'b', 'c']);
  });

  test('tags trimmed individually', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n- **tags**: a , b , c\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.tags).toEqual(['a', 'b', 'c']);
  });

  test('empty tags between commas filtered out', () => {
    // 'a,,b' → ['a', '', 'b'] → filter(Boolean) → ['a', 'b']
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n- **tags**: a,,b\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.tags).toEqual(['a', 'b']);
  });

  test('single tag → array of 1', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n- **tags**: solo\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.tags).toEqual(['solo']);
  });

  test('tags field absent → tags property ABSENT (exactOptionalPropertyTypes)', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns')!;
    expect('tags' in entry).toBe(false);
    expect(entry.tags).toBeUndefined();
  });

  test('tags with trailing comma filters trailing empty', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n- **tags**: a, b,\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.tags).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// parseEntry — related handling
// ---------------------------------------------------------------------------

describe('parseEntry — relatedWaypointId optionality', () => {
  test('related field absent → relatedWaypointId ABSENT', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns')!;
    expect('relatedWaypointId' in entry).toBe(false);
    expect(entry.relatedWaypointId).toBeUndefined();
  });

  test('related field present → relatedWaypointId set', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n- **related**: wp_123\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns')!;
    expect(entry.relatedWaypointId).toBe('wp_123');
    expect('relatedWaypointId' in entry).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseEntry — category assignment
// ---------------------------------------------------------------------------

describe('parseEntry — category passthrough', () => {
  test('category from argument is set on entry', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'lessons')?.category).toBe('lessons');
    expect(parseEntry(section!, 'patterns')?.category).toBe('patterns');
    expect(parseEntry(section!, 'preferences')?.category).toBe('preferences');
    expect(parseEntry(section!, 'dreams')?.category).toBe('dreams');
  });

  test('category is NOT parsed from the body (always from argument)', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'lessons')!;
    expect(entry.category).toBe('lessons');
  });
});

// ---------------------------------------------------------------------------
// parseEntry — output shape
// ---------------------------------------------------------------------------

describe('parseEntry — output shape', () => {
  test('entry has exactly 6 required keys (no tags/related)', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns')!;
    expect(Object.keys(entry).sort()).toEqual(
      ['id', 'category', 'title', 'source', 'body', 'ts'].sort(),
    );
  });

  test('entry with tags has 7 keys', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n- **tags**: a\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns')!;
    expect(Object.keys(entry).length).toBe(7);
  });

  test('entry with related has 7 keys', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n- **related**: wp_x\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns')!;
    expect(Object.keys(entry).length).toBe(7);
  });

  test('entry with tags AND related has 8 keys', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n- **tags**: a\n- **related**: wp_x\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns')!;
    expect(Object.keys(entry).length).toBe(8);
  });

  test('source is cast to MemorySource (string)', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: dream\n\nbody';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns')!;
    expect(typeof entry.source).toBe('string');
    expect(entry.source).toBe('dream');
  });
});

// ---------------------------------------------------------------------------
// Round-trip fidelity
// ---------------------------------------------------------------------------

describe('round-trip — serializeEntry → splitSections → parseEntry', () => {
  test('minimal entry round-trips exactly', () => {
    const original = makeEntry();
    const md = serializeEntry(original);
    const [section] = splitSections(md);
    const parsed = parseEntry(section!, original.category);
    expect(parsed).toEqual(original);
  });

  test('entry with tags round-trips', () => {
    const original = makeEntry({ tags: ['a', 'b', 'c'] });
    const md = serializeEntry(original);
    const [section] = splitSections(md);
    const parsed = parseEntry(section!, original.category);
    expect(parsed).toEqual(original);
  });

  test('entry with related round-trips', () => {
    const original = makeEntry({ relatedWaypointId: 'wp_xyz' });
    const md = serializeEntry(original);
    const [section] = splitSections(md);
    const parsed = parseEntry(section!, original.category);
    expect(parsed).toEqual(original);
  });

  test('entry with tags AND related round-trips', () => {
    const original = makeEntry({
      tags: ['x', 'y'],
      relatedWaypointId: 'wp_xyz',
    });
    const md = serializeEntry(original);
    const [section] = splitSections(md);
    const parsed = parseEntry(section!, original.category);
    expect(parsed).toEqual(original);
  });

  test('title with newline DOES NOT round-trip (deliberate data loss)', () => {
    // serializeEntry replaces \n with ' '. Round-trip yields flattened title.
    const original = makeEntry({ title: 'line1\nline2' });
    const md = serializeEntry(original);
    const [section] = splitSections(md);
    const parsed = parseEntry(section!, original.category);
    expect(parsed?.title).toBe('line1 line2'); // flattened, not 'line1\nline2'
    expect(parsed?.title).not.toBe(original.title);
  });

  test('body with leading/trailing whitespace DOES NOT round-trip exactly', () => {
    // Both serialize and parse trim body.
    const original = makeEntry({ body: '  \nhello\n  ' });
    const md = serializeEntry(original);
    const [section] = splitSections(md);
    const parsed = parseEntry(section!, original.category);
    expect(parsed?.body).toBe('hello'); // trimmed
    expect(parsed?.body).not.toBe(original.body);
  });

  test('multiple entries in same markdown round-trip independently', () => {
    const a = makeEntry({ id: 'mem_a', title: 'A' });
    const b = makeEntry({ id: 'mem_b', title: 'B', ts: '2026-01-02' });
    const md = serializeEntry(a) + serializeEntry(b);
    const sections = splitSections(md);
    expect(sections.length).toBe(2);
    const parsedA = parseEntry(sections[0]!, a.category);
    const parsedB = parseEntry(sections[1]!, b.category);
    expect(parsedA?.id).toBe('mem_a');
    expect(parsedB?.id).toBe('mem_b');
    expect(parsedB?.ts).toBe('2026-01-02');
  });

  test('round-trip preserves all 4 valid MemoryCategory values', () => {
    for (const cat of ['patterns', 'lessons', 'preferences', 'dreams'] as const) {
      const original = makeEntry({ category: cat });
      const md = serializeEntry(original);
      const [section] = splitSections(md);
      const parsed = parseEntry(section!, cat);
      expect(parsed?.category).toBe(cat);
    }
  });
});

// ---------------------------------------------------------------------------
// Purity
// ---------------------------------------------------------------------------

describe('purity — functions do not mutate input', () => {
  test('serializeEntry does not mutate its input entry', () => {
    const entry = makeEntry({ tags: ['x'] });
    const snapshot = { ...entry, tags: [...entry.tags!] };
    serializeEntry(entry);
    expect(entry).toEqual(snapshot);
  });

  test('serializeEntry is pure (same input → same output)', () => {
    const entry = makeEntry();
    const a = serializeEntry(entry);
    const b = serializeEntry(entry);
    expect(a).toBe(b);
  });

  test('splitSections is pure (same input → same output)', () => {
    const md = '## a\nbody';
    const a = splitSections(md);
    const b = splitSections(md);
    expect(a).toEqual(b);
  });

  test('splitSections does not mutate its input string (immutable anyway)', () => {
    const md = '## a\nbody';
    const original = md;
    splitSections(md);
    expect(md).toBe(original);
  });

  test('parseEntry is pure (same input → same output)', () => {
    const md = serializeEntry(makeEntry());
    const [section] = splitSections(md);
    const a = parseEntry(section!, 'patterns');
    const b = parseEntry(section!, 'patterns');
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Adversarial inputs
// ---------------------------------------------------------------------------

describe('adversarial inputs — tolerance', () => {
  test('completely empty body → parseEntry handles gracefully', () => {
    const md = '## [ts] title\n- **id**: mem\n- **source**: reflect\n\n';
    const [section] = splitSections(md);
    const entry = parseEntry(section!, 'patterns');
    expect(entry).not.toBeNull();
    expect(entry?.body).toBe('');
  });

  test('malformed header (no brackets) → null', () => {
    const md = '## no brackets here\n- **id**: mem\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')).toBeNull();
  });

  test('section with body but no meta → null', () => {
    const md = '## [ts] title\nbody without meta';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')).toBeNull();
  });

  test('section with only id (no source) → null', () => {
    const md = '## [ts] title\n- **id**: mem\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')).toBeNull();
  });

  test('section with only source (no id) → null', () => {
    const md = '## [ts] title\n- **source**: reflect\n\nbody';
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')).toBeNull();
  });

  test('unicode in title is preserved', () => {
    const md = serializeEntry(makeEntry({ title: '你好世界' }));
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.title).toBe('你好世界');
  });

  test('unicode in body is preserved', () => {
    const md = serializeEntry(makeEntry({ body: '你好\n世界' }));
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.body).toBe('你好\n世界');
  });

  test('very long title is preserved', () => {
    const longTitle = 'a'.repeat(500);
    const md = serializeEntry(makeEntry({ title: longTitle }));
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.title).toBe(longTitle);
  });

  test('very long body is preserved', () => {
    const longBody = 'b'.repeat(1000);
    const md = serializeEntry(makeEntry({ body: longBody }));
    const [section] = splitSections(md);
    expect(parseEntry(section!, 'patterns')?.body).toBe(longBody);
  });
});
