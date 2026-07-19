import type { Strategy } from '../cerebellum/waypoint.js';

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
] as const;

export type OrchestratorEventType = (typeof EVENT_TYPES)[number];
