import { describe, test, expect } from 'vitest';
import { buildUserPrompt } from '../../src/cerebellum/dreamer-prompt.js';
import type { DreamInput } from '../../src/cerebellum/dreamer-prompt.js';
import type { MemoryEntry } from '../../src/cerebellum/memory.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';
import type { LLMProvider } from '../../src/llm/provider.js';

/**
 * dreamer-prompt.ts — pure prompt builder for the dreamer phase.
 *
 * Iteration 47 extracted this from dreamer.ts. The function is pure
 * (no I/O, no LLM calls, no side effects) so it is ideal for direct
 * unit tests. Two-layer memory design is the load-bearing detail:
 *
 *   - Reflect entries → full-body injection (they carry diagnostic
 *     depth the dreamer should translate into backlogItems).
 *   - Non-reflect entries → title-only injection (pointers, not content).
 *
 * Until Iteration 62 the module had no dedicated test file — it was
 * exercised only through dreamer.test.ts end-to-end. The prompt
 * shape is what the LLM sees, so a silent regression in formatting
 * changes dreamer output quality without failing any existing test.
 */

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const stubProvider: LLMProvider = {
  async complete() {
    return { content: '', tokens: { input: 0, output: 0 } };
  },
};

function makeTrace(
  overrides: Partial<TraceRecord> = {},
): TraceRecord {
  return {
    waypoint_id: 'wp_test',
    voyage_id: 'voyage_test',
    ts: '2026-07-21T00:00:00.000Z',
    goal: 'test goal',
    strategy: 'engineer-bias-action',
    outcome: 'success',
    iterations_used: 1,
    tokens_consumed: { input: 100, output: 50 },
    ...overrides,
  } as TraceRecord;
}

function makeEntry(
  overrides: Partial<MemoryEntry> & { title: string; category: MemoryEntry['category']; source: MemoryEntry['source'] },
): MemoryEntry {
  return {
    id: 'mem_test',
    body: '',
    ts: '2026-07-21T00:00:00.000Z',
    ...overrides,
  };
}

function makeInput(overrides: Partial<DreamInput> = {}): DreamInput {
  return {
    rootDir: '/test',
    provider: stubProvider,
    recentTrace: [],
    memorySnapshot: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Recent trace rendering
// ---------------------------------------------------------------------------

describe('buildUserPrompt — recent trace rendering', () => {
  test('renders "(no recent waypoints)" when trace is empty', () => {
    const prompt = buildUserPrompt(makeInput({ recentTrace: [] }));
    expect(prompt).toContain('(no recent waypoints)');
  });

  test('renders each waypoint with [outcome] prefix', () => {
    const trace = [
      makeTrace({ goal: 'add retry', outcome: 'success' }),
      makeTrace({ goal: 'fix typo', outcome: 'failure' }),
    ];
    const prompt = buildUserPrompt(makeInput({ recentTrace: trace }));
    expect(prompt).toContain('[success] add retry');
    expect(prompt).toContain('[failure] fix typo');
  });

  test('caps at last 10 entries (older ones age out)', () => {
    const trace = Array.from({ length: 15 }, (_, i) =>
      makeTrace({ goal: `goal-${i}`, outcome: 'success' as const }),
    );
    const prompt = buildUserPrompt(makeInput({ recentTrace: trace }));
    expect(prompt).toContain('goal-5'); // 15-10=5, so goal-5 is the oldest kept
    expect(prompt).not.toContain('goal-4');
    expect(prompt).toContain('goal-14'); // most recent
  });

  test('appends fail_reason when present (truncated to 200 chars)', () => {
    const longReason = 'x'.repeat(300);
    const trace = [
      makeTrace({ goal: 'g', outcome: 'failure', fail_reason: longReason }),
    ];
    const prompt = buildUserPrompt(makeInput({ recentTrace: trace }));
    expect(prompt).toContain('— FAIL:');
    // Slice is 0..200 so the prompt contains 200 chars of x.
    expect(prompt).toContain('x'.repeat(200));
    expect(prompt).not.toContain('x'.repeat(201));
  });

  test('omits FAIL suffix when fail_reason is absent', () => {
    const trace = [
      makeTrace({ goal: 'g', outcome: 'failure', fail_reason: undefined }),
    ];
    const prompt = buildUserPrompt(makeInput({ recentTrace: trace }));
    expect(prompt).not.toContain('FAIL');
  });
});

// ---------------------------------------------------------------------------
// Memory rendering — empty state
// ---------------------------------------------------------------------------

describe('buildUserPrompt — empty memory state', () => {
  test('renders "(memory empty — fresh agent)" when no snapshots', () => {
    const prompt = buildUserPrompt(makeInput({ memorySnapshot: [] }));
    expect(prompt).toContain('(memory empty — fresh agent)');
  });

  test('renders "(memory empty)" when snapshots are present but all empty', () => {
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [
        { category: 'patterns', entries: [] },
      ],
    });
    expect(prompt).toContain('(memory empty — fresh agent)');
  });
});

