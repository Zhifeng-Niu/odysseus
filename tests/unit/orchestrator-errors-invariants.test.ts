import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

import {
  InterruptedError,
  RejectedError,
  StuckLoopError,
} from '../../src/orchestrator/errors.js';

// ---------------------------------------------------------------------------
// Source contract — errors.ts
//
// This module defines three named Error subclasses used by the cerebellum
// orchestrator to signal distinct control-flow conditions:
//   - InterruptedError: voyage was interrupted (Ctrl+C or interrupt())
//   - StuckLoopError: repeated-tool-call detector fired post-recovery
//   - RejectedError: user rejected a waypoint via reject()
//
// Each subclass:
//   1. extends Error
//   2. assigns this.name to the class name (preserves the contract even
//      after minification/bundling, and produces readable stack traces)
//   3. exposes its discriminators as public readonly fields
//   4. formats a human-readable message at construction time
//
// These tests pin all four properties so refactors do not silently break
// the orchestrator's catch branches (which rely on instanceof + field
// access).
// ---------------------------------------------------------------------------

describe('orchestrator/errors — module exports', () => {
  test('exports exactly 3 named classes', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    const exportedClasses = src.match(/^export\s+class\s+(\w+)/gm) ?? [];
    expect(exportedClasses.length).toBe(3);
    expect(exportedClasses.some((c) => c.includes('InterruptedError'))).toBe(true);
    expect(exportedClasses.some((c) => c.includes('StuckLoopError'))).toBe(true);
    expect(exportedClasses.some((c) => c.includes('RejectedError'))).toBe(true);
  });

  test('all 3 classes are Error subclasses', () => {
    expect(InterruptedError.prototype instanceof Error).toBe(true);
    expect(StuckLoopError.prototype instanceof Error).toBe(true);
    expect(RejectedError.prototype instanceof Error).toBe(true);
  });

  test('no other top-level declarations (const, function, interface, type)', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).not.toMatch(/^export\s+(function|const|interface|type|enum)\s/m);
  });
});

// ---------------------------------------------------------------------------
// InterruptedError
// ---------------------------------------------------------------------------

describe('InterruptedError — contract', () => {
  test('constructs with reason and sets formatted message', () => {
    const err = new InterruptedError('user-pressed-ctrl-c');
    expect(err.message).toBe('Voyage interrupted: user-pressed-ctrl-c');
    expect(err.reason).toBe('user-pressed-ctrl-c');
  });

  test('name is set to class name', () => {
    const err = new InterruptedError('test');
    expect(err.name).toBe('InterruptedError');
  });

  test('is instanceof Error and instanceof InterruptedError', () => {
    const err = new InterruptedError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InterruptedError);
  });

  test('reason is a public readonly field', () => {
    const err = new InterruptedError('x');
    // Field exists on the instance
    expect(Object.prototype.hasOwnProperty.call(err, 'reason')).toBe(true);
    expect(typeof err.reason).toBe('string');
  });

  test('stack trace is populated', () => {
    const err = new InterruptedError('test');
    expect(typeof err.stack).toBe('string');
    expect(err.stack).toContain('InterruptedError');
  });

  test('source declares single constructor parameter (reason: string)', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).toMatch(/class\s+InterruptedError\s+extends\s+Error\s*\{[^}]*constructor\s*\(\s*public\s+reason:\s*string\s*\)/s);
  });

  test('source message template uses ${reason}', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).toMatch(/Voyage interrupted:\s*\$\{reason\}/);
  });

  test('can be thrown and caught', () => {
    expect(() => {
      throw new InterruptedError('test');
    }).toThrow(InterruptedError);
    expect(() => {
      throw new InterruptedError('test');
    }).toThrow('Voyage interrupted: test');
  });

  test('serializes reason correctly via toString()', () => {
    const err = new InterruptedError('user-sigint');
    expect(err.toString()).toBe('InterruptedError: Voyage interrupted: user-sigint');
  });
});

// ---------------------------------------------------------------------------
// StuckLoopError
// ---------------------------------------------------------------------------

