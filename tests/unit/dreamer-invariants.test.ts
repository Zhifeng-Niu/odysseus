/**
 * Invariants for src/cerebellum/dreamer.ts.
 *
 * dreamer.test.ts covers behavior: valid JSON produces items, garbage
 * response produces parseOk=false, caps truncate output, dedup skips
 * duplicates, auto-approve routes to backlog, prompt safety-perimeter
 * guards, etc. This file pins the load-bearing structural contracts
 * that behavior tests imply but do not make explicit:
 *
 *   - DreamOutput type shape: exactly { backlogItemsAdded, backlog-
 *     ItemsSkipped, memoryEntriesAdded, addedBacklogItems, added-
 *     MemoryEntries, rawResponse, durationMs, parseOk, parseError? }.
 *   - exactOptionalPropertyTypes contract: parseError key is ABSENT
 *     when parseOk=true (verified via 'parseError' in obj, not just
 *     undefined value).
 *   - parseError is PRESENT when parseOk=false.
 *   - DreamBacklogItem / DreamMemoryEntry / DreamAddedBacklogItem /
 *     DreamAddedMemoryEntry type aliases are exported (downstream
 *     callers may import them).
 *   - dream() calls provider.complete with temperature=0.9 (divergent
 *     thinking) and maxTokens=1500.
 *   - dream() passes a non-empty systemPrompt to the provider.
 *   - dream() returns durationMs as a finite non-negative number.
 *   - dream() returns rawResponse as a string (the original LLM
 *     content, even when parsing fails).
 *   - dreamer.ts imports DREAM_SYSTEM_PROMPT from prompts.js (not
 *     re-defines it locally).
 *   - dreamer.ts imports coerceBacklogItem and coerceMemoryEntry from
 *     llm-result.js (Iteration 46 extraction).
 *   - dreamer.ts imports normalizeGoal, isDuplicateGoal, buildSucceeded-
 *     GoalSet from dreamer-dedup.js (Iteration 45 extraction).
 *   - dreamer.ts re-exports buildUserPrompt and DreamInput from
 *     dreamer-prompt.js (Iteration 47 extraction).
 *   - dreamer.ts does NOT re-define any of the extracted helpers.
 *
 * The exactOptionalPropertyTypes check is load-bearing: downstream
 * consumers that distinguish "no parseError key" from "parseError:
 * undefined" rely on the key being absent when parseOk=true.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dream, type DreamOutput, type DreamInput } from '../../src/cerebellum/dreamer.js';
import type {
  DreamBacklogItem,
  DreamMemoryEntry,
  DreamAddedBacklogItem,
  DreamAddedMemoryEntry,
} from '../../src/cerebellum/dreamer.js';
import type { LLMProvider, LLMCompletion, LLMCompleteOptions } from '../../src/llm/provider.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeFakeProvider(
  responseContent: string,
  capture: { prompt?: string; options?: LLMCompleteOptions } = {},
): LLMProvider {
  return {
    async complete(prompt: string, options?: LLMCompleteOptions): Promise<LLMCompletion> {
      capture.prompt = prompt;
      capture.options = options;
      return {
        content: responseContent,
        model: 'fake-model',
        usage: { inputTokens: 0, outputTokens: 0 },
        finishReason: 'stop',
      };
    },
    async *stream() {
      yield responseContent;
    },
    getModel() {
      return 'fake-model';
    },
  };
}

// Shared temp dir setup so each test gets a clean rootDir.
let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ody-dreamer-inv-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeDreamInput(
  provider: LLMProvider,
  overrides: Partial<DreamInput> = {},
): DreamInput {
  return {
    rootDir: tempDir,
    provider,
    recentTrace: [],
    memorySnapshot: [
      { category: 'patterns', entries: [] },
      { category: 'lessons', entries: [] },
      { category: 'preferences', entries: [] },
      { category: 'dreams', entries: [] },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// DreamOutput type shape — parseOk=false path
// ---------------------------------------------------------------------------

describe('DreamOutput type shape — parseOk=false', () => {
  test('returns exactly 9 keys (parseError present on failure)', async () => {
    const output = await dream(
      makeDreamInput(makeFakeProvider('not valid json')),
    );
    expect(output.parseOk).toBe(false);
    expect(Object.keys(output).sort()).toEqual(
      [
        'addedBacklogItems',
        'addedMemoryEntries',
        'backlogItemsAdded',
        'backlogItemsSkipped',
        'durationMs',
        'memoryEntriesAdded',
        'parseError',
        'parseOk',
        'rawResponse',
      ].sort(),
    );
  });

  test('parseError key is PRESENT when parsing fails', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('garbage')));
    expect('parseError' in output).toBe(true);
    expect(typeof output.parseError).toBe('string');
    expect(output.parseError!.length).toBeGreaterThan(0);
  });

  test('parseOk is strictly boolean', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('garbage')));
    expect(typeof output.parseOk).toBe('boolean');
    expect(output.parseOk).toBe(false);
  });

  test('rawResponse carries the original LLM content verbatim', async () => {
    const output = await dream(
      makeDreamInput(makeFakeProvider('raw-not-json-content')),
    );
    expect(output.rawResponse).toBe('raw-not-json-content');
  });

  test('durationMs is a non-negative finite number', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('garbage')));
    expect(typeof output.durationMs).toBe('number');
    expect(Number.isFinite(output.durationMs)).toBe(true);
    expect(output.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('addedBacklogItems is an empty array on parse failure', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('garbage')));
    expect(Array.isArray(output.addedBacklogItems)).toBe(true);
    expect(output.addedBacklogItems).toEqual([]);
  });

  test('addedMemoryEntries is an empty array on parse failure', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('garbage')));
    expect(Array.isArray(output.addedMemoryEntries)).toBe(true);
    expect(output.addedMemoryEntries).toEqual([]);
  });

  test('backlogItemsAdded is 0 on parse failure', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('garbage')));
    expect(output.backlogItemsAdded).toBe(0);
  });

  test('backlogItemsSkipped is 0 on parse failure', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('garbage')));
    expect(output.backlogItemsSkipped).toBe(0);
  });

  test('memoryEntriesAdded is 0 on parse failure', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('garbage')));
    expect(output.memoryEntriesAdded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DreamOutput type shape — parseOk=true path
// ---------------------------------------------------------------------------

describe('DreamOutput type shape — parseOk=true', () => {
  test('returns exactly 8 keys (parseError ABSENT on success)', async () => {
    const output = await dream(
      makeDreamInput(makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] }))),
    );
    expect(output.parseOk).toBe(true);
    expect(Object.keys(output).sort()).toEqual(
      [
        'addedBacklogItems',
        'addedMemoryEntries',
        'backlogItemsAdded',
        'backlogItemsSkipped',
        'durationMs',
        'memoryEntriesAdded',
        'parseOk',
        'rawResponse',
      ].sort(),
    );
  });

  test('parseError key is ABSENT when parseOk=true (exactOptionalPropertyTypes)', async () => {
    // The 'in' operator checks key existence regardless of value —
    // the key must not be present at all under exactOptionalPropertyTypes.
    const output = await dream(
      makeDreamInput(makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] }))),
    );
    expect(output.parseOk).toBe(true);
    expect('parseError' in output).toBe(false);
  });

  test('parseOk is strictly boolean', async () => {
    const output = await dream(
      makeDreamInput(makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] }))),
    );
    expect(typeof output.parseOk).toBe('boolean');
    expect(output.parseOk).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DreamOutput type — TypeScript compile-time field presence
// ---------------------------------------------------------------------------

describe('DreamOutput type — required field shapes', () => {
  test('backlogItemsAdded is a number', async () => {
    const output = await dream(
      makeDreamInput(makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] }))),
    );
    expect(typeof output.backlogItemsAdded).toBe('number');
  });

  test('backlogItemsSkipped is a number', async () => {
    const output = await dream(
      makeDreamInput(makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] }))),
    );
    expect(typeof output.backlogItemsSkipped).toBe('number');
  });

  test('memoryEntriesAdded is a number', async () => {
    const output = await dream(
      makeDreamInput(makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] }))),
    );
    expect(typeof output.memoryEntriesAdded).toBe('number');
  });

  test('addedBacklogItems is an array', async () => {
    const output = await dream(
      makeDreamInput(makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] }))),
    );
    expect(Array.isArray(output.addedBacklogItems)).toBe(true);
  });

  test('addedMemoryEntries is an array', async () => {
    const output = await dream(
      makeDreamInput(makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] }))),
    );
    expect(Array.isArray(output.addedMemoryEntries)).toBe(true);
  });

  test('rawResponse is a string', async () => {
    const output = await dream(
      makeDreamInput(makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] }))),
    );
    expect(typeof output.rawResponse).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// dream() — provider call contract
// ---------------------------------------------------------------------------

describe('dream() — provider call contract', () => {
  test('passes temperature=0.9 (divergent thinking)', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await dream(
      makeDreamInput(makeFakeProvider('{}', capture)),
    );
    expect(capture.options?.temperature).toBe(0.9);
  });

  test('passes maxTokens=1500', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await dream(
      makeDreamInput(makeFakeProvider('{}', capture)),
    );
    expect(capture.options?.maxTokens).toBe(1500);
  });

  test('passes a non-empty systemPrompt', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await dream(
      makeDreamInput(makeFakeProvider('{}', capture)),
    );
    expect(typeof capture.options?.systemPrompt).toBe('string');
    expect((capture.options?.systemPrompt ?? '').length).toBeGreaterThan(0);
  });

  test('systemPrompt mentions JSON output', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await dream(
      makeDreamInput(makeFakeProvider('{}', capture)),
    );
    const sp = capture.options?.systemPrompt ?? '';
    expect(sp).toContain('JSON');
  });

  test('systemPrompt mentions backlogItems or memoryEntries (output keys)', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await dream(
      makeDreamInput(makeFakeProvider('{}', capture)),
    );
    const sp = capture.options?.systemPrompt ?? '';
    expect(sp.toLowerCase()).toContain('backlog');
  });

  test('systemPrompt is the DREAM_SYSTEM_PROMPT (dreaming state framing)', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await dream(
      makeDreamInput(makeFakeProvider('{}', capture)),
    );
    const sp = capture.options?.systemPrompt ?? '';
    // DREAM_SYSTEM_PROMPT begins with "You are Odysseus in a dreaming state."
    expect(sp).toContain('dreaming state');
  });

  test('prompt passed to provider is non-empty', async () => {
    const capture: { prompt?: string } = {};
    await dream(
      makeDreamInput(makeFakeProvider('{}', capture)),
    );
    expect(typeof capture.prompt).toBe('string');
    expect(capture.prompt!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// dream() — provider error propagation
// ---------------------------------------------------------------------------

describe('dream() — provider error propagation', () => {
  test('provider throw propagates to caller (not swallowed as parseOk=false)', async () => {
    const failing: LLMProvider = {
      async complete() {
        throw new Error('network down');
      },
      async *stream() {
        throw new Error('network down');
      },
      getModel() {
        return 'failing';
      },
    };
    await expect(dream(makeDreamInput(failing))).rejects.toThrow('network down');
  });

  test('provider throwing a non-Error value still propagates', async () => {
    const failing: LLMProvider = {
      async complete() {
        throw 'string error';
      },
      async *stream() {
        throw 'string error';
      },
      getModel() {
        return 'failing';
      },
    };
    await expect(dream(makeDreamInput(failing))).rejects.toBe('string error');
  });
});

// ---------------------------------------------------------------------------
// dream() — determinism on same fake response
// ---------------------------------------------------------------------------

describe('dream() — determinism', () => {
  test('same LLM response produces same steps across two calls', async () => {
    const json = JSON.stringify({
      backlogItems: [],
      memoryEntries: [],
    });
    const provider = makeFakeProvider(json);
    const out1 = await dream(makeDreamInput(provider));
    const out2 = await dream(makeDreamInput(provider));
    expect(out1.parseOk).toBe(out2.parseOk);
    expect(out1.backlogItemsAdded).toBe(out2.backlogItemsAdded);
    expect(out1.memoryEntriesAdded).toBe(out2.memoryEntriesAdded);
  });
});

// ---------------------------------------------------------------------------
// Type aliases exported (compile-time check via assignment)
// ---------------------------------------------------------------------------

describe('Type aliases exported from dreamer.ts', () => {
  test('DreamBacklogItem alias exists and accepts the right shape', () => {
    const item: DreamBacklogItem = {
      goal: 'g',
      priority: 50,
    };
    expect(item.goal).toBe('g');
    expect(item.priority).toBe(50);
  });

  test('DreamMemoryEntry alias exists and accepts the right shape', () => {
    const entry: DreamMemoryEntry = {
      category: 'patterns',
      title: 't',
      body: 'b',
    };
    expect(entry.category).toBe('patterns');
    expect(entry.title).toBe('t');
  });

  test('DreamAddedBacklogItem alias exists with id/goal/priority', () => {
    const added: DreamAddedBacklogItem = {
      id: 'bl_abc',
      goal: 'g',
      priority: 50,
    };
    expect(added.id).toBe('bl_abc');
  });

  test('DreamAddedMemoryEntry alias exists with id/category/title', () => {
    const added: DreamAddedMemoryEntry = {
      id: 'mem_abc',
      category: 'patterns',
      title: 't',
    };
    expect(added.id).toBe('mem_abc');
  });

  test('DreamOutput type is constructible from a real dream() call', async () => {
    // TypeScript enforces this at compile time; runtime check that the
    // returned object has the right runtime shape.
    const output: DreamOutput = await dream(
      makeDreamInput(makeFakeProvider('{}')),
    );
    expect(output).toBeDefined();
    expect(typeof output).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// Extraction invariants — dreamer.ts sources helpers from sibling modules
// ---------------------------------------------------------------------------

describe('dreamer.ts extraction invariants', () => {
  test('imports DREAM_SYSTEM_PROMPT from prompts.js (not re-defined)', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/dreamer.ts', 'utf8');
    expect(src).toContain("from './prompts.js'");
    expect(src).toContain('DREAM_SYSTEM_PROMPT');
    // Must NOT define it locally.
    expect(src).not.toMatch(/export\s+const\s+DREAM_SYSTEM_PROMPT\s*=/);
  });

  test('imports coerceBacklogItem and coerceMemoryEntry from llm-result.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/dreamer.ts', 'utf8');
    expect(src).toContain("from './llm-result.js'");
    expect(src).toContain('coerceBacklogItem');
    expect(src).toContain('coerceMemoryEntry');
    // Must NOT re-define them.
    expect(src).not.toMatch(/function\s+coerceBacklogItem/);
    expect(src).not.toMatch(/function\s+coerceMemoryEntry/);
  });

  test('imports normalizeGoal, isDuplicateGoal, buildSucceededGoalSet from dreamer-dedup.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/dreamer.ts', 'utf8');
    expect(src).toContain("from './dreamer-dedup.js'");
    expect(src).toContain('normalizeGoal');
    expect(src).toContain('isDuplicateGoal');
    expect(src).toContain('buildSucceededGoalSet');
  });

  test('imports buildUserPrompt and DreamInput from dreamer-prompt.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/dreamer.ts', 'utf8');
    expect(src).toContain("from './dreamer-prompt.js'");
    expect(src).toContain('buildUserPrompt');
    expect(src).toContain('DreamInput');
  });

  test('re-exports buildUserPrompt and DreamInput for backwards compat', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/dreamer.ts', 'utf8');
    expect(src).toMatch(/export\s*\{[^}]*buildUserPrompt[^}]*\}\s*from\s*['"]\.\/dreamer-prompt\.js['"]/);
  });

  test('imports extractJsonObject from extract-json.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/dreamer.ts', 'utf8');
    expect(src).toContain("from './extract-json.js'");
    expect(src).toContain('extractJsonObject');
  });

  test('imports writeMemory from memory.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/dreamer.ts', 'utf8');
    expect(src).toContain("from './memory.js'");
    expect(src).toContain('writeMemory');
  });

  test('imports enqueuePendingReview, autoApproveAllPendingReview, shouldAutoApprove from pending-review.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/dreamer.ts', 'utf8');
    expect(src).toContain("from './pending-review.js'");
    expect(src).toContain('enqueuePendingReview');
    expect(src).toContain('autoApproveAllPendingReview');
    expect(src).toContain('shouldAutoApprove');
  });
});

// ---------------------------------------------------------------------------
// dream() — empty / edge-case JSON shapes
// ---------------------------------------------------------------------------

describe('dream() — empty / edge-case JSON shapes', () => {
  test('JSON with no arrays yields parseOk=true with zero counts', async () => {
    const output = await dream(
      makeDreamInput(makeFakeProvider(JSON.stringify({}))),
    );
    expect(output.parseOk).toBe(true);
    expect(output.backlogItemsAdded).toBe(0);
    expect(output.memoryEntriesAdded).toBe(0);
  });

  test('JSON with empty arrays yields parseOk=true with zero counts', async () => {
    const output = await dream(
      makeDreamInput(
        makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] })),
      ),
    );
    expect(output.parseOk).toBe(true);
    expect(output.backlogItemsAdded).toBe(0);
    expect(output.memoryEntriesAdded).toBe(0);
  });

  test('JSON with only backlogItems (no memoryEntries) still parses', async () => {
    const output = await dream(
      makeDreamInput(
        makeFakeProvider(JSON.stringify({ backlogItems: [] })),
      ),
    );
    expect(output.parseOk).toBe(true);
  });

  test('JSON wrapped in markdown code fence parses', async () => {
    const fenced = '```json\n' + JSON.stringify({ backlogItems: [], memoryEntries: [] }) + '\n```';
    const output = await dream(makeDreamInput(makeFakeProvider(fenced)));
    expect(output.parseOk).toBe(true);
  });

  test('null content yields parseOk=false', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('null')));
    expect(output.parseOk).toBe(false);
  });

  test('array content (not object) yields parseOk=false', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('[]')));
    expect(output.parseOk).toBe(false);
  });

  test('number content yields parseOk=false', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('42')));
    expect(output.parseOk).toBe(false);
  });

  test('empty string content yields parseOk=false', async () => {
    const output = await dream(makeDreamInput(makeFakeProvider('')));
    expect(output.parseOk).toBe(false);
  });
});
