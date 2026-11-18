import type { Strategy } from '../cerebellum/waypoint.js';
import type { BrainState } from '../cerebellum/brain-state.js';

/**
 * Origin tag for backlog items — tells us where a piece of pending work came
 * from. Drives prioritization in the consolidator.
 *
 * - `user`: explicitly injected by the user (CLI arg, TUI input). Always
 *   highest priority.
 * - `plan`: produced by the planner's decomposition of a complex user goal.
 *   Same urgency as the user goal that spawned it — these are not
 *   exploratory, they are the explicit next steps the agent committed to.
 *   Priority matches `user` so the plan chain executes before any
 *   reflect/dream/curiosity work.
 * - `reflect`: produced by reflection on a failure. Time-urgent — the agent
 *   shouldn't repeat the mistake.
 * - `dream`: produced by the dreamer's free-association over recent trace.
 *   Exploratory, no urgency.
 * - `curiosity`: produced by the curiosity phase's forward-looking
 *   exploration of self-model aspirations. Where dream reflects on the past,
 *   curiosity explores the future. Priority between reflect and dream —
 *   curiosity work preempts idle dreaming but yields to failures.
 * - `system`: bookkeeping origin for internal seed items.
 * - `perception`: produced by the perception hub's channels (file watcher,
 *   clock ticks). Environment state changes the agent should react to;
 *   dedup gates keep repeated perceptions from re-enqueueing.
 */
export type BacklogOrigin = 'user' | 'plan' | 'dream' | 'reflect' | 'curiosity' | 'system' | 'perception';

/**
 * Memory categories map 1:1 to files in `.odysseus/memory/`. Each category
 * is a different "lobe" of the agent's long-term memory.
 */
export type MemoryCategory = 'patterns' | 'lessons' | 'preferences' | 'dreams';

/**
 * Orchestrator → Consumer event stream (one-way, actor model).
 *
 * Consumers (TUI / CLI / future Web UI) subscribe to these events to observe
 * Orchestrator state. Never read Orchestrator internal fields directly —
 * reconstruct local state from events only.
 *
 * Events use a discriminated union on `type` so TypeScript narrows payload
 * automatically in switch statements.
 */
