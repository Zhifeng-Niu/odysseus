import { describe, test, expect } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ChatPanel } from '../../src/tui/chat-panel.js';
import type { OrchestratorEvent } from '../../src/orchestrator/events.js';

/**
 * Build a synthetic event stream for a voyage that decomposed a goal into
 * N plan steps, then executed each step as a committed waypoint. Used to
 * verify the TUI correctly infers plan→step relationships from event order.
 *
 * The event stream mirrors what runVoyage + runWaypoint actually emit:
 *   voyage-started → plan-completed → (per step: waypoint-started,
 *   waypoint-iteration, tool-call-*, waypoint-committed) → voyage-completed.
 */
function buildPlanVoyageEvents(
  planGoal: string,
  steps: { goal: string; waypointId: string }[]
): OrchestratorEvent[] {
  const events: OrchestratorEvent[] = [];
  const voyageId = 'voy_test123456';
  events.push({
    type: 'voyage-started',
    voyageId,
    prompt: planGoal,
    ts: 1000,
  });
  events.push({
    type: 'plan-completed',
    voyageId,
    goal: planGoal,
    stepCount: steps.length,
    durationMs: 342,
    parseOk: true,
    ts: 1342,
  });
  let stepTs = 2000;
  for (const step of steps) {
    events.push({
      type: 'waypoint-started',
      waypointId: step.waypointId,
      goal: step.goal,
      strategy: 'engineer',
      ts: stepTs,
    });
    events.push({
      type: 'waypoint-iteration',
      waypointId: step.waypointId,
      iteration: 1,
      ts: stepTs + 100,
    });
    events.push({
      type: 'waypoint-committed',
      waypointId: step.waypointId,
      sha: `fake_sha_${step.waypointId.slice(-4)}`,
      iterationsUsed: 1,
      ts: stepTs + 500,
    });
    stepTs += 1000;
  }
  events.push({
    type: 'voyage-completed',
    voyageId,
    ts: stepTs,
  });
  return events;
}

function renderChatPanel(events: readonly OrchestratorEvent[]): string {
  const instance = render(React.createElement(ChatPanel, { events }));
  const frame = instance.lastFrame() ?? '';
  instance.unmount();
  return frame;
}

