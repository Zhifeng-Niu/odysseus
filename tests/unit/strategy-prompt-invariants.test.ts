import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildEngineerSystemPrompt,
  loadSelfModel,
  loadLongTermMemoryMarkdown,
} from '../../src/cerebellum/strategy-prompt.js';
import { ENGINEER_BASE_PROMPT } from '../../src/cerebellum/prompts.js';
import { appendTrace } from '../../src/trace/jsonl.js';

/**
 * buildEngineerSystemPrompt — four-layer composition contract.
 *
 * cerebellum-strategy.test.ts covers the individual loaders
 * (loadSelfModel, loadLongTermMemoryMarkdown) and the extraction
 * invariant (strategy.ts re-exports vs re-defines). It does NOT pin the
 * COMPOSITION contract of buildEngineerSystemPrompt:
 *
 *   - Section ordering: SELF-MODEL → LONG-TERM MEMORY → VOYAGE LOG →
 *     ENGINEER ORIENTATION. The order is load-bearing because the LLM
 *     reads top-to-bottom and the engineer orientation must come last
 *     (closest to the task) for the action-bias rules to land.
 *
 *   - Section headers: each layer has a specific header string (e.g.
 *     "# SELF-MODEL (read at waypoint start — your persistent sense of
 *     self)"). Downstream prompt-invariant tests rely on these headers
 *     being grep-able. A refactor that shortens or rephrases a header
 *     would silently break those tests.
 *
 *   - Separator: layers are joined with '\n\n---\n\n'. The horizontal
 *     rule is a visual signal to the LLM that a new section is starting.
 *     Drift (e.g. switching to '\n\n') would reduce the visual hierarchy.
 *
 *   - Degradation: missing files silently skip their section. The
 *     engineer orientation is ALWAYS present (it's the immutable base).
 *
 *   - ENGINEER_BASE_PROMPT verbatim: the base prompt is injected
 *     unmodified — no trimming, no prefixing. This is defense-in-depth
 *     against a refactor that accidentally wraps or transforms the base.
 *
 * Each test below pins one slice of this composition contract.
 */

describe('buildEngineerSystemPrompt — degradation (missing files)', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-strat-inv-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('undefined cwd → returns "# ENGINEER ORIENTATION\\n\\n" + base prompt', async () => {
    // No cwd means no files to load. But the ENGINEER ORIENTATION layer
    // is pushed unconditionally — it's the immutable base that's always
    // present. So the prompt is always at least the header + base prompt,
    // never the base prompt alone. Pinning this so a refactor that
    // conditionally includes the header (e.g. "skip header when alone")
    // is flagged.
    const prompt = buildEngineerSystemPrompt(undefined);
    expect(prompt).toBe(`# ENGINEER ORIENTATION\n\n${ENGINEER_BASE_PROMPT}`);
  });

  test('empty cwd → same shape as undefined cwd', async () => {
    // Empty string is treated the same as undefined by all three loaders.
    const prompt = buildEngineerSystemPrompt('');
    expect(prompt).toBe(`# ENGINEER ORIENTATION\n\n${ENGINEER_BASE_PROMPT}`);
  });

  test('cwd with no .odysseus/ → same shape as undefined cwd', async () => {
    // Real directory, but no self-model, no memory, no trace. All three
    // loaders return ''. The function falls back to header + base prompt.
    const prompt = buildEngineerSystemPrompt(workdir);
    expect(prompt).toBe(`# ENGINEER ORIENTATION\n\n${ENGINEER_BASE_PROMPT}`);
  });

  test('degraded prompt does NOT contain separator (only one section)', async () => {
    // With only the ENGINEER ORIENTATION section present, there are no
    // section boundaries, so the separator '\n\n---\n\n' must not appear.
    // Pinning this so the separator count is always section_count - 1.
    const prompt = buildEngineerSystemPrompt(undefined);
    expect(prompt).not.toContain('\n\n---\n\n');
  });
});

