import { describe, test, expect } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  INITIAL_BRAIN_STATE,
  LLM_ACTIVE_STATES,
  canTransitionTo,
  type BrainState,
} from '../../src/cerebellum/brain-state.js';

/**
 * brain-state.ts — the cognitive state machine that models the agent
 * between and during waypoints.
 *
 * Iteration 25 — the module's JSDoc literally said "see the unit tests
 * for the invariant" but no dedicated test file existed. The contract
 * was exercised only indirectly via orchestrator integration tests,
 * which made it invisible to regression testing. If someone added a
 * bogus transition to ALLOWED_TRANSITIONS, only the orchestrator
 * integration suite could catch it — and even then, only if a test
 * path happened to exercise the specific transition.
 *
 * These tests lock the contract directly: the state-machine topology,
 * the directionality of each transition, the initial state, and the
 * LLM-cost classification.
 */

describe('brain-state — INITIAL_BRAIN_STATE', () => {
  test('initial state is idle (brain asleep until prompted)', () => {
    // A fresh Orchestrator starts in `idle` — no dreaming until there
    // is something to dream about. This matches the JSDoc on
    // INITIAL_BRAIN_STATE and is load-bearing for the first user input
    // (which must transition idle → wakeful, the only allowed move).
    expect(INITIAL_BRAIN_STATE).toBe('idle');
  });
});

describe('brain-state — ALLOWED_TRANSITIONS shape', () => {
  test('every BrainState has an entry in the map', () => {
    // If a new state is added to the union but not to the map,
    // canTransitionTo would throw on lookup. This test catches that
    // at the type-system boundary.
    const allStates: readonly BrainState[] = [
      'idle',
      'wakeful',
      'dreaming',
      'reflecting',
      'consolidating',
    ];
    for (const s of allStates) {
      expect(Array.isArray(ALLOWED_TRANSITIONS[s])).toBe(true);
    }
  });

  test('no state can transition to itself', () => {
    // Self-transitions would defeat the purpose of a state machine —
    // the agent would never actually change cognitive phase. All
    // entries must move to a different phase.
    const allStates = Object.keys(ALLOWED_TRANSITIONS) as BrainState[];
    for (const from of allStates) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        expect(to).not.toBe(from);
      }
    }
  });
});

describe('brain-state — canTransitionTo allowed paths', () => {
  // The happy path: each transition that the orchestrator actually
  // performs during a voyage. If any of these becomes disallowed,
  // the orchestrator will throw on state transition —voyage crashes.

  test('idle → wakeful (first user input starts a waypoint)', () => {
    expect(canTransitionTo('idle', 'wakeful')).toBe(true);
  });

  test('wakeful → idle (waypoint completes with empty backlog)', () => {
    // When a waypoint produces no self-evolution work, the brain
    // returns to idle rather than starting a dream cycle.
    expect(canTransitionTo('wakeful', 'idle')).toBe(true);
  });

  test('wakeful → dreaming (waypoint completes with backlog items)', () => {
    expect(canTransitionTo('wakeful', 'dreaming')).toBe(true);
  });

  test('dreaming → reflecting (dream pass complete, meta-cognition begins)', () => {
    expect(canTransitionTo('dreaming', 'reflecting')).toBe(true);
  });

  test('dreaming → wakeful (user input interrupts dream)', () => {
    // Pre-emption: a user message during dreaming must be able to
    // start a new waypoint without going through reflecting/
    // consolidating first.
    expect(canTransitionTo('dreaming', 'wakeful')).toBe(true);
  });

  test('reflecting → consolidating (meta-cognition done, persisting)', () => {
    expect(canTransitionTo('reflecting', 'consolidating')).toBe(true);
  });

  test('reflecting → wakeful (reflection interrupted by user input)', () => {
    expect(canTransitionTo('reflecting', 'wakeful')).toBe(true);
  });

  test('consolidating → wakeful (next backlog item starts)', () => {
    expect(canTransitionTo('consolidating', 'wakeful')).toBe(true);
  });

  test('consolidating → idle (backlog drained, await next user input)', () => {
    expect(canTransitionTo('consolidating', 'idle')).toBe(true);
  });
});

describe('brain-state — canTransitionTo disallowed paths', () => {
  // The negative space: transitions the orchestrator must NEVER make.
  // These exist to enforce cognitive phases — you can't dream before
  // being awake, you can't persist before reflecting, etc.

  test('idle → dreaming is disallowed (must wake first)', () => {
    expect(canTransitionTo('idle', 'dreaming')).toBe(false);
  });

  test('idle → reflecting is disallowed', () => {
    expect(canTransitionTo('idle', 'reflecting')).toBe(false);
  });

  test('idle → consolidating is disallowed', () => {
    expect(canTransitionTo('idle', 'consolidating')).toBe(false);
  });

  test('wakeful → reflecting is disallowed (must dream first)', () => {
    // Reflecting without dreaming would skip the creative pass that
    // generates backlog candidates. The state machine enforces
    // ordering.
    expect(canTransitionTo('wakeful', 'reflecting')).toBe(false);
  });

  test('wakeful → consolidating is disallowed', () => {
    expect(canTransitionTo('wakeful', 'consolidating')).toBe(false);
  });

  test('dreaming → idle is disallowed (must go through wakeful)', () => {
    // A dream can be interrupted (→ wakeful) or complete (→ reflecting),
    // but it cannot directly return to idle — that would skip
    // reflection on what was dreamed.
    expect(canTransitionTo('dreaming', 'idle')).toBe(false);
  });

  test('dreaming → consolidating is disallowed', () => {
    expect(canTransitionTo('dreaming', 'consolidating')).toBe(false);
  });

  test('reflecting → idle is disallowed', () => {
    expect(canTransitionTo('reflecting', 'idle')).toBe(false);
  });

  test('reflecting → dreaming is disallowed (no recursive dreaming)', () => {
    expect(canTransitionTo('reflecting', 'dreaming')).toBe(false);
  });

  test('consolidating → dreaming is disallowed', () => {
    expect(canTransitionTo('consolidating', 'dreaming')).toBe(false);
  });

  test('consolidating → reflecting is disallowed', () => {
    expect(canTransitionTo('consolidating', 'reflecting')).toBe(false);
  });
});

describe('brain-state — LLM_ACTIVE_STATES', () => {
  test('wakeful and dreaming are LLM-active (consume tokens)', () => {
    // The budget tracker uses this classification. wakeful = running
    // the agent loop (LLM ↔ tools), dreaming = free-association LLM
    // pass. Both burn tokens.
    expect(LLM_ACTIVE_STATES).toContain('wakeful');
    expect(LLM_ACTIVE_STATES).toContain('dreaming');
  });

  test('idle, reflecting, consolidating are NOT LLM-active', () => {
    // Idle = no activity. Reflecting uses local heuristics (in the
    // current implementation). Consolidating is pure I/O. None of
    // these should appear in the LLM-active list — if they did, the
    // budget tracker would over-count.
    expect(LLM_ACTIVE_STATES).not.toContain('idle');
    expect(LLM_ACTIVE_STATES).not.toContain('reflecting');
    expect(LLM_ACTIVE_STATES).not.toContain('consolidating');
  });
});
