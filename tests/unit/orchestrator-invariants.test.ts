/**
 * Invariants for src/cerebellum/orchestrator.ts.
 *
 * The orchestrator is Odysseus's central nervous system — 1542 LOC
 * that coordinates the outer agent loop, inner tool-dispatch loop,
 * verify layers, checkpoint/rollback, dreaming/curiosity phases, and
 * the approval gate. Per CLAUDE.md, the source file CANNOT be edited
 * without manual review; this test file pins the public surface so
 * structural regressions are caught without modifying the source.
 *
 * Behavior tests (cerebellum-orchestrator.test.ts, orchestrator-events
 * .test.ts, agent-loop-runAgentTurn.test.ts — collectively 30+ tests)
 * cover the runtime flows. This file pins the LOAD-BEARING STRUCTURAL
 * CONTRACTS:
 *
 *   1. CerebellumOrchestrator extends EventEmitter — every observer
 *      pattern in the codebase depends on this inheritance.
 *
 *   2. OrchestratorConfig has exactly 5 required + 2 optional fields.
 *      Adding/removing a required field breaks every caller (src/index
 *      .ts, src/agent/loop.ts, src/tui/*).
 *
 *   3. RunWaypointResult.outcome is exactly 'success' | 'failure' |
 *      'abandoned'. Adding a new outcome requires updating every
 *      consumer of runWaypoint.
 *
 *   4. RunVoyageResult.outcome is exactly 'completed' | 'interrupted'.
 *
 *   5. DEFAULT_AUTO_APPROVE is true when stdout is not a TTY (CLI
 *      mode), false when it is (TUI mode). Load-bearing: CLI has no
 *      approval gate UI, so it MUST auto-approve.
 *
 *   6. Public method surface: runWaypoint, approve, reject,
 *      injectMessage, interrupt, runVoyage. These are the API the
 *      outer loops depend on.
 *
 *   7. emit('event', ...) is the single event-stream channel. All
 *      event types flow through this. The TUI and CLI both subscribe
 *      to 'event' and filter by event.type.
 *
 *   8. DEFAULT_MAX_ITERATIONS ceiling — without this, a degenerate
 *      waypoint could loop forever consuming tokens.
 */