// ---------------------------------------------------------------------------
// Memory rendering — non-reflect entries (title-only layer)
// ---------------------------------------------------------------------------

describe('buildUserPrompt — non-reflect memory (title-only)', () => {
  test('renders category header with count + title list', () => {
    const entry1 = makeEntry({
      title: 'Bias to action',
      category: 'patterns',
      source: 'user',
    });
    const entry2 = makeEntry({
      title: 'Prefer small diffs',
      category: 'patterns',
      source: 'user',
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [{ category: 'patterns', entries: [entry1, entry2] }],
    });
    expect(prompt).toContain('### patterns (2)');
    expect(prompt).toContain('- Bias to action');
    expect(prompt).toContain('- Prefer small diffs');
  });

  test('does NOT include body text for non-reflect entries', () => {
    const entry = makeEntry({
      title: 'Bias to action',
      category: 'patterns',
      source: 'user',
      body: 'Act, do not narrate. This is the diagnostic body.',
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [{ category: 'patterns', entries: [entry] }],
    });
    expect(prompt).not.toContain('Act, do not narrate');
  });

  test('renders "(no non-reflect memory yet)" when only reflect entries exist', () => {
    const entry = makeEntry({
      title: 'Systemic gap',
      category: 'patterns',
      source: 'reflect',
      body: 'Diagnostic body.',
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [{ category: 'patterns', entries: [entry] }],
    });
    expect(prompt).toContain('(no non-reflect memory yet — only diagnostic reflections present)');
  });
});

// ---------------------------------------------------------------------------
// Memory rendering — reflect entries (full-body layer)
// ---------------------------------------------------------------------------

