import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider, LLMCompletion } from '../../src/llm/provider.js';
import {
  curiosity,
  buildCuriosityUserPrompt,
  loadSelfModelForCuriosity,
  shouldRunCuriosity,
} from '../../src/cerebellum/curiosity.js';
import { listBacklog } from '../../src/cerebellum/backlog.js';
import { listPendingReview } from '../../src/cerebellum/pending-review.js';
import { readMemory } from '../../src/cerebellum/memory.js';
import { loadRecentExplorationsSync } from '../../src/cerebellum/exploration-log.js';
import type { TraceRecord } from '../../src/trace/jsonl.js';

function completion(content: string): LLMCompletion {
  return {
    content,
    model: 'mock',
    usage: { inputTokens: 10, outputTokens: 20 },
    finishReason: 'stop',
  };
}

function staticProvider(responseContent: string): LLMProvider {
  return {
    async complete(): Promise<LLMCompletion> {
      return completion(responseContent);
    },
    async *stream() {
      yield '';
    },
    getModel() {
      return 'mock';
    },
  };
}

const emptyTrace: TraceRecord[] = [];

const SAMPLE_SELF_MODEL = `# Self-Model — Odysseus

## Aspirations (gaps to close)

1. **Continuous self-monitor.** A lightweight inline critic that fires every
   N tool calls.
2. **Diagnosis-to-backlog bridge.** Reflect entry bodies must reach the
   actionable layer.
`;

