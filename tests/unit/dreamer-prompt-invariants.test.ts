/**
 * Invariants for src/cerebellum/dreamer-prompt.ts.
 *
 * The existing dreamer-prompt.test.ts covers behavior: empty trace,
 * empty memory, title-only layer, reflect full-body layer, mixed-source
 * snapshot, prompt skeleton. This file pins the load-bearing structural
 * contracts that the behavioral tests imply:
 *
 *   - DreamInput type shape: required vs optional fields
 *   - buildUserPrompt is a PURE function: same input → identical output
 *   - buildUserPrompt does NOT touch provider/rootDir (pure builder)
 *   - slice(-10) hard cap: 10 entries kept, 11th ages out
 *   - slice(0, 200) hard cap on fail_reason
 *   - Prompt section ordering: <recent> → <memory> → <reflection> → directive
 *   - Exact section delimiter templates (load-bearing for LLM parsing)
 *   - Category header template `### ${category} (${count})`
 *   - Reflect header template `### [${category}] ${title}${rel}${tags}`
 *   - Reflect block separator `\n\n---\n\n`
 *   - Three empty-state branches (total empty vs reflect-only vs non-reflect-only)
 *   - source partition is binary: 'reflect' vs everything-else
 *
 * The two-layer memory split is the most load-bearing architectural
 * decision in the dreamer prompt — it's what makes reflective memory
 * actually feed back into the agent's roadmap. Pinning the partition
 * contract ensures a future "unify the layers" refactor surfaces
 * explicitly.
 */

import { describe, test, expect } from 'vitest';
import { buildUserPrompt } from '../../src/cerebellum/dreamer-prompt.js';
import type { DreamInput } from '../../src/cerebellum/dreamer-prompt.js';
import type { MemoryEntry } from '../../src/cerebellum/memory.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';
import type { LLMProvider } from '../../src/llm/provider.js';

const stubProvider: LLMProvider = {
  async complete() {
    return { content: '', tokens: { input: 0, output: 0 } };
  },
};

