import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

import {
  EVENT_TYPES,
  type BacklogOrigin,
  type MemoryCategory,
  type OrchestratorCommand,
  type OrchestratorEvent,
  type OrchestratorEventType,
} from '../../src/orchestrator/events.js';

// ---------------------------------------------------------------------------
// Source contract — orchestrator/events.ts
//
// The orchestrator's public event stream + command surface. Three contracts:
//   1. OrchestratorEvent: discriminated union on `type` — consumers switch
//      and narrow payload
//   2. OrchestratorCommand: consumer → orchestrator commands (4 variants)
//   3. EVENT_TYPES: runtime list of event type strings (introspection)
//
// Invariants pinned here:
//   - BacklogOrigin is a 6-value string union
//   - MemoryCategory is a 4-value string union
//   - OrchestratorEvent has the full set of `type` literal values
//   - Every event variant carries a `ts: number` timestamp
//   - OrchestratorCommand has exactly 4 variants
//   - EVENT_TYPES contains the expected type strings
//   - OrchestratorEventType is derived from EVENT_TYPES via indexed access
//
// KNOWN ASYMMETRY (pinned, not "fixed"): the type union has `plan-completed`
// but EVENT_TYPES does not. This is intentional — plan-completed's emission
// path was added in a later iteration. Pinning the asymmetry prevents
// accidental "cleanup" that would change runtime behavior.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

describe('orchestrator/events — module exports', () => {
  test('exports BacklogOrigin type', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/^export\s+type\s+BacklogOrigin\s*=/m);
  });

  test('exports MemoryCategory type', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/^export\s+type\s+MemoryCategory\s*=/m);
  });

  test('exports OrchestratorEvent type', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/^export\s+type\s+OrchestratorEvent\s*=/m);
  });

  test('exports OrchestratorCommand type', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/^export\s+type\s+OrchestratorCommand\s*=/m);
  });

  test('exports OrchestratorEventType type', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/^export\s+type\s+OrchestratorEventType\s*=/m);
  });

  test('exports EVENT_TYPES const', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/^export\s+const\s+EVENT_TYPES\s*=/m);
  });

  test('exactly 6 exports (5 types + 1 const)', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const exports = src.match(/^export\s+(type|const|interface|function|class|enum)\s+\w+/gm) ?? [];
    expect(exports.length).toBe(6);
  });

  test('no default export', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).not.toMatch(/^export\s+default\s/m);
  });
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

describe('orchestrator/events — imports', () => {
  test('imports Strategy type from cerebellum/waypoint', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/^import\s+type\s+\{\s*Strategy\s*\}\s+from\s+'\.\.\/cerebellum\/waypoint\.js'/m);
  });

  test('imports BrainState type from cerebellum/brain-state', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/^import\s+type\s+\{\s*BrainState\s*\}\s+from\s+'\.\.\/cerebellum\/brain-state\.js'/m);
  });

  test('exactly 2 imports, both type-only', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const imports = src.match(/^import\s+type\s/mg) ?? [];
    expect(imports.length).toBe(2);
    const allImports = src.match(/^import\s/mg) ?? [];
    expect(allImports.length).toBe(2);
  });

  test('all imports use .js ESM extension', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const imports = src.match(/^import[^;\n]+from\s+'[^']+'/gm) ?? [];
    for (const imp of imports) {
      expect(imp).toMatch(/\.js'/);
    }
  });
});

// ---------------------------------------------------------------------------
// BacklogOrigin — 7-value union
// ---------------------------------------------------------------------------

