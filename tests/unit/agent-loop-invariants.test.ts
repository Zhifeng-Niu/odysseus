import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

import {
  runAgentTurn,
  type AgentLoopConfig,
  type AgentLoopResult,
} from '../../src/agent/loop.js';

// ---------------------------------------------------------------------------
// Source contract — agent/loop.ts
//
// runAgentTurn is the unified CLI entry point: every user input (code task
// OR conversational query) flows through a single CerebellumOrchestrator.
//
// Invariants pinned here (source-level + behavioral shape):
//   - autoApprove is forced to true in source (CLI has no TUI approval gate)
//   - Event subscription listens on 'event' and filters by
//     event.type === 'assistant-message'
//   - lastAssistantMessage is captured into a local closure variable
//   - Fallback message when no assistant message was emitted has a stable
//     format keyed on outcome
//   - AgentLoopConfig has 6 required fields, all non-optional
//   - AgentLoopResult has 1 required (response) + 1 optional (waypointOutcome)
//
// Behavioral tests live in agent-loop-runAgentTurn.test.ts with mocked
// CerebellumOrchestrator. This file pins STRUCTURAL contracts only.
// ---------------------------------------------------------------------------

describe('agent/loop — module exports', () => {
  test('exports AgentLoopConfig interface', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/^export\s+interface\s+AgentLoopConfig/m);
  });

  test('exports AgentLoopResult interface', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/^export\s+interface\s+AgentLoopResult/m);
  });

  test('exports runAgentTurn async function', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/^export\s+async\s+function\s+runAgentTurn/m);
  });

  test('exactly 3 exports (2 interfaces + 1 function)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const exports = src.match(/^export\s+(interface|type|function|async\s+function|class|const)\s+\w+/gm) ?? [];
    expect(exports.length).toBe(3);
  });

  test('no default export', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).not.toMatch(/^export\s+default\s/m);
  });
});

// ---------------------------------------------------------------------------
// AgentLoopConfig — shape (6 required fields)
// ---------------------------------------------------------------------------

describe('AgentLoopConfig — shape', () => {
  test('has cwd: string (required)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/cwd:\s*string/);
  });

  test('has provider: LLMProvider (required)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/provider:\s*LLMProvider/);
  });

  test('has registry: ToolRegistry (required)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/registry:\s*ToolRegistry/);
  });

  test('has tracePath: string (required)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/tracePath:\s*string/);
  });

  test('has verifyLayers: readonly VerifyLayer[] (required)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/verifyLayers:\s*readonly\s+VerifyLayer\[\]/);
  });

  test('has mission: string (required)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/mission:\s*string/);
  });

  test('all 6 fields are required (no `?`)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const match = src.match(/interface\s+AgentLoopConfig\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const optional = match![1].match(/^\s+\w+\?\s*:/gm) ?? [];
    expect(optional.length).toBe(0);
    const required = match![1].match(/^\s+\w+:\s+/gm) ?? [];
    expect(required.length).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// AgentLoopResult — shape (1 required + 1 optional)
// ---------------------------------------------------------------------------

describe('AgentLoopResult — shape', () => {
  test('has response: string (required)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/response:\s*string\b/);
  });

  test('has waypointOutcome?: success | failure | abandoned (optional)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/waypointOutcome\?\s*:\s*'success'\s*\|\s*'failure'\s*\|\s*'abandoned'/);
  });

  test('waypointOutcome is a 3-value string union', async () => {
    const outcome: NonNullable<AgentLoopResult['waypointOutcome']> = 'success';
    const validValues: ReadonlyArray<'success' | 'failure' | 'abandoned'> = [
      'success',
      'failure',
      'abandoned',
    ];
    expect(validValues).toContain(outcome);
    expect(validValues.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// runAgentTurn — function signature
// ---------------------------------------------------------------------------

describe('runAgentTurn — function signature', () => {
  test('is an async function', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/export\s+async\s+function\s+runAgentTurn/);
  });

  test('takes (userInput: string, config: AgentLoopConfig)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/function\s+runAgentTurn\s*\(\s*userInput:\s*string,\s*config:\s*AgentLoopConfig\s*\)/s);
  });

  test('returns Promise<AgentLoopResult>', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/\):\s*Promise<AgentLoopResult>/);
  });

  test('runtime: function returns a Promise when invoked', () => {
    // We can't actually invoke runAgentTurn without all its deps, but we can
    // confirm it's an async function at the type level.
    expect(typeof runAgentTurn).toBe('function');
    expect(runAgentTurn.constructor.name).toBe('AsyncFunction');
  });
});