function makeTrace(overrides: Partial<TraceRecord> = {}): TraceRecord {
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
  overrides: Partial<MemoryEntry> & {
    title: string;
    category: MemoryEntry['category'];
    source: MemoryEntry['source'];
  },
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

describe('dreamer-prompt invariants', () => {
  // -------------------------------------------------------------------------
  // DreamInput type shape
  // -------------------------------------------------------------------------

  describe('DreamInput type shape', () => {
    test('rootDir, provider, recentTrace, memorySnapshot are required', () => {
      // Type-level: TypeScript enforces presence. Runtime: verify they
      // survive on a minimal input.
      const input: DreamInput = {
        rootDir: '/test',
        provider: stubProvider,
        recentTrace: [],
        memorySnapshot: [],
      };
      expect(input.rootDir).toBe('/test');
      expect(input.provider).toBe(stubProvider);
      expect(input.recentTrace).toEqual([]);
      expect(input.memorySnapshot).toEqual([]);
    });

    test('maxBacklogItems and maxMemoryEntries are optional', () => {
      const input: DreamInput = {
        rootDir: '/test',
        provider: stubProvider,
        recentTrace: [],
        memorySnapshot: [],
      };
      // Field is omitted entirely (exactOptionalPropertyTypes).
      expect(input.maxBacklogItems).toBeUndefined();
      expect(input.maxMemoryEntries).toBeUndefined();
      expect('maxBacklogItems' in input).toBe(false);
      expect('maxMemoryEntries' in input).toBe(false);
    });

    test('recentTrace is a readonly array', () => {
      const input: DreamInput = {
        rootDir: '/test',
        provider: stubProvider,
        recentTrace: [makeTrace()],
        memorySnapshot: [],
      };
      expect(Array.isArray(input.recentTrace)).toBe(true);
    });

    test('memorySnapshot is a ReadonlyArray of {category, entries}', () => {
      const input: DreamInput = {
        rootDir: '/test',
        provider: stubProvider,
        recentTrace: [],
        memorySnapshot: [
          { category: 'patterns', entries: [] },
          { category: 'lessons', entries: [] },
        ],
      };
      expect(Array.isArray(input.memorySnapshot)).toBe(true);
      expect(input.memorySnapshot[0]!.category).toBe('patterns');
      expect(Array.isArray(input.memorySnapshot[0]!.entries)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Purity — same input always gives same output
  // -------------------------------------------------------------------------

  describe('buildUserPrompt purity', () => {
    test('two calls with identical input produce identical output', () => {
      const input = makeInput({
        recentTrace: [makeTrace({ goal: 'g1' }), makeTrace({ goal: 'g2' })],
        memorySnapshot: [
          {
            category: 'patterns',
            entries: [
              makeEntry({ title: 't1', category: 'patterns', source: 'user', body: 'b1' }),
            ],
          },
        ],
      });
      const a = buildUserPrompt(input);
      const b = buildUserPrompt(input);
      expect(a).toBe(b);
    });

    test('output does not change between invocations (deterministic)', () => {
      const input = makeInput({
        recentTrace: Array.from({ length: 5 }, (_, i) =>
          makeTrace({ goal: `g${i}` }),
        ),
      });
      const outputs = new Set<string>();
      for (let i = 0; i < 10; i++) {
        outputs.add(buildUserPrompt(input));
      }
      expect(outputs.size).toBe(1);
    });

    test('buildUserPrompt does NOT touch provider (pure builder)', () => {
      // The function signature accepts provider but buildUserPrompt
      // itself never calls it — the caller (dreamer.ts) does. Verify
      // by passing a provider that would throw if called.
      const throwingProvider: LLMProvider = {
        async complete() {
          throw new Error('provider should not be called by buildUserPrompt');
        },
      };
      const input = makeInput({ provider: throwingProvider });
      expect(() => buildUserPrompt(input)).not.toThrow();
    });

    test('buildUserPrompt does NOT touch rootDir (pure builder)', () => {
      // rootDir is for the caller's I/O; buildUserPrompt never reads
      // the filesystem. Pass a bogus path and verify no error.
      const input = makeInput({ rootDir: '/nonexistent/path/xyz' });
      expect(() => buildUserPrompt(input)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // slice(-10) hard cap on recentTrace
  // -------------------------------------------------------------------------

  describe('slice(-10) hard cap', () => {
    test('exactly 10 entries: all rendered', () => {
      const trace = Array.from({ length: 10 }, (_, i) =>
        makeTrace({ goal: `goal-${i}` }),
      );
      const prompt = buildUserPrompt(makeInput({ recentTrace: trace }));
      for (let i = 0; i < 10; i++) {
        expect(prompt).toContain(`goal-${i}`);
      }
    });

    test('exactly 11 entries: oldest is dropped', () => {
      const trace = Array.from({ length: 11 }, (_, i) =>
        makeTrace({ goal: `goal-${i}` }),
      );
      const prompt = buildUserPrompt(makeInput({ recentTrace: trace }));
      expect(prompt).not.toContain('goal-0');
      for (let i = 1; i < 11; i++) {
        expect(prompt).toContain(`goal-${i}`);
      }
    });

    test('cap is exactly 10 (not 9 or 11)', () => {
      // Generate 20, verify exactly the 10 most-recent survive.
      const trace = Array.from({ length: 20 }, (_, i) =>
        makeTrace({ goal: `goal-${i}` }),
      );
      const prompt = buildUserPrompt(makeInput({ recentTrace: trace }));
      // goal-10..goal-19 survive (10 items). goal-0..goal-9 dropped.
      // Use line-boundary regex to avoid substring false matches
      // (e.g. "goal-1" is a substring of "goal-10").
      for (let i = 0; i < 10; i++) {
        expect(prompt).not.toMatch(new RegExp(`\\bgoal-${i}\\b`));
      }
      for (let i = 10; i < 20; i++) {
        expect(prompt).toMatch(new RegExp(`\\bgoal-${i}\\b`));
      }
    });
  });

  // -------------------------------------------------------------------------
  // fail_reason slice(0, 200) hard cap
  // -------------------------------------------------------------------------

  describe('fail_reason slice(0, 200) hard cap', () => {
    test('fail_reason of exactly 200 chars: rendered in full', () => {
      const reason = 'x'.repeat(200);
      const trace = [makeTrace({ goal: 'g', outcome: 'failure', fail_reason: reason })];
      const prompt = buildUserPrompt(makeInput({ recentTrace: trace }));
      expect(prompt).toContain('x'.repeat(200));
    });

    test('fail_reason of 201 chars: truncated to 200', () => {
      const reason = 'x'.repeat(201);
      const trace = [makeTrace({ goal: 'g', outcome: 'failure', fail_reason: reason })];
      const prompt = buildUserPrompt(makeInput({ recentTrace: trace }));
      expect(prompt).toContain('x'.repeat(200));
      expect(prompt).not.toContain('x'.repeat(201));
    });

    test('fail_reason truncation uses slice(0, 200) (no ellipsis)', () => {
      // Pin that truncation is a hard cut, not a "… [truncated]" suffix.
      const reason = 'y'.repeat(300);
      const trace = [makeTrace({ goal: 'g', outcome: 'failure', fail_reason: reason })];
      const prompt = buildUserPrompt(makeInput({ recentTrace: trace }));
      expect(prompt).not.toContain('…');
      expect(prompt).not.toContain('[truncated]');
      expect(prompt).not.toContain('...');
    });
  });

  // -------------------------------------------------------------------------
  // Prompt section ordering
  // -------------------------------------------------------------------------

  describe('prompt section ordering', () => {
    test('sections appear in fixed order: recent → memory → reflection → directive', () => {
      const prompt = buildUserPrompt(makeInput());
      const recentIdx = prompt.indexOf('<recent>');
      const memoryIdx = prompt.indexOf('<memory>');
      const reflectionIdx = prompt.indexOf('<reflection>');
      const directiveIdx = prompt.indexOf('Reflect.');
      expect(recentIdx).toBeLessThan(memoryIdx);
      expect(memoryIdx).toBeLessThan(reflectionIdx);
      expect(reflectionIdx).toBeLessThan(directiveIdx);
    });

    test('sections are separated by exactly one blank line', () => {
      const prompt = buildUserPrompt(makeInput());
      // Between </recent> and <memory>: exactly one blank line (\n\n).
      expect(prompt).toContain('</recent>\n\n<memory>');
      expect(prompt).toContain('</memory>\n\n<reflection>');
      // After </reflection>: exactly one blank line before directive.
      expect(prompt).toContain('</reflection>\n\nReflect.');
    });

    test('prompt ends with the full directive sentence', () => {
      const prompt = buildUserPrompt(makeInput());
      // Trailing newline may or may not be present; trim before check.
      const trimmed = prompt.trim();
      expect(trimmed.endsWith('Return JSON.')).toBe(true);
    });

    test('directive is exactly "Reflect. Surface what wants to be done next. Return JSON."', () => {
      const prompt = buildUserPrompt(makeInput());
      // Load-bearing: the LLM is instructed to return JSON; changing
      // this sentence changes what the LLM emits.
      expect(prompt).toContain(
        'Reflect. Surface what wants to be done next. Return JSON.',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Exact template strings — load-bearing for LLM parsing
  // -------------------------------------------------------------------------

  describe('exact template strings', () => {
    test('memory category header is exactly `### ${category} (${count})`', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'patterns',
            entries: [
              makeEntry({ title: 't1', category: 'patterns', source: 'user' }),
              makeEntry({ title: 't2', category: 'patterns', source: 'user' }),
              makeEntry({ title: 't3', category: 'patterns', source: 'user' }),
            ],
          },
        ],
      });
      expect(prompt).toContain('### patterns (3)');
    });

    test('reflect header is exactly `### [${category}] ${title}`', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'lessons',
            entries: [
              makeEntry({
                title: 'Specific Title',
                category: 'lessons',
                source: 'reflect',
                body: 'b',
              }),
            ],
          },
        ],
      });
      expect(prompt).toContain('### [lessons] Specific Title');
    });

    test('reflect entries joined with exactly `\\n\\n---\\n\\n`', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'lessons',
            entries: [
              makeEntry({ title: 'first', category: 'lessons', source: 'reflect', body: 'b1' }),
              makeEntry({ title: 'second', category: 'lessons', source: 'reflect', body: 'b2' }),
            ],
          },
        ],
      });
      expect(prompt).toContain('---');
      // Verify the exact separator by checking the surrounding context.
      const sep = '\n\n---\n\n';
      expect(prompt.includes(sep)).toBe(true);
    });

    test('related-waypoint marker is exactly ` _(from ${id})_`', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'lessons',
            entries: [
              makeEntry({
                title: 't',
                category: 'lessons',
                source: 'reflect',
                body: 'b',
                relatedWaypointId: 'wp_xyz',
              }),
            ],
          },
        ],
      });
      expect(prompt).toContain('_(from wp_xyz)_');
    });

    test('tags marker is exactly ` _[${tags.join(", ")}]_`', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'lessons',
            entries: [
              makeEntry({
                title: 't',
                category: 'lessons',
                source: 'reflect',
                body: 'b',
                tags: ['alpha', 'beta'],
              }),
            ],
          },
        ],
      });
      expect(prompt).toContain('_[alpha, beta]_');
    });

    test('non-reflect entry rendered as `  - ${title}` (two-space indent, hyphen)', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'patterns',
            entries: [
              makeEntry({ title: 'My Title', category: 'patterns', source: 'user' }),
            ],
          },
        ],
      });
      expect(prompt).toContain('\n  - My Title');
    });
  });

  // -------------------------------------------------------------------------
  // Three empty-state branches
  // -------------------------------------------------------------------------

  describe('three empty-state branches', () => {
    test('branch A: total empty → "(memory empty — fresh agent)"', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [],
      });
      expect(prompt).toContain('(memory empty — fresh agent)');
    });

    test('branch A: empty entries within snapshot → still "(memory empty — fresh agent)"', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [{ category: 'patterns', entries: [] }],
      });
      expect(prompt).toContain('(memory empty — fresh agent)');
    });

    test('branch B: only reflect entries → "(no non-reflect memory yet...)"', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'patterns',
            entries: [
              makeEntry({
                title: 'reflect-only',
                category: 'patterns',
                source: 'reflect',
                body: 'b',
              }),
            ],
          },
        ],
      });
      expect(prompt).toContain(
        '(no non-reflect memory yet — only diagnostic reflections present)',
      );
      // The reflect block is still rendered.
      expect(prompt).toContain('### [patterns] reflect-only');
    });

    test('branch C: only non-reflect entries → "(no reflection entries — skip this section)"', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'patterns',
            entries: [
              makeEntry({
                title: 'pointer',
                category: 'patterns',
                source: 'user',
              }),
            ],
          },
        ],
      });
      expect(prompt).toContain('(no reflection entries — skip this section)');
      // The non-reflect block is still rendered.
      expect(prompt).toContain('### patterns (1)');
    });

    test('branch D (mixed): neither empty-state message appears', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'patterns',
            entries: [
              makeEntry({ title: 'p', category: 'patterns', source: 'user' }),
              makeEntry({
                title: 'r',
                category: 'patterns',
                source: 'reflect',
                body: 'b',
              }),
            ],
          },
        ],
      });
      expect(prompt).not.toContain('(memory empty');
      expect(prompt).not.toContain('(no non-reflect memory yet');
      expect(prompt).not.toContain('(no reflection entries');
    });
  });

  // -------------------------------------------------------------------------
  // Source partition — binary: 'reflect' vs everything else
  // -------------------------------------------------------------------------

  describe('source partition (reflect vs non-reflect)', () => {
    test('every MemoryEntry source other than "reflect" goes to the title-only layer', () => {
      // MemoryEntry has a fixed union of sources. Verify each non-reflect
      // variant lands in the non-reflect bucket.
      const sources = ['dream', 'user', 'failure', 'system'] as const;
      for (const source of sources) {
        const prompt = buildUserPrompt({
          ...makeInput(),
          memorySnapshot: [
            {
              category: 'patterns',
              entries: [
                makeEntry({
                  title: `entry-${source}`,
                  category: 'patterns',
                  source: source as MemoryEntry['source'],
                  body: 'should-not-appear-in-full-body',
                }),
              ],
            },
          ],
        });
        expect(prompt).toContain(`- entry-${source}`);
        // The body must NOT be rendered (title-only layer).
        expect(prompt).not.toContain('should-not-appear-in-full-body');
      }
    });

    test('source="reflect" entries go to the full-body layer (not title-only)', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'patterns',
            entries: [
              makeEntry({
                title: 'r-entry',
                category: 'patterns',
                source: 'reflect',
                body: 'diagnostic-body',
              }),
            ],
          },
        ],
      });
      // The reflect block contains the title AND body.
      expect(prompt).toContain('### [patterns] r-entry');
      expect(prompt).toContain('diagnostic-body');
      // The non-reflect layer must NOT contain a category header for
      // this entry (since all entries in this snapshot are reflect).
      expect(prompt).not.toContain('### patterns (1)');
    });

    test('mixed sources within same category: both layers show the category', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'patterns',
            entries: [
              makeEntry({ title: 'pointer', category: 'patterns', source: 'user' }),
              makeEntry({
                title: 'reflect',
                category: 'patterns',
                source: 'reflect',
                body: 'reflect-body',
              }),
            ],
          },
        ],
      });
      // Non-reflect layer shows count 1 (just the user entry).
      expect(prompt).toContain('### patterns (1)');
      // Reflect layer shows the [patterns] header.
      expect(prompt).toContain('### [patterns] reflect');
    });
  });

  // -------------------------------------------------------------------------
  // Count correctness in non-reflect header
  // -------------------------------------------------------------------------

  describe('count correctness', () => {
    test('count reflects only non-reflect entries in that category', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'patterns',
            entries: [
              makeEntry({ title: 'u1', category: 'patterns', source: 'user' }),
              makeEntry({ title: 'u2', category: 'patterns', source: 'user' }),
              makeEntry({
                title: 'r1',
                category: 'patterns',
                source: 'reflect',
                body: 'b',
              }),
            ],
          },
        ],
      });
      // Non-reflect layer: 2 (u1 + u2). Reflect entry is in the reflect block.
      expect(prompt).toContain('### patterns (2)');
    });

    test('multiple categories each get their own header with own count', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        memorySnapshot: [
          {
            category: 'patterns',
            entries: [
              makeEntry({ title: 'p', category: 'patterns', source: 'user' }),
            ],
          },
          {
            category: 'lessons',
            entries: [
              makeEntry({ title: 'l1', category: 'lessons', source: 'user' }),
              makeEntry({ title: 'l2', category: 'lessons', source: 'user' }),
            ],
          },
        ],
      });
      expect(prompt).toContain('### patterns (1)');
      expect(prompt).toContain('### lessons (2)');
    });
  });

  // -------------------------------------------------------------------------
  // recentTrace rendering format
  // -------------------------------------------------------------------------

  describe('recentTrace rendering format', () => {
    test('each entry rendered as `- [${outcome}] ${goal}`', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        recentTrace: [
          makeTrace({ goal: 'goal-A', outcome: 'success' }),
          makeTrace({ goal: 'goal-B', outcome: 'failure' }),
        ],
      });
      expect(prompt).toContain('- [success] goal-A');
      expect(prompt).toContain('- [failure] goal-B');
    });

    test('entries joined with newline (no blank line between)', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        recentTrace: [
          makeTrace({ goal: 'g1' }),
          makeTrace({ goal: 'g2' }),
        ],
      });
      // Two adjacent lines, no blank line between.
      expect(prompt).toContain('- [success] g1\n- [success] g2');
    });

    test('FAIL suffix is exactly ` — FAIL: ${truncated_reason}` (em-dash + space)', () => {
      const prompt = buildUserPrompt({
        ...makeInput(),
        recentTrace: [
          makeTrace({ goal: 'g', outcome: 'failure', fail_reason: 'reason text' }),
        ],
      });
      // Verify the em-dash + space separator.
      expect(prompt).toContain('g — FAIL: reason text');
    });
  });

  // -------------------------------------------------------------------------
  // Output is a non-empty string
  // -------------------------------------------------------------------------

  describe('output sanity', () => {
    test('output is always a non-empty string', () => {
      const prompt = buildUserPrompt(makeInput());
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(0);
    });

    test('output contains all three section tags even for empty input', () => {
      const prompt = buildUserPrompt(makeInput());
      expect(prompt).toContain('<recent>');
      expect(prompt).toContain('</recent>');
      expect(prompt).toContain('<memory>');
      expect(prompt).toContain('</memory>');
      expect(prompt).toContain('<reflection>');
      expect(prompt).toContain('</reflection>');
    });
  });
});
