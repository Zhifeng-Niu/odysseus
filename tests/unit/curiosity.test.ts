import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  test('shouldRunCuriosity defaults to OFF', () => {
    delete process.env.ODYSSEUS_CURIOSITY;
    expect(shouldRunCuriosity()).toBe(false);
  });

  test('shouldRunCuriosity = 1 enables curiosity', () => {
    process.env.ODYSSEUS_CURIOSITY = '1';
    expect(shouldRunCuriosity()).toBe(true);
  });

  test('shouldRunCuriosity = 0 explicitly disables curiosity', () => {
    process.env.ODYSSEUS_CURIOSITY = '0';
    expect(shouldRunCuriosity()).toBe(false);
  });

  test('shouldRunCuriosity = false explicitly disables curiosity', () => {
    process.env.ODYSSEUS_CURIOSITY = 'false';
    expect(shouldRunCuriosity()).toBe(false);
  });

  test('shouldRunCuriosity = yes enables curiosity', () => {
    process.env.ODYSSEUS_CURIOSITY = 'yes';
    expect(shouldRunCuriosity()).toBe(true);
  });
});
