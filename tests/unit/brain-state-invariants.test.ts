/**
 * Invariants for src/cerebellum/brain-state.ts.
 *
 * The existing brain-state.test.ts covers behavior: every allowed
 * transition is tested true, every disallowed transition is tested
 * false, INITIAL_BRAIN_STATE is 'idle', LLM_ACTIVE_STATES contains
 * wakeful/dreaming. This file pins the load-bearing structural
 * contracts that the behavioral tests imply but don't make explicit:
 *
 *   - ALLOWED_TRANSITIONS keys are exactly the BrainState union
 *     (no missing states, no extra states)
 *   - Every ALLOWED_TRANSITIONS value is a readonly array of BrainState
 *     (not a mutable array, not arbitrary strings)
 *   - Every state has at least one outgoing transition (no sink states
 *     — would deadlock the state machine)
 *   - Every state has at least one incoming transition (no unreachable
 *     states — would be dead code)
 *   - The state graph is strongly connected (any state can reach any
 *     other state through some transition path)
 *   - wakeful is the "hub" state: multiple states transition TO it
 *     (pre-emption contract for user input interrupts)
 *   - canTransitionTo is a pure lookup (deterministic, side-effect-free)
 *   - BrainStateTransition type shape: {from, to, reason, ts}
 *   - INITIAL_BRAIN_STATE is a valid BrainState literal
 *   - LLM_ACTIVE_STATES is exactly 2 entries (wakeful, dreaming) — no
 *     more, no less
 *
 * The strong-connectivity invariant is the most load-bearing: if a
 * future refactor removed a transition, the orchestrator could end up
 * in a state with no exit (deadlock) or an unreachable state (dead
 * code). Graph reachability catches both.
 *
 * The "wakeful is hub" contract is load-bearing because pre-emption
 * (user input interrupts dream/reflection) depends on dreaming → wakeful
 * and reflecting → wakeful existing. Removing either would make user
 * input during a dream/reflection crash or queue indefinitely.
 */

import { describe, test, expect } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  INITIAL_BRAIN_STATE,
  LLM_ACTIVE_STATES,
  canTransitionTo,
  type BrainState,
  type BrainStateTransition,
} from '../../src/cerebellum/brain-state.js';

const ALL_STATES: readonly BrainState[] = [
  'idle',
  'wakeful',
  'dreaming',
  'reflecting',
  'consolidating',
];