describe('ChatPanel — planner observability (Iteration 16)', () => {
  test('renders PlanBanner when plan-completed event is present', () => {
    const events = buildPlanVoyageEvents('refactor the parser module', [
      { goal: 'step-alpha: extract foo', waypointId: 'wp_aaa111000001' },
      { goal: 'step-beta: rename bar', waypointId: 'wp_bbb222000002' },
    ]);
    const out = renderChatPanel(events);
    // Plan banner header
    expect(out).toContain('PLAN');
    expect(out).toContain('2 steps');
    expect(out).toContain('342ms');
    expect(out).toContain('ok');
    // Plan goal surface
    expect(out).toContain('refactor the parser module');
  });

  test('renders step N/M chip on each plan-origin waypoint card', () => {
    const events = buildPlanVoyageEvents('refactor the parser module', [
      { goal: 'step-alpha', waypointId: 'wp_aaa111000001' },
      { goal: 'step-beta', waypointId: 'wp_bbb222000002' },
      { goal: 'step-gamma', waypointId: 'wp_ccc333000003' },
    ]);
    const out = renderChatPanel(events);
    expect(out).toContain('step 1/3');
    expect(out).toContain('step 2/3');
    expect(out).toContain('step 3/3');
  });

  test('does NOT render step chip when no plan-completed event exists', () => {
    // Plain voyage, no planner.
    const events: OrchestratorEvent[] = [
      { type: 'voyage-started', voyageId: 'v1', prompt: 'add a file', ts: 1000 },
      {
        type: 'waypoint-started',
        waypointId: 'wp_x1',
        goal: 'add a file',
        strategy: 'engineer',
        ts: 2000,
      },
      {
        type: 'waypoint-committed',
        waypointId: 'wp_x1',
        sha: 'abc1234',
        iterationsUsed: 1,
        ts: 3000,
      },
    ];
    const out = renderChatPanel(events);
    expect(out).not.toContain('PLAN');
    expect(out).not.toContain('step 1/');
  });

  test('shows "N/M ran" when plan produced fewer waypoints than expected', () => {
    // Plan says 3 steps but only 1 waypoint-started fires (e.g. user
    // interrupted mid-voyage). The PlanBanner should surface this.
    const events: OrchestratorEvent[] = [
      { type: 'voyage-started', voyageId: 'v1', prompt: 'big refactor', ts: 1000 },
      {
        type: 'plan-completed',
        voyageId: 'v1',
        goal: 'big refactor',
        stepCount: 3,
        durationMs: 500,
        parseOk: true,
        ts: 1500,
      },
      {
        type: 'waypoint-started',
        waypointId: 'wp_only1',
        goal: 'step 1',
        strategy: 'engineer',
        ts: 2000,
      },
      // voyage-completed without the other 2 steps — e.g. interrupt.
      { type: 'voyage-completed', voyageId: 'v1', ts: 3000 },
    ];
    const out = renderChatPanel(events);
    expect(out).toContain('1/3 ran');
  });

  test('shows parseOk=false in banner when plan() returned invalid JSON', () => {
    const events: OrchestratorEvent[] = [
      {
        type: 'plan-completed',
        voyageId: 'v1',
        goal: 'ambiguous goal',
        stepCount: 0,
        durationMs: 200,
        parseOk: false,
        ts: 1000,
      },
    ];
    const out = renderChatPanel(events);
    expect(out).toContain('parse-fail');
    expect(out).toContain('0 steps');
  });

  test('handles two consecutive plans without bleeding steps across them', () => {
    // Two plans back-to-back: plan A (2 steps), plan B (1 step). The
    // inference must not assign plan B's waypoint to plan A.
    const events: OrchestratorEvent[] = [
      { type: 'voyage-started', voyageId: 'v1', prompt: 'multi-plan voyage', ts: 1000 },
      {
        type: 'plan-completed',
        voyageId: 'v1',
        goal: 'goal A',
        stepCount: 2,
        durationMs: 100,
        parseOk: true,
        ts: 1100,
      },
      {
        type: 'waypoint-started',
        waypointId: 'wp_a1',
        goal: 'A-step-1',
        strategy: 'engineer',
        ts: 1200,
      },
      {
        type: 'waypoint-started',
        waypointId: 'wp_a2',
        goal: 'A-step-2',
        strategy: 'engineer',
        ts: 1300,
      },
      {
        type: 'plan-completed',
        voyageId: 'v1',
        goal: 'goal B',
        stepCount: 1,
        durationMs: 50,
        parseOk: true,
        ts: 1400,
      },
      {
        type: 'waypoint-started',
        waypointId: 'wp_b1',
        goal: 'B-step-1',
        strategy: 'engineer',
        ts: 1500,
      },
    ];
    const out = renderChatPanel(events);
    // Plan A: 2 steps, A-step-1 and A-step-2
    expect(out).toContain('goal A');
    expect(out).toContain('step 1/2');
    expect(out).toContain('step 2/2');
    // Plan B: 1 step, B-step-1
    expect(out).toContain('goal B');
    expect(out).toContain('step 1/1');
    // Crucially, B's step should NOT be labeled as A's step 3.
    expect(out).not.toContain('step 3/2');
  });

  test('shows empty-state hint when event stream is empty', () => {
    const out = renderChatPanel([]);
    expect(out).toContain('Chat with the agent');
  });

  // ─── Iteration 17: surface hidden self-evolution events ─────────
  describe('EvolutionFeed (curiosity + memory events)', () => {
    test('renders CURIOSITY banner when curiosity-completed fires', () => {
      const events: OrchestratorEvent[] = [
        {
          type: 'curiosity-completed',
          voyageId: 'v1',
          backlogItemsAdded: 2,
          memoryEntriesAdded: 1,
          durationMs: 4200,
          ts: 1000,
        },
      ];
      const out = renderChatPanel(events);
      expect(out).toContain('CURIOSITY');
      expect(out).toContain('+2 backlog');
      expect(out).toContain('+1 memory');
      expect(out).toContain('4.2s');
      expect(out).toContain('Self-evolution');
    });

    test('renders MEMORY banner when memory-consolidated fires', () => {
      const events: OrchestratorEvent[] = [
        {
          type: 'memory-consolidated',
          category: 'patterns',
          entryCount: 5,
          bytesWritten: 2310,
          ts: 1000,
        },
      ];
      const out = renderChatPanel(events);
      expect(out).toContain('MEMORY');
      expect(out).toContain('patterns');
      expect(out).toContain('5 entries');
      expect(out).toContain('2.3KB');
    });

    test('MEMORY singular form for 1 entry', () => {
      const events: OrchestratorEvent[] = [
        {
          type: 'memory-consolidated',
          category: 'lessons',
          entryCount: 1,
          bytesWritten: 512,
          ts: 1000,
        },
      ];
      const out = renderChatPanel(events);
      expect(out).toContain('1 entry'); // not "1 entries"
      expect(out).not.toContain('1 entries');
    });

    test('CURIOSITY omits "+N memory" when memoryEntriesAdded=0', () => {
      const events: OrchestratorEvent[] = [
        {
          type: 'curiosity-completed',
          voyageId: 'v1',
          backlogItemsAdded: 1,
          memoryEntriesAdded: 0,
          durationMs: 800,
          ts: 1000,
        },
      ];
      const out = renderChatPanel(events);
      expect(out).toContain('+1 backlog');
      expect(out).not.toContain('+0 memory');
      expect(out).toContain('800ms');
    });

    test('multiple evolution events render in feed order', () => {
      const events: OrchestratorEvent[] = [
        {
          type: 'curiosity-completed',
          voyageId: 'v1',
          backlogItemsAdded: 1,
          memoryEntriesAdded: 0,
          durationMs: 500,
          ts: 1000,
        },
        {
          type: 'memory-consolidated',
          category: 'dreams',
          entryCount: 3,
          bytesWritten: 100,
          ts: 2000,
        },
        {
          type: 'curiosity-completed',
          voyageId: 'v1',
          backlogItemsAdded: 2,
          memoryEntriesAdded: 0,
          durationMs: 300,
          ts: 3000,
        },
      ];
      const out = renderChatPanel(events);
      // All three surface
      expect(out).toContain('CURIOSITY');
      expect(out).toContain('MEMORY');
      // Order check: "Self-evolution" header appears before any entry
      const headerIdx = out.indexOf('Self-evolution');
      const firstCuriosityIdx = out.indexOf('CURIOSITY');
      expect(headerIdx).toBeLessThan(firstCuriosityIdx);
    });
  });

  // ─── Iteration 17: surface hidden waypoint-scoped events ─────────
  describe('WaypointCard event-line rendering', () => {
    test('self-monitor event renders with tool call count and message', () => {
      const waypointId = 'wp_sm0000000001';
      const events: OrchestratorEvent[] = [
        {
          type: 'waypoint-started',
          waypointId,
          goal: 'do work',
          strategy: 'engineer',
          ts: 1000,
        },
        {
          type: 'self-monitor',
          waypointId,
          toolCallCount: 6,
          message: 'stuck-loop: same tool+target 3x — re-read the goal',
          ts: 1100,
        },
      ];
      const out = renderChatPanel(events);
      expect(out).toContain('self-monitor');
      expect(out).toContain('(call 6)');
      expect(out).toContain('stuck-loop');
    });

    test('recovery-intervention renders tool name and message', () => {
      const waypointId = 'wp_ri0000000001';
      const events: OrchestratorEvent[] = [
        {
          type: 'waypoint-started',
          waypointId,
          goal: 'fix bug',
          strategy: 'engineer',
          ts: 1000,
        },
        {
          type: 'recovery-intervention',
          waypointId,
          tool: 'file-read',
          message: 'repeated file-read detected; hinting alternatives',
          ts: 1100,
        },
      ];
      const out = renderChatPanel(events);
      expect(out).toContain('recovery');
      expect(out).toContain('file-read');
      expect(out).toContain('repeated file-read');
    });

    test('misused-signal renders signal name and refused tool count', () => {
      const waypointId = 'wp_ms0000000001';
      const events: OrchestratorEvent[] = [
        {
          type: 'waypoint-started',
          waypointId,
          goal: 'hi',
          strategy: 'engineer',
          ts: 1000,
        },
        {
          type: 'misused-signal',
          waypointId,
          signal: '[CONVERSATIONAL-DONE]',
          toolCallCount: 2,
          ts: 1100,
        },
      ];
      const out = renderChatPanel(events);
      expect(out).toContain('misused-signal');
      expect(out).toContain('[CONVERSATIONAL-DONE]');
      expect(out).toContain('2 tool calls refused');
    });

    test('misused-signal singular form for 1 refused call', () => {
      const waypointId = 'wp_ms0000000002';
      const events: OrchestratorEvent[] = [
        {
          type: 'waypoint-started',
          waypointId,
          goal: 'hi',
          strategy: 'engineer',
          ts: 1000,
        },
        {
          type: 'misused-signal',
          waypointId,
          signal: '[CONVERSATIONAL-DONE]',
          toolCallCount: 1,
          ts: 1100,
        },
      ];
      const out = renderChatPanel(events);
      expect(out).toContain('1 tool call refused'); // singular
      expect(out).not.toContain('1 tool calls refused');
    });
  });
});