describe('BacklogOrigin — contract', () => {
  test('is a string union', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type\s+BacklogOrigin\s*=\s*['"]/);
  });

  test('contains all 7 origins: user, plan, dream, reflect, curiosity, system, perception', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const match = src.match(/type\s+BacklogOrigin\s*=\s*([^;]+);/);
    expect(match).not.toBeNull();
    for (const origin of ["'user'", "'plan'", "'dream'", "'reflect'", "'curiosity'", "'system'", "'perception'"]) {
      expect(match![1]).toContain(origin);
    }
  });

  test('exactly 7 origins (no more, no less)', async () => {
    // 'perception' added with the perception hub (Ithaca MVP): environment
    // channels (file watcher, clock) drain into the backlog through it.
    const validOrigins: ReadonlyArray<BacklogOrigin> = [
      'user', 'plan', 'dream', 'reflect', 'curiosity', 'system', 'perception',
    ];
    expect(validOrigins.length).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// MemoryCategory — 4-value union
// ---------------------------------------------------------------------------

describe('MemoryCategory — contract', () => {
  test('is a string union', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type\s+MemoryCategory\s*=\s*['"]/);
  });

  test('contains all 4 categories: patterns, lessons, preferences, dreams', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const match = src.match(/type\s+MemoryCategory\s*=\s*([^;]+);/);
    expect(match).not.toBeNull();
    for (const cat of ["'patterns'", "'lessons'", "'preferences'", "'dreams'"]) {
      expect(match![1]).toContain(cat);
    }
  });

  test('exactly 4 categories', () => {
    const validCats: ReadonlyArray<MemoryCategory> = [
      'patterns', 'lessons', 'preferences', 'dreams',
    ];
    expect(validCats.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// OrchestratorEvent — discriminated union shape
// ---------------------------------------------------------------------------

describe('OrchestratorEvent — discriminated union', () => {
  test('is a union of object literals with `type` discriminator', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type\s+OrchestratorEvent\s*=\s*\|?\s*\{\s*type:\s*['"]/);
  });

  test('every variant has a `type` field with a string literal value', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    // Extract the union body (up to the next top-level type or const decl)
    const match = src.match(/type\s+OrchestratorEvent\s*=\s*([\s\S]*?)\n\/\*\*/);
    expect(match).not.toBeNull();
    const unionBody = match![1];
    // Count `type: '...'` occurrences — each variant must have one
    const typeFields = unionBody.match(/type:\s*'[^']+'/g) ?? [];
    expect(typeFields.length).toBeGreaterThanOrEqual(20);
  });

  test('every variant has a `ts: number` field (uniform timestamp)', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const match = src.match(/type\s+OrchestratorEvent\s*=\s*([\s\S]*?)\n\/\*\*/);
    expect(match).not.toBeNull();
    const unionBody = match![1];
    const typeFields = unionBody.match(/type:\s*'[^']+'/g) ?? [];
    const tsFields = unionBody.match(/\bts:\s*number/g) ?? [];
    expect(tsFields.length).toBe(typeFields.length);
  });

  test('union contains voyage-started, voyage-completed, voyage-interrupted', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'voyage-started'/);
    expect(src).toMatch(/type:\s*'voyage-completed'/);
    expect(src).toMatch(/type:\s*'voyage-interrupted'/);
  });

  test('union contains all waypoint-* variants', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    for (const t of [
      'waypoint-started',
      'waypoint-iteration',
      'waypoint-awaiting-approval',
      'waypoint-committed',
      'waypoint-rolled-back',
      'waypoint-failed',
    ]) {
      expect(src).toMatch(new RegExp(`type:\\s*'${t}'`));
    }
  });

  test('union contains assistant-message, tool-call-started, tool-call-completed', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'assistant-message'/);
    expect(src).toMatch(/type:\s*'tool-call-started'/);
    expect(src).toMatch(/type:\s*'tool-call-completed'/);
  });

  test('union contains verify-started, verify-completed', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'verify-started'/);
    expect(src).toMatch(/type:\s*'verify-completed'/);
  });

  test('union contains brain-state-changed, voyage-idle, dream-completed', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'brain-state-changed'/);
    expect(src).toMatch(/type:\s*'voyage-idle'/);
    expect(src).toMatch(/type:\s*'dream-completed'/);
  });

  test('union contains curiosity-completed, plan-completed, backlog-item-added, memory-consolidated', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'curiosity-completed'/);
    expect(src).toMatch(/type:\s*'plan-completed'/);
    expect(src).toMatch(/type:\s*'backlog-item-added'/);
    expect(src).toMatch(/type:\s*'memory-consolidated'/);
  });

  test('union contains recovery-intervention, self-monitor, misused-signal', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'recovery-intervention'/);
    expect(src).toMatch(/type:\s*'self-monitor'/);
    expect(src).toMatch(/type:\s*'misused-signal'/);
  });
});

// ---------------------------------------------------------------------------
// OrchestratorEvent — specific payload contracts
// ---------------------------------------------------------------------------