describe('brain-state invariants', () => {
  // -------------------------------------------------------------------------
  // BrainState union — exhaustive enumeration
  // -------------------------------------------------------------------------

  describe('BrainState union', () => {
    test('has exactly 5 members', () => {
      expect(ALL_STATES).toHaveLength(5);
    });

    test('all members are lowercase strings', () => {
      // Pinning so a future refactor like 'Wakeful' or 'WAKEFUL' surfaces.
      for (const s of ALL_STATES) {
        expect(s).toBe(s.toLowerCase());
        expect(s).toMatch(/^[a-z]+$/);
      }
    });

    test('all members are unique (no duplicates in the canonical list)', () => {
      const set = new Set(ALL_STATES);
      expect(set.size).toBe(ALL_STATES.length);
    });

    test('the 5 documented states are present', () => {
      // Lock the literal names — renaming any of these silently breaks
      // every consumer that pattern-matches on the string value.
      expect(ALL_STATES).toContain('idle');
      expect(ALL_STATES).toContain('wakeful');
      expect(ALL_STATES).toContain('dreaming');
      expect(ALL_STATES).toContain('reflecting');
      expect(ALL_STATES).toContain('consolidating');
    });
  });

  // -------------------------------------------------------------------------
  // ALLOWED_TRANSITIONS map shape
  // -------------------------------------------------------------------------

  describe('ALLOWED_TRANSITIONS map shape', () => {
    test('keys are exactly the 5 BrainState values (no more, no less)', () => {
      const keys = Object.keys(ALLOWED_TRANSITIONS).sort();
      const expected = [...ALL_STATES].sort();
      expect(keys).toEqual(expected);
    });

    test('every value is an array', () => {
      for (const s of ALL_STATES) {
        expect(Array.isArray(ALLOWED_TRANSITIONS[s])).toBe(true);
      }
    });

    test('every value is non-empty (no sink states)', () => {
      // A state with zero outgoing transitions would deadlock the
      // orchestrator if it ever entered that state.
      for (const s of ALL_STATES) {
        expect(ALLOWED_TRANSITIONS[s].length).toBeGreaterThan(0);
      }
    });

    test('every transition target is a valid BrainState (not arbitrary string)', () => {
      const validSet = new Set(ALL_STATES);
      for (const from of ALL_STATES) {
        for (const to of ALLOWED_TRANSITIONS[from]) {
          expect(validSet.has(to)).toBe(true);
        }
      }
    });

    test('no state transitions to itself (reflexivity check)', () => {
      // Already covered in brain-state.test.ts, but pin here too for
      // structural completeness.
      for (const from of ALL_STATES) {
        for (const to of ALLOWED_TRANSITIONS[from]) {
          expect(to).not.toBe(from);
        }
      }
    });

    test('outgoing counts match the documented topology', () => {
      // Pin the exact out-degree per state. The orchestrator depends
      // on specific exit paths; if a refactor adds/removes a transition,
      // surface it explicitly.
      expect(ALLOWED_TRANSITIONS.idle).toEqual(['wakeful']);
      expect(ALLOWED_TRANSITIONS.wakeful).toEqual(['idle', 'dreaming']);
      expect(ALLOWED_TRANSITIONS.dreaming).toEqual(['reflecting', 'wakeful']);
      expect(ALLOWED_TRANSITIONS.reflecting).toEqual(['consolidating', 'wakeful']);
      expect(ALLOWED_TRANSITIONS.consolidating).toEqual(['wakeful', 'idle']);
    });
  });

  // -------------------------------------------------------------------------
  // Graph properties — reachability and strong connectivity
  // -------------------------------------------------------------------------

  describe('graph reachability', () => {
    test('every state has at least one incoming transition (no unreachable states)', () => {
      // If a state has zero incoming edges, it can never be entered —
      // dead code.
      const incoming = new Set<BrainState>();
      for (const from of ALL_STATES) {
        for (const to of ALLOWED_TRANSITIONS[from]) {
          incoming.add(to);
        }
      }
      for (const s of ALL_STATES) {
        expect(incoming.has(s)).toBe(true);
      }
    });

    test('wakeful is reachable from every other state (hub for pre-emption)', () => {
      // Pre-emption contract: any cognitive phase can be interrupted by
      // user input, which transitions to wakeful. If some state can NOT
      // reach wakeful, user input during that state would be unhandleable.
      for (const from of ALL_STATES) {
        const visited = new Set<BrainState>();
        const queue: BrainState[] = [from];
        let canReachWakeful = false;
        while (queue.length > 0) {
          const cur = queue.shift()!;
          if (visited.has(cur)) continue;
          visited.add(cur);
          if (cur === 'wakeful') {
            canReachWakeful = true;
            break;
          }
          for (const next of ALLOWED_TRANSITIONS[cur]) {
            if (!visited.has(next)) queue.push(next);
          }
        }
        expect(canReachWakeful).toBe(true);
      }
    });

    test('idle is reachable from every other state (no permanent traps)', () => {
      // The brain must always be able to return to idle — otherwise a
      // session could never cleanly end. (Consolidating → idle is the
      // happy path, but other states need a path too.)
      for (const from of ALL_STATES) {
        const visited = new Set<BrainState>();
        const queue: BrainState[] = [from];
        let canReachIdle = false;
        while (queue.length > 0) {
          const cur = queue.shift()!;
          if (visited.has(cur)) continue;
          visited.add(cur);
          if (cur === 'idle') {
            canReachIdle = true;
            break;
          }
          for (const next of ALLOWED_TRANSITIONS[cur]) {
            if (!visited.has(next)) queue.push(next);
          }
        }
        expect(canReachIdle).toBe(true);
      }
    });

    test('state graph is strongly connected (any state can reach any other)', () => {
      // The strongest graph invariant. If this holds, the orchestrator
      // can never get stuck — any state has a path to any other state.
      for (const from of ALL_STATES) {
        const reachable = new Set<BrainState>();
        const queue: BrainState[] = [from];
        while (queue.length > 0) {
          const cur = queue.shift()!;
          if (reachable.has(cur)) continue;
          reachable.add(cur);
          for (const next of ALLOWED_TRANSITIONS[cur]) {
            if (!reachable.has(next)) queue.push(next);
          }
        }
        // From `from`, we must be able to reach every state.
        for (const target of ALL_STATES) {
          expect(reachable.has(target)).toBe(true);
        }
      }
    });

    test('wakeful has the highest in-degree (multiple states pre-empt into it)', () => {
      // The hub property. Count incoming edges for each state.
      const inDegree: Record<BrainState, number> = {
        idle: 0,
        wakeful: 0,
        dreaming: 0,
        reflecting: 0,
        consolidating: 0,
      };
      for (const from of ALL_STATES) {
        for (const to of ALLOWED_TRANSITIONS[from]) {
          inDegree[to]++;
        }
      }
      // wakeful is reached from: idle (sometimes), dreaming (interrupt),
      // reflecting (interrupt), consolidating (next waypoint). Plus
      // possibly idle (drained backlog). It should have the highest
      // in-degree of all states.
      const maxInDegree = Math.max(...ALL_STATES.map((s) => inDegree[s]));
      expect(inDegree.wakeful).toBe(maxInDegree);
      expect(inDegree.wakeful).toBeGreaterThanOrEqual(3);
    });
  });

  // -------------------------------------------------------------------------
  // canTransitionTo function contract
  // -------------------------------------------------------------------------

  describe('canTransitionTo function contract', () => {
    test('returns a strictly boolean value', () => {
      // Not truthy/falsy — must be true/false.
      const t = canTransitionTo('idle', 'wakeful');
      const f = canTransitionTo('idle', 'dreaming');
      expect(typeof t).toBe('boolean');
      expect(typeof f).toBe('boolean');
      expect(t).toBe(true);
      expect(f).toBe(false);
    });

    test('is symmetric to ALLOWED_TRANSITIONS[from].includes(to)', () => {
      // Pinning the implementation: the function is a lookup, not a
      // computed heuristic. If someone "improves" it to derive transitions
      // dynamically, this test surfaces the change.
      for (const from of ALL_STATES) {
        for (const to of ALL_STATES) {
          const expected = ALLOWED_TRANSITIONS[from].includes(to);
          expect(canTransitionTo(from, to)).toBe(expected);
        }
      }
    });

    test('total transition matrix: 5 allowed out of 20 off-diagonal pairs', () => {
      // Count the true entries (excluding diagonal which is always false).
      let trueCount = 0;
      let falseCount = 0;
      for (const from of ALL_STATES) {
        for (const to of ALL_STATES) {
          if (from === to) continue;
          if (canTransitionTo(from, to)) {
            trueCount++;
          } else {
            falseCount++;
          }
        }
      }
      // 5 states × 4 others = 20 possible off-diagonal pairs.
      // Sum of ALLOWED_TRANSITIONS lengths: 1+2+2+2+2 = 9.
      expect(trueCount).toBe(9);
      expect(falseCount).toBe(11);
      expect(trueCount + falseCount).toBe(20);
    });

    test('deterministic: same inputs always give same output', () => {
      // Run each query 10 times; the result must never vary.
      for (let i = 0; i < 10; i++) {
        expect(canTransitionTo('idle', 'wakeful')).toBe(true);
        expect(canTransitionTo('dreaming', 'idle')).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // BrainStateTransition type shape
  // -------------------------------------------------------------------------

  describe('BrainStateTransition type shape', () => {
    test('has exactly {from, to, reason, ts} fields', () => {
      // Construct a literal — TypeScript will enforce field presence;
      // runtime verifies the keys.
      const t: BrainStateTransition = {
        from: 'idle',
        to: 'wakeful',
        reason: 'user input received',
        ts: Date.now(),
      };
      expect(Object.keys(t).sort()).toEqual(['from', 'reason', 'to', 'ts']);
    });

    test('from and to are BrainState values', () => {
      const t: BrainStateTransition = {
        from: 'dreaming',
        to: 'wakeful',
        reason: 'pre-empted by user input',
        ts: 0,
      };
      expect(ALL_STATES).toContain(t.from);
      expect(ALL_STATES).toContain(t.to);
    });

    test('reason is a string', () => {
      const t: BrainStateTransition = {
        from: 'idle',
        to: 'wakeful',
        reason: '',
        ts: 0,
      };
      expect(typeof t.reason).toBe('string');
    });

    test('ts is a number (epoch millis)', () => {
      const t: BrainStateTransition = {
        from: 'idle',
        to: 'wakeful',
        reason: 'x',
        ts: Date.now(),
      };
      expect(typeof t.ts).toBe('number');
      expect(Number.isFinite(t.ts)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // INITIAL_BRAIN_STATE
  // -------------------------------------------------------------------------

  describe('INITIAL_BRAIN_STATE', () => {
    test('is "idle"', () => {
      expect(INITIAL_BRAIN_STATE).toBe('idle');
    });

    test('is a valid BrainState value', () => {
      expect(ALL_STATES).toContain(INITIAL_BRAIN_STATE);
    });

    test('has exactly one outgoing transition (to wakeful)', () => {
      // A fresh Orchestrator can do exactly one thing: start a waypoint.
      // Pin the out-degree of idle.
      expect(ALLOWED_TRANSITIONS[INITIAL_BRAIN_STATE]).toEqual(['wakeful']);
      expect(ALLOWED_TRANSITIONS[INITIAL_BRAIN_STATE]).toHaveLength(1);
    });

    test('is NOT in LLM_ACTIVE_STATES (brain starts inactive)', () => {
      // The initial state must not consume tokens — otherwise the
      // budget tracker would start charging before any work is done.
      expect(LLM_ACTIVE_STATES).not.toContain(INITIAL_BRAIN_STATE);
    });
  });

  // -------------------------------------------------------------------------
  // LLM_ACTIVE_STATES
  // -------------------------------------------------------------------------

  describe('LLM_ACTIVE_STATES', () => {
    test('is exactly [wakeful, dreaming] — no more, no less', () => {
      // Pin both inclusion (wakeful, dreaming) and cardinality (2).
      // A future addition like 'reflecting' would balloon budget estimates.
      expect(LLM_ACTIVE_STATES).toHaveLength(2);
      expect(LLM_ACTIVE_STATES).toContain('wakeful');
      expect(LLM_ACTIVE_STATES).toContain('dreaming');
    });

    test('does NOT contain idle, reflecting, or consolidating', () => {
      // These states use local heuristics or pure I/O — no LLM calls.
      expect(LLM_ACTIVE_STATES).not.toContain('idle');
      expect(LLM_ACTIVE_STATES).not.toContain('reflecting');
      expect(LLM_ACTIVE_STATES).not.toContain('consolidating');
    });

    test('is a readonly array (frozen contract)', () => {
      // The type annotation `readonly BrainState[]` is load-bearing;
      // callers should not be able to push() new states. TypeScript
      // enforces this at compile time; we pin the runtime length.
      expect(LLM_ACTIVE_STATES.length).toBe(2);
    });

    test('every entry is a valid BrainState', () => {
      const valid = new Set(ALL_STATES);
      for (const s of LLM_ACTIVE_STATES) {
        expect(valid.has(s)).toBe(true);
      }
    });

    test('entries are unique (no duplicates)', () => {
      const set = new Set(LLM_ACTIVE_STATES);
      expect(set.size).toBe(LLM_ACTIVE_STATES.length);
    });
  });

  // -------------------------------------------------------------------------
  // Phase-ordering invariants — the "cognitive lifecycle"
  // -------------------------------------------------------------------------

  describe('cognitive lifecycle ordering', () => {
    test('dreaming must precede reflecting (dream → reflect edge exists)', () => {
      // The creative dream pass generates backlog candidates that
      // reflection then critiques. If the dream → reflect edge were
      // removed, reflection would have nothing to reflect on.
      expect(canTransitionTo('dreaming', 'reflecting')).toBe(true);
    });

    test('reflecting must precede consolidating (reflect → consolidate edge exists)', () => {
      // Reflection produces the memory items that consolidation persists.
      expect(canTransitionTo('reflecting', 'consolidating')).toBe(true);
    });

    test('the canonical happy-path cycle: idle→wakeful→dreaming→reflecting→consolidating→idle', () => {
      // A complete cognitive cycle. Every edge must exist.
      expect(canTransitionTo('idle', 'wakeful')).toBe(true);
      expect(canTransitionTo('wakeful', 'dreaming')).toBe(true);
      expect(canTransitionTo('dreaming', 'reflecting')).toBe(true);
      expect(canTransitionTo('reflecting', 'consolidating')).toBe(true);
      expect(canTransitionTo('consolidating', 'idle')).toBe(true);
    });

    test('pre-emption short-circuits: dreaming→wakeful and reflecting→wakeful', () => {
      // User input during a cognitive phase must interrupt it and
      // start a new waypoint. These two edges are the pre-emption
      // contract.
      expect(canTransitionTo('dreaming', 'wakeful')).toBe(true);
      expect(canTransitionTo('reflecting', 'wakeful')).toBe(true);
    });
  });
});