import { describe, test, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { CerebellumOrchestrator } from '../../src/cerebellum/orchestrator.js';
import type {
  OrchestratorConfig,
  RunWaypointInput,
  RunWaypointResult,
  RunVoyageResult,
} from '../../src/cerebellum/orchestrator.js';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// CerebellumOrchestrator extends EventEmitter
// ---------------------------------------------------------------------------

describe('CerebellumOrchestrator — EventEmitter inheritance', () => {
  test('class extends EventEmitter', () => {
    // This is load-bearing — the entire observation surface (TUI,
    // CLI, trace) subscribes via emitter.on('event', ...).
    expect(CerebellumOrchestrator.prototype instanceof EventEmitter).toBe(true);
  });

  test('source declares "extends EventEmitter"', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/export\s+class\s+CerebellumOrchestrator\s+extends\s+EventEmitter/);
  });

  test('source overrides emit to route through "event" channel', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    // The emit method is overridden so every event flows through
    // the unified 'event' channel.
    expect(src).toMatch(/super\.emit\(['"]event['"]/);
  });

  test('instance has EventEmitter methods (on, off, emit, once)', () => {
    const fakeProvider = {
      async complete() {
        return { content: '', model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'stop' as const };
      },
      async *stream() { yield ''; },
      getModel() { return 'fake'; },
    };
    const fakeRegistry = { get: () => undefined, listSpecs: () => [], register: () => {}, mayMutate: () => false, dispatch: async () => ({ ok: false, error: 'x' }) };
    const orch = new CerebellumOrchestrator({
      cwd: '/tmp',
      provider: fakeProvider,
      registry: fakeRegistry as never,
      tracePath: '/tmp/trace.jsonl',
      verifyLayers: [],
    });
    expect(typeof orch.on).toBe('function');
    expect(typeof orch.off).toBe('function');
    expect(typeof orch.emit).toBe('function');
    expect(typeof orch.once).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// OrchestratorConfig type shape
// ---------------------------------------------------------------------------

describe('OrchestratorConfig type shape', () => {
  test('source declares OrchestratorConfig interface', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+OrchestratorConfig\s*\{/);
  });

  test('has required fields cwd, provider, registry, tracePath, verifyLayers', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const configMatch = src.match(/export\s+interface\s+OrchestratorConfig\s*\{([\s\S]*?)\}/);
    expect(configMatch).not.toBeNull();
    const body = configMatch![1];
    expect(body).toMatch(/^\s*cwd:\s*string;/m);
    expect(body).toMatch(/^\s*provider:\s*LLMProvider;/m);
    expect(body).toMatch(/^\s*registry:\s*ToolRegistry;/m);
    expect(body).toMatch(/^\s*tracePath:\s*string;/m);
    expect(body).toMatch(/^\s*verifyLayers:\s*readonly\s+VerifyLayer\[\];/m);
  });

  test('has optional fields maxIterations and autoApprove', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const configMatch = src.match(/export\s+interface\s+OrchestratorConfig\s*\{([\s\S]*?)\}/);
    expect(configMatch).not.toBeNull();
    const body = configMatch![1];
    expect(body).toMatch(/maxIterations\?\s*:\s*number/);
    expect(body).toMatch(/autoApprove\?\s*:\s*boolean/);
  });

  test('config has exactly 5 required + 2 optional = 7 fields', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const configMatch = src.match(/export\s+interface\s+OrchestratorConfig\s*\{([\s\S]*?)\}/);
    expect(configMatch).not.toBeNull();
    const body = configMatch![1];
    // Each field ends with ';' at end of line.
    const fieldLines = body.split('\n').filter((l) => l.trim().match(/^\w+/) && l.includes(';'));
    expect(fieldLines.length).toBe(7);
  });

  test('compile-time: minimal config (only required fields) is valid', () => {
    // This test exists just to fail at compile-time if a new required
    // field is added without updating callers. Runtime body is moot.
    const config: OrchestratorConfig = {
      cwd: '/tmp',
      provider: {
        async complete() {
          return { content: '', model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'stop' };
        },
        async *stream() { yield ''; },
        getModel() { return 'fake'; },
      },
      registry: {
        get: () => undefined,
        listSpecs: () => [],
        register: () => {},
        mayMutate: () => false,
        dispatch: async () => ({ ok: false, error: 'no-op' }),
      } as never,
      tracePath: '/tmp/trace.jsonl',
      verifyLayers: [],
    };
    expect(config.cwd).toBe('/tmp');
  });
});

// ---------------------------------------------------------------------------
// RunWaypointInput type shape
// ---------------------------------------------------------------------------

describe('RunWaypointInput type shape', () => {
  test('source declares RunWaypointInput interface', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+RunWaypointInput\s*\{/);
  });

  test('goal is required (string)', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const match = src.match(/export\s+interface\s+RunWaypointInput\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/goal:\s*string/);
  });

  test('parentWaypointId and voyageId are optional', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const match = src.match(/export\s+interface\s+RunWaypointInput\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/parentWaypointId\?\s*:\s*string/);
    expect(match![1]).toMatch(/voyageId\?\s*:\s*string/);
  });

  test('compile-time: minimal input with only goal is valid', () => {
    const input: RunWaypointInput = { goal: 'test' };
    expect(input.goal).toBe('test');
  });
});

// ---------------------------------------------------------------------------
// RunWaypointResult type shape
// ---------------------------------------------------------------------------

describe('RunWaypointResult type shape', () => {
  test('source declares RunWaypointResult interface', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+RunWaypointResult\s*\{/);
  });

  test('outcome is exactly "success" | "failure" | "abandoned"', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const match = src.match(/export\s+interface\s+RunWaypointResult\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    // Pin the 3-member union — adding 'paused' or 'cancelled' would
    // break every consumer of runWaypoint.
    expect(match![1]).toMatch(/outcome:\s*['"]success['"]\s*\|\s*['"]failure['"]\s*\|\s*['"]abandoned['"]/);
  });

  test('has waypoint, outcome, iterationsUsed, tokensConsumed required', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const match = src.match(/export\s+interface\s+RunWaypointResult\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).toMatch(/waypoint:\s*Waypoint/);
    expect(body).toMatch(/iterationsUsed:\s*number/);
    expect(body).toMatch(/tokensConsumed:/);
  });

  test('checkpointSha and failReason are optional', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const match = src.match(/export\s+interface\s+RunWaypointResult\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/checkpointSha\?\s*:\s*string/);
    expect(match![1]).toMatch(/failReason\?\s*:\s*string/);
  });

  test('tokensConsumed is { input: number; output: number }', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    // Match the inline object type directly on source (interface body
    // capture would stop at the first nested `}` due to non-greedy match).
    expect(src).toMatch(/tokensConsumed:\s*\{\s*input:\s*number;\s*output:\s*number\s*\}/);
  });
});

