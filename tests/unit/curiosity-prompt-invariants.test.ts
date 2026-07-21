import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, LLMCompletion } from '../../src/llm/provider.js';
import {
  buildCuriosityUserPrompt,
  loadSelfModelForCuriosity,
} from '../../src/cerebellum/curiosity-prompt.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';
import type { MemoryCategory } from '../../src/orchestrator/events.js';
import type { MemoryEntry } from '../../src/cerebellum/memory.js';

/**
 * buildCuriosityUserPrompt — structural composition contract.
 *
 * curiosity.test.ts covers behavior — whether proposals become backlog items,
 * whether memory entries persist, whether env vars gate curiosity (30+ tests).
 * It pins the PRESENCE of XML-like block tags but NOT the load-bearing
 * structural invariants of the prompt:
 *
 *   - Block ORDERING. The LLM reads top-to-bottom. self-model must come
 *     before recent because "who I aspire to be" frames "what I just did".
 *     Recent before memory because immediate history outranks older
 *     abstractions. Explorations last because they're cross-voyage context
 *     — the most distant signal.
 *
 *   - Empty-state placeholders. Each block has a specific placeholder string
 *     when its input is empty. These are prompts to the LLM, not just
 *     whitespace — they tell it WHY the block is empty and shape its output.
 *     A refactor that replaces these with empty strings or different
 *     wording would silently change LLM behavior.
 *
 *   - Trace slicing to last 10. Older waypoints are dropped to keep the
 *     prompt within token budget. The slice happens BEFORE format, so a
 *     refactor that reverses the order would put the OLDER records in the
 *     prompt and drop recent ones — silently breaking recency bias.
 *
 *   - Fail-reason truncation at 200 chars. Long fail_reason strings would
 *     blow up the prompt. The 200-char cap is documented but not pinned.
 *     A refactor that changes this boundary silently changes what failure
 *     context the LLM sees.
 *
 *   - Memory block rendering: "### category (count)\n  - title". The three-
 *     space indent and the count annotation are cues the LLM uses to weigh
 *     categories. Drift here is silent.
 *
 *   - The closing question: exact wording "What is the smallest concrete
 *     step toward one of your aspirations? Return JSON." A "helpful"
 *     refactor that rephrases this would change what kind of proposals
 *     the LLM emits — they'd drift from "smallest concrete step" toward
 *     larger, vaguer goals.
 *
 * Each test below pins one slice of the prompt contract.
 */

function staticProvider(): LLMProvider {
  return {
    async complete(): Promise<LLMCompletion> {
      return {
        content: '',
        model: 'mock',
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: 'stop',
      };
    },
    async *stream() {
      yield '';
    },
    getModel() {
      return 'mock';
    },
  };
}

const SAMPLE_SELF_MODEL = `# Self-Model — Odysseus

## Aspirations (gaps to close)

1. **Continuous self-monitor.** A lightweight inline critic.
`;

