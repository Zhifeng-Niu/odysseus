/**
 * Invariants for src/cerebellum/curiosity.ts.
 *
 * curiosity.test.ts covers behavior: valid JSON produces items with
 * origin=curiosity, garbage yields parseOk=false, default priority 90,
 * dedup against succeeded goals, auto-approve routing, shouldRun-
 * Curiosity env-var matrix. This file pins the load-bearing structural
 * contracts that behavior tests imply but do not make explicit:
 *
 *   - CuriosityOutput type shape: exactly { backlogItemsAdded,
 *     backlogItemsSkipped, memoryEntriesAdded, addedBacklogItems,
 *     addedMemoryEntries, rawResponse, durationMs, parseOk, parseError? }.
 *   - exactOptionalPropertyTypes contract: parseError key is ABSENT
 *     when parseOk=true (verified via 'parseError' in obj).
 *   - parseError is PRESENT when parseOk=false.
 *   - CuriosityBacklogItem / CuriosityMemoryEntry / CuriosityAdded-
 *     BacklogItem / CuriosityAddedMemoryEntry type aliases are exported.
 *   - curiosity() calls provider.complete with temperature=0.8 (high
 *     temp, slightly lower than dreamer's 0.9 — curiosity is more
 *     focused) and maxTokens=1800.
 *   - curiosity() passes a non-empty systemPrompt (CURIOSITY_SYSTEM_
 *     PROMPT) to the provider.
 *   - curiosity() returns durationMs as a finite non-negative number.
 *   - curiosity() returns rawResponse as a string (the original LLM
 *     content, even when parsing fails).
 *   - shouldRunCuriosity defaults to true when env var is absent.
 *   - shouldRunCuriosity is false for '0', 'false', 'no' (escape
 *     hatches); true for all other values including '1', 'yes', 'true'.
 *   - curiosity.ts imports CURIOSITY_SYSTEM_PROMPT from prompts.js.
 *   - curiosity.ts imports coerceBacklogItem, coerceMemoryEntry from
 *     llm-result.js.
 *   - curiosity.ts imports isDuplicateGoal, buildSucceededGoalSet
 *     from dreamer-dedup.js.
 *   - curiosity.ts re-exports buildCuriosityUserPrompt and
 *     CuriosityInput from curiosity-prompt.js.
 *
 * Parallel structure to dreamer-invariants.test.ts (Iter 98).
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  curiosity,
  shouldRunCuriosity,
  type CuriosityOutput,
  type CuriosityInput,
} from '../../src/cerebellum/curiosity.js';
import type {
  CuriosityBacklogItem,
  CuriosityMemoryEntry,
  CuriosityAddedBacklogItem,
  CuriosityAddedMemoryEntry,
} from '../../src/cerebellum/curiosity.js';
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

let tempDir: string;
const envSnapshot: Record<string, string | undefined> = {};

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ody-curiosity-inv-'));
  // Snapshot ODYSSEUS_CURIOSITY so we can restore it after each test.
  envSnapshot.ODYSSEUS_CURIOSITY = process.env.ODYSSEUS_CURIOSITY;
  delete process.env.ODYSSEUS_CURIOSITY;
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  // Restore env.
  if (envSnapshot.ODYSSEUS_CURIOSITY === undefined) {
    delete process.env.ODYSSEUS_CURIOSITY;
  } else {
    process.env.ODYSSEUS_CURIOSITY = envSnapshot.ODYSSEUS_CURIOSITY;
  }
});

function makeCuriosityInput(
  provider: LLMProvider,
  overrides: Partial<CuriosityInput> = {},
): CuriosityInput {
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
// shouldRunCuriosity — env var matrix
// ---------------------------------------------------------------------------

describe('shouldRunCuriosity — env var matrix', () => {
  test('returns true when env var is absent (autonomous default)', () => {
    delete process.env.ODYSSEUS_CURIOSITY;
    expect(shouldRunCuriosity()).toBe(true);
  });

  test('returns true when env var is empty string', () => {
    process.env.ODYSSEUS_CURIOSITY = '';
    expect(shouldRunCuriosity()).toBe(true);
  });

  test('returns true when env var is "1"', () => {
    process.env.ODYSSEUS_CURIOSITY = '1';
    expect(shouldRunCuriosity()).toBe(true);
  });

  test('returns true when env var is "yes"', () => {
    process.env.ODYSSEUS_CURIOSITY = 'yes';
    expect(shouldRunCuriosity()).toBe(true);
  });

  test('returns true when env var is "true"', () => {
    process.env.ODYSSEUS_CURIOSITY = 'true';
    expect(shouldRunCuriosity()).toBe(true);
  });

  test('returns true when env var is any other non-escape value', () => {
    process.env.ODYSSEUS_CURIOSITY = 'on';
    expect(shouldRunCuriosity()).toBe(true);
  });

  test('returns false when env var is "0" (escape hatch)', () => {
    process.env.ODYSSEUS_CURIOSITY = '0';
    expect(shouldRunCuriosity()).toBe(false);
  });

  test('returns false when env var is "false" (escape hatch)', () => {
    process.env.ODYSSEUS_CURIOSITY = 'false';
    expect(shouldRunCuriosity()).toBe(false);
  });

  test('returns false when env var is "no" (escape hatch)', () => {
    process.env.ODYSSEUS_CURIOSITY = 'no';
    expect(shouldRunCuriosity()).toBe(false);
  });

  test('is case-sensitive (FALSE is NOT the same as false)', () => {
    // Documenting actual behavior — only lowercase 'false' is an escape.
    process.env.ODYSSEUS_CURIOSITY = 'FALSE';
    expect(shouldRunCuriosity()).toBe(true);
  });

  test('returns strictly boolean', () => {
    delete process.env.ODYSSEUS_CURIOSITY;
    const r = shouldRunCuriosity();
    expect(typeof r).toBe('boolean');
  });

  test('deterministic across multiple calls with same env', () => {
    process.env.ODYSSEUS_CURIOSITY = '0';
    const a = shouldRunCuriosity();
    const b = shouldRunCuriosity();
    const c = shouldRunCuriosity();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

// ---------------------------------------------------------------------------
// CuriosityOutput type shape — parseOk=false path
// ---------------------------------------------------------------------------

describe('CuriosityOutput type shape — parseOk=false', () => {
  test('returns exactly 9 keys (parseError present on failure)', async () => {
    const output = await curiosity(
      makeCuriosityInput(makeFakeProvider('not valid json')),
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
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('garbage')));
    expect('parseError' in output).toBe(true);
    expect(typeof output.parseError).toBe('string');
    expect(output.parseError!.length).toBeGreaterThan(0);
  });

  test('parseOk is strictly boolean', async () => {
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('garbage')));
    expect(typeof output.parseOk).toBe('boolean');
    expect(output.parseOk).toBe(false);
  });

  test('rawResponse carries the original LLM content verbatim', async () => {
    const output = await curiosity(
      makeCuriosityInput(makeFakeProvider('raw-not-json-content')),
    );
    expect(output.rawResponse).toBe('raw-not-json-content');
  });

  test('durationMs is a non-negative finite number', async () => {
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('garbage')));
    expect(typeof output.durationMs).toBe('number');
    expect(Number.isFinite(output.durationMs)).toBe(true);
    expect(output.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('addedBacklogItems is an empty array on parse failure', async () => {
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('garbage')));
    expect(Array.isArray(output.addedBacklogItems)).toBe(true);
    expect(output.addedBacklogItems).toEqual([]);
  });

  test('addedMemoryEntries is an empty array on parse failure', async () => {
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('garbage')));
    expect(Array.isArray(output.addedMemoryEntries)).toBe(true);
    expect(output.addedMemoryEntries).toEqual([]);
  });

  test('backlogItemsAdded is 0 on parse failure', async () => {
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('garbage')));
    expect(output.backlogItemsAdded).toBe(0);
  });

  test('backlogItemsSkipped is 0 on parse failure', async () => {
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('garbage')));
    expect(output.backlogItemsSkipped).toBe(0);
  });

  test('memoryEntriesAdded is 0 on parse failure', async () => {
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('garbage')));
    expect(output.memoryEntriesAdded).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CuriosityOutput type shape — parseOk=true path
// ---------------------------------------------------------------------------

describe('CuriosityOutput type shape — parseOk=true', () => {
  test('returns exactly 8 keys (parseError ABSENT on success)', async () => {
    const output = await curiosity(
      makeCuriosityInput(
        makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] })),
      ),
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
    const output = await curiosity(
      makeCuriosityInput(
        makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] })),
      ),
    );
    expect(output.parseOk).toBe(true);
    expect('parseError' in output).toBe(false);
  });

  test('parseOk is strictly boolean', async () => {
    const output = await curiosity(
      makeCuriosityInput(
        makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] })),
      ),
    );
    expect(typeof output.parseOk).toBe('boolean');
    expect(output.parseOk).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CuriosityOutput required field shapes
// ---------------------------------------------------------------------------

describe('CuriosityOutput required field shapes', () => {
  test('backlogItemsAdded is a number', async () => {
    const output = await curiosity(
      makeCuriosityInput(makeFakeProvider(JSON.stringify({}))),
    );
    expect(typeof output.backlogItemsAdded).toBe('number');
  });

  test('backlogItemsSkipped is a number', async () => {
    const output = await curiosity(
      makeCuriosityInput(makeFakeProvider(JSON.stringify({}))),
    );
    expect(typeof output.backlogItemsSkipped).toBe('number');
  });

  test('memoryEntriesAdded is a number', async () => {
    const output = await curiosity(
      makeCuriosityInput(makeFakeProvider(JSON.stringify({}))),
    );
    expect(typeof output.memoryEntriesAdded).toBe('number');
  });

  test('addedBacklogItems is an array', async () => {
    const output = await curiosity(
      makeCuriosityInput(makeFakeProvider(JSON.stringify({}))),
    );
    expect(Array.isArray(output.addedBacklogItems)).toBe(true);
  });

  test('addedMemoryEntries is an array', async () => {
    const output = await curiosity(
      makeCuriosityInput(makeFakeProvider(JSON.stringify({}))),
    );
    expect(Array.isArray(output.addedMemoryEntries)).toBe(true);
  });

  test('rawResponse is a string', async () => {
    const output = await curiosity(
      makeCuriosityInput(makeFakeProvider(JSON.stringify({}))),
    );
    expect(typeof output.rawResponse).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// curiosity() — provider call contract
// ---------------------------------------------------------------------------

describe('curiosity() — provider call contract', () => {
  test('passes temperature=0.8 (high temp, slightly lower than dreamer)', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await curiosity(makeCuriosityInput(makeFakeProvider('{}', capture)));
    expect(capture.options?.temperature).toBe(0.8);
  });

  test('passes maxTokens=1800 (larger than dreamer 1500 — bigger self-model footprint)', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await curiosity(makeCuriosityInput(makeFakeProvider('{}', capture)));
    expect(capture.options?.maxTokens).toBe(1800);
  });

  test('passes a non-empty systemPrompt', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await curiosity(makeCuriosityInput(makeFakeProvider('{}', capture)));
    expect(typeof capture.options?.systemPrompt).toBe('string');
    expect((capture.options?.systemPrompt ?? '').length).toBeGreaterThan(0);
  });

  test('systemPrompt is the CURIOSITY_SYSTEM_PROMPT (curiosity state framing)', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await curiosity(makeCuriosityInput(makeFakeProvider('{}', capture)));
    const sp = capture.options?.systemPrompt ?? '';
    expect(sp).toContain('curiosity state');
  });

  test('systemPrompt mentions JSON output', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await curiosity(makeCuriosityInput(makeFakeProvider('{}', capture)));
    const sp = capture.options?.systemPrompt ?? '';
    expect(sp).toContain('JSON');
  });

  test('systemPrompt looks FORWARD (curiosity vs dreamer asymmetry)', async () => {
    const capture: { options?: LLMCompleteOptions } = {};
    await curiosity(makeCuriosityInput(makeFakeProvider('{}', capture)));
    const sp = capture.options?.systemPrompt ?? '';
    expect(sp).toContain('FORWARD');
  });

  test('prompt passed to provider is non-empty', async () => {
    const capture: { prompt?: string } = {};
    await curiosity(makeCuriosityInput(makeFakeProvider('{}', capture)));
    expect(typeof capture.prompt).toBe('string');
    expect(capture.prompt!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// curiosity() — provider error propagation
// ---------------------------------------------------------------------------

describe('curiosity() — provider error propagation', () => {
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
    await expect(curiosity(makeCuriosityInput(failing))).rejects.toThrow('network down');
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
    await expect(curiosity(makeCuriosityInput(failing))).rejects.toBe('string error');
  });
});

// ---------------------------------------------------------------------------
// curiosity() — determinism
// ---------------------------------------------------------------------------

describe('curiosity() — determinism', () => {
  test('same LLM response produces same counts across two calls', async () => {
    const json = JSON.stringify({ backlogItems: [], memoryEntries: [] });
    const provider = makeFakeProvider(json);
    const out1 = await curiosity(makeCuriosityInput(provider));
    const out2 = await curiosity(makeCuriosityInput(provider));
    expect(out1.parseOk).toBe(out2.parseOk);
    expect(out1.backlogItemsAdded).toBe(out2.backlogItemsAdded);
    expect(out1.memoryEntriesAdded).toBe(out2.memoryEntriesAdded);
  });
});

// ---------------------------------------------------------------------------
// Type aliases exported
// ---------------------------------------------------------------------------

describe('Type aliases exported from curiosity.ts', () => {
  test('CuriosityBacklogItem alias exists and accepts the right shape', () => {
    const item: CuriosityBacklogItem = {
      goal: 'g',
      priority: 50,
    };
    expect(item.goal).toBe('g');
    expect(item.priority).toBe(50);
  });

  test('CuriosityMemoryEntry alias exists and accepts the right shape', () => {
    const entry: CuriosityMemoryEntry = {
      category: 'patterns',
      title: 't',
      body: 'b',
    };
    expect(entry.category).toBe('patterns');
    expect(entry.title).toBe('t');
  });

  test('CuriosityAddedBacklogItem alias exists with id/goal/priority', () => {
    const added: CuriosityAddedBacklogItem = {
      id: 'bl_abc',
      goal: 'g',
      priority: 90,
    };
    expect(added.id).toBe('bl_abc');
  });

  test('CuriosityAddedMemoryEntry alias exists with id/category/title', () => {
    const added: CuriosityAddedMemoryEntry = {
      id: 'mem_abc',
      category: 'patterns',
      title: 't',
    };
    expect(added.id).toBe('mem_abc');
  });

  test('CuriosityOutput type is constructible from a real curiosity() call', async () => {
    const output: CuriosityOutput = await curiosity(
      makeCuriosityInput(makeFakeProvider('{}')),
    );
    expect(output).toBeDefined();
    expect(typeof output).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// Extraction invariants — curiosity.ts sources helpers from sibling modules
// ---------------------------------------------------------------------------

describe('curiosity.ts extraction invariants', () => {
  test('imports CURIOSITY_SYSTEM_PROMPT from prompts.js (not re-defined)', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/curiosity.ts', 'utf8');
    expect(src).toContain("from './prompts.js'");
    expect(src).toContain('CURIOSITY_SYSTEM_PROMPT');
    // Must NOT define it locally.
    expect(src).not.toMatch(/export\s+const\s+CURIOSITY_SYSTEM_PROMPT\s*=/);
  });

  test('imports coerceBacklogItem and coerceMemoryEntry from llm-result.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/curiosity.ts', 'utf8');
    expect(src).toContain("from './llm-result.js'");
    expect(src).toContain('coerceBacklogItem');
    expect(src).toContain('coerceMemoryEntry');
    expect(src).not.toMatch(/function\s+coerceBacklogItem/);
    expect(src).not.toMatch(/function\s+coerceMemoryEntry/);
  });

  test('imports isDuplicateGoal and buildSucceededGoalSet from dreamer-dedup.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/curiosity.ts', 'utf8');
    expect(src).toContain("from './dreamer-dedup.js'");
    expect(src).toContain('isDuplicateGoal');
    expect(src).toContain('buildSucceededGoalSet');
  });

  test('imports buildCuriosityUserPrompt and CuriosityInput from curiosity-prompt.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/curiosity.ts', 'utf8');
    expect(src).toContain("from './curiosity-prompt.js'");
    expect(src).toContain('buildCuriosityUserPrompt');
    expect(src).toContain('CuriosityInput');
  });

  test('re-exports buildCuriosityUserPrompt and CuriosityInput for backwards compat', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/curiosity.ts', 'utf8');
    expect(src).toMatch(/export\s*\{[^}]*buildCuriosityUserPrompt[^}]*\}\s*from\s*['"]\.\/curiosity-prompt\.js['"]/);
  });

  test('imports extractJsonObject from extract-json.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/curiosity.ts', 'utf8');
    expect(src).toContain("from './extract-json.js'");
    expect(src).toContain('extractJsonObject');
  });

  test('imports writeMemory from memory.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/curiosity.ts', 'utf8');
    expect(src).toContain("from './memory.js'");
    expect(src).toContain('writeMemory');
  });

  test('imports enqueuePendingReview, autoApproveAllPendingReview, shouldAutoApprove from pending-review.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/curiosity.ts', 'utf8');
    expect(src).toContain("from './pending-review.js'");
    expect(src).toContain('enqueuePendingReview');
    expect(src).toContain('autoApproveAllPendingReview');
    expect(src).toContain('shouldAutoApprove');
  });

  test('imports appendExploration from exploration-log.js', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile('src/cerebellum/curiosity.ts', 'utf8');
    expect(src).toContain("from './exploration-log.js'");
    expect(src).toContain('appendExploration');
  });
});

// ---------------------------------------------------------------------------
// curiosity() — empty / edge-case JSON shapes
// ---------------------------------------------------------------------------

describe('curiosity() — empty / edge-case JSON shapes', () => {
  test('JSON with no arrays yields parseOk=true with zero counts', async () => {
    const output = await curiosity(
      makeCuriosityInput(makeFakeProvider(JSON.stringify({}))),
    );
    expect(output.parseOk).toBe(true);
    expect(output.backlogItemsAdded).toBe(0);
    expect(output.memoryEntriesAdded).toBe(0);
  });

  test('JSON with empty arrays yields parseOk=true with zero counts', async () => {
    const output = await curiosity(
      makeCuriosityInput(
        makeFakeProvider(JSON.stringify({ backlogItems: [], memoryEntries: [] })),
      ),
    );
    expect(output.parseOk).toBe(true);
    expect(output.backlogItemsAdded).toBe(0);
    expect(output.memoryEntriesAdded).toBe(0);
  });

  test('JSON with only backlogItems (no memoryEntries) still parses', async () => {
    const output = await curiosity(
      makeCuriosityInput(
        makeFakeProvider(JSON.stringify({ backlogItems: [] })),
      ),
    );
    expect(output.parseOk).toBe(true);
  });

  test('JSON wrapped in markdown code fence parses', async () => {
    const fenced = '```json\n' + JSON.stringify({ backlogItems: [], memoryEntries: [] }) + '\n```';
    const output = await curiosity(makeCuriosityInput(makeFakeProvider(fenced)));
    expect(output.parseOk).toBe(true);
  });

  test('null content yields parseOk=false', async () => {
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('null')));
    expect(output.parseOk).toBe(false);
  });

  test('array content (not object) yields parseOk=false', async () => {
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('[]')));
    expect(output.parseOk).toBe(false);
  });

  test('number content yields parseOk=false', async () => {
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('42')));
    expect(output.parseOk).toBe(false);
  });

  test('empty string content yields parseOk=false', async () => {
    const output = await curiosity(makeCuriosityInput(makeFakeProvider('')));
    expect(output.parseOk).toBe(false);
  });
});
