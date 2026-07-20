import { describe, test, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Size cap for `.odysseus/self-model.md`.
 *
 * Why this test exists: the self-model is injected into the system prompt
 * of EVERY LLM iteration of EVERY waypoint. A 40k-char self-model (the
 * pre-Iteration-30 state) cost ~10k tokens per iteration — the single
 * largest line-item in the per-waypoint budget. The file grows
 * monotonically by default (each iteration appends, none compress), so
 * without a structural guard the bloat returns.
 *
 * The cap is set at 12k chars — roughly 3x the post-Iteration-30 compressed
 * size (8k). That leaves room for 2-3 new capability entries before the
 * test forces a compression pass. When the test fails, the fix is not to
 * raise the cap but to compress: collapse verbose entries to 1-3 lines,
 * preserve names + actionable triggers, drop changelog narrative (git
 * history preserves the detail).
 *
 * Historical pattern: pre-Iteration-30 the file grew to ~40k across 30
 * iterations because every capability entry included "As of YYYY-MM-DD
 * (Iteration N)..." narratives of 10-20 lines each. The LLM only needs
 * current state, not evolution history.
 */
const SELF_MODEL_PATH = join(process.cwd(), '.odysseus', 'self-model.md');
const SELF_MODEL_CHAR_CAP = 12_000;
const SELF_MODEL_LINE_CAP = 120;

describe('.odysseus/self-model.md size cap', () => {
  test('file exists', () => {
    const stat = statSync(SELF_MODEL_PATH);
    expect(stat.isFile()).toBe(true);
  });

  test('stays under 12k chars (token efficiency guard)', () => {
    const content = readFileSync(SELF_MODEL_PATH, 'utf8');
    expect(
      content.length,
      `self-model.md is ${content.length} chars (cap ${SELF_MODEL_CHAR_CAP}). ` +
        `The self-model is injected into every LLM iteration's system prompt — ` +
        `bloat compounds across every iteration of every waypoint. ` +
        `Compress verbose capability entries to 1-3 lines; git history preserves detail. ` +
        `See the test docstring for the rationale.`
    ).toBeLessThan(SELF_MODEL_CHAR_CAP);
  });

  test('stays under 120 lines', () => {
    const content = readFileSync(SELF_MODEL_PATH, 'utf8');
    const lines = content.split('\n').length;
    expect(
      lines,
      `self-model.md is ${lines} lines (cap ${SELF_MODEL_LINE_CAP}). ` +
        `Compress or consolidate entries before adding new ones.`
    ).toBeLessThan(SELF_MODEL_LINE_CAP);
  });

  test('preserves required section headers', () => {
    const content = readFileSync(SELF_MODEL_PATH, 'utf8');
    // These section names are part of the contract — downstream tooling
    // (dreamer, curiosity) may parse by header.
    expect(content).toContain('## Identity');
    expect(content).toContain('## Current Capabilities');
    expect(content).toContain('## Active Limitations');
    expect(content).toContain('## Aspirations');
  });

  test('does not contain changelog-style "As of YYYY-MM-DD (Iteration N)" narratives', () => {
    // The pre-Iteration-30 bloat pattern: every capability entry started
    // with "As of 2026-07-21 (Iteration N)". These narratives are pure
    // changelog — git history is the right home for them, not the live
    // system prompt. Allow at most ONE such phrase (the "Last updated"
    // header line).
    const content = readFileSync(SELF_MODEL_PATH, 'utf8');
    const matches = content.match(/As of \d{4}-\d{2}-\d{2}/g) ?? [];
    expect(
      matches.length,
      `Found ${matches.length} "As of YYYY-MM-DD" phrases (cap 1). ` +
        `Changelog narrative belongs in git log, not the system prompt. ` +
        `Compress to current-state description without the historical marker.`
    ).toBeLessThan(2);
  });
});