describe('buildCuriosityUserPrompt — block ordering', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-curio-ord-'));
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('four XML-like blocks appear in fixed order: self-model → recent → memory → explorations', async () => {
    // The LLM reads the prompt top-to-bottom. The ordering is load-bearing:
    //   - self-model FIRST (aspirations frame everything that follows)
    //   - recent NEXT (immediate history, the freshest signal)
    //   - memory NEXT (older abstractions, categories of patterns)
    //   - explorations LAST (cross-voyage proposals, most distant)
    // A refactor that reorders the blocks would silently re-prioritize
    // what the LLM attends to.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    const selfIdx = prompt.indexOf('<self-model>');
    const recentIdx = prompt.indexOf('<recent>');
    const memoryIdx = prompt.indexOf('<memory>');
    const explorationsIdx = prompt.indexOf('<explorations>');
    expect(selfIdx).toBeGreaterThanOrEqual(0);
    expect(recentIdx).toBeGreaterThan(selfIdx);
    expect(memoryIdx).toBeGreaterThan(recentIdx);
    expect(explorationsIdx).toBeGreaterThan(memoryIdx);
  });

  test('closing question is the LAST line — comes after </explorations>', async () => {
    // The prompt ends with "What is the smallest concrete step..." The LLM
    // uses this as its emission trigger. If anything appears after the
    // question (e.g. a footer or another tag), the LLM might confuse it
    // for part of the task.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    const questionIdx = prompt.indexOf(
      'What is the smallest concrete step toward one of your aspirations?',
    );
    const feedbackCloseIdx = prompt.indexOf('</feedback>');
    expect(questionIdx).toBeGreaterThan(feedbackCloseIdx);
    // Nothing after the question — it's the final line (possibly with
    // trailing whitespace, but no more content).
    const afterQuestion = prompt.slice(questionIdx);
    // The question text ends with "Return JSON." — that's the last content.
    expect(afterQuestion.trim().endsWith('Return JSON.')).toBe(true);
  });

  test('blocks are separated by exactly one blank line (\\n\\n)', async () => {
    // The visual cue for "new block" is a blank line between tags. More
    // whitespace would dilute the structure; less would make blocks run
    // together. Pinning the exact separator count so a refactor that
    // changes the template literal spacing is caught.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    // Between closing tag and next opening tag: "</tag>\n\n<next>"
    const blockBoundaries = prompt.match(/<\/[a-z-]+>\n\n<[a-z-]+>/g);
    expect(blockBoundaries).not.toBeNull();
    expect(blockBoundaries!.length).toBe(4); // 5 blocks → 4 boundaries
  });

  test('every block has matching opening and closing tags', async () => {
    // Each block must have a paired closing tag. A refactor that drops
    // the closing tag would produce malformed-looking XML and confuse
    // the LLM about block boundaries.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(prompt.match(/<self-model>/g)?.length).toBe(1);
    expect(prompt.match(/<\/self-model>/g)?.length).toBe(1);
    expect(prompt.match(/<recent>/g)?.length).toBe(1);
    expect(prompt.match(/<\/recent>/g)?.length).toBe(1);
    expect(prompt.match(/<memory>/g)?.length).toBe(1);
    expect(prompt.match(/<\/memory>/g)?.length).toBe(1);
    expect(prompt.match(/<explorations>/g)?.length).toBe(1);
    expect(prompt.match(/<\/explorations>/g)?.length).toBe(1);
    expect(prompt.match(/<feedback>/g)?.length).toBe(1);
    expect(prompt.match(/<\/feedback>/g)?.length).toBe(1);
  });
});

describe('buildCuriosityUserPrompt — empty-state placeholders', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-curio-empty-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('missing self-model → exact placeholder string in <self-model>', async () => {
    // The placeholder is a prompt to the LLM — it says "no aspirations to
    // explore" AND tells it what to do ("Return empty arrays."). A
    // refactor that shortens this (e.g. "(self-model missing)") would
    // drop the instruction, and the LLM might hallucinate aspirations.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(prompt).toContain(
      '(self-model missing — no aspirations to explore. Return empty arrays.)',
    );
  });

  test('whitespace-only self-model → same placeholder as missing', async () => {
    // loadSelfModelForCuriosity trims and treats zero-length-after-trim as
    // missing. Pinning that the placeholder fires for whitespace too —
    // a refactor that treats whitespace as "present but empty" would
    // inject an empty <self-model> block with no placeholder, leaving
    // the LLM with no instruction about what to do.
    await writeFile(join(rootDir, 'self-model.md'), '   \n\t  \n');
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(prompt).toContain(
      '(self-model missing — no aspirations to explore. Return empty arrays.)',
    );
  });

  test('empty recentTrace → "(no recent waypoints)" in <recent>', async () => {
    // Empty trace means no immediate history. The placeholder tells the
    // LLM "you haven't done anything recently" rather than leaving the
    // block visually empty.
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(prompt).toContain('(no recent waypoints)');
  });

  test('empty memorySnapshot → "(memory empty — fresh agent)" in <memory>', async () => {
    // Empty memory means the agent is fresh. The placeholder tells the
    // LLM this is a fresh start — no prior patterns/lessons to apply.
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(prompt).toContain('(memory empty — fresh agent)');
  });

  test('memorySnapshot with all-empty entries → same placeholder as empty snapshot', async () => {
    // A snapshot with categories but no entries is functionally empty.
    // The block filters out empty categories and falls back to the
    // placeholder. A refactor that renders empty categories as headers
    // would clutter the prompt with "(0)" annotations.
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [
        { category: 'patterns', entries: [] },
        { category: 'lessons', entries: [] },
      ],
    });
    expect(prompt).toContain('(memory empty — fresh agent)');
    expect(prompt).not.toContain('### patterns');
    expect(prompt).not.toContain('### lessons');
  });

  test('no explorations.jsonl → "(no prior explorations — fresh curiosity memory)"', async () => {
    // Explorations is the cross-voyage audit trail. When empty (no file
    // or no records), the placeholder fires. The wording — "fresh
    // curiosity memory" — tells the LLM this is the FIRST curiosity pass.
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(prompt).toContain(
      '(no prior explorations — fresh curiosity memory)',
    );
  });
});

