import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

import { AgentContext, type AgentContextInit } from '../../src/agent/context.js';
import type { ChatMessage } from '../../src/llm/provider.js';

// ---------------------------------------------------------------------------
// Source contract — agent/context.ts
//
// AgentContext owns two pieces of state:
//   1. mission: a string set once at construction (immutable)
//   2. messages: a growing array of ChatMessages (append-only)
//
// Design invariants pinned here:
//   - The constructor COPIES the input messages array so external mutation
//     does not leak in
//   - messages() returns a fresh COPY so external mutation does not leak out
//   - append() mutates the internal array but returns void
//   - getMission() returns the string passed at construction
//   - The class never holds a reference to the caller's arrays
//
// These tests exist because a naive refactor (e.g. removing the spread) would
// create action-at-a-distance bugs where the caller's array changes silently
// affect the agent's history.
// ---------------------------------------------------------------------------

function makeMsg(content: string, role: 'user' | 'assistant' = 'user'): ChatMessage {
  return { role, content } as ChatMessage;
}

describe('agent/context — module exports', () => {
  test('exports AgentContext class and AgentContextInit interface', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/^export\s+class\s+AgentContext/m);
    expect(src).toMatch(/^export\s+interface\s+AgentContextInit/m);
  });

  test('imports only ChatMessage type from llm/provider', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/^import\s+type\s+\{\s*ChatMessage\s*\}\s+from\s+'\.\.\/llm\/provider\.js'/m);
  });

  test('no other exports', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    const exports = src.match(/^export\s+(class|interface|type|function|const|enum)\s+\w+/gm) ?? [];
    expect(exports.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// AgentContextInit — shape
// ---------------------------------------------------------------------------

describe('AgentContextInit — shape', () => {
  test('has mission: string (required)', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/interface\s+AgentContextInit\s*\{[^}]*mission:\s*string/s);
  });

  test('has initialMessages?: ChatMessage[] (optional)', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/initialMessages\?\s*:\s*ChatMessage\[\]/);
  });

  test('has exactly 2 fields', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    const match = src.match(/interface\s+AgentContextInit\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const fields = match![1].match(/^\s+\w+\??\s*:/gm) ?? [];
    expect(fields.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Construction — mission is required
// ---------------------------------------------------------------------------

describe('AgentContext — construction', () => {
  test('constructs with mission only', () => {
    const ctx = new AgentContext({ mission: 'test-mission' });
    expect(ctx.getMission()).toBe('test-mission');
    expect(ctx.messages()).toEqual([]);
  });

  test('constructs with mission and initialMessages', () => {
    const init: AgentContextInit = {
      mission: 'm',
      initialMessages: [makeMsg('hello')],
    };
    const ctx = new AgentContext(init);
    expect(ctx.getMission()).toBe('m');
    expect(ctx.messages()).toHaveLength(1);
    expect(ctx.messages()[0]).toEqual({ role: 'user', content: 'hello' });
  });

  test('source declares private readonly fields', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/private\s+readonly\s+mission:\s*string/);
    expect(src).toMatch(/private\s+readonly\s+messagesRef:\s*ChatMessage\[\]/);
  });

  test('source constructor copies initialMessages via spread', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/init\.initialMessages\s*\?\s*\[\.\.\.init\.initialMessages\]\s*:\s*\[\]/);
  });
});

// ---------------------------------------------------------------------------
// Immutability boundary — input isolation
//
// The constructor must copy the input array so subsequent mutation by the
// caller does not affect the agent's internal state.
// ---------------------------------------------------------------------------