describe('StuckLoopError — contract', () => {
  test('constructs with toolName, count, args and sets formatted message', () => {
    const err = new StuckLoopError('bash', 3, '{"cmd":"ls"}');
    expect(err.toolName).toBe('bash');
    expect(err.count).toBe(3);
    expect(err.args).toBe('{"cmd":"ls"}');
    expect(err.message).toContain('"bash"');
    expect(err.message).toContain('3 times in a row');
    expect(err.message).toContain('{"cmd":"ls"}');
  });

  test('name is set to class name', () => {
    const err = new StuckLoopError('bash', 1, 'x');
    expect(err.name).toBe('StuckLoopError');
  });

  test('is instanceof Error and instanceof StuckLoopError', () => {
    const err = new StuckLoopError('bash', 1, 'x');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StuckLoopError);
  });

  test('NOT instanceof InterruptedError or RejectedError', () => {
    const err = new StuckLoopError('bash', 1, 'x');
    expect(err).not.toBeInstanceOf(InterruptedError);
    expect(err).not.toBeInstanceOf(RejectedError);
  });

  test('all 3 fields are public own properties', () => {
    const err = new StuckLoopError('bash', 2, 'args');
    expect(Object.prototype.hasOwnProperty.call(err, 'toolName')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(err, 'count')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(err, 'args')).toBe(true);
  });

  test('count is a number (not stringified)', () => {
    const err = new StuckLoopError('bash', 5, 'x');
    expect(typeof err.count).toBe('number');
    expect(err.count).toBe(5);
  });

  test('source declares 3 public constructor parameters', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).toMatch(
      /constructor\s*\(\s*public\s+toolName:\s*string,\s*public\s+count:\s*number,\s*public\s+args:\s*string,?\s*\)/s,
    );
  });

  test('source message mentions "Stuck loop detected" and "recovery intervention"', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).toMatch(/Stuck loop detected/);
    expect(src).toMatch(/recovery intervention/);
  });

  test('message format is stable (snapshot)', () => {
    const err = new StuckLoopError('read_file', 4, '{"path":"/a"}');
    expect(err.message).toBe(
      'Stuck loop detected: "read_file" invoked 4 times in a row ' +
        'with identical arguments ({"path":"/a"}) — loop persisted after recovery intervention',
    );
  });

  test('can be thrown and caught with instanceof narrowing', () => {
    try {
      throw new StuckLoopError('bash', 2, 'args');
    } catch (e) {
      expect(e).toBeInstanceOf(StuckLoopError);
      if (e instanceof StuckLoopError) {
        expect(e.toolName).toBe('bash');
        expect(e.count).toBe(2);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// RejectedError
// ---------------------------------------------------------------------------

describe('RejectedError — contract', () => {
  test('constructs with waypointId and reason; sets formatted message', () => {
    const err = new RejectedError('wp_abc123', 'wrong approach');
    expect(err.waypointId).toBe('wp_abc123');
    expect(err.reason).toBe('wrong approach');
    expect(err.message).toBe('Waypoint wp_abc123 rejected: wrong approach');
  });

  test('name is set to class name', () => {
    const err = new RejectedError('wp_x', 'x');
    expect(err.name).toBe('RejectedError');
  });

  test('is instanceof Error and instanceof RejectedError', () => {
    const err = new RejectedError('wp_x', 'x');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(RejectedError);
  });

  test('NOT instanceof InterruptedError or StuckLoopError', () => {
    const err = new RejectedError('wp_x', 'x');
    expect(err).not.toBeInstanceOf(InterruptedError);
    expect(err).not.toBeInstanceOf(StuckLoopError);
  });

  test('waypointId and reason are public own properties', () => {
    const err = new RejectedError('wp_x', 'y');
    expect(Object.prototype.hasOwnProperty.call(err, 'waypointId')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(err, 'reason')).toBe(true);
  });

  test('source declares 2 public constructor parameters', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).toMatch(
      /constructor\s*\(\s*public\s+waypointId:\s*string,\s*public\s+reason:\s*string,?\s*\)/s,
    );
  });

  test('source message template uses ${waypointId} and ${reason}', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).toMatch(/Waypoint\s+\$\{waypointId\}\s+rejected:\s*\$\{reason\}/);
  });

  test('can be thrown and caught', () => {
    expect(() => {
      throw new RejectedError('wp_1', 'bad');
    }).toThrow(RejectedError);
    expect(() => {
      throw new RejectedError('wp_1', 'bad');
    }).toThrow('Waypoint wp_1 rejected: bad');
  });

  test('serializes correctly via toString()', () => {
    const err = new RejectedError('wp_99', 'nope');
    expect(err.toString()).toBe('RejectedError: Waypoint wp_99 rejected: nope');
  });
});

// ---------------------------------------------------------------------------
// Cross-class behavior — instanceof discrimination
//
// The orchestrator's catch blocks branch on instanceof. These tests pin the
// invariant that the three classes are mutually distinct: catching one does
// not accidentally match another.
// ---------------------------------------------------------------------------