describe('buildUserPrompt — reflect memory (full body)', () => {
  test('renders reflection block with title and body', () => {
    const entry = makeEntry({
      title: 'Systemic gap in retry logic',
      category: 'patterns',
      source: 'reflect',
      body: 'The retry mechanism does not distinguish transient vs permanent failures.',
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [{ category: 'patterns', entries: [entry] }],
    });
    expect(prompt).toContain('### [patterns] Systemic gap in retry logic');
    expect(prompt).toContain(
      'The retry mechanism does not distinguish transient vs permanent failures.',
    );
  });

  test('renders reflection block with relatedWaypointId when present', () => {
    const entry = makeEntry({
      title: 't',
      category: 'lessons',
      source: 'reflect',
      body: 'b',
      relatedWaypointId: 'wp_abc123',
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [{ category: 'lessons', entries: [entry] }],
    });
    expect(prompt).toContain('_(from wp_abc123)_');
  });

  test('omits related-waypoint marker when relatedWaypointId is absent', () => {
    const entry = makeEntry({
      title: 't',
      category: 'lessons',
      source: 'reflect',
      body: 'b',
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [{ category: 'lessons', entries: [entry] }],
    });
    expect(prompt).not.toContain('_(from ');
  });

  test('renders tags bracket when tags are present and non-empty', () => {
    const entry = makeEntry({
      title: 't',
      category: 'lessons',
      source: 'reflect',
      body: 'b',
      tags: ['retry', 'observability'],
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [{ category: 'lessons', entries: [entry] }],
    });
    expect(prompt).toContain('_[retry, observability]_');
  });

  test('omits tags bracket when tags are absent or empty', () => {
    const noTags = makeEntry({
      title: 't',
      category: 'lessons',
      source: 'reflect',
      body: 'b',
    });
    const emptyTags = makeEntry({
      title: 't2',
      category: 'lessons',
      source: 'reflect',
      body: 'b',
      tags: [],
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [
        { category: 'lessons', entries: [noTags, emptyTags] },
      ],
    });
    expect(prompt).not.toContain('_[');
  });

  test('separates multiple reflect entries with horizontal rule', () => {
    const e1 = makeEntry({
      title: 'first',
      category: 'lessons',
      source: 'reflect',
      body: 'body1',
    });
    const e2 = makeEntry({
      title: 'second',
      category: 'lessons',
      source: 'reflect',
      body: 'body2',
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [{ category: 'lessons', entries: [e1, e2] }],
    });
    expect(prompt).toContain('---');
  });

  test('renders "(no reflection entries)" when no reflect entries exist', () => {
    const entry = makeEntry({
      title: 'Pointer only',
      category: 'patterns',
      source: 'user',
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [{ category: 'patterns', entries: [entry] }],
    });
    expect(prompt).toContain('(no reflection entries — skip this section)');
  });
});

// ---------------------------------------------------------------------------
// Mixed-source snapshot
// ---------------------------------------------------------------------------

describe('buildUserPrompt — mixed-source snapshot', () => {
  test('splits entries by source within the same category', () => {
    const reflect = makeEntry({
      title: 'Systemic issue',
      category: 'patterns',
      source: 'reflect',
      body: 'Body that matters.',
    });
    const pointer = makeEntry({
      title: 'Quick pointer',
      category: 'patterns',
      source: 'user',
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [{ category: 'patterns', entries: [reflect, pointer] }],
    });

    // Non-reflect layer: title-only for "Quick pointer"
    expect(prompt).toContain('### patterns (1)');
    expect(prompt).toContain('- Quick pointer');

    // Reflect layer: full body for "Systemic issue"
    expect(prompt).toContain('### [patterns] Systemic issue');
    expect(prompt).toContain('Body that matters.');
  });

  test('reflect entries from multiple categories each get their own heading', () => {
    const reflect1 = makeEntry({
      title: 'R1',
      category: 'patterns',
      source: 'reflect',
      body: 'B1',
    });
    const reflect2 = makeEntry({
      title: 'R2',
      category: 'lessons',
      source: 'reflect',
      body: 'B2',
    });
    const prompt = buildUserPrompt({
      ...makeInput(),
      memorySnapshot: [
        { category: 'patterns', entries: [reflect1] },
        { category: 'lessons', entries: [reflect2] },
      ],
    });
    expect(prompt).toContain('### [patterns] R1');
    expect(prompt).toContain('### [lessons] R2');
  });
});

// ---------------------------------------------------------------------------
// Prompt skeleton — section headers are load-bearing
// ---------------------------------------------------------------------------

describe('buildUserPrompt — section skeleton', () => {
  test('always wraps output in <recent>, <memory>, <reflection> tags', () => {
    const prompt = buildUserPrompt(makeInput());
    expect(prompt).toContain('<recent>');
    expect(prompt).toContain('</recent>');
    expect(prompt).toContain('<memory>');
    expect(prompt).toContain('</memory>');
    expect(prompt).toContain('<reflection>');
    expect(prompt).toContain('</reflection>');
  });

  test('ends with the call-to-action directive', () => {
    const prompt = buildUserPrompt(makeInput());
    expect(prompt.trim().endsWith('Return JSON.')).toBe(true);
    expect(prompt).toContain('Reflect.');
    expect(prompt).toContain('Surface what wants to be done next.');
  });
});