describe('AgentContext — input isolation (defensive copy in)', () => {
  test('mutating caller array after construction does NOT affect context', () => {
    const callerArr: ChatMessage[] = [makeMsg('first')];
    const ctx = new AgentContext({ mission: 'm', initialMessages: callerArr });
    callerArr.push(makeMsg('injected'));
    expect(ctx.messages()).toHaveLength(1);
    expect(ctx.messages()[0]?.content).toBe('first');
  });

  test('caller array reassignment does NOT affect context', () => {
    const callerArr: ChatMessage[] = [makeMsg('a')];
    const ctx = new AgentContext({ mission: 'm', initialMessages: callerArr });
    callerArr.length = 0; // empty the original array
    expect(ctx.messages()).toHaveLength(1);
  });

  test('null/undefined initialMessages initializes to empty array', () => {
    const ctx = new AgentContext({ mission: 'm' });
    expect(ctx.messages()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Immutability boundary — output isolation
//
// messages() must return a fresh copy so external code cannot mutate the
// internal array.
// ---------------------------------------------------------------------------

describe('AgentContext — output isolation (defensive copy out)', () => {
  test('messages() returns a fresh array each call', () => {
    const ctx = new AgentContext({ mission: 'm', initialMessages: [makeMsg('a')] });
    const a = ctx.messages();
    const b = ctx.messages();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  test('mutating returned array does NOT affect subsequent calls', () => {
    const ctx = new AgentContext({ mission: 'm', initialMessages: [makeMsg('a')] });
    const snapshot = ctx.messages();
    snapshot.push(makeMsg('injected'));
    expect(ctx.messages()).toHaveLength(1);
  });

  test('source messages() returns spread copy', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/messages\(\):\s*ChatMessage\[\]\s*\{\s*return\s*\[\.\.\.this\.messagesRef\]\s*;\s*\}/);
  });

  test('messages() elements are shallow references to the same objects', () => {
    const msg = makeMsg('shared');
    const ctx = new AgentContext({ mission: 'm', initialMessages: [msg] });
    const got = ctx.messages();
    expect(got[0]).toBe(msg); // same object reference (shallow copy)
  });
});

// ---------------------------------------------------------------------------
// append() — append-only contract
// ---------------------------------------------------------------------------

describe('AgentContext — append()', () => {
  test('appends a single message', () => {
    const ctx = new AgentContext({ mission: 'm' });
    ctx.append(makeMsg('a'));
    expect(ctx.messages()).toHaveLength(1);
  });

  test('appends multiple messages in order', () => {
    const ctx = new AgentContext({ mission: 'm' });
    ctx.append(makeMsg('a'));
    ctx.append(makeMsg('b'));
    ctx.append(makeMsg('c'));
    const msgs = ctx.messages();
    expect(msgs.map((m) => m.content)).toEqual(['a', 'b', 'c']);
  });

  test('append returns void', () => {
    const ctx = new AgentContext({ mission: 'm' });
    const result = ctx.append(makeMsg('a'));
    expect(result).toBeUndefined();
  });

  test('append updates the array seen by subsequent messages() calls', () => {
    const ctx = new AgentContext({ mission: 'm' });
    expect(ctx.messages()).toHaveLength(0);
    ctx.append(makeMsg('first'));
    expect(ctx.messages()).toHaveLength(1);
    ctx.append(makeMsg('second'));
    expect(ctx.messages()).toHaveLength(2);
  });

  test('append after initialMessages preserves order', () => {
    const ctx = new AgentContext({
      mission: 'm',
      initialMessages: [makeMsg('init-1'), makeMsg('init-2')],
    });
    ctx.append(makeMsg('appended'));
    const msgs = ctx.messages();
    expect(msgs.map((m) => m.content)).toEqual(['init-1', 'init-2', 'appended']);
  });

  test('source append uses push', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/append\(message:\s*ChatMessage\):\s*void\s*\{\s*this\.messagesRef\.push\(message\)\s*;\s*\}/);
  });
});

// ---------------------------------------------------------------------------
// getMission() — immutability of mission
// ---------------------------------------------------------------------------

describe('AgentContext — getMission()', () => {
  test('returns the mission string', () => {
    const ctx = new AgentContext({ mission: 'specific-mission' });
    expect(ctx.getMission()).toBe('specific-mission');
  });

  test('returns the same string across multiple calls', () => {
    const ctx = new AgentContext({ mission: 'm' });
    const a = ctx.getMission();
    const b = ctx.getMission();
    expect(a).toBe(b);
  });

  test('empty-string mission is preserved', () => {
    const ctx = new AgentContext({ mission: '' });
    expect(ctx.getMission()).toBe('');
  });

  test('unicode mission is preserved', () => {
    const ctx = new AgentContext({ mission: '任务 — 🚀' });
    expect(ctx.getMission()).toBe('任务 — 🚀');
  });

  test('no setMission method exists', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).not.toMatch(/setMission/);
  });
});

// ---------------------------------------------------------------------------
// Public method surface
// ---------------------------------------------------------------------------

describe('AgentContext — public API surface', () => {
  test('exposes exactly 3 public methods', () => {
    const methods = Object.getOwnPropertyNames(AgentContext.prototype).filter(
      (n) => n !== 'constructor',
    );
    expect(methods.sort()).toEqual(['append', 'getMission', 'messages']);
  });

  test('append, messages, getMission are on the prototype (not instance)', () => {
    const ctx = new AgentContext({ mission: 'm' });
    expect(Object.getPrototypeOf(ctx)).toHaveProperty('append');
    expect(Object.getPrototypeOf(ctx)).toHaveProperty('messages');
    expect(Object.getPrototypeOf(ctx)).toHaveProperty('getMission');
  });

  test('mission and messagesRef are NOT own properties of the instance via public access', () => {
    const ctx = new AgentContext({ mission: 'm' });
    // They ARE own properties at runtime (TS `private` is compile-time only),
    // but we verify the public API does not surface them as methods.
    expect(typeof (ctx as unknown as { append?: unknown }).append).toBe('function');
    expect(typeof (ctx as unknown as { messages?: unknown }).messages).toBe('function');
    expect(typeof (ctx as unknown as { getMission?: unknown }).getMission).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Determinism — same inputs produce same outputs
// ---------------------------------------------------------------------------

describe('AgentContext — determinism', () => {
  test('two contexts with same init have equal messages()', () => {
    const init: AgentContextInit = {
      mission: 'm',
      initialMessages: [makeMsg('a'), makeMsg('b')],
    };
    const ctx1 = new AgentContext(init);
    const ctx2 = new AgentContext(init);
    expect(ctx1.messages()).toEqual(ctx2.messages());
    expect(ctx1.getMission()).toBe(ctx2.getMission());
  });

  test('contexts are independent — append on one does not affect other', () => {
    const init: AgentContextInit = {
      mission: 'm',
      initialMessages: [makeMsg('shared')],
    };
    const ctx1 = new AgentContext(init);
    const ctx2 = new AgentContext(init);
    ctx1.append(makeMsg('only-for-1'));
    expect(ctx1.messages()).toHaveLength(2);
    expect(ctx2.messages()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety guards
// ---------------------------------------------------------------------------

describe('agent/context — source-level safety', () => {
  test('no console, process, or side effects', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/process\./);
  });

  test('no direct file or network access', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).not.toMatch(/import.*fs/);
    expect(src).not.toMatch(/import.*path/);
    expect(src).not.toMatch(/fetch\(/);
  });

  test('no static members', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).not.toMatch(/static\s+\w+/);
  });

  test('no default export', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).not.toMatch(/^export\s+default\s/m);
  });

  test('uses ESM .js import extension', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).toMatch(/from\s+'\.\.\/llm\/provider\.js'/);
  });

  test('mission field is assigned exactly once (in constructor)', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    const assignments = src.match(/this\.mission\s*=/g) ?? [];
    expect(assignments.length).toBe(1);
    expect(src).toMatch(/this\.mission\s*=\s*init\.mission/);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('agent/context — structural fingerprint', () => {
  test('file has exactly 1 class declaration', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    const classes = src.match(/^export\s+class\s+\w+/gm) ?? [];
    expect(classes.length).toBe(1);
  });

  test('file has exactly 1 interface declaration', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    const ifaces = src.match(/^export\s+interface\s+\w+/gm) ?? [];
    expect(ifaces.length).toBe(1);
  });

  test('class has exactly 2 private readonly fields', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    const privFields = src.match(/private\s+readonly\s+\w+:/g) ?? [];
    expect(privFields.length).toBe(2);
  });

  test('class has exactly 3 public methods', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    const methods = src.match(/^\s+(append|messages|getMission)\(/gm) ?? [];
    expect(methods.length).toBe(3);
  });

  test('no getters or setters', async () => {
    const src = await readFile('src/agent/context.ts', 'utf8');
    expect(src).not.toMatch(/\bget\s+\w+\s*\(/);
    expect(src).not.toMatch(/\bset\s+\w+\s*\(/);
  });
});