describe('buildCuriosityUserPrompt — trace slicing and formatting', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-curio-trace-'));
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('only the last 10 trace records appear in <recent>', async () => {
    // slice(-10) keeps the 10 most recent records. Older ones are dropped.
    // Pinning this boundary: a refactor that drops the slice would blow
    // up the prompt for long voyages; one that changes to slice(0, 10)
    // would show the OLDEST 10, breaking recency bias.
    //
    // NOTE: matching with the "- [success] " prefix and trailing "\n"
    // because goal-1 is a substring of goal-10, goal-11, etc. The full
    // record line is the unambiguous unit.
    const records: TraceRecord[] = [];
    for (let i = 0; i < 15; i++) {
      records.push({
        waypoint_id: `wp_${i}`,
        goal: `goal-${i}`,
        outcome: 'success',
        ts: `2026-07-${10 + i}T00:00:00Z`,
      });
    }
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: records,
      memorySnapshot: [],
    });
    // goals 5-14 (last 10) should appear; goals 0-4 should NOT.
    for (let i = 5; i < 15; i++) {
      expect(prompt).toContain(`- [success] goal-${i}\n`);
    }
    for (let i = 0; i < 5; i++) {
      expect(prompt).not.toContain(`- [success] goal-${i}\n`);
    }
  });

  test('exactly 10 records → all 10 appear (boundary)', async () => {
    // The slice(-10) boundary: 10 records → no drop. 11 records → drop 1.
    // Pinning the boundary so a refactor that changes to slice(-9) or
    // slice(-11) is caught.
    const records: TraceRecord[] = [];
    for (let i = 0; i < 10; i++) {
      records.push({
        waypoint_id: `wp_${i}`,
        goal: `goal-${i}`,
        outcome: 'success',
        ts: `2026-07-${10 + i}T00:00:00Z`,
      });
    }
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: records,
      memorySnapshot: [],
    });
    for (let i = 0; i < 10; i++) {
      expect(prompt).toContain(`goal-${i}`);
    }
  });

  test('trace record renders as "- [outcome] goal" with no fail_reason for success', async () => {
    // The format is `- [${outcome}] ${goal}` + optional ` — FAIL: ${reason}`.
    // Pinning the literal hyphen-space-bracket-outcome-bracket-space-goal
    // prefix so a refactor that changes spacing or markers is caught.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [
        {
          waypoint_id: 'wp_1',
          goal: 'add retry logic',
          outcome: 'success',
          ts: '2026-07-15T00:00:00Z',
        },
      ],
      memorySnapshot: [],
    });
    expect(prompt).toContain('- [success] add retry logic');
    // No fail_reason → no " — FAIL:" annotation.
    expect(prompt).not.toContain(' — FAIL:');
  });

  test('failed trace record renders fail_reason after " — FAIL: "', async () => {
    // fail_reason is rendered as ` — FAIL: ${reason}`. The em-dash-space-
    // FAIL-colon-space prefix is the marker. A refactor that changes this
    // marker would break downstream regex parsing of the prompt.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [
        {
          waypoint_id: 'wp_1',
          goal: 'fix the bug',
          outcome: 'failure',
          fail_reason: 'tsc returned exit code 1',
          ts: '2026-07-15T00:00:00Z',
        },
      ],
      memorySnapshot: [],
    });
    expect(prompt).toContain('- [failure] fix the bug — FAIL: tsc returned exit code 1');
  });

  test('fail_reason longer than 200 chars is truncated to exactly 200', async () => {
    // slice(0, 200) caps fail_reason at 200 chars to prevent prompt bloat.
    // The cap is documented in the source but not previously pinned. A
    // refactor that changes this to 100 or 500 would silently change
    // what failure context the LLM sees.
    const longReason = 'X'.repeat(500);
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [
        {
          waypoint_id: 'wp_1',
          goal: 'fail big',
          outcome: 'failure',
          fail_reason: longReason,
          ts: '2026-07-15T00:00:00Z',
        },
      ],
      memorySnapshot: [],
    });
    // Exactly 200 X's after " — FAIL: ".
    const match = prompt.match(/— FAIL: (X+)/);
    expect(match).not.toBeNull();
    expect(match![1].length).toBe(200);
  });

  test('fail_reason exactly 200 chars is NOT truncated (boundary)', async () => {
    // The boundary: 200 chars stays as-is. 201 chars → truncated to 200.
    // Pinning the boundary so a refactor that uses < instead of <= is caught.
    const exactReason = 'Y'.repeat(200);
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [
        {
          waypoint_id: 'wp_1',
          goal: 'boundary',
          outcome: 'failure',
          fail_reason: exactReason,
          ts: '2026-07-15T00:00:00Z',
        },
      ],
      memorySnapshot: [],
    });
    const match = prompt.match(/— FAIL: (Y+)/);
    expect(match).not.toBeNull();
    expect(match![1].length).toBe(200);
  });

  test('fail_reason of 201 chars is truncated to 200 (boundary upper)', async () => {
    // Just-over-boundary. Confirms slice(0, 200) not slice(0, 201).
    const overReason = 'Z'.repeat(201);
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [
        {
          waypoint_id: 'wp_1',
          goal: 'over boundary',
          outcome: 'failure',
          fail_reason: overReason,
          ts: '2026-07-15T00:00:00Z',
        },
      ],
      memorySnapshot: [],
    });
    const match = prompt.match(/— FAIL: (Z+)/);
    expect(match).not.toBeNull();
    expect(match![1].length).toBe(200);
  });

  test('multiple trace records are joined with newline (not comma or space)', async () => {
    // The join separator is '\n'. A refactor that switches to ', ' would
    // collapse the visual hierarchy and make the list harder to scan.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [
        { waypoint_id: 'wp_1', goal: 'first', outcome: 'success', ts: '2026-07-10T00:00:00Z' },
        { waypoint_id: 'wp_2', goal: 'second', outcome: 'failure', fail_reason: 'oops', ts: '2026-07-11T00:00:00Z' },
      ],
      memorySnapshot: [],
    });
    // Between the two records: "- [success] first\n- [failure] second — FAIL: oops"
    expect(prompt).toContain('- [success] first\n- [failure] second — FAIL: oops');
  });
});