describe('buildEngineerSystemPrompt — section ordering and headers', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-strat-ord-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  async function writeSelfModel(content: string): Promise<void> {
    await mkdir(join(workdir, '.odysseus'), { recursive: true });
    await writeFile(join(workdir, '.odysseus', 'self-model.md'), content);
  }

  async function writeMemory(category: 'patterns' | 'lessons', content: string): Promise<void> {
    await mkdir(join(workdir, '.odysseus', 'memory'), { recursive: true });
    await writeFile(join(workdir, '.odysseus', 'memory', `${category}.md`), content);
  }

  async function writeTraceRecord(goal: string): Promise<void> {
    await appendTrace(join(workdir, '.odysseus', 'trace.jsonl'), {
      waypoint_id: `wp_${goal.slice(0, 4)}`,
      goal,
      outcome: 'success',
    });
  }

  // -------------------------------------------------------------------------
  // SELF-MODEL layer
  // -------------------------------------------------------------------------

  test('self-model present → SELF-MODEL section appears with exact header', async () => {
    await writeSelfModel('I am Odysseus, a self-bootstrapping agent.');
    const prompt = buildEngineerSystemPrompt(workdir);
    // Header is load-bearing — prompt-invariants.test.ts relies on
    // the "# SELF-MODEL" prefix being stable for grep-based assertions.
    expect(prompt).toContain(
      '# SELF-MODEL (read at waypoint start — your persistent sense of self)',
    );
    expect(prompt).toContain('I am Odysseus, a self-bootstrapping agent.');
  });

  test('self-model is always the FIRST section', async () => {
    // SELF-MODEL is the outermost layer of the agent's persistent identity.
    // It must come before long-term memory and voyage log so the LLM
    // reads "who I am" before "what I've done".
    await writeSelfModel('IDENTITY');
    await writeMemory('patterns', 'PATTERN');
    await writeTraceRecord('GOAL');

    const prompt = buildEngineerSystemPrompt(workdir);
    const selfModelIdx = prompt.indexOf('# SELF-MODEL');
    const longTermIdx = prompt.indexOf('# LONG-TERM MEMORY');
    const voyageLogIdx = prompt.indexOf('# VOYAGE LOG');
    const engineerIdx = prompt.indexOf('# ENGINEER ORIENTATION');

    expect(selfModelIdx).toBeLessThan(longTermIdx);
    expect(longTermIdx).toBeLessThan(voyageLogIdx);
    expect(voyageLogIdx).toBeLessThan(engineerIdx);
  });

  // -------------------------------------------------------------------------
  // LONG-TERM MEMORY layer
  // -------------------------------------------------------------------------

  test('patterns + lessons both present → LONG-TERM MEMORY section contains both', async () => {
    await writeMemory('patterns', 'use immutability for state updates');
    await writeMemory('lessons', 'always handle errors at boundaries');
    const prompt = buildEngineerSystemPrompt(workdir);
    expect(prompt).toContain(
      '# LONG-TERM MEMORY (patterns and lessons from past voyages — apply these actively)',
    );
    expect(prompt).toContain('## patterns');
    expect(prompt).toContain('## lessons');
    expect(prompt).toContain('use immutability for state updates');
    expect(prompt).toContain('always handle errors at boundaries');
  });

  test('only patterns present → LONG-TERM MEMORY section contains patterns only', async () => {
    // Missing lessons.md is silently skipped. The section still appears
    // (patterns is enough) but does not contain a ## lessons header.
    await writeMemory('patterns', 'use small files');
    const prompt = buildEngineerSystemPrompt(workdir);
    expect(prompt).toContain('# LONG-TERM MEMORY');
    expect(prompt).toContain('## patterns');
    expect(prompt).not.toContain('## lessons');
  });

  test('only lessons present → LONG-TERM MEMORY section contains lessons only', async () => {
    await writeMemory('lessons', 'test first');
    const prompt = buildEngineerSystemPrompt(workdir);
    expect(prompt).toContain('# LONG-TERM MEMORY');
    expect(prompt).toContain('## lessons');
    expect(prompt).not.toContain('## patterns');
  });

  test('preferences and dreams are NEVER injected into the system prompt', async () => {
    // INJECTED_MEMORY_CATEGORIES is ['patterns', 'lessons'] only.
    // preferences is operator config (belongs in self-model).
    // dreams is reflect-source content (belongs in the dreamer's
    // reflection block). Pinning that they NEVER leak into the
    // wakeful system prompt — a refactor that adds them here would
    // bloat every waypoint's prompt with irrelevant content.
    await mkdir(join(workdir, '.odysseus', 'memory'), { recursive: true });
    await writeFile(join(workdir, '.odysseus', 'memory', 'preferences.md'), 'OPERATOR_PREF');
    await writeFile(join(workdir, '.odysseus', 'memory', 'dreams.md'), 'REFLECTIVE_DREAM');
    const prompt = buildEngineerSystemPrompt(workdir);
    expect(prompt).not.toContain('OPERATOR_PREF');
    expect(prompt).not.toContain('REFLECTIVE_DREAM');
    expect(prompt).not.toContain('## preferences');
    expect(prompt).not.toContain('## dreams');
  });

  // -------------------------------------------------------------------------
  // VOYAGE LOG layer
  // -------------------------------------------------------------------------

  test('trace.jsonl with records → VOYAGE LOG section appears', async () => {
    await writeTraceRecord('add retry logic');
    const prompt = buildEngineerSystemPrompt(workdir);
    expect(prompt).toContain(
      '# VOYAGE LOG (recent voyages — what you already tried; do not repeat failed approaches)',
    );
  });

  // -------------------------------------------------------------------------
  // ENGINEER ORIENTATION layer (always last)
  // -------------------------------------------------------------------------

  test('ENGINEER ORIENTATION section is always present (even when other layers are empty)', async () => {
    // No files → all loaders return ''. But the engineer orientation
    // is pushed unconditionally. With no other layers, the prompt is
    // EXACTLY ENGINEER_BASE_PROMPT (no header — see degradation tests).
    // With other layers, the header appears.
    await writeSelfModel('x');
    const prompt = buildEngineerSystemPrompt(workdir);
    expect(prompt).toContain('# ENGINEER ORIENTATION');
    // The ENGINEER_BASE_PROMPT content is appended verbatim after the header.
    expect(prompt).toContain('BIAS TO ACTION — CRITICAL');
  });

  test('ENGINEER_BASE_PROMPT content is appended verbatim (no transformation)', async () => {
    // The base prompt is a string literal. Pinning that it appears
    // UNMODIFIED in the composed prompt — no trimming, no prefixing,
    // no comment wrapping. A refactor that "helpfully" reformats it
    // would silently change the LLM's behavior under the operator.
    await writeSelfModel('x'); // force at least one other layer so we can check the boundary
    const prompt = buildEngineerSystemPrompt(workdir);
    // The last section starts with the header, followed by \n\n, then the base prompt.
    const orientationIdx = prompt.indexOf('# ENGINEER ORIENTATION');
    expect(orientationIdx).toBeGreaterThan(0);
    const afterHeader = prompt.slice(orientationIdx);
    // The base prompt appears verbatim somewhere after the header.
    expect(afterHeader).toContain(ENGINEER_BASE_PROMPT);
  });
});

