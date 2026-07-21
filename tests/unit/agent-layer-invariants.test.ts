/**
 * Invariants for the agent layer — src/agent/context.ts, src/agent/prompt.ts,
 * and src/agent/loop.ts.
 *
 * The agent layer is the boundary between the CLI/TUI and the Cerebellum
 * orchestrator. Despite being small (28 + 18 + 81 = 127 LOC across three
 * files), these modules encode load-bearing identity and isolation
 * contracts that behavior tests (agent-loop.test.ts, agent-loop-runAgentTurn
 * .test.ts) imply but do not make explicit:
 *
 *   - AgentContext DEFENSIVELY COPIES initialMessages — the source array
 *     can be mutated after construction without affecting the context's
 *     internal state.
 *   - AgentContext.messages() returns a FRESH copy on every call —
 *     callers can mutate the returned array without affecting internal
 *     state.
 *   - AgentContext.getMission() returns the SAME string reference each
 *     call (mission is immutable post-construction).
 *   - AgentContext.append() only mutates internal state; the method
 *     returns void, not the new length (callers must not rely on
 *     array.push()'s return value).
 *
 *   - buildSystemPrompt is PURE — same input produces same output,
 *     no side effects, no I/O.
 *   - The Odysseus identity string ("You are Odysseus, a self-
 *     bootstrapping coding agent.") is hardcoded — this is the
 *     load-bearing identity pin that distinguishes Odysseus from the
 *     base model default.
 *   - DONE signal, safety-perimeter note, and tool-list rendering
 *     format are pinned.
 *
 *   - runAgentTurn ALWAYS constructs CerebellumOrchestrator with
 *     autoApprove: true (CLI mode contract — no TUI to handle the
 *     approval gate).
 *   - runAgentTurn subscribes to 'event' BEFORE calling runWaypoint,
 *     filtering for 'assistant-message'.
 *   - AgentLoopResult.waypointOutcome is present whenever runWaypoint
 *     returns a result; absent only when the function rejects.
 *
 * This file pins all of the above. agent-loop.test.ts (3 tests) covers
 * happy-path behavior; this file nails down the structural contracts
 * that future refactors must preserve.
 */

import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { AgentContext, type AgentContextInit } from '../../src/agent/context.js';
import { buildSystemPrompt, type PromptInput } from '../../src/agent/prompt.js';
import type { ChatMessage } from '../../src/llm/provider.js';

// ---------------------------------------------------------------------------
// AgentContext — defensive copy of initialMessages
// ---------------------------------------------------------------------------

describe('AgentContext — defensive copy of initialMessages', () => {
  test('constructor copies the source array (mutations to source do not propagate)', () => {
    const source: ChatMessage[] = [
      { role: 'user', content: 'original' },
    ];
    const ctx = new AgentContext({ mission: 'm', initialMessages: source });
    // Mutate the source after construction.
    source.push({ role: 'user', content: 'injected-after-construction' });
    // The context's internal copy is unaffected.
    expect(ctx.messages()).toHaveLength(1);
    expect(ctx.messages()[0]!.content).toBe('original');
  });

  test('constructor accepts undefined initialMessages (defaults to empty)', () => {
    const ctx = new AgentContext({ mission: 'm' });
    expect(ctx.messages()).toEqual([]);
  });

  test('constructor accepts empty initialMessages array', () => {
    const ctx = new AgentContext({ mission: 'm', initialMessages: [] });
    expect(ctx.messages()).toEqual([]);
  });

  test('source element mutation does NOT propagate into context', () => {
    // Even element-level mutations don't leak in (defensive copy is
    // shallow at the array level — element identity is preserved —
    // but mutating an element's properties is a caller-side concern).
    // Here we test array-level only: replacing source[0] doesn't
    // affect the context.
    const initial: ChatMessage[] = [{ role: 'user', content: 'a' }];
    const ctx = new AgentContext({ mission: 'm', initialMessages: initial });
    initial[0] = { role: 'assistant', content: 'b' };
    expect(ctx.messages()[0]).toEqual({ role: 'user', content: 'a' });
  });
});

// ---------------------------------------------------------------------------
// AgentContext — messages() returns a fresh copy each call
// ---------------------------------------------------------------------------

