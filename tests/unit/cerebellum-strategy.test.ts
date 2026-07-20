import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  selectStrategy,
  ENGINEER_STRATEGY,
  CONVERSATIONAL_DONE_MARKER,
  detectConversationalDone,
  loadSelfModel,
  loadLongTermMemoryMarkdown,
  setStrategyCwd,
} from '../../src/cerebellum/strategy.js';

describe('selectStrategy (Iteration 0: engineer only)', () => {
  test('returns engineer strategy by default', () => {
    const result = selectStrategy({ goal: 'add a tool', allowedStrategies: ['engineer'] });
    expect(result.name).toBe('engineer');
    expect(result.systemPrompt.length).toBeGreaterThan(0);
  });

  test('respects explicit override when allowed', () => {
    const result = selectStrategy({
      goal: 'try something different',
      requestedStrategy: 'engineer',
      allowedStrategies: ['engineer'],
    });
    expect(result.name).toBe('engineer');
  });

  test('falls back to engineer if requested strategy is not in allowed list', () => {
    const result = selectStrategy({
      goal: 'x',
      requestedStrategy: 'creative',
      allowedStrategies: ['engineer'],
    });
    expect(result.name).toBe('engineer');
  });

  test('ENGINEER_STRATEGY has expected shape', () => {
    expect(ENGINEER_STRATEGY.name).toBe('engineer');
    expect(typeof ENGINEER_STRATEGY.systemPrompt).toBe('string');
    // maxIterations is optional — engineer strategy leaves it undefined so
    // the loop runs until DONE / interrupt / conversational stop / loop
    // detector, not an arbitrary iter cap.
    expect(ENGINEER_STRATEGY.maxIterations).toBeUndefined();
  });

  test('ENGINEER_STRATEGY prompt teaches the agent about [CONVERSATIONAL-DONE]', () => {
    // The prompt is the contract. If this assertion fails, the strategy
    // prompt no longer teaches the agent how to end a conversational turn
    // — the orchestrator's detection logic would then dangle.
    expect(ENGINEER_STRATEGY.systemPrompt).toContain(CONVERSATIONAL_DONE_MARKER);
  });

  test('ENGINEER_STRATEGY prompt teaches BLOCKED-FILE early-exit (Iteration 33)', () => {
    // Iteration 33 finding: 8 maxIterations failures included 2 goals that
    // explicitly named src/cerebellum/orchestrator.ts (a safety-perimeter
    // file). The agent attempted creative workarounds (parallel files in
    // sibling directories) across 16 turns, burning ~2.1M input tokens.
    // The prompt must teach the agent to early-exit with BLOCKED+DONE so
    // the verify gate records the waypoint as abandoned on turn 1.
    //
    // If this assertion fails, the agent will revert to multi-turn
    // workaround attempts whenever a goal names a safety-perimeter file.
    const prompt = ENGINEER_STRATEGY.systemPrompt;
    expect(prompt).toContain('BLOCKED-FILE CASE');
    expect(prompt).toContain('BLOCKED:');
    expect(prompt).toContain('safety perimeter');
    expect(prompt).toContain('requires human review');
    // The exact filenames from CLAUDE.md safety-perimeter list must appear
    // in the BLOCKED section so the agent can pattern-match goal text.
    expect(prompt).toContain('src/cerebellum/orchestrator.ts');
    expect(prompt).toContain('package.json');
    expect(prompt).toContain('tsconfig.json');
    expect(prompt).toContain('.gitignore');
  });
});

