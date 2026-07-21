import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  recordEvent,
  readEventLog,
  eventsForWaypoint,
} from '../../src/trace/event-log.js';
import type { OrchestratorEvent } from '../../src/orchestrator/events.js';

// ---------------------------------------------------------------------------
// Source contract — trace/event-log.ts
//
// Append-only JSONL recorder for orchestrator events.
//
// Invariants pinned here:
//   - recordEvent is fire-and-forget (returns void), serialized through a
//     module-level promise chain
//   - write errors are SWALLOWED (logging is best-effort; never crashes voyage)
//   - readEventLog returns [] on missing file or any read error
//   - readEventLog skips malformed lines defensively
//   - readEventLog skips empty/whitespace-only lines
//   - eventsForWaypoint filters by 'waypointId' in e (defensive against
//     events that lack the field)
//   - mkdir recursive ensures the parent directory exists
//
// All tests use mkdtemp isolation — never touch the real .odysseus/.
// ---------------------------------------------------------------------------

describe('trace/event-log — module exports', () => {
  test('exports recordEvent, readEventLog, eventsForWaypoint', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/^export\s+function\s+recordEvent/m);
    expect(src).toMatch(/^export\s+async\s+function\s+readEventLog/m);
    expect(src).toMatch(/^export\s+function\s+eventsForWaypoint/m);
  });

  test('exactly 3 exports', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    const exports = src.match(/^export\s+(async\s+)?function\s+\w+/gm) ?? [];
    expect(exports.length).toBe(3);
  });

  test('writeOne is NOT exported (internal helper)', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/^async\s+function\s+writeOne/m);
    expect(src).not.toMatch(/^export\s+.*writeOne/m);
  });

  test('writeChain is module-level state (not exported)', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/^let\s+writeChain:\s*Promise<void>\s*=\s*Promise\.resolve\(\)/m);
    expect(src).not.toMatch(/^export\s+.*writeChain/m);
  });

  test('no default export', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).not.toMatch(/^export\s+default\s/m);
  });
});

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

describe('trace/event-log — imports', () => {
  test('imports appendFile, mkdir, readFile from node:fs/promises', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/^import\s+\{\s*appendFile,\s*mkdir,\s*readFile\s*\}\s+from\s+'node:fs\/promises'/m);
  });

  test('imports dirname from node:path', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/^import\s+\{\s*dirname\s*\}\s+from\s+'node:path'/m);
  });

  test('imports OrchestratorEvent as type', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/^import\s+type\s+\{\s*OrchestratorEvent\s*\}\s+from\s+'\.\.\/orchestrator\/events\.js'/m);
  });

  test('exactly 3 import statements', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    const imports = src.match(/^import\s/mg) ?? [];
    expect(imports.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// recordEvent — signature and behavior
// ---------------------------------------------------------------------------

describe('recordEvent — signature', () => {
  test('takes (path: string, event: OrchestratorEvent) and returns void', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/function\s+recordEvent\s*\(\s*path:\s*string,\s*event:\s*OrchestratorEvent\s*\):\s*void/);
  });

  test('runtime: returns undefined when invoked', () => {
    const result = recordEvent('/tmp/should-not-exist/invalid', {
      type: 'assistant-message',
      content: 'x',
    } as OrchestratorEvent);
    expect(result).toBeUndefined();
  });
});