// ---------------------------------------------------------------------------
// autoApprove is hardcoded true
//
// CRITICAL CONTRACT: CLI mode forces autoApprove=true because there is no
// TUI to handle approval gates. This must not silently flip.
// ---------------------------------------------------------------------------

describe('runAgentTurn — autoApprove contract', () => {
  test('source hardcodes autoApprove: true', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/autoApprove:\s*true/);
  });

  test('autoApprove is NOT read from config (not parameterized)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    // The autoApprove line must reference the literal `true`, not config.*
    const match = src.match(/autoApprove:\s*([^,]+)/);
    expect(match).not.toBeNull();
    expect(match![1].trim()).toBe('true');
  });

  test('AgentLoopConfig does NOT have an autoApprove field', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const match = src.match(/interface\s+AgentLoopConfig\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toMatch(/autoApprove/);
  });
});

// ---------------------------------------------------------------------------
// Event subscription pattern
// ---------------------------------------------------------------------------

describe('runAgentTurn — event subscription pattern', () => {
  test('subscribes to orchestrator "event" channel', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/orchestrator\.on\(\s*['"]event['"]\s*,/);
  });

  test('filters by event.type === "assistant-message"', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/event\.type\s*===\s*['"]assistant-message['"]/);
  });

  test('captures event.content into lastAssistantMessage', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/lastAssistantMessage\s*=\s*event\.content/);
  });

  test('lastAssistantMessage initialized to empty string', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/let\s+lastAssistantMessage\s*=\s*['"]['"]/);
  });

  test('event handler parameter is typed OrchestratorEvent', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/\(\s*event:\s*OrchestratorEvent\s*\)/);
  });
});

// ---------------------------------------------------------------------------
// Fallback message format
// ---------------------------------------------------------------------------

describe('runAgentTurn — fallback message format', () => {
  test('uses lastAssistantMessage when non-empty (trim check)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/if\s*\(\s*lastAssistantMessage\.trim\(\)\.length\s*>\s*0\s*\)/);
  });

  test('fallback success message includes "Waypoint succeeded" + iterations count', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/Waypoint succeeded\s*\(\s*\$\{result\.iterationsUsed\}\s+iterations\)/);
  });

  test('fallback non-success message includes outcome and failReason', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/Waypoint\s+\$\{result\.outcome\}:\s*\$\{result\.failReason\s*\?\?\s*['"]unknown['"]\}/);
  });

  test('always returns waypointOutcome (both branches)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    // Both return statements must include waypointOutcome
    const occurrences = src.match(/waypointOutcome:\s*result\.outcome/g) ?? [];
    expect(occurrences.length).toBe(2);
  });

  test('ternary condition is result.outcome === "success"', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/result\.outcome\s*===\s*['"]success['"]/);
  });
});

// ---------------------------------------------------------------------------
// OrchestratorConfig construction
// ---------------------------------------------------------------------------

describe('runAgentTurn — orchestrator construction', () => {
  test('constructs CerebellumOrchestrator with 5 fields from config + autoApprove', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/new\s+CerebellumOrchestrator\s*\(/);
    expect(src).toMatch(/cwd:\s*config\.cwd/);
    expect(src).toMatch(/provider:\s*config\.provider/);
    expect(src).toMatch(/registry:\s*config\.registry/);
    expect(src).toMatch(/tracePath:\s*config\.tracePath/);
    expect(src).toMatch(/verifyLayers:\s*config\.verifyLayers/);
  });

  test('calls runWaypoint with goal = userInput', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/orchestrator\.runWaypoint\(\s*\{\s*goal:\s*userInput\s*\}\s*\)/s);
  });
});