describe('detectConversationalDone', () => {
  test('marker alone on its own line at end of reply', () => {
    const result = detectConversationalDone(
      'Hi! I am Odysseus.\n[CONVERSATIONAL-DONE]',
    );
    expect(result.found).toBe(true);
    expect(result.cleanContent).toBe('Hi! I am Odysseus.');
  });

  test('marker at the very start', () => {
    const result = detectConversationalDone(
      '[CONVERSATIONAL-DONE]\nOkay, bye.',
    );
    expect(result.found).toBe(true);
    expect(result.cleanContent).toBe('Okay, bye.');
  });

  test('marker is case-insensitive', () => {
    const result = detectConversationalDone('hi\n[conversational-done]');
    expect(result.found).toBe(true);
    expect(result.cleanContent).toBe('hi');
  });

  test('marker surrounded by extra blank lines collapses cleanly', () => {
    const result = detectConversationalDone(
      'Hello.\n\n\n[CONVERSATIONAL-DONE]\n\n',
    );
    expect(result.found).toBe(true);
    expect(result.cleanContent).toBe('Hello.');
  });

  test('marker mid-sentence does NOT match (avoids false positive)', () => {
    // The agent might discuss the marker in prose ("I will not emit
    // [CONVERSATIONAL-DONE] because this is a code task"). That must NOT
    // trigger detection — the marker has to be on its own line.
    const result = detectConversationalDone(
      'I will now describe the [CONVERSATIONAL-DONE] protocol and how it works.',
    );
    expect(result.found).toBe(false);
    // cleanContent equals input trimmed when marker not found:
    expect(result.cleanContent).toBe(
      'I will now describe the [CONVERSATIONAL-DONE] protocol and how it works.',
    );
  });

  test('empty input returns empty clean content, no detection', () => {
    const result = detectConversationalDone('   ');
    expect(result.found).toBe(false);
    expect(result.cleanContent).toBe('');
  });

  test('marker with trailing whitespace on same line still detected', () => {
    const result = detectConversationalDone(
      'Reply text here.\n[CONVERSATIONAL-DONE]   ',
    );
    expect(result.found).toBe(true);
    expect(result.cleanContent).toBe('Reply text here.');
  });
});

