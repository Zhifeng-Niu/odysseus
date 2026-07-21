import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import {
  readVoyageState,
  incrementWorkCounter,
  resetWorkCounter,
  DEFAULT_VOYAGE_STATE_PATH,
  INITIAL_VOYAGE_STATE,
} from '../../src/cerebellum/voyage-state.js';

let workdir: string;
let statePath: string;

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'ody-vs-'));
  statePath = join(workdir, 'voyage-state.json');
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readVoyageState
// ---------------------------------------------------------------------------

describe('readVoyageState', () => {
  test('returns initial state when file does not exist', () => {
    const state = readVoyageState(statePath);
    expect(state).toEqual(INITIAL_VOYAGE_STATE);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('reads a valid state file', () => {
    const content = JSON.stringify({ workWaypointCounter: 5 });
    require('node:fs').writeFileSync(statePath, content, 'utf8');
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(5);
  });

  test('returns initial state for empty file', () => {
    require('node:fs').writeFileSync(statePath, '', 'utf8');
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('returns initial state for whitespace-only file', () => {
    require('node:fs').writeFileSync(statePath, '   \n  ', 'utf8');
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('returns initial state for malformed JSON', () => {
    require('node:fs').writeFileSync(statePath, '{not valid json', 'utf8');
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('returns initial state when parsed value is not an object', () => {
    require('node:fs').writeFileSync(statePath, '42', 'utf8');
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('returns initial state when parsed value is null', () => {
    require('node:fs').writeFileSync(statePath, 'null', 'utf8');
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('returns initial state when parsed value is an array', () => {
    require('node:fs').writeFileSync(statePath, '[]', 'utf8');
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('defaults missing workWaypointCounter field to 0', () => {
    require('node:fs').writeFileSync(statePath, '{}', 'utf8');
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('defaults non-number workWaypointCounter to 0', () => {
    require('node:fs').writeFileSync(
      statePath,
      JSON.stringify({ workWaypointCounter: 'three' }),
      'utf8',
    );
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('defaults NaN workWaypointCounter to 0', () => {
    require('node:fs').writeFileSync(
      statePath,
      JSON.stringify({ workWaypointCounter: NaN }),
      'utf8',
    );
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('defaults Infinity workWaypointCounter to 0', () => {
    require('node:fs').writeFileSync(
      statePath,
      JSON.stringify({ workWaypointCounter: Infinity }),
      'utf8',
    );
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('floors fractional workWaypointCounter', () => {
    require('node:fs').writeFileSync(
      statePath,
      JSON.stringify({ workWaypointCounter: 3.9 }),
      'utf8',
    );
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(3);
  });

  test('clamps negative workWaypointCounter to 0', () => {
    require('node:fs').writeFileSync(
      statePath,
      JSON.stringify({ workWaypointCounter: -5 }),
      'utf8',
    );
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('tolerates extra fields in the JSON', () => {
    require('node:fs').writeFileSync(
      statePath,
      JSON.stringify({ workWaypointCounter: 2, extraField: 'ignored' }),
      'utf8',
    );
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(2);
  });

  test('uses DEFAULT_VOYAGE_STATE_PATH when no path argument given', () => {
    // Just verify the constant is exported and is a string path
    expect(typeof DEFAULT_VOYAGE_STATE_PATH).toBe('string');
    expect(DEFAULT_VOYAGE_STATE_PATH).toContain('voyage-state.json');
  });
});

// ---------------------------------------------------------------------------
// incrementWorkCounter
// ---------------------------------------------------------------------------

describe('incrementWorkCounter', () => {
  test('returns 1 when starting from no file', () => {
    const result = incrementWorkCounter(statePath);
    expect(result).toBe(1);
  });

  test('persists the incremented value to disk', () => {
    incrementWorkCounter(statePath);
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(1);
  });

  test('increments sequentially across multiple calls', () => {
    expect(incrementWorkCounter(statePath)).toBe(1);
    expect(incrementWorkCounter(statePath)).toBe(2);
    expect(incrementWorkCounter(statePath)).toBe(3);
  });

  test('increments from a pre-existing value', () => {
    require('node:fs').writeFileSync(
      statePath,
      JSON.stringify({ workWaypointCounter: 7 }),
      'utf8',
    );
    expect(incrementWorkCounter(statePath)).toBe(8);
  });

  test('creates parent directories if they do not exist', () => {
    const nestedPath = join(workdir, 'nested', 'deep', 'state.json');
    const result = incrementWorkCounter(nestedPath);
    expect(result).toBe(1);
    expect(existsSync(nestedPath)).toBe(true);
  });

  test('writes valid JSON that can be re-read', () => {
    incrementWorkCounter(statePath);
    incrementWorkCounter(statePath);
    const raw = readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.workWaypointCounter).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// resetWorkCounter
// ---------------------------------------------------------------------------

describe('resetWorkCounter', () => {
  test('sets counter to 0 when file does not exist', () => {
    resetWorkCounter(statePath);
    const state = readVoyageState(statePath);
    expect(state.workWaypointCounter).toBe(0);
  });

  test('resets a non-zero counter back to 0', () => {
    incrementWorkCounter(statePath);
    incrementWorkCounter(statePath);
    incrementWorkCounter(statePath);
    expect(readVoyageState(statePath).workWaypointCounter).toBe(3);

    resetWorkCounter(statePath);
    expect(readVoyageState(statePath).workWaypointCounter).toBe(0);
  });

  test('creates the file if it does not exist', () => {
    expect(existsSync(statePath)).toBe(false);
    resetWorkCounter(statePath);
    expect(existsSync(statePath)).toBe(true);
  });

  test('creates parent directories if they do not exist', () => {
    const nestedPath = join(workdir, 'nested', 'deep', 'state.json');
    resetWorkCounter(nestedPath);
    expect(existsSync(nestedPath)).toBe(true);
  });

  test('writes valid JSON with counter 0', () => {
    resetWorkCounter(statePath);
    const raw = readFileSync(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.workWaypointCounter).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integration: increment → reset → increment cycle
// ---------------------------------------------------------------------------

describe('increment/reset cycle', () => {
  test('simulates a circadian rhythm: work 3, reset, work 2', () => {
    // Accumulate 3 work waypoints
    expect(incrementWorkCounter(statePath)).toBe(1);
    expect(incrementWorkCounter(statePath)).toBe(2);
    expect(incrementWorkCounter(statePath)).toBe(3);

    // Dream happens — reset
    resetWorkCounter(statePath);
    expect(readVoyageState(statePath).workWaypointCounter).toBe(0);

    // New cycle begins
    expect(incrementWorkCounter(statePath)).toBe(1);
    expect(incrementWorkCounter(statePath)).toBe(2);
  });
});