describe('buildEngineerSystemPrompt — separator invariant', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-strat-sep-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('sections are joined with "\\n\\n---\\n\\n"', async () => {
    // The horizontal rule --- is the visual signal to the LLM that a
    // new top-level section is starting. Drift to a weaker separator
    // (e.g. '\n\n') would reduce the hierarchy cue and make the prompt
    // harder to parse.
    await mkdir(join(workdir, '.odysseus'), { recursive: true });
    await writeFile(join(workdir, '.odysseus', 'self-model.md'), 'IDENTITY');
    await mkdir(join(workdir, '.odysseus', 'memory'), { recursive: true });
    await writeFile(join(workdir, '.odysseus', 'memory', 'patterns.md'), 'PATTERN');
    await appendTrace(join(workdir, '.odysseus', 'trace.jsonl'), {
      waypoint_id: 'wp_test',
      goal: 'test goal',
      outcome: 'success',
    });

    const prompt = buildEngineerSystemPrompt(workdir);
    // Three separators between four sections.
    const sepCount = (prompt.match(/\n\n---\n\n/g) ?? []).length;
    expect(sepCount).toBe(3);
  });

  test('separator does NOT appear within a single section', async () => {
    // The separator is only between top-level sections. Within a
    // section (e.g. inside the memory blob), content may have its own
    // newlines but not the --- rule. Pinning that the separator count
    // equals the section boundary count, not the total newlines.
    await mkdir(join(workdir, '.odysseus', 'memory'), { recursive: true });
    await writeFile(
      join(workdir, '.odysseus', 'memory', 'patterns.md'),
      'line 1\n\nline 2\n\nline 3', // multiple paragraphs inside patterns
    );
    const prompt = buildEngineerSystemPrompt(workdir);
    // With one section present (LONG-TERM MEMORY) + ENGINEER ORIENTATION,
    // there is exactly ONE separator between them. The intra-section
    // newlines don't add separators.
    const sepCount = (prompt.match(/\n\n---\n\n/g) ?? []).length;
    expect(sepCount).toBe(1);
  });
});