describe('loadLongTermMemoryMarkdown', () => {
  test('returns empty string when cwd is undefined', () => {
    expect(loadLongTermMemoryMarkdown(undefined)).toBe('');
  });

  test('returns empty string when both files are missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ody-strat-'));
    try {
      expect(loadLongTermMemoryMarkdown(dir)).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns empty string when files exist but are empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ody-strat-'));
    try {
      await mkdir(join(dir, '.odysseus', 'memory'), { recursive: true });
      await writeFile(join(dir, '.odysseus', 'memory', 'patterns.md'), '');
      await writeFile(join(dir, '.odysseus', 'memory', 'lessons.md'), '   \n  \n');
      expect(loadLongTermMemoryMarkdown(dir)).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns patterns content when only patterns.md exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ody-strat-'));
    try {
      await mkdir(join(dir, '.odysseus', 'memory'), { recursive: true });
      await writeFile(
        join(dir, '.odysseus', 'memory', 'patterns.md'),
        '## [2026-07-20T10:00:00Z] Always pin file paths\n- **id**: mem_aaa\n- **source**: dream\n\nGoals must name a specific file.\n',
      );
      const result = loadLongTermMemoryMarkdown(dir);
      expect(result).toContain('## patterns');
      expect(result).toContain('Always pin file paths');
      expect(result).toContain('Goals must name a specific file.');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns both categories joined by separator', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ody-strat-'));
    try {
      await mkdir(join(dir, '.odysseus', 'memory'), { recursive: true });
      await writeFile(
        join(dir, '.odysseus', 'memory', 'patterns.md'),
        '## [2026-07-20T10:00:00Z] Pattern title\n- **id**: mem_aaa\n- **source**: dream\n\nbody-a\n',
      );
      await writeFile(
        join(dir, '.odysseus', 'memory', 'lessons.md'),
        '## [2026-07-20T10:00:00Z] Lesson title\n- **id**: mem_bbb\n- **source**: dream\n\nbody-b\n',
      );
      const result = loadLongTermMemoryMarkdown(dir);
      expect(result).toContain('## patterns');
      expect(result).toContain('Pattern title');
      expect(result).toContain('## lessons');
      expect(result).toContain('Lesson title');
      // Both bodies injected (not just titles — full context for the agent).
      expect(result).toContain('body-a');
      expect(result).toContain('body-b');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('ignores preferences.md and dreams.md (not in INJECTED_MEMORY_CATEGORIES)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ody-strat-'));
    try {
      await mkdir(join(dir, '.odysseus', 'memory'), { recursive: true });
      await writeFile(
        join(dir, '.odysseus', 'memory', 'preferences.md'),
        '## [2026-07-20T10:00:00Z] Operator prefers tabs\n- **id**: mem_aaa\n- **source**: user\n\nuse tabs not spaces\n',
      );
      await writeFile(
        join(dir, '.odysseus', 'memory', 'dreams.md'),
        '## [2026-07-20T10:00:00Z] Reflective entry\n- **id**: mem_bbb\n- **source**: reflect\n\ndeep diagnostic\n',
      );
      const result = loadLongTermMemoryMarkdown(dir);
      // Neither category should be injected.
      expect(result).toBe('');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('ENGINEER_STRATEGY.systemPrompt long-term memory injection', () => {
  let originalCwd: string | undefined;
  let tempDir: string;

  beforeEach(async () => {
    // Snapshot whatever cwd was set by earlier tests so we can restore it.
    // setStrategyCwd has no getter, so we track via a known temp dir.
    tempDir = await mkdtemp(join(tmpdir(), 'ody-strat-inject-'));
    await mkdir(join(tempDir, '.odysseus', 'memory'), { recursive: true });
    // Point the strategy at the temp dir.
    setStrategyCwd(tempDir);
  });

  afterEach(async () => {
    // Restore to project root so other test suites don't see our temp dir.
    setStrategyCwd(join(process.cwd(), '.odysseus', '..'));
    await rm(tempDir, { recursive: true, force: true });
  });

  test('patterns.md content surfaces in systemPrompt under LONG-TERM MEMORY section', async () => {
    await writeFile(
      join(tempDir, '.odysseus', 'memory', 'patterns.md'),
      '## [2026-07-20T10:00:00Z] Bias to action over narration\n- **id**: mem_aaa\n- **source**: dream\n\nThe agent must call tools, not describe what it will do.\n',
    );
    const prompt = ENGINEER_STRATEGY.systemPrompt;
    expect(prompt).toContain('LONG-TERM MEMORY');
    expect(prompt).toContain('Bias to action over narration');
    expect(prompt).toContain('The agent must call tools');
  });

  test('lessons.md content surfaces alongside patterns', async () => {
    await writeFile(
      join(tempDir, '.odysseus', 'memory', 'patterns.md'),
      '## [2026-07-20T10:00:00Z] P1\n- **id**: mem_aaa\n- **source**: dream\n\nbody-p1\n',
    );
    await writeFile(
      join(tempDir, '.odysseus', 'memory', 'lessons.md'),
      '## [2026-07-20T10:00:00Z] L1\n- **id**: mem_bbb\n- **source**: dream\n\nbody-l1\n',
    );
    const prompt = ENGINEER_STRATEGY.systemPrompt;
    expect(prompt).toContain('P1');
    expect(prompt).toContain('L1');
  });

  test('both sections degrade gracefully when files are missing', () => {
    // No files written — both categories missing.
    const prompt = ENGINEER_STRATEGY.systemPrompt;
    // SELF-MODEL may or may not be present (project root has one); the key
    // assertion is that LONG-TERM MEMORY section is absent.
    expect(prompt).not.toContain('LONG-TERM MEMORY');
    // Engineer orientation is always present.
    expect(prompt).toContain('ENGINEER ORIENTATION');
  });

  test('self-model and long-term memory both present when both exist', async () => {
    await writeFile(
      join(tempDir, '.odysseus', 'self-model.md'),
      '# Self-Model — Odysseus\n\n## Identity\n\nI am Odysseus.\n',
    );
    await writeFile(
      join(tempDir, '.odysseus', 'memory', 'patterns.md'),
      '## [2026-07-20T10:00:00Z] Some pattern\n- **id**: mem_aaa\n- **source**: dream\n\nbody\n',
    );
    const prompt = ENGINEER_STRATEGY.systemPrompt;
    // Both sections present, in order: SELF-MODEL → LONG-TERM MEMORY → ENGINEER.
    const selfModelIdx = prompt.indexOf('SELF-MODEL');
    const ltmIdx = prompt.indexOf('LONG-TERM MEMORY');
    const engineerIdx = prompt.indexOf('ENGINEER ORIENTATION');
    expect(selfModelIdx).toBeGreaterThan(-1);
    expect(ltmIdx).toBeGreaterThan(selfModelIdx);
    expect(engineerIdx).toBeGreaterThan(ltmIdx);
  });

  test('voyage log surfaces in systemPrompt under VOYAGE LOG section when trace exists', async () => {
    await writeFile(
      join(tempDir, '.odysseus', 'trace.jsonl'),
      JSON.stringify({
        ts: '2026-07-20T10:00:00Z',
        waypoint_id: 'wp_abc',
        goal: 'add retry to llm provider',
        strategy: 'engineer',
        parent: null,
        outcome: 'success',
        checkpoint_sha: 'sha_abc',
        iterations_used: 3,
        tokens_consumed: { input: 0, output: 0 },
        verify_result: {},
        fail_reason: null,
        diff_summary: 'committed as sha_abc',
        voyage_id: 'voy_abc',
      }) + '\n',
    );
    const prompt = ENGINEER_STRATEGY.systemPrompt;
    expect(prompt).toContain('VOYAGE LOG');
    expect(prompt).toContain('add retry to llm provider');
    expect(prompt).toContain('voy_abc');
  });

  test('VOYAGE LOG section is absent when trace.jsonl is missing', () => {
    // No trace.jsonl written.
    const prompt = ENGINEER_STRATEGY.systemPrompt;
    expect(prompt).not.toContain('VOYAGE LOG');
    expect(prompt).toContain('ENGINEER ORIENTATION');
  });

  test('four-layer ordering: SELF-MODEL → LONG-TERM MEMORY → VOYAGE LOG → ENGINEER ORIENTATION', async () => {
    await writeFile(
      join(tempDir, '.odysseus', 'self-model.md'),
      '# Self-Model\n\n## Identity\n\nI am Odysseus.\n',
    );
    await writeFile(
      join(tempDir, '.odysseus', 'memory', 'patterns.md'),
      '## [2026-07-20T10:00:00Z] Some pattern\n- **id**: mem_aaa\n- **source**: dream\n\nbody\n',
    );
    await writeFile(
      join(tempDir, '.odysseus', 'trace.jsonl'),
      JSON.stringify({
        ts: '2026-07-20T10:00:00Z',
        waypoint_id: 'wp_abc',
        goal: 'add retry',
        strategy: 'engineer',
        parent: null,
        outcome: 'success',
        checkpoint_sha: 'sha_abc',
        iterations_used: 1,
        tokens_consumed: { input: 0, output: 0 },
        verify_result: {},
        fail_reason: null,
        diff_summary: null,
        voyage_id: 'voy_abc',
      }) + '\n',
    );

    const prompt = ENGINEER_STRATEGY.systemPrompt;
    const selfModelIdx = prompt.indexOf('SELF-MODEL');
    const ltmIdx = prompt.indexOf('LONG-TERM MEMORY');
    const voyageLogIdx = prompt.indexOf('VOYAGE LOG');
    const engineerIdx = prompt.indexOf('ENGINEER ORIENTATION');
    expect(selfModelIdx).toBeGreaterThan(-1);
    expect(ltmIdx).toBeGreaterThan(selfModelIdx);
    expect(voyageLogIdx).toBeGreaterThan(ltmIdx);
    expect(engineerIdx).toBeGreaterThan(voyageLogIdx);
  });
});