export type OrchestratorEvent =
  | { type: 'voyage-started'; voyageId: string; prompt: string; ts: number }
  | { type: 'voyage-completed'; voyageId: string; ts: number }
  | { type: 'voyage-interrupted'; voyageId: string; reason: string; ts: number }
  | {
      type: 'waypoint-started';
      waypointId: string;
      goal: string;
      strategy: Strategy;
      ts: number;
    }
  | { type: 'waypoint-iteration'; waypointId: string; iteration: number; ts: number }
  | {
      type: 'waypoint-awaiting-approval';
      waypointId: string;
      iteration: number;
      ts: number;
    }
  | {
      type: 'waypoint-committed';
      waypointId: string;
      sha: string;
      iterationsUsed: number;
      ts: number;
    }
  | {
      type: 'waypoint-rolled-back';
      waypointId: string;
      reason: string;
      iterationsUsed: number;
      ts: number;
    }
  | { type: 'waypoint-failed'; waypointId: string; error: string; ts: number }
  | { type: 'assistant-message'; waypointId: string; content: string; ts: number }
  | {
      type: 'tool-call-started';
      waypointId: string;
      callId: string;
      tool: string;
      args: unknown;
      ts: number;
    }
  | {
      type: 'tool-call-completed';
      waypointId: string;
      callId: string;
      result: unknown;
      ok: boolean;
      ts: number;
    }
  | { type: 'verify-started'; waypointId: string; iteration: number; ts: number }
  | {
      type: 'verify-completed';
      waypointId: string;
      iteration: number;
      passed: boolean;
      detail?: string;
      ts: number;
    }
  // ─── Brain state + self-evolution events ────────────────────────────────
  // These extend the contract from "execute waypoints" to "evolve between
  // waypoints". The brain cycles through wakeful → dreaming → reflecting →
  // consolidating while the user is idle, persisting backlog items and memory
  // entries that shape future waypoints.
  | {
      type: 'brain-state-changed';
      from: BrainState;
      to: BrainState;
      reason: string;
      ts: number;
    }
  | {
      type: 'voyage-idle';
      voyageId: string;
      lastWaypointId: string | null;
      backlogSize: number;
      ts: number;
    }
  | {
      type: 'dream-completed';
      voyageId: string;
      backlogItemsAdded: number;
      memoryEntriesAdded: number;
      durationMs: number;
      ts: number;
    }
  // ─── Curiosity phase events ────────────────────────────────────────────
  // Symmetric to dream-completed but for the forward-looking exploration
  // phase. Fired after runCuriosityPhase finishes (whether or not it added
  // items). Observers use this to distinguish "agent is idle" from "agent
  // is curious" — both end with voyage-idle, but only the former has no
  // curiosity-completed preceding it.
  | {
      type: 'curiosity-completed';
      voyageId: string;
      backlogItemsAdded: number;
      memoryEntriesAdded: number;
      durationMs: number;
      ts: number;
    }
  // ─── Planner phase events ─────────────────────────────────────────────
  // Fired when runVoyage invokes the planner on a complex seed goal. The
  // planner decomposes the goal into ordered sub-tasks; each sub-task is
  // enqueued as a plan-origin backlog item. Observers use this to see
  // when the agent chose to plan (vs. execute directly) and how many
  // steps the plan produced. Falls back silently to user-origin enqueue
  // when shouldPlanGoal is false or plan() fails — no event is emitted
  // in the fallback path (the existing backlog-item-added event covers it).
  | {
      type: 'plan-completed';
      voyageId: string;
      goal: string;
      stepCount: number;
      durationMs: number;
      parseOk: boolean;
      ts: number;
    }
  | {
      type: 'backlog-item-added';
      itemId: string;
      goal: string;
      origin: BacklogOrigin;
      priority: number;
      ts: number;
    }
  | {
      type: 'memory-consolidated';
      category: MemoryCategory;
      entryCount: number;
      bytesWritten: number;
      ts: number;
    }
  // ─── Recovery intervention events ───────────────────────────────────────
  | {
      type: 'recovery-intervention';
      waypointId: string;
      tool: string;
      message: string;
      ts: number;
    }
  // ─── Self-monitor events ────────────────────────────────────────────────
  // Closes the "reflection is triggered, not continuous" gap: self-awareness
  // previously ran only in the dream phase (between waypoints), never during
  // wakeful execution. This event fires every N tool calls inside the
  // runWaypoint loop when a non-abortive observation nudge is injected into
  // the conversation, giving observers visibility into continuous self-monitor.
  | {
      type: 'self-monitor';
      waypointId: string;
      toolCallCount: number;
      message: string;
      ts: number;
    }
  // ─── Protocol-signal misuse events ──────────────────────────────────────
  // The agent emitted a structural signal ([CONVERSATIONAL-DONE]) in a context
  // where it is meaningless — alongside tool calls. The orchestrator's hard
  // gate caught it, refused the tool calls, and surfaced the violation to
  // the LLM as a tool-result error so the agent can retry correctly.
  // Observers see this event for telemetry on protocol reliability.
  | {
      type: 'misused-signal';
      waypointId: string;
      signal: string;
      toolCallCount: number;
      ts: number;
    };

/**
 * Consumer → Orchestrator command surface (one-way).
 *
 * Consumers call Orchestrator methods (`approve`, `reject`, `injectMessage`,
 * `interrupt`) to influence behavior. They never mutate Orchestrator state
 * directly.
 *
 * This type is provided as a self-documenting enumeration of valid commands;
 * the Orchestrator exposes them as instance methods, not a dispatch table.
 */
export type OrchestratorCommand =
  | { type: 'approve-waypoint'; waypointId: string }
  | { type: 'reject-waypoint'; waypointId: string; reason: string }
  | { type: 'inject-message'; content: string }
  | { type: 'interrupt' };

export const EVENT_TYPES = [
  'voyage-started',
  'voyage-completed',
  'voyage-interrupted',
  'waypoint-started',
  'waypoint-iteration',
  'waypoint-awaiting-approval',
  'waypoint-committed',
  'waypoint-rolled-back',
  'waypoint-failed',
  'assistant-message',
  'tool-call-started',
  'tool-call-completed',
  'verify-started',
  'verify-completed',
  // Brain state + self-evolution
  'brain-state-changed',
  'voyage-idle',
  'dream-completed',
  'curiosity-completed',
  'backlog-item-added',
  'memory-consolidated',
  // Recovery intervention
  'recovery-intervention',
  // Self-monitor (continuous self-awareness during wakeful execution)
  'self-monitor',
  // Protocol-signal misuse (hard gate refused tool calls on a CONVERSATIONAL-DONE turn)
  'misused-signal',
] as const;

export type OrchestratorEventType = (typeof EVENT_TYPES)[number];