describe('buildCuriosityUserPrompt — memory block rendering', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-curio-mem-'));
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  function memEntry(category: MemoryCategory, title: string): MemoryEntry {
    return {
      id: `mem_${title.slice(0, 8)}`,
      category,
      title,
      source: 'dream',
      body: 'body placeholder',
      ts: '2026-07-15T00:00:00Z',
    };
  }

  test('memory category renders as "### <category> (<count>)" header', async () => {
    // The header format is "### category (count)". The triple-hash is
    // markdown H3. The parenthesized count lets the LLM gauge how many
    // entries a category has — useful for weighting attention.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [
        {
          category: 'patterns',
          entries: [memEntry('patterns', 'append-only trace')],
        },
      ],
    });
    expect(prompt).toContain('### patterns (1)');
    expect(prompt).toContain('- append-only trace');
  });

  test('multiple entries in one category → each on its own line with "  - " prefix', async () => {
    // Each entry title is rendered as "  - title" (two spaces, hyphen,
    // space). The two-space indent visually nests under the ### header.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [
        {
          category: 'patterns',
          entries: [
            memEntry('patterns', 'first pattern'),
            memEntry('patterns', 'second pattern'),
            memEntry('patterns', 'third pattern'),
          ],
        },
      ],
    });
    expect(prompt).toContain('### patterns (3)');
    expect(prompt).toContain('  - first pattern\n  - second pattern\n  - third pattern');
  });

  test('multiple categories are separated by blank line (\\n\\n)', async () => {
    // Categories are joined with '\n\n' to create visual separation.
    // A refactor that joins with '\n' would collapse them into one block.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [
        {
          category: 'patterns',
          entries: [memEntry('patterns', 'pattern A')],
        },
        {
          category: 'lessons',
          entries: [memEntry('lessons', 'lesson B')],
        },
      ],
    });
    expect(prompt).toContain('### patterns (1)\n  - pattern A\n\n### lessons (1)\n  - lesson B');
  });

  test('entry body is NOT rendered — only title', async () => {
    // Only the title appears in the prompt, not the body. Bodies can be
    // long and would bloat the prompt. Pinning that bodies stay out
    // so a refactor that "helpfully" includes them is caught.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [
        {
          category: 'patterns',
          entries: [memEntry('patterns', 'visible title')],
        },
      ],
    });
    expect(prompt).toContain('visible title');
    expect(prompt).not.toContain('body placeholder');
  });

  test('empty category within a non-empty snapshot is skipped (not rendered as "(0)")', async () => {
    // A snapshot may have categories with zero entries. Those should NOT
    // render as "### category (0)" — they'd clutter the prompt. The
    // filter(Boolean) after .map drops them.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [
        { category: 'patterns', entries: [memEntry('patterns', 'real pattern')] },
        { category: 'lessons', entries: [] },
      ],
    });
    expect(prompt).toContain('### patterns (1)');
    expect(prompt).not.toContain('### lessons');
    expect(prompt).not.toContain('(0)');
  });
});