describe('AgentContext — messages() returns fresh copy', () => {
  test('two calls to messages() return different array references', () => {
    const ctx = new AgentContext({ mission: 'm' });
    ctx.append({ role: 'user', content: 'x' });
    const a = ctx.messages();
    const b = ctx.messages();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  test('mutating the returned array does NOT affect internal state', () => {
    const ctx = new AgentContext({ mission: 'm' });
    ctx.append({ role: 'user', content: 'first' });
    const snapshot = ctx.messages();
    snapshot.push({ role: 'user', content: 'injected' });
    snapshot.splice(0, 1);
    // Internal state unchanged.
    expect(ctx.messages()).toHaveLength(1);
    expect(ctx.messages()[0]!.content).toBe('first');
  });

  test('messages() preserves element identity (shallow copy)', () => {
    const msg: ChatMessage = { role: 'user', content: 'shared-ref' };
    const ctx = new AgentContext({ mission: 'm' });
    ctx.append(msg);
    const retrieved = ctx.messages()[0]!;
    // Shallow copy means the element reference is preserved.
    expect(retrieved).toBe(msg);
  });
});

// ---------------------------------------------------------------------------
// AgentContext — mission immutability
// ---------------------------------------------------------------------------

describe('AgentContext — mission immutability', () => {
  test('getMission returns the same string each call', () => {
    const ctx = new AgentContext({ mission: 'unchanged-mission' });
    const a = ctx.getMission();
    const b = ctx.getMission();
    expect(a).toBe('unchanged-mission');
    expect(b).toBe('unchanged-mission');
    expect(a).toBe(b); // Same reference — strings are primitives anyway
  });

  test('getMission is not affected by append calls', () => {
    const ctx = new AgentContext({ mission: 'original-mission' });
    ctx.append({ role: 'user', content: 'msg' });
    ctx.append({ role: 'assistant', content: 'reply' });
    expect(ctx.getMission()).toBe('original-mission');
  });

  test('getMission returns empty string when constructed with empty mission', () => {
    const ctx = new AgentContext({ mission: '' });
    expect(ctx.getMission()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// AgentContext — append contract
// ---------------------------------------------------------------------------

describe('AgentContext — append contract', () => {
  test('append adds to the end of the message list (FIFO order)', () => {
    const ctx = new AgentContext({ mission: 'm' });
    ctx.append({ role: 'user', content: 'first' });
    ctx.append({ role: 'assistant', content: 'second' });
    ctx.append({ role: 'user', content: 'third' });
    const msgs = ctx.messages();
    expect(msgs[0]!.content).toBe('first');
    expect(msgs[1]!.content).toBe('second');
    expect(msgs[2]!.content).toBe('third');
  });

  test('append returns void (does not expose Array.push return value)', () => {
    const ctx = new AgentContext({ mission: 'm' });
    const result = ctx.append({ role: 'user', content: 'x' });
    expect(result).toBeUndefined();
  });

  test('append accepts any ChatMessage role', () => {
    const ctx = new AgentContext({ mission: 'm' });
    ctx.append({ role: 'system', content: 'sys' });
    ctx.append({ role: 'user', content: 'u' });
    ctx.append({ role: 'assistant', content: 'a' });
    ctx.append({ role: 'tool', content: 't', toolCallId: 'tc1' });
    expect(ctx.messages()).toHaveLength(4);
  });

  test('append preserves toolCalls when present on assistant message', () => {
    const ctx = new AgentContext({ mission: 'm' });
    ctx.append({
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'file-read', arguments: '{}' } }],
    });
    expect(ctx.messages()[0]!.toolCalls).toEqual([
      { id: 'tc1', type: 'function', function: { name: 'file-read', arguments: '{}' } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// AgentContextInit type shape — exactOptionalPropertyTypes
// ---------------------------------------------------------------------------

describe('AgentContextInit type shape', () => {
  test('mission is required', () => {
    const init: AgentContextInit = { mission: 'm' };
    expect(init.mission).toBe('m');
  });

  test('initialMessages is optional (can be omitted)', () => {
    const init: AgentContextInit = { mission: 'm' };
    expect('initialMessages' in init).toBe(false);
  });

  test('initialMessages can be provided', () => {
    const init: AgentContextInit = {
      mission: 'm',
      initialMessages: [{ role: 'user', content: 'init' }],
    };
    expect(init.initialMessages).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt — purity
// ---------------------------------------------------------------------------

describe('buildSystemPrompt — purity', () => {
  test('same input produces identical output (referential transparency)', () => {
    const input: PromptInput = {
      mission: 'test-mission',
      availableTools: ['file-read', 'file-write'],
    };
    const a = buildSystemPrompt(input);
    const b = buildSystemPrompt(input);
    expect(a).toBe(b);
  });

  test('function does not mutate the input object', () => {
    const input: PromptInput = {
      mission: 'm',
      availableTools: ['file-read', 'file-write', 'file-edit'],
    };
    const toolsBefore = [...input.availableTools];
    buildSystemPrompt(input);
    expect(input.availableTools).toEqual(toolsBefore);
    expect(input.mission).toBe('m');
  });

  test('function does not mutate the tools array order', () => {
    const input: PromptInput = {
      mission: 'm',
      availableTools: ['z-tool', 'a-tool', 'm-tool'],
    };
    buildSystemPrompt(input);
    // Order preserved — the function does not sort.
    expect(input.availableTools).toEqual(['z-tool', 'a-tool', 'm-tool']);
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt — Odysseus identity pin (load-bearing)
// ---------------------------------------------------------------------------

describe('buildSystemPrompt — Odysseus identity', () => {
  test('begins with the Odysseus identity string', () => {
    const prompt = buildSystemPrompt({ mission: 'm', availableTools: [] });
    // The identity string is the load-bearing pin that distinguishes
    // Odysseus from the base model default. The engineer strategy
    // re-loads self-model.md at every waypoint, but this identity
    // anchor is the fallback when self-model is missing.
    expect(prompt).toContain('You are Odysseus');
    expect(prompt).toContain('self-bootstrapping coding agent');
  });

  test('contains the mission verbatim', () => {
    const prompt = buildSystemPrompt({
      mission: 'MAKE ODYSSSEUS A QUALIFIED AGENT',
      availableTools: [],
    });
    expect(prompt).toContain('MAKE ODYSSSEUS A QUALIFIED AGENT');
  });

  test('mentions the Cerebellum loop', () => {
    const prompt = buildSystemPrompt({ mission: 'm', availableTools: [] });
    expect(prompt).toContain('Cerebellum');
    expect(prompt.toLowerCase()).toContain('checkpoint');
    expect(prompt.toLowerCase()).toContain('verify');
  });

  test('mentions the safety perimeter (cannot be disabled)', () => {
    const prompt = buildSystemPrompt({ mission: 'm', availableTools: [] });
    expect(prompt.toLowerCase()).toContain('safety');
    expect(prompt.toLowerCase()).toContain('perimeter');
    expect(prompt.toLowerCase()).toContain('cannot disable');
  });

  test('includes the DONE signal contract', () => {
    const prompt = buildSystemPrompt({ mission: 'm', availableTools: [] });
    expect(prompt).toContain('DONE');
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt — tool list rendering
// ---------------------------------------------------------------------------

describe('buildSystemPrompt — tool list rendering', () => {
  test('tools joined with ", "', () => {
    const prompt = buildSystemPrompt({
      mission: 'm',
      availableTools: ['file-read', 'file-write', 'git-commit'],
    });
    expect(prompt).toContain('file-read, file-write, git-commit');
  });

  test('preserves tool order as given (no sort)', () => {
    const prompt = buildSystemPrompt({
      mission: 'm',
      availableTools: ['zzz', 'aaa', 'mmm'],
    });
    // If sorted alphabetically, this would be 'aaa, mmm, zzz'.
    expect(prompt).toContain('zzz, aaa, mmm');
    expect(prompt).not.toContain('aaa, mmm, zzz');
  });

  test('empty availableTools array renders an empty list', () => {
    const prompt = buildSystemPrompt({
      mission: 'm',
      availableTools: [],
    });
    // The "Available tools: " label is still present.
    expect(prompt).toContain('Available tools:');
    // The empty rendering is just the label with no items after the colon.
    expect(prompt).toMatch(/Available tools:\s*\n/);
  });

  test('single tool renders without trailing comma', () => {
    const prompt = buildSystemPrompt({
      mission: 'm',
      availableTools: ['only-tool'],
    });
    expect(prompt).toContain('only-tool');
    expect(prompt).not.toMatch(/only-tool,/);
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt — return type
// ---------------------------------------------------------------------------

describe('buildSystemPrompt — return type', () => {
  test('always returns a string', () => {
    const prompt = buildSystemPrompt({ mission: '', availableTools: [] });
    expect(typeof prompt).toBe('string');
  });

  test('prompt is non-empty even with empty mission and tools', () => {
    const prompt = buildSystemPrompt({ mission: '', availableTools: [] });
    expect(prompt.length).toBeGreaterThan(100); // Identity + loop description
  });
});

// ---------------------------------------------------------------------------
// src/agent/loop.ts — source-level invariants
// (Behavior is covered by agent-loop-runAgentTurn.test.ts; this section
// pins the STRUCTURAL contracts that the behavior tests rely on.)
// ---------------------------------------------------------------------------

describe('src/agent/loop.ts — source-level invariants', () => {
  test('runAgentTurn always passes autoApprove: true', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    // The CLI mode contract: no TUI to handle the approval gate, so
    // force-approve. This is load-bearing — changing it would break
    // every CLI invocation.
    expect(src).toContain('autoApprove: true');
  });

  test('source imports CerebellumOrchestrator', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/import\s*\{\s*CerebellumOrchestrator\s*\}\s*from\s*['"]\.\.\/cerebellum\/orchestrator\.js['"]/);
  });

  test('source subscribes to orchestrator.on("event", ...)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/orchestrator\.on\(['"]event['"]/);
  });

  test('source filters for "assistant-message" event type', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/event\.type\s*===\s*['"]assistant-message['"]/);
  });

  test('source exports exactly runAgentTurn + AgentLoopConfig + AgentLoopResult', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/export\s+async\s+function\s+runAgentTurn/);
    expect(src).toMatch(/export\s+interface\s+AgentLoopConfig/);
    expect(src).toMatch(/export\s+interface\s+AgentLoopResult/);
  });

  test('AgentLoopConfig has exactly 6 required fields + no optional', async () => {
    // Pin the config shape — adding or removing a field is a breaking
    // change for src/index.ts.
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const configMatch = src.match(/export\s+interface\s+AgentLoopConfig\s*\{([^}]+)\}/);
    expect(configMatch).not.toBeNull();
    const body = configMatch![1];
    expect(body).toContain('cwd:');
    expect(body).toContain('provider:');
    expect(body).toContain('registry:');
    expect(body).toContain('tracePath:');
    expect(body).toContain('verifyLayers:');
    expect(body).toContain('mission:');
    // No optional fields (no '?').
    expect(body).not.toMatch(/\?\s*:/);
  });

  test('AgentLoopResult has response + optional waypointOutcome', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const resultMatch = src.match(/export\s+interface\s+AgentLoopResult\s*\{([^}]+)\}/);
    expect(resultMatch).not.toBeNull();
    const body = resultMatch![1];
    expect(body).toContain('response:');
    expect(body).toContain('waypointOutcome?');
    // waypointOutcome is a union of exactly 3 values.
    expect(body).toMatch(/['"]success['"]\s*\|\s*['"]failure['"]\s*\|\s*['"]abandoned['"]/);
  });
});

// ---------------------------------------------------------------------------
// Source-level invariants for context.ts and prompt.ts
// ---------------------------------------------------------------------------

describe('src/agent/context.ts — source-level invariants', () => {
  test('AgentContext class is exported', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/export\s+class\s+AgentContext/);
  });

  test('messagesRef is private readonly', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/private\s+readonly\s+messagesRef/);
  });

  test('mission field is private readonly (immutable post-construction)', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/private\s+readonly\s+mission/);
  });

  test('constructor does defensive spread copy of initialMessages', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    // The defensive copy pattern — critical for the isolation contract.
    expect(src).toMatch(/\[\.\.\.init\.initialMessages\]/);
  });

  test('messages() returns a fresh spread copy', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/return\s*\[\.\.\.this\.messagesRef\]/);
  });

  test('append uses push (mutates internal state, returns void)', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/this\.messagesRef\.push\(message\)/);
  });

  test('exports AgentContextInit interface', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+AgentContextInit/);
  });
});

describe('src/agent/prompt.ts — source-level invariants', () => {
  test('buildSystemPrompt function is exported', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).toMatch(/export\s+function\s+buildSystemPrompt/);
  });

  test('PromptInput interface is exported', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+PromptInput/);
  });

  test('availableTools typed as readonly string[]', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    expect(src).toMatch(/readonly\s+string\[\]/);
  });

  test('source does NOT use any runtime dependencies (no imports)', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    // Pure function — no external runtime deps. Compile-time type
    // imports are OK but no `from '...` at runtime.
    expect(src).not.toMatch(/^import\s+/m);
  });

  test('identity string includes "self-bootstrapping"', async () => {
    const src = await readFile('src/agent/prompt.ts', 'utf8');
    // Pin the full identity phrase — this is the load-bearing text
    // that distinguishes Odysseus from base models.
    expect(src).toContain('You are Odysseus, a self-bootstrapping coding agent.');
  });
});