describe('curiosity', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'ody-curio-'));
    // Default to consent-gate path (pending-review) so tests can assert the
    // raw proposals before auto-approval runs. Tests that need auto-approve
    // set the env var explicitly in the body.
    process.env.ODYSSEUS_AUTO_APPROVE = '0';
    // Curiosity is opt-in at the orchestrator layer; the curiosity()
    // function itself doesn't consult this env var but we keep the env
    // clean so assertions don't leak across tests.
    delete process.env.ODYSSEUS_CURIOSITY;
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
    delete process.env.ODYSSEUS_AUTO_APPROVE;
    delete process.env.ODYSSEUS_CURIOSITY;
  });

  test('valid JSON produces backlog + memory entries with origin=curiosity', async () => {
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const response = JSON.stringify({
      backlogItems: [
        {
          goal: 'add SELF_MONITOR_INTERVAL constant to strategy.ts',
          priority: 80,
          rationale: 'moves toward aspiration #1 (continuous self-monitor)',
        },
      ],
      memoryEntries: [
        {
          category: 'patterns',
          title: 'curiosity probes aspirations',
          body: 'Each curiosity pass picks one aspiration and proposes a concrete step.',
        },
      ],
    });

    const out = await curiosity({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.parseOk).toBe(true);
    expect(out.backlogItemsAdded).toBe(1);
    expect(out.memoryEntriesAdded).toBe(1);

    const pending = await listPendingReview(rootDir);
    expect(pending.length).toBe(1);
    expect(pending[0]!.goal).toBe('add SELF_MONITOR_INTERVAL constant to strategy.ts');
    expect(pending[0]!.origin).toBe('curiosity');
    expect(pending[0]!.priority).toBe(80);

    const patterns = await readMemory(rootDir, 'patterns');
    expect(patterns.length).toBe(1);
    expect(patterns[0]!.source).toBe('dream'); // reuses 'dream' memory source
    expect(patterns[0]!.title).toBe('curiosity probes aspirations');
  });

  test('JSON wrapped in markdown code fence is parsed', async () => {
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const response = [
      'Here is what I want to explore:',
      '',
      '```json',
      JSON.stringify({
        backlogItems: [{ goal: 'extract JsonUtil into src/cerebellum/json.ts' }],
        memoryEntries: [],
      }),
      '```',
    ].join('\n');

    const out = await curiosity({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.parseOk).toBe(true);
    expect(out.backlogItemsAdded).toBe(1);
    const pending = await listPendingReview(rootDir);
    expect(pending[0]!.goal).toBe('extract JsonUtil into src/cerebellum/json.ts');
  });

  test('garbage response → parseOk=false, no persistence', async () => {
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const out = await curiosity({
      rootDir,
      provider: staticProvider('I will not return JSON today.'),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.parseOk).toBe(false);
    expect(out.parseError).toBeDefined();
    expect(out.backlogItemsAdded).toBe(0);
    expect(out.memoryEntriesAdded).toBe(0);

    const pending = await listPendingReview(rootDir);
    expect(pending.length).toBe(0);
  });

  test('missing self-model still runs but prompt notes the absence', async () => {
    // No self-model.md written — loadSelfModelForCuriosity returns ''.
    const response = JSON.stringify({
      backlogItems: [],
      memoryEntries: [],
    });

    const out = await curiosity({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.parseOk).toBe(true);
    expect(out.backlogItemsAdded).toBe(0);
    // The prompt builder should signal the missing self-model so the LLM
    // knows there's nothing to be curious about.
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });
    expect(prompt).toMatch(/self-model missing/i);
  });

  test('cap: extra backlog items beyond default (2) are dropped', async () => {
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const response = JSON.stringify({
      backlogItems: [
        { goal: 'explore one' },
        { goal: 'explore two' },
        { goal: 'explore three' },
        { goal: 'explore four' },
      ],
      memoryEntries: [],
    });

    const out = await curiosity({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    // Default cap is 2 — curiosity is focused, not brainstorming.
    expect(out.backlogItemsAdded).toBe(2);
    const pending = await listPendingReview(rootDir);
    expect(pending.length).toBe(2);
  });

  test('priority out of [0, 100] is clamped', async () => {
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const response = JSON.stringify({
      backlogItems: [
        { goal: 'negative priority', priority: -50 },
        { goal: 'huge priority', priority: 9999 },
      ],
      memoryEntries: [],
    });

    await curiosity({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    const pending = await listPendingReview(rootDir);
    expect(pending.length).toBe(2);
    const priorities = pending.map((p) => p.priority).sort((a, b) => a - b);
    expect(priorities).toEqual([0, 100]);
  });

  test('default priority for origin=curiosity is 90', async () => {
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const response = JSON.stringify({
      backlogItems: [{ goal: 'explore without explicit priority' }],
      memoryEntries: [],
    });

    await curiosity({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    const pending = await listPendingReview(rootDir);
    expect(pending[0]!.priority).toBe(90);
  });

  test('dedup: goals already succeeded in trace are skipped', async () => {
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const trace: TraceRecord[] = [
      {
        waypoint_id: 'wp_abc',
        voyage_id: 'voy_abc',
        goal: 'add SELF_MONITOR_INTERVAL constant to strategy.ts',
        outcome: 'success',
        iterations_used: 3,
        checkpoint_sha: 'sha_abc',
        ts: '2026-07-20T10:00:00Z',
        fail_reason: null,
      },
    ];

    const response = JSON.stringify({
      backlogItems: [
        // Duplicate of the succeeded goal — should be skipped.
        { goal: 'Add SELF_MONITOR_INTERVAL constant to strategy.ts!' },
        // New exploration — should be enqueued.
        { goal: 'extract json helper into src/cerebellum/json.ts' },
      ],
      memoryEntries: [],
    });

    const out = await curiosity({
      rootDir,
      provider: staticProvider(response),
      recentTrace: trace,
      memorySnapshot: [],
    });

    expect(out.backlogItemsSkipped).toBe(1);
    expect(out.backlogItemsAdded).toBe(1);
    const pending = await listPendingReview(rootDir);
    expect(pending.length).toBe(1);
    expect(pending[0]!.goal).toBe('extract json helper into src/cerebellum/json.ts');
  });

  test('auto-approve ON routes proposals directly into backlog', async () => {
    process.env.ODYSSEUS_AUTO_APPROVE = '1';
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const response = JSON.stringify({
      backlogItems: [{ goal: 'add workWaypointCounter to orchestrator.ts' }],
      memoryEntries: [],
    });

    const out = await curiosity({
      rootDir,
      provider: staticProvider(response),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });

    expect(out.backlogItemsAdded).toBe(1);
    // Pending-review was written then drained by auto-approve.
    const pending = await listPendingReview(rootDir);
    expect(pending.length).toBe(0);
    // The item should now be in the backlog with origin=curiosity.
    const backlog = await listBacklog(rootDir);
    expect(backlog.length).toBe(1);
    expect(backlog[0]!.origin).toBe('curiosity');
    expect(backlog[0]!.goal).toBe('add workWaypointCounter to orchestrator.ts');
  });

  test('user prompt embeds the self-model text', async () => {
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(''),
      recentTrace: emptyTrace,
      memorySnapshot: [],
    });
    expect(prompt).toMatch(/Continuous self-monitor/);
    expect(prompt).toMatch(/Diagnosis-to-backlog bridge/);
    expect(prompt).toMatch(/<self-model>/);
    expect(prompt).toMatch(/<recent>/);
    expect(prompt).toMatch(/<memory>/);
    // Iteration 11: <explorations> block always present (empty when no log).
    expect(prompt).toMatch(/<explorations>/);
  });

  test('user prompt includes memory titles for dedup context', async () => {
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const prompt = buildCuriosityUserPrompt({
      rootDir,
      provider: staticProvider(''),
      recentTrace: emptyTrace,
      memorySnapshot: [
        {
          category: 'patterns',
          entries: [
            {
              id: 'mem_aaa',
              category: 'patterns',
              title: 'append-only trace',
              source: 'dream',
              body: 'trace is append-only',
              ts: '2026-07-20T10:00:00Z',
            },
          ],
        },
      ],
    });
    expect(prompt).toMatch(/append-only trace/);
  });

  test('loadSelfModelForCuriosity returns empty string for missing file', async () => {
    const result = loadSelfModelForCuriosity(rootDir);
    expect(result).toBe('');
  });

  test('loadSelfModelForCuriosity returns file content when present', async () => {
    await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
    const result = loadSelfModelForCuriosity(rootDir);
    expect(result).toContain('Aspirations');
  });

  test('shouldRunCuriosity defaults to ON (autonomous agent)', () => {
    delete process.env.ODYSSEUS_CURIOSITY;
    expect(shouldRunCuriosity()).toBe(true);
  });

  test('shouldRunCuriosity = empty string still defaults to ON', () => {
    process.env.ODYSSEUS_CURIOSITY = '';
    expect(shouldRunCuriosity()).toBe(true);
  });

  test('shouldRunCuriosity = 1 explicitly enables curiosity', () => {
    process.env.ODYSSEUS_CURIOSITY = '1';
    expect(shouldRunCuriosity()).toBe(true);
  });

  test('shouldRunCuriosity = 0 is the escape hatch (disables curiosity)', () => {
    process.env.ODYSSEUS_CURIOSITY = '0';
    expect(shouldRunCuriosity()).toBe(false);
  });

  test('shouldRunCuriosity = false is the escape hatch', () => {
    process.env.ODYSSEUS_CURIOSITY = 'false';
    expect(shouldRunCuriosity()).toBe(false);
  });

  test('shouldRunCuriosity = no is the escape hatch', () => {
    process.env.ODYSSEUS_CURIOSITY = 'no';
    expect(shouldRunCuriosity()).toBe(false);
  });

  test('shouldRunCuriosity = yes explicitly enables curiosity', () => {
    process.env.ODYSSEUS_CURIOSITY = 'yes';
    expect(shouldRunCuriosity()).toBe(true);
  });

  describe('cross-voyage curiosity memory (Iteration 11)', () => {
    test('curiosity writes one exploration record per enqueued item', async () => {
      await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
      const response = JSON.stringify({
        backlogItems: [
          { goal: 'add SELF_MONITOR_INTERVAL to strategy.ts', priority: 80 },
          { goal: 'extract json helper into src/cerebellum/json.ts', priority: 75 },
        ],
        memoryEntries: [],
      });

      await curiosity({
        rootDir,
        provider: staticProvider(response),
        recentTrace: emptyTrace,
        memorySnapshot: [],
      });

      const records = loadRecentExplorationsSync(join(rootDir, 'explorations.jsonl'));
      expect(records.length).toBe(2);
      expect(records[0]!.origin).toBe('curiosity');
      // Reverse-chronological by ts; both written within ms of each other,
      // so file order wins on ties. Both goals must appear.
      const goals = records.map((r) => r.goal).sort();
      expect(goals).toEqual([
        'add SELF_MONITOR_INTERVAL to strategy.ts',
        'extract json helper into src/cerebellum/json.ts',
      ].sort());
      // Priorities preserved (post-clamp).
      const priorities = records.map((r) => r.priority).sort();
      expect(priorities).toEqual([75, 80]);
    });

    test('exploration record includes voyage_id when provided', async () => {
      await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
      const response = JSON.stringify({
        backlogItems: [{ goal: 'add thing to file.ts' }],
        memoryEntries: [],
      });

      await curiosity({
        rootDir,
        provider: staticProvider(response),
        recentTrace: emptyTrace,
        memorySnapshot: [],
        voyageId: 'voy_xyz',
      });

      const records = loadRecentExplorationsSync(join(rootDir, 'explorations.jsonl'));
      expect(records.length).toBe(1);
      expect(records[0]!.voyage_id).toBe('voy_xyz');
    });

    test('exploration record omits voyage_id when not provided', async () => {
      await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
      const response = JSON.stringify({
        backlogItems: [{ goal: 'add thing to file.ts' }],
        memoryEntries: [],
      });

      await curiosity({
        rootDir,
        provider: staticProvider(response),
        recentTrace: emptyTrace,
        memorySnapshot: [],
        // voyageId intentionally omitted (probe / test path).
      });

      const records = loadRecentExplorationsSync(join(rootDir, 'explorations.jsonl'));
      expect(records.length).toBe(1);
      expect(records[0]!.voyage_id).toBeUndefined();
    });

    test('skipped (deduped) items are NOT written to exploration log', async () => {
      await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
      const trace: TraceRecord[] = [
        {
          waypoint_id: 'wp_done',
          voyage_id: 'voy_done',
          goal: 'add SELF_MONITOR_INTERVAL to strategy.ts',
          outcome: 'success',
          iterations_used: 1,
          checkpoint_sha: null,
          ts: '2026-07-19T10:00:00Z',
          fail_reason: null,
        },
      ];

      const response = JSON.stringify({
        backlogItems: [
          // Duplicate of succeeded goal — should be skipped + NOT logged.
          { goal: 'add SELF_MONITOR_INTERVAL to strategy.ts' },
          // New goal — should be logged.
          { goal: 'extract json helper into src/cerebellum/json.ts' },
        ],
        memoryEntries: [],
      });

      await curiosity({
        rootDir,
        provider: staticProvider(response),
        recentTrace: trace,
        memorySnapshot: [],
      });

      const records = loadRecentExplorationsSync(join(rootDir, 'explorations.jsonl'));
      expect(records.length).toBe(1);
      expect(records[0]!.goal).toBe('extract json helper into src/cerebellum/json.ts');
    });

    test('next curiosity pass sees prior explorations in user prompt', async () => {
      await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);

      // Pre-seed the exploration log as if a prior pass wrote it.
      await writeFile(
        join(rootDir, 'explorations.jsonl'),
        JSON.stringify({
          id: 'expl_prior1',
          ts: '2026-07-20T10:00:00Z',
          goal: 'add SELF_MONITOR_INTERVAL to strategy.ts',
          origin: 'curiosity',
          priority: 80,
          voyage_id: 'voy_prior',
        }) + '\n',
      );

      // Trace shows the prior exploration succeeded.
      const trace: TraceRecord[] = [
        {
          waypoint_id: 'wp_done',
          voyage_id: 'voy_prior',
          goal: 'add SELF_MONITOR_INTERVAL to strategy.ts',
          outcome: 'success',
          iterations_used: 3,
          checkpoint_sha: 'sha_x',
          ts: '2026-07-20T11:00:00Z',
          fail_reason: null,
        },
      ];

      const prompt = buildCuriosityUserPrompt({
        rootDir,
        provider: staticProvider(''),
        recentTrace: trace,
        memorySnapshot: [],
      });

      // The exploration must surface in the prompt...
      expect(prompt).toContain('add SELF_MONITOR_INTERVAL to strategy.ts');
      // ...with its joined outcome.
      expect(prompt).toContain('proposed→success');
    });

    test('prior FAILED exploration surfaces FAIL reason in prompt', async () => {
      await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);

      await writeFile(
        join(rootDir, 'explorations.jsonl'),
        JSON.stringify({
          id: 'expl_failed',
          ts: '2026-07-20T10:00:00Z',
          goal: 'add workWaypointCounter to orchestrator.ts',
          origin: 'curiosity',
          priority: 90,
        }) + '\n',
      );

      const trace: TraceRecord[] = [
        {
          waypoint_id: 'wp_fail',
          goal: 'add workWaypointCounter to orchestrator.ts',
          outcome: 'failure',
          iterations_used: 5,
          checkpoint_sha: null,
          ts: '2026-07-20T11:00:00Z',
          fail_reason: 'tsc strict mode rejected the new field',
        },
      ];

      const prompt = buildCuriosityUserPrompt({
        rootDir,
        provider: staticProvider(''),
        recentTrace: trace,
        memorySnapshot: [],
      });

      expect(prompt).toContain('proposed→failure');
      expect(prompt).toContain('tsc strict mode rejected the new field');
    });

    test('explorations.jsonl survives append across multiple curiosity passes', async () => {
      await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);

      // Pass 1.
      await curiosity({
        rootDir,
        provider: staticProvider(
          JSON.stringify({
            backlogItems: [{ goal: 'first exploration goal' }],
            memoryEntries: [],
          }),
        ),
        recentTrace: emptyTrace,
        memorySnapshot: [],
      });

      // Pass 2.
      await curiosity({
        rootDir,
        provider: staticProvider(
          JSON.stringify({
            backlogItems: [{ goal: 'second exploration goal' }],
            memoryEntries: [],
          }),
        ),
        recentTrace: emptyTrace,
        memorySnapshot: [],
      });

      const records = loadRecentExplorationsSync(join(rootDir, 'explorations.jsonl'));
      expect(records.length).toBe(2);
      // Both goals present (file order; reverse-chrono by ts which is too
      // close to call — so just check membership).
      const goals = records.map((r) => r.goal);
      expect(goals).toContain('first exploration goal');
      expect(goals).toContain('second exploration goal');
    });

    test('explorations.jsonl is valid JSONL after writes (one record per line)', async () => {
      await writeFile(join(rootDir, 'self-model.md'), SAMPLE_SELF_MODEL);
      await curiosity({
        rootDir,
        provider: staticProvider(
          JSON.stringify({
            // Goals must be semantically distinct — isDuplicateGoal uses
            // Jaccard token similarity ≥ 0.5, so 'goal A' vs 'goal B'
            // would both normalize to {'goal'} and the second would be
            // dropped as a near-duplicate. Use real verb+object+file form.
            backlogItems: [
              { goal: 'add timing to dream() in src/cerebellum/dreamer.ts' },
              { goal: 'extract extractJson into src/cerebellum/json.ts' },
            ],
            memoryEntries: [],
          }),
        ),
        recentTrace: emptyTrace,
        memorySnapshot: [],
      });

      const raw = await readFile(join(rootDir, 'explorations.jsonl'), 'utf8');
      const lines = raw.trim().split('\n');
      expect(lines.length).toBe(2);
      for (const line of lines) {
        // Each line must be valid JSON.
        const parsed = JSON.parse(line) as { id: string; goal: string };
        expect(parsed.id).toMatch(/^expl_/);
        expect(parsed.goal.length).toBeGreaterThan(0);
      }
    });
  });

  describe('CURIOSITY_SYSTEM_PROMPT invariants (Iteration 42 extraction)', () => {
    // Iteration 42 moved CURIOSITY_SYSTEM_PROMPT from curiosity.ts to
    // prompts.ts (mirroring Iteration 35's DREAM_SYSTEM_PROMPT extraction).
    // Each rule below is a literal-string invariant on the prompt. If a
    // rule disappears, the corresponding failure mode returns.

    test('CURIOSITY_SYSTEM_PROMPT is exported from prompts.ts and imported by curiosity.ts', async () => {
      // If a future refactor inlines the prompt back into curiosity.ts,
      // the file-size pressure returns and this assertion catches it.
      const { readFile } = await import('node:fs/promises');
      const promptsSrc = await readFile('src/cerebellum/prompts.ts', 'utf8');
      const curiositySrc = await readFile('src/cerebellum/curiosity.ts', 'utf8');
      expect(promptsSrc).toContain('export const CURIOSITY_SYSTEM_PROMPT');
      expect(curiositySrc).toContain(
        "import { CURIOSITY_SYSTEM_PROMPT } from './prompts.js'",
      );
      expect(curiositySrc).not.toContain('const CURIOSITY_SYSTEM_PROMPT = `');
    });

    test('CURIOSITY_SYSTEM_PROMPT enforces file-scoped goals', async () => {
      // Without this rule the curiosity LLM emits "explore the dreamer" —
      // no anchor, no convergence. The GOOD/BAD contrast is the most
      // effective teaching shape (mirrors DREAM_SYSTEM_PROMPT).
      const { readFile } = await import('node:fs/promises');
      const src = await readFile('src/cerebellum/prompts.ts', 'utf8');
      expect(src).toContain('Curiosity goals are EXPLORATIONS');
      expect(src).toContain('FORBIDDEN: vague explorations');
      expect(src).toContain('"explore the dreamer"');
    });

    test('CURIOSITY_SYSTEM_PROMPT enforces focused cap (2 items, not 5)', async () => {
      // Curiosity is focused, not brainstorming. If the cap drifts back to
      // the dreamer's 5, the LLM proposes a scattershot of half-formed
      // ideas instead of one well-chosen next step.
      const { readFile } = await import('node:fs/promises');
      const src = await readFile('src/cerebellum/prompts.ts', 'utf8');
      expect(src).toContain('Maximum 2 backlogItems per curiosity pass');
    });

    test('CURIOSITY_SYSTEM_PROMPT teaches honest empty-output', async () => {
      // Without this rule the LLM manufactures low-quality proposals to
      // fill quota. "nothing to explore today" being a valid output is
      // what makes curiosity honest instead of compulsive.
      const { readFile } = await import('node:fs/promises');
      const src = await readFile('src/cerebellum/prompts.ts', 'utf8');
      expect(src).toContain('Do NOT manufacture work');
      expect(src).toContain('"nothing to explore today" is a valid output');
    });
  });
});