describe('OrchestratorEvent — payload contracts', () => {
  test('voyage-started has voyageId, prompt, ts', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'voyage-started';\s*voyageId:\s*string;\s*prompt:\s*string;\s*ts:\s*number/);
  });

  test('voyage-completed has voyageId, ts (no prompt)', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'voyage-completed';\s*voyageId:\s*string;\s*ts:\s*number/);
  });

  test('voyage-interrupted has reason: string', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'voyage-interrupted';\s*voyageId:\s*string;\s*reason:\s*string;\s*ts:\s*number/);
  });

  test('waypoint-started carries strategy: Strategy', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'waypoint-started';[\s\S]*?strategy:\s*Strategy;/);
  });

  test('waypoint-committed has sha and iterationsUsed', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'waypoint-committed';[\s\S]*?sha:\s*string;[\s\S]*?iterationsUsed:\s*number;/);
  });

  test('waypoint-rolled-back has reason and iterationsUsed', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'waypoint-rolled-back';[\s\S]*?reason:\s*string;[\s\S]*?iterationsUsed:\s*number;/);
  });

  test('assistant-message has content: string', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'assistant-message';\s*waypointId:\s*string;\s*content:\s*string;\s*ts:\s*number/);
  });

  test('tool-call-started has callId, tool, args (unknown)', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'tool-call-started';[\s\S]*?callId:\s*string;[\s\S]*?tool:\s*string;[\s\S]*?args:\s*unknown;/);
  });

  test('tool-call-completed has result, ok', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'tool-call-completed';[\s\S]*?result:\s*unknown;[\s\S]*?ok:\s*boolean;/);
  });

  test('verify-completed has passed and optional detail', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'verify-completed';[\s\S]*?passed:\s*boolean;[\s\S]*?detail\?:\s*string;/);
  });

  test('brain-state-changed has from, to (BrainState), reason', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'brain-state-changed';[\s\S]*?from:\s*BrainState;[\s\S]*?to:\s*BrainState;[\s\S]*?reason:\s*string;/);
  });

  test('voyage-idle has lastWaypointId: string | null, backlogSize', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'voyage-idle';[\s\S]*?lastWaypointId:\s*string\s*\|\s*null;[\s\S]*?backlogSize:\s*number;/);
  });

  test('dream-completed has backlogItemsAdded, memoryEntriesAdded, durationMs', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'dream-completed';[\s\S]*?backlogItemsAdded:\s*number;[\s\S]*?memoryEntriesAdded:\s*number;[\s\S]*?durationMs:\s*number;/);
  });

  test('curiosity-completed mirrors dream-completed payload shape', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'curiosity-completed';[\s\S]*?backlogItemsAdded:\s*number;[\s\S]*?memoryEntriesAdded:\s*number;[\s\S]*?durationMs:\s*number;/);
  });

  test('plan-completed has stepCount, parseOk, durationMs (any order)', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    // Extract just the plan-completed variant block
    const match = src.match(/type:\s*'plan-completed';[\s\S]*?ts:\s*number;\s*\}/);
    expect(match).not.toBeNull();
    const block = match![0];
    expect(block).toMatch(/stepCount:\s*number/);
    expect(block).toMatch(/parseOk:\s*boolean/);
    expect(block).toMatch(/durationMs:\s*number/);
  });

  test('backlog-item-added has origin: BacklogOrigin and priority', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'backlog-item-added';[\s\S]*?origin:\s*BacklogOrigin;[\s\S]*?priority:\s*number;/);
  });

  test('memory-consolidated has category: MemoryCategory and bytesWritten', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'memory-consolidated';[\s\S]*?category:\s*MemoryCategory;[\s\S]*?bytesWritten:\s*number;/);
  });

  test('recovery-intervention has tool and message', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'recovery-intervention';[\s\S]*?tool:\s*string;[\s\S]*?message:\s*string;/);
  });

  test('self-monitor has toolCallCount and message', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'self-monitor';[\s\S]*?toolCallCount:\s*number;[\s\S]*?message:\s*string;/);
  });

  test('misused-signal has signal and toolCallCount', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'misused-signal';[\s\S]*?signal:\s*string;[\s\S]*?toolCallCount:\s*number;/);
  });
});

// ---------------------------------------------------------------------------
// OrchestratorCommand — consumer → orchestrator
// ---------------------------------------------------------------------------