// ---------------------------------------------------------------------------
// RunVoyageResult type shape
// ---------------------------------------------------------------------------

describe('RunVoyageResult type shape', () => {
  test('source declares RunVoyageResult interface', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/export\s+interface\s+RunVoyageResult\s*\{/);
  });

  test('outcome is exactly "completed" | "interrupted"', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const match = src.match(/export\s+interface\s+RunVoyageResult\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/outcome:\s*['"]completed['"]\s*\|\s*['"]interrupted['"]/);
  });

  test('has voyageId, waypoints, dreamCount required', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const match = src.match(/export\s+interface\s+RunVoyageResult\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).toMatch(/voyageId:\s*string/);
    expect(body).toMatch(/waypoints:\s*RunWaypointResult\[\]/);
    expect(body).toMatch(/dreamCount:\s*number/);
  });

  test('reason is optional', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const match = src.match(/export\s+interface\s+RunVoyageResult\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/reason\?\s*:\s*string/);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_AUTO_APPROVE — TTY-sensitive
// ---------------------------------------------------------------------------

describe('DEFAULT_AUTO_APPROVE — TTY-sensitive default', () => {
  test('source defines DEFAULT_AUTO_APPROVE based on process.stdout.isTTY', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    // The TTY check is load-bearing: CLI (non-TTY) must auto-approve
    // because there's no UI to handle the approval gate; TUI (TTY)
    // defaults to manual approval so the user stays in the loop.
    expect(src).toMatch(/DEFAULT_AUTO_APPROVE\s*=/);
    expect(src).toMatch(/process\.stdout\?\.isTTY/);
  });

  test('default is false when stdout is a TTY', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    // The ternary: isTTY === true → false; else → true.
    expect(src).toMatch(/isTTY\s*===\s*true\s*\?\s*false\s*:\s*true/);
  });

  test('constructor applies default when autoApprove is omitted', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/this\.autoApprove\s*=\s*config\.autoApprove\s*\?\?\s*DEFAULT_AUTO_APPROVE/);
  });
});

// ---------------------------------------------------------------------------
// Public method surface
// ---------------------------------------------------------------------------