describe('buildCuriosityUserPrompt — self-model content', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-curio-sm-'));
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('self-model content is rendered verbatim inside <self-model> block', async () => {
    // The self-model markdown is injected as-is, no transformation.
    // Markdown headers (#, ##), bold (**), lists (1.) all pass through.
    // The LLM parses this as context — drift would change its reading.
    const content = '# Identity\n\nI am **Odysseus**, an agent.\n';
    await writeFile(join(rootDir, 'self-model.md'), content);
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(prompt).toContain(`<self-model>\n${content}</self-model>`);
  });

  test('self-model is trimmed (leading/trailing whitespace removed)', async () => {
    // loadSelfModelForCuriosity trims the file content. A file with
    // trailing blank lines should not produce trailing blank lines
    // inside the <self-model> block (which would shift the closing tag).
    await writeFile(join(rootDir, 'self-model.md'), 'CONTENT\n\n\n');
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(prompt).toContain('<self-model>\nCONTENT\n</self-model>');
    // No triple-newline inside the block (would mean trim didn't run).
    expect(prompt).not.toContain('CONTENT\n\n\n');
  });

  test('self-model read errors fall back to placeholder (best-effort)', async () => {
    // loadSelfModelForCuriosity wraps readFileSync in try/catch. Any
    // error (ENOENT, permissions) returns ''. The placeholder then fires.
    // Pinning that read errors do NOT throw — curiosity must degrade
    // gracefully when self-model is inaccessible.
    // No file written — read will throw ENOENT.
    const direct = loadSelfModelForCuriosity(rootDir);
    expect(direct).toBe('');
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(prompt).toContain(
      '(self-model missing — no aspirations to explore. Return empty arrays.)',
    );
  });
});

describe('buildCuriosityUserPrompt — determinism and purity', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-curio-det-'));
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('two consecutive calls produce identical output', async () => {
    // The function is pure (given the same inputs, same output). Pinning
    // determinism so a refactor that adds non-determinism (e.g. a
    // Date.now() timestamp in the prompt) is flagged. The LLM's
    // proposal quality depends on prompt stability.
    const input = {
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    };
    const first = buildCuriosityUserPrompt(input);
    const second = buildCuriosityUserPrompt(input);
    expect(first).toBe(second);
  });

  test('prompt reflects file changes between calls (no caching)', async () => {
    // loadSelfModelForCuriosity reads fresh on every call — no internal
    // cache. This is load-bearing: the operator may edit self-model
    // between curiosity passes. A refactor that adds memoization would
    // silently break self-model hot-reload.
    await writeFile(join(rootDir, 'self-model.md'), 'VERSION_1');
    const v1 = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(v1).toContain('VERSION_1');

    await writeFile(join(rootDir, 'self-model.md'), 'VERSION_2');
    const v2 = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(v2).toContain('VERSION_2');
    expect(v2).not.toContain('VERSION_1');
  });
});

describe('buildCuriosityUserPrompt — closing question exact text', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-curio-q-'));
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  test('closing question is verbatim "What is the smallest concrete step..."', async () => {
    // The exact question is a load-bearing contract:
    //   - "smallest" pushes the LLM toward granular, actionable proposals
    //     (not "refactor everything").
    //   - "concrete step" rules out abstract aspirations.
    //   - "toward one of your aspirations" ties back to the self-model.
    //   - "Return JSON" is the format instruction.
    // A refactor that rephrases this (e.g. "What should I work on next?")
    // would silently change the kind of proposals the LLM emits.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    expect(prompt).toContain(
      'What is the smallest concrete step toward one of your aspirations? Return JSON.',
    );
  });

  test('closing question appears EXACTLY ONCE (not duplicated)', async () => {
    // A refactor that accidentally concatenates the question twice (e.g.
    // by appending it in two places) would confuse the LLM. Pinning
    // the exact occurrence count.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(),
      recentTrace: [],
      memorySnapshot: [],
    });
    const occurrences = (
      prompt.match(
        /What is the smallest concrete step toward one of your aspirations\? Return JSON\./g,
      ) ?? []
    ).length;
    expect(occurrences).toBe(1);
  });
});