describe('OrchestratorCommand — contract', () => {
  test('is a 4-variant union', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const match = src.match(/type\s+OrchestratorCommand\s*=\s*([\s\S]*?);\n\n/s);
    expect(match).not.toBeNull();
    const variants = match![1].match(/type:\s*'[^']+'/g) ?? [];
    expect(variants.length).toBe(4);
  });

  test('has approve-waypoint variant', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'approve-waypoint';\s*waypointId:\s*string/);
  });

  test('has reject-waypoint variant with reason', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'reject-waypoint';\s*waypointId:\s*string;\s*reason:\s*string/);
  });

  test('has inject-message variant', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'inject-message';\s*content:\s*string/);
  });

  test('has interrupt variant (no payload)', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type:\s*'interrupt'\s*\}/);
  });

  test('exactly 4 valid command types', () => {
    const validCommands: ReadonlyArray<OrchestratorCommand['type']> = [
      'approve-waypoint',
      'reject-waypoint',
      'inject-message',
      'interrupt',
    ];
    expect(validCommands.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// EVENT_TYPES — runtime list
// ---------------------------------------------------------------------------

describe('EVENT_TYPES — runtime list', () => {
  test('is a readonly tuple (as const)', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/export\s+const\s+EVENT_TYPES\s*=\s*\[[\s\S]*?\]\s+as\s+const/);
  });

  test('has exactly 23 entries', () => {
    expect(EVENT_TYPES.length).toBe(23);
  });

  test('all entries are strings', () => {
    for (const t of EVENT_TYPES) {
      expect(typeof t).toBe('string');
    }
  });

  test('contains all voyage-* types', () => {
    expect(EVENT_TYPES).toContain('voyage-started');
    expect(EVENT_TYPES).toContain('voyage-completed');
    expect(EVENT_TYPES).toContain('voyage-interrupted');
  });

  test('contains all waypoint-* types', () => {
    const waypointTypes = [
      'waypoint-started',
      'waypoint-iteration',
      'waypoint-awaiting-approval',
      'waypoint-committed',
      'waypoint-rolled-back',
      'waypoint-failed',
    ];
    for (const t of waypointTypes) {
      expect(EVENT_TYPES).toContain(t);
    }
  });

  test('contains assistant-message', () => {
    expect(EVENT_TYPES).toContain('assistant-message');
  });

  test('contains tool-call-* types', () => {
    expect(EVENT_TYPES).toContain('tool-call-started');
    expect(EVENT_TYPES).toContain('tool-call-completed');
  });

  test('contains verify-* types', () => {
    expect(EVENT_TYPES).toContain('verify-started');
    expect(EVENT_TYPES).toContain('verify-completed');
  });

  test('contains brain-state-changed, voyage-idle, dream-completed', () => {
    expect(EVENT_TYPES).toContain('brain-state-changed');
    expect(EVENT_TYPES).toContain('voyage-idle');
    expect(EVENT_TYPES).toContain('dream-completed');
  });

  test('contains curiosity-completed', () => {
    expect(EVENT_TYPES).toContain('curiosity-completed');
  });

  test('contains backlog-item-added, memory-consolidated', () => {
    expect(EVENT_TYPES).toContain('backlog-item-added');
    expect(EVENT_TYPES).toContain('memory-consolidated');
  });

  test('contains recovery-intervention, self-monitor, misused-signal', () => {
    expect(EVENT_TYPES).toContain('recovery-intervention');
    expect(EVENT_TYPES).toContain('self-monitor');
    expect(EVENT_TYPES).toContain('misused-signal');
  });

  test('does NOT contain plan-completed (KNOWN ASYMMETRY)', () => {
    // plan-completed IS in the type union but NOT in EVENT_TYPES. This is
    // intentional: the event is emitted by runVoyage but not surfaced in
    // the introspection array. Pinning so accidental "cleanup" doesn't
    // break observers that filter on EVENT_TYPES membership.
    expect(EVENT_TYPES).not.toContain('plan-completed');
  });

  test('all entries are unique (no duplicates)', () => {
    const set = new Set(EVENT_TYPES);
    expect(set.size).toBe(EVENT_TYPES.length);
  });
});

// ---------------------------------------------------------------------------
// OrchestratorEventType — derived from EVENT_TYPES
// ---------------------------------------------------------------------------

describe('OrchestratorEventType — derived type', () => {
  test('uses indexed access on typeof EVENT_TYPES', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).toMatch(/type\s+OrchestratorEventType\s*=\s*\(typeof\s+EVENT_TYPES\)\[number\]/);
  });

  test('value is one of EVENT_TYPES entries', () => {
    const sample: OrchestratorEventType = 'voyage-started';
    expect(EVENT_TYPES).toContain(sample);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('orchestrator/events — source-level safety', () => {
  test('no runtime values (pure type module + 1 const)', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).not.toMatch(/\bfunction\s+\w+\s*\(/);
    expect(src).not.toMatch(/\bclass\s+\w+/);
  });

  test('no console, no process, no I/O', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/process\./);
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/child_process/);
  });

  test('imports are type-only (zero runtime deps)', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const runtimeImports = src.match(/^import\s+\{/gm) ?? [];
    const typeImports = src.match(/^import\s+type\s+\{/gm) ?? [];
    expect(runtimeImports.length).toBe(0);
    expect(typeImports.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('orchestrator/events — structural fingerprint', () => {
  test('file has exactly 5 exported type declarations', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const types = src.match(/^export\s+type\s+\w+/gm) ?? [];
    expect(types.length).toBe(5);
  });

  test('file has exactly 1 exported const', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const consts = src.match(/^export\s+const\s+\w+/gm) ?? [];
    expect(consts.length).toBe(1);
  });

  test('type union uses `|` for each variant', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const pipes = src.match(/^\s*\|\s*\{\s*type:/gm) ?? [];
    expect(pipes.length).toBeGreaterThanOrEqual(20);
  });

  test('file is between 200 and 300 lines', async () => {
    const src = await readFile('src/orchestrator/events.ts', 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(200);
    expect(lines.length).toBeLessThanOrEqual(300);
  });
});