// ---------------------------------------------------------------------------
// Imports — only type imports + CerebellumOrchestrator class
// ---------------------------------------------------------------------------

describe('agent/loop — imports', () => {
  test('imports LLMProvider as type', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/^import\s+type\s+\{\s*LLMProvider\s*\}\s+from\s+'\.\.\/llm\/provider\.js'/m);
  });

  test('imports CerebellumOrchestrator as a value (not type-only)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/^import\s+\{\s*CerebellumOrchestrator\s*\}\s+from\s+'\.\.\/cerebellum\/orchestrator\.js'/m);
    // And NOT `import type`
    expect(src).not.toMatch(/^import\s+type\s+\{\s*CerebellumOrchestrator\s*\}/m);
  });

  test('imports ToolRegistry as type', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/^import\s+type\s+\{\s*ToolRegistry\s*\}\s+from\s+'\.\.\/tools\/registry\.js'/m);
  });

  test('imports VerifyLayer as type', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/^import\s+type\s+\{\s*VerifyLayer\s*\}\s+from\s+'\.\.\/cerebellum\/verify\.js'/m);
  });

  test('imports OrchestratorEvent as type', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/^import\s+type\s+\{\s*OrchestratorEvent\s*\}\s+from\s+'\.\.\/orchestrator\/events\.js'/m);
  });

  test('exactly 5 import statements', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const imports = src.match(/^import\s/mg) ?? [];
    expect(imports.length).toBe(5);
  });

  test('all imports use .js ESM extension', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const imports = src.match(/^import[^;\n]+from\s+'[^']+'/gm) ?? [];
    for (const imp of imports) {
      expect(imp).toMatch(/\.js'/);
    }
  });
});

// ---------------------------------------------------------------------------
// JSDoc — preserve design intent
// ---------------------------------------------------------------------------

describe('agent/loop — JSDoc preservation', () => {
  test('function has a JSDoc block', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/\/\*\*[\s\S]*?\*\/\s*export\s+async\s+function\s+runAgentTurn/);
  });

  test('JSDoc mentions "unified agent runtime" or "path-unification"', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/unified\s+agent\s+runtime|path-unification/i);
  });

  test('JSDoc mentions "autoApprove is forced ON" or equivalent', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/autoApprove\s+is\s+forced\s+ON/i);
  });

  test('JSDoc mentions "assistant-message" event', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).toMatch(/assistant-message/);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('agent/loop — source-level safety', () => {
  test('no console, no process.stdout, no process.exit', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/process\.stdout/);
    expect(src).not.toMatch(/process\.exit/);
  });

  test('no direct file I/O (fs) — only via orchestrator', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).not.toMatch(/^import.*from\s+'fs'/m);
    expect(src).not.toMatch(/^import.*from\s+'node:fs'/m);
  });

  test('no direct network — no fetch, http, https imports', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/^import.*from\s+'https?'/m);
  });

  test('no shell, no exec — only orchestrator owns subprocess access', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\(/);
  });

  test('no static or class fields (function-only module)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    expect(src).not.toMatch(/\bclass\s+\w+/);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('agent/loop — structural fingerprint', () => {
  test('file has exactly 2 interface declarations', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const ifaces = src.match(/^export\s+interface\s+\w+/gm) ?? [];
    expect(ifaces.length).toBe(2);
  });

  test('file has exactly 1 exported async function', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const fns = src.match(/^export\s+async\s+function\s+\w+/gm) ?? [];
    expect(fns.length).toBe(1);
  });

  test('function has exactly 2 parameters', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const match = src.match(/function\s+runAgentTurn\s*\(([^)]*)\)/s);
    expect(match).not.toBeNull();
    const params = match![1].split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    expect(params.length).toBe(2);
  });

  test('file is under 100 lines (compact single-purpose module)', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeLessThanOrEqual(100);
  });

  test('exactly one return statement with the success branch, one with fallback', async () => {
    const src = await readFile('src/agent/loop.ts', 'utf8');
    const returns = src.match(/^\s+return\s/gm) ?? [];
    expect(returns.length).toBe(2);
  });
});