describe('recordEvent — write serialization', () => {
  test('appends events as JSONL (one JSON object per line)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const logPath = join(dir, 'events.jsonl');
      recordEvent(logPath, { type: 'assistant-message', content: 'first' } as OrchestratorEvent);
      recordEvent(logPath, { type: 'assistant-message', content: 'second' } as OrchestratorEvent);
      // Wait for the write chain to flush
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 50));

      const raw = await readFile(logPath, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      expect(lines.length).toBe(2);
      expect(JSON.parse(lines[0]!).content).toBe('first');
      expect(JSON.parse(lines[1]!).content).toBe('second');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('creates parent directory if missing (recursive mkdir)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const nestedDir = join(dir, 'a', 'b', 'c');
      const logPath = join(nestedDir, 'events.jsonl');
      recordEvent(logPath, { type: 'assistant-message', content: 'x' } as OrchestratorEvent);
      await new Promise((r) => setTimeout(r, 50));

      const raw = await readFile(logPath, 'utf8');
      expect(raw).toContain('"content":"x"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('each line is terminated with newline (\\n)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const logPath = join(dir, 'events.jsonl');
      recordEvent(logPath, { type: 'assistant-message', content: 'x' } as OrchestratorEvent);
      await new Promise((r) => setTimeout(r, 50));

      const raw = await readFile(logPath, 'utf8');
      expect(raw.endsWith('\n')).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('writes are serialized (promise chain)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const logPath = join(dir, 'events.jsonl');
      // Fire 50 events in a tight burst
      for (let i = 0; i < 50; i++) {
        recordEvent(logPath, {
          type: 'assistant-message',
          content: `evt-${i}`,
        } as OrchestratorEvent);
      }
      await new Promise((r) => setTimeout(r, 100));

      const raw = await readFile(logPath, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      expect(lines.length).toBe(50);
      // Verify order preserved
      const contents = lines.map((l) => (JSON.parse(l) as { content: string }).content);
      for (let i = 0; i < 50; i++) {
        expect(contents[i]).toBe(`evt-${i}`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('source uses writeChain.then(...).catch(...)', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/writeChain\s*=\s*writeChain\s*\.then\(/);
    expect(src).toMatch(/\.catch\(\(\)\s*=>\s*\{[\s\S]*?\}\)/);
  });
});

// ---------------------------------------------------------------------------
// recordEvent — error swallowing (best-effort logging)
//
// CRITICAL: a logging failure must NEVER crash the voyage. The catch must
// silently swallow.
// ---------------------------------------------------------------------------

describe('recordEvent — best-effort error handling', () => {
  test('recordEvent to an unwritable path does NOT throw', () => {
    expect(() => {
      recordEvent('/nonexistent-root/path/that/cannot/be/created/events.jsonl', {
        type: 'assistant-message',
        content: 'x',
      } as OrchestratorEvent);
    }).not.toThrow();
  });

  test('source catch block is empty (swallows error)', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    // The catch block should contain a comment but no throw/re-throw
    const catchMatch = src.match(/\.catch\(\(\)\s*=>\s*\{([\s\S]*?)\}\)/);
    expect(catchMatch).not.toBeNull();
    expect(catchMatch![1]).not.toMatch(/throw/);
    expect(catchMatch![1]).not.toMatch(/console\./);
  });

  test('recordEvent continues writing subsequent events after a failure', async () => {
    // Write to an invalid path, then to a valid path — second should succeed.
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const badPath = '/nonexistent-root/x/y/events.jsonl';
      const goodPath = join(dir, 'events.jsonl');
      recordEvent(badPath, { type: 'assistant-message', content: 'bad' } as OrchestratorEvent);
      recordEvent(goodPath, { type: 'assistant-message', content: 'good' } as OrchestratorEvent);
      await new Promise((r) => setTimeout(r, 100));

      const raw = await readFile(goodPath, 'utf8');
      expect(raw).toContain('"content":"good"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// readEventLog — missing file and malformed input
// ---------------------------------------------------------------------------

describe('readEventLog — missing file handling', () => {
  test('returns [] when file does not exist', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const missing = join(dir, 'does-not-exist.jsonl');
      const result = await readEventLog(missing);
      expect(result).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('source catches read error and returns []', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/try\s*\{\s*raw\s*=\s*await\s+readFile\([^)]+\)\s*;\s*\}\s*catch\s*\{\s*return\s*\[\]\s*;\s*\}/s);
  });
});

describe('readEventLog — empty and whitespace handling', () => {
  test('returns [] for an empty file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const path = join(dir, 'empty.jsonl');
      await writeFile(path, '', 'utf8');
      const result = await readEventLog(path);
      expect(result).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('skips blank lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const path = join(dir, 'blanks.jsonl');
      await writeFile(
        path,
        '{"type":"assistant-message","content":"a"}\n\n{"type":"assistant-message","content":"b"}\n\n',
        'utf8',
      );
      const result = await readEventLog(path);
      expect(result.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('skips whitespace-only lines', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const path = join(dir, 'ws.jsonl');
      await writeFile(
        path,
        '{"type":"assistant-message","content":"a"}\n   \n\t\n{"type":"assistant-message","content":"b"}\n',
        'utf8',
      );
      const result = await readEventLog(path);
      expect(result.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('trims each line before parsing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const path = join(dir, 'padded.jsonl');
      await writeFile(
        path,
        '  {"type":"assistant-message","content":"a"}  \n',
        'utf8',
      );
      const result = await readEventLog(path);
      expect(result.length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('readEventLog — malformed JSON handling', () => {
  test('skips malformed lines, keeps valid ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const path = join(dir, 'mixed.jsonl');
      await writeFile(
        path,
        [
          '{"type":"assistant-message","content":"first"}',
          'not-valid-json',
          '{"type":"assistant-message","content":"second"}',
          '{broken: }',
          '{"type":"assistant-message","content":"third"}',
        ].join('\n') + '\n',
        'utf8',
      );
      const result = await readEventLog(path);
      expect(result.length).toBe(3);
      expect((result[0] as { content: string }).content).toBe('first');
      expect((result[1] as { content: string }).content).toBe('second');
      expect((result[2] as { content: string }).content).toBe('third');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('source try/catch wraps JSON.parse', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/try\s*\{\s*events\.push\(JSON\.parse\(trimmed\)[^)]*\)\s*;[^}]*\}\s*catch\s*\{[^}]*\}/s);
  });
});

describe('readEventLog — roundtrip', () => {
  test('write N events, read them back in order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'evt-'));
    try {
      const path = join(dir, 'roundtrip.jsonl');
      const events: OrchestratorEvent[] = [
        { type: 'assistant-message', content: 'one' } as OrchestratorEvent,
        { type: 'assistant-message', content: 'two' } as OrchestratorEvent,
        { type: 'assistant-message', content: 'three' } as OrchestratorEvent,
      ];
      for (const e of events) recordEvent(path, e);
      await new Promise((r) => setTimeout(r, 100));

      const read = await readEventLog(path);
      expect(read.length).toBe(3);
      expect(read.map((e) => (e as { content: string }).content)).toEqual(['one', 'two', 'three']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// readEventLog — signature
// ---------------------------------------------------------------------------

describe('readEventLog — signature', () => {
  test('takes (path: string) and returns Promise<OrchestratorEvent[]>', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/async\s+function\s+readEventLog\s*\(\s*path:\s*string\s*\):\s*Promise<OrchestratorEvent\[\]>/);
  });
});

// ---------------------------------------------------------------------------
// eventsForWaypoint — filtering
// ---------------------------------------------------------------------------

describe('eventsForWaypoint — signature', () => {
  test('takes (events: readonly OrchestratorEvent[], waypointId: string) returns OrchestratorEvent[]', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/function\s+eventsForWaypoint\s*\(\s*events:\s*readonly\s+OrchestratorEvent\[\],\s*waypointId:\s*string\s*\):\s*OrchestratorEvent\[\]/);
  });
});

describe('eventsForWaypoint — filtering behavior', () => {
  test('returns only events whose waypointId matches', () => {
    const events = [
      { type: 'a', waypointId: 'wp_1' },
      { type: 'b', waypointId: 'wp_2' },
      { type: 'c', waypointId: 'wp_1' },
      { type: 'd', waypointId: 'wp_3' },
    ] as unknown as OrchestratorEvent[];
    const filtered = eventsForWaypoint(events, 'wp_1');
    expect(filtered.length).toBe(2);
    expect(filtered.map((e) => (e as { type: string }).type)).toEqual(['a', 'c']);
  });

  test('returns empty array when no events match', () => {
    const events = [
      { type: 'a', waypointId: 'wp_1' },
    ] as unknown as OrchestratorEvent[];
    expect(eventsForWaypoint(events, 'wp_nonexistent')).toEqual([]);
  });

  test('returns empty array for empty input', () => {
    expect(eventsForWaypoint([], 'wp_1')).toEqual([]);
  });

  test('does NOT include events lacking waypointId field', () => {
    const events = [
      { type: 'no-id' },
      { type: 'has-id', waypointId: 'wp_1' },
      { type: 'also-no-id' },
    ] as unknown as OrchestratorEvent[];
    const filtered = eventsForWaypoint(events, 'wp_1');
    expect(filtered.length).toBe(1);
  });

  test('preserves emission order', () => {
    const events = [
      { type: 'first', waypointId: 'wp_1' },
      { type: 'other', waypointId: 'wp_2' },
      { type: 'second', waypointId: 'wp_1' },
      { type: 'third', waypointId: 'wp_1' },
    ] as unknown as OrchestratorEvent[];
    const filtered = eventsForWaypoint(events, 'wp_1');
    expect(filtered.map((e) => (e as { type: string }).type)).toEqual(['first', 'second', 'third']);
  });

  test('does NOT mutate the input array', () => {
    const events = [
      { type: 'a', waypointId: 'wp_1' },
      { type: 'b', waypointId: 'wp_2' },
    ] as unknown as OrchestratorEvent[];
    const snapshot = [...events];
    eventsForWaypoint(events, 'wp_1');
    expect(events).toEqual(snapshot);
  });

  test('source uses "waypointId" in e check before access', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/'waypointId'\s+in\s+e/);
  });
});

// ---------------------------------------------------------------------------
// Source-level safety
// ---------------------------------------------------------------------------

describe('trace/event-log — source-level safety', () => {
  test('no console.* (silent module)', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).not.toMatch(/console\./);
  });

  test('no process.exit (never crashes the process)', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).not.toMatch(/process\.exit/);
  });

  test('no shell exec/spawn', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).not.toMatch(/child_process/);
    expect(src).not.toMatch(/\bexec\(/);
  });

  test('uses node:fs/promises (not sync fs)', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/from\s+'node:fs\/promises'/);
    expect(src).not.toMatch(/readFileSync/);
    expect(src).not.toMatch(/writeFileSync/);
    expect(src).not.toMatch(/appendFileSync/);
    expect(src).not.toMatch(/mkdirSync/);
  });

  test('uses utf8 encoding for both read and write', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/appendFile\([^,]+,\s*line,\s*'utf8'\)/);
    expect(src).toMatch(/readFile\([^,]+,\s*'utf8'\)/);
  });

  test('uses recursive mkdir (creates nested dirs)', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    expect(src).toMatch(/mkdir\([^,]+,\s*\{\s*recursive:\s*true\s*\}\)/);
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint
// ---------------------------------------------------------------------------

describe('trace/event-log — structural fingerprint', () => {
  test('file has exactly 3 exported functions', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    const exports = src.match(/^export\s+(async\s+)?function\s+\w+/gm) ?? [];
    expect(exports.length).toBe(3);
  });

  test('file has exactly 1 internal async function (writeOne)', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    const internal = src.match(/^async\s+function\s+\w+/gm) ?? [];
    expect(internal.length).toBe(1);
    expect(internal[0]).toMatch(/\bwriteOne\b/);
  });

  test('writeChain is declared once at module scope', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    const decls = src.match(/^let\s+writeChain/gm) ?? [];
    expect(decls.length).toBe(1);
  });

  test('JSON.stringify is used exactly once (in writeOne)', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    const uses = src.match(/JSON\.stringify\(/g) ?? [];
    expect(uses.length).toBe(1);
  });

  test('JSON.parse is used exactly once (in readEventLog)', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    const uses = src.match(/JSON\.parse\(/g) ?? [];
    expect(uses.length).toBe(1);
  });

  test('file is between 60 and 100 lines', async () => {
    const src = await readFile('src/trace/event-log.ts', 'utf8');
    const lines = src.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(60);
    expect(lines.length).toBeLessThanOrEqual(100);
  });
});