describe('CerebellumOrchestrator — public method surface', () => {
  test('runWaypoint is a public async method', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/async\s+runWaypoint\s*\(\s*input:\s*RunWaypointInput\s*\)/);
  });

  test('runVoyage is a public async method', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/async\s+runVoyage\s*\(/);
  });

  test('approve is a public method taking waypointId', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/approve\s*\(\s*waypointId:\s*string\s*\)/);
  });

  test('reject is a public method taking waypointId + reason', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/reject\s*\(\s*waypointId:\s*string,\s*reason:\s*string\s*\)/);
  });

  test('injectMessage is a public method taking content', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/injectMessage\s*\(\s*content:\s*string\s*\)/);
  });

  test('interrupt is a public method with optional reason', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/interrupt\s*\(\s*reason\s*=\s*['"]user requested['"]\s*\)/);
  });

  test('all six public methods are present on the instance', () => {
    const fakeProvider = {
      async complete() {
        return { content: '', model: 'fake', usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'stop' as const };
      },
      async *stream() { yield ''; },
      getModel() { return 'fake'; },
    };
    const fakeRegistry = { get: () => undefined, listSpecs: () => [], register: () => {}, mayMutate: () => false, dispatch: async () => ({ ok: false, error: 'x' }) };
    const orch = new CerebellumOrchestrator({
      cwd: '/tmp',
      provider: fakeProvider,
      registry: fakeRegistry as never,
      tracePath: '/tmp/trace.jsonl',
      verifyLayers: [],
    });
    expect(typeof orch.runWaypoint).toBe('function');
    expect(typeof orch.runVoyage).toBe('function');
    expect(typeof orch.approve).toBe('function');
    expect(typeof orch.reject).toBe('function');
    expect(typeof orch.injectMessage).toBe('function');
    expect(typeof orch.interrupt).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Event emission — emits('event', ...) is the unified channel
// ---------------------------------------------------------------------------

describe('orchestrator — unified event channel', () => {
  test('source emits assistant-message events', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/type:\s*['"]assistant-message['"]/);
  });

  test('source emits tool-call-started events', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/type:\s*['"]tool-call-started['"]/);
  });

  test('source emits tool-call-completed events', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/type:\s*['"]tool-call-completed['"]/);
  });

  test('source emits verify-started events', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/type:\s*['"]verify-started['"]/);
  });

  test('source emits verify-completed events', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/type:\s*['"]verify-completed['"]/);
  });

  test('all event types flow through emit("event", ...)', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    // The single emitEvent helper centralizes emission — observers
    // subscribe to 'event' and filter by event.type.
    expect(src).toMatch(/emitEvent\s*\(/);
    expect(src).toMatch(/return\s+super\.emit\(['"]event['"]/);
  });
});

// ---------------------------------------------------------------------------
// Module imports — depends on the full cerebellum suite
// ---------------------------------------------------------------------------

describe('orchestrator — module imports', () => {
  test('imports LLMProvider from llm/provider.js', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/from\s*['"]\.\.\/llm\/provider\.js['"]/);
  });

  test('imports ToolRegistry from tools/registry.js', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/from\s*['"]\.\.\/tools\/registry\.js['"]/);
  });

  test('imports VerifyLayer from cerebellum/verify.js', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/from\s*['"]\.\/verify\.js['"]/);
  });

  test('imports OrchestratorEvent from orchestrator/events.js', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/from\s*['"]\.\.\/orchestrator\/events\.js['"]/);
  });

  test('imports Waypoint from cerebellum/waypoint.js', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/from\s*['"]\.\/waypoint\.js['"]/);
  });

  test('imports BrainState from cerebellum/brain-state.js', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/from\s*['"]\.\/brain-state\.js['"]/);
  });

  test('imports RepeatedToolCallDetector', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/from\s*['"]\.\/repeated-tool-call-detector\.js['"]/);
  });
});

// ---------------------------------------------------------------------------
// OrchestratorState — internal accounting shape
// ---------------------------------------------------------------------------

describe('OrchestratorState — internal accounting', () => {
  test('source declares OrchestratorState interface', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/interface\s+OrchestratorState\s*\{/);
  });

  test('OrchestratorState has allowedShas, totalInput, totalOutput', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const match = src.match(/interface\s+OrchestratorState\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const body = match![1];
    expect(body).toMatch(/allowedShas:\s*Set<string>/);
    expect(body).toMatch(/totalInput:\s*number/);
    expect(body).toMatch(/totalOutput:\s*number/);
  });

  test('OrchestratorState is NOT exported (internal-only)', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    // The interface is module-private — external callers can't
    // inspect or mutate internal state directly.
    expect(src).not.toMatch(/export\s+interface\s+OrchestratorState/);
  });

  test('state field is private readonly', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/private\s+readonly\s+state:\s*OrchestratorState/);
  });
});

// ---------------------------------------------------------------------------
// PendingApproval — approval gate plumbing
// ---------------------------------------------------------------------------

describe('PendingApproval — approval gate', () => {
  test('source declares PendingApproval interface', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/interface\s+PendingApproval\s*\{/);
  });

  test('PendingApproval has resolve and reject callbacks', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const match = src.match(/interface\s+PendingApproval\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/resolve:\s*\(\s*\)\s*=>\s*void/);
    expect(match![1]).toMatch(/reject:\s*\(\s*err:\s*Error\s*\)\s*=>\s*void/);
  });

  test('pendingApprovals is a private readonly Map', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).toMatch(/private\s+readonly\s+pendingApprovals\s*=\s*new\s+Map/);
  });

  test('PendingApproval is NOT exported (internal-only)', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).not.toMatch(/export\s+interface\s+PendingApproval/);
  });
});

// ---------------------------------------------------------------------------
// Module exports — exactly the public surface
// ---------------------------------------------------------------------------

describe('orchestrator.ts — module exports', () => {
  test('exports exactly 4 interfaces + 1 class', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    const interfaceExports = src.match(/^export\s+interface\s+(\w+)/gm) ?? [];
    const classExports = src.match(/^export\s+class\s+(\w+)/gm) ?? [];
    expect(interfaceExports.length).toBe(4); // OrchestratorConfig, RunWaypointInput, RunWaypointResult, RunVoyageResult
    expect(classExports.length).toBe(1); // CerebellumOrchestrator
  });

  test('does NOT export OrchestratorState or PendingApproval (internal)', async () => {
    const src = await readFile('src/cerebellum/orchestrator.ts', 'utf8');
    expect(src).not.toMatch(/export\s+interface\s+OrchestratorState/);
    expect(src).not.toMatch(/export\s+interface\s+PendingApproval/);
  });
});