describe('orchestrator/errors — mutual discrimination', () => {
  test('catch in priority order: InterruptedError first', () => {
    let caught = 'none';
    try {
      throw new InterruptedError('test');
    } catch (e) {
      if (e instanceof InterruptedError) caught = 'interrupted';
      else if (e instanceof StuckLoopError) caught = 'stuck';
      else if (e instanceof RejectedError) caught = 'rejected';
    }
    expect(caught).toBe('interrupted');
  });

  test('catch in priority order: StuckLoopError', () => {
    let caught = 'none';
    try {
      throw new StuckLoopError('bash', 2, 'x');
    } catch (e) {
      if (e instanceof InterruptedError) caught = 'interrupted';
      else if (e instanceof StuckLoopError) caught = 'stuck';
      else if (e instanceof RejectedError) caught = 'rejected';
    }
    expect(caught).toBe('stuck');
  });

  test('catch in priority order: RejectedError', () => {
    let caught = 'none';
    try {
      throw new RejectedError('wp_1', 'x');
    } catch (e) {
      if (e instanceof InterruptedError) caught = 'interrupted';
      else if (e instanceof StuckLoopError) caught = 'stuck';
      else if (e instanceof RejectedError) caught = 'rejected';
    }
    expect(caught).toBe('rejected');
  });

  test('generic Error is NOT instanceof any of the three', () => {
    const plain = new Error('plain');
    expect(plain).not.toBeInstanceOf(InterruptedError);
    expect(plain).not.toBeInstanceOf(StuckLoopError);
    expect(plain).not.toBeInstanceOf(RejectedError);
  });

  test('each class has a distinct prototype', () => {
    expect(Object.getPrototypeOf(InterruptedError.prototype)).toBe(Error.prototype);
    expect(Object.getPrototypeOf(StuckLoopError.prototype)).toBe(Error.prototype);
    expect(Object.getPrototypeOf(RejectedError.prototype)).toBe(Error.prototype);
    // All three are siblings, not nested
    expect(InterruptedError.prototype).not.toBe(StuckLoopError.prototype);
    expect(InterruptedError.prototype).not.toBe(RejectedError.prototype);
    expect(StuckLoopError.prototype).not.toBe(RejectedError.prototype);
  });
});

// ---------------------------------------------------------------------------
// Source-level guards — message templates must not drift
// ---------------------------------------------------------------------------

describe('orchestrator/errors — source-level guards', () => {
  test('this.name is explicitly assigned in every class', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    const nameAssignments = src.match(/this\.name\s*=\s*['"][^'"]+['"]/g) ?? [];
    expect(nameAssignments.length).toBe(3);
    expect(nameAssignments.some((s) => s.includes('InterruptedError'))).toBe(true);
    expect(nameAssignments.some((s) => s.includes('StuckLoopError'))).toBe(true);
    expect(nameAssignments.some((s) => s.includes('RejectedError'))).toBe(true);
  });

  test('no console, stdout, or process.env access', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/process\.stdout/);
    expect(src).not.toMatch(/process\.exit/);
  });

  test('no external imports — pure TypeScript Error subclasses', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).not.toMatch(/^import\s/m);
  });

  test('no default export', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).not.toMatch(/^export\s+default\s/m);
  });

  test('message strings are non-empty for all classes', () => {
    expect(new InterruptedError('x').message.length).toBeGreaterThan(0);
    expect(new StuckLoopError('x', 1, 'y').message.length).toBeGreaterThan(0);
    expect(new RejectedError('x', 'y').message.length).toBeGreaterThan(0);
  });

  test('empty-string arguments do not throw', () => {
    expect(() => new InterruptedError('')).not.toThrow();
    expect(() => new StuckLoopError('', 0, '')).not.toThrow();
    expect(() => new RejectedError('', '')).not.toThrow();
  });

  test('count = 0 produces grammatical message (no special-casing needed)', () => {
    const err = new StuckLoopError('bash', 0, 'x');
    expect(err.message).toContain('0 times in a row');
  });
});

// ---------------------------------------------------------------------------
// Structural fingerprint — catches accidental additions/removals
// ---------------------------------------------------------------------------

describe('orchestrator/errors — structural fingerprint', () => {
  test('class declaration count in source is exactly 3', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    const classDecl = src.match(/^export\s+class\s+\w+\s+extends\s+Error/gm) ?? [];
    expect(classDecl.length).toBe(3);
  });

  test('all classes extend Error (not a custom base)', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).toMatch(/class\s+InterruptedError\s+extends\s+Error/);
    expect(src).toMatch(/class\s+StuckLoopError\s+extends\s+Error/);
    expect(src).toMatch(/class\s+RejectedError\s+extends\s+Error/);
  });

  test('all classes use constructor(public ...) shorthand', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    // Each class should have exactly one `constructor(public` occurrence.
    const publicParams = src.match(/constructor\s*\(\s*public\s/g) ?? [];
    expect(publicParams.length).toBe(3);
  });

  test('no static members', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).not.toMatch(/static\s+\w+/);
  });

  test('no getters or setters', async () => {
    const src = await readFile('src/orchestrator/errors.ts', 'utf8');
    expect(src).not.toMatch(/\bget\s+\w+\s*\(/);
    expect(src).not.toMatch(/\bset\s+\w+\s*\(/);
  });
});