describe('buildEngineerSystemPrompt — composition is deterministic', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-strat-det-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('two consecutive calls with the same cwd produce identical output', async () => {
    // The function is pure (given the same files, same output). Pinning
    // determinism so a refactor that adds non-determinism (e.g. a
    // Date.now() timestamp in the prompt) is flagged. The LLM's behavior
    // depends on prompt stability across waypoints within a voyage.
    await mkdir(join(workdir, '.odysseus'), { recursive: true });
    await writeFile(join(workdir, '.odysseus', 'self-model.md'), 'stable identity');
    const first = buildEngineerSystemPrompt(workdir);
    const second = buildEngineerSystemPrompt(workdir);
    expect(first).toBe(second);
  });

  test('prompt reflects file changes between calls (no caching)', async () => {
    // The function reads files fresh on every call — there is no
    // internal cache. This is load-bearing: the self-model is supposed
    // to be editable between waypoints (wp_mrs855ke007 fix). A refactor
    // that adds memoization would silently break self-model hot-reload.
    await mkdir(join(workdir, '.odysseus'), { recursive: true });
    await writeFile(join(workdir, '.odysseus', 'self-model.md'), 'VERSION_1');
    const v1 = buildEngineerSystemPrompt(workdir);
    expect(v1).toContain('VERSION_1');

    await writeFile(join(workdir, '.odysseus', 'self-model.md'), 'VERSION_2');
    const v2 = buildEngineerSystemPrompt(workdir);
    expect(v2).toContain('VERSION_2');
    expect(v2).not.toContain('VERSION_1');
  });
});

describe('buildEngineerSystemPrompt — loader integration', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-strat-integ-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('loadSelfModel and buildEngineerSystemPrompt agree on self-model content', async () => {
    // The composed prompt's SELF-MODEL section must contain exactly
    // what loadSelfModel returns — no truncation, no reformatting.
    await mkdir(join(workdir, '.odysseus'), { recursive: true });
    const selfModelContent = '## Identity\nI am Odysseus.';
    await writeFile(join(workdir, '.odysseus', 'self-model.md'), selfModelContent);

    const direct = loadSelfModel(workdir);
    const composed = buildEngineerSystemPrompt(workdir);

    expect(direct).toBe(selfModelContent);
    expect(composed).toContain(selfModelContent);
  });

  test('loadLongTermMemoryMarkdown and buildEngineerSystemPrompt agree on memory content', async () => {
    await mkdir(join(workdir, '.odysseus', 'memory'), { recursive: true });
    await writeFile(join(workdir, '.odysseus', 'memory', 'patterns.md'), 'PATTERN_CONTENT');
    await writeFile(join(workdir, '.odysseus', 'memory', 'lessons.md'), 'LESSON_CONTENT');

    const direct = loadLongTermMemoryMarkdown(workdir);
    const composed = buildEngineerSystemPrompt(workdir);

    expect(direct).toContain('PATTERN_CONTENT');
    expect(direct).toContain('LESSON_CONTENT');
    expect(composed).toContain(direct);
  });

  test('blank self-model file (whitespace only) is treated as missing', async () => {
    // loadSelfModel returns '' for whitespace-only files (trimmed length 0).
    // The composed prompt must NOT include a SELF-MODEL section for a
    // whitespace-only file — it's treated identically to a missing file.
    await mkdir(join(workdir, '.odysseus'), { recursive: true });
    await writeFile(join(workdir, '.odysseus', 'self-model.md'), '   \n\t  \n');
    const prompt = buildEngineerSystemPrompt(workdir);
    expect(prompt).not.toContain('# SELF-MODEL');
    // Falls back to the always-present ENGINEER ORIENTATION layer.
    expect(prompt).toBe(`# ENGINEER ORIENTATION\n\n${ENGINEER_BASE_PROMPT}`);
  });
});
