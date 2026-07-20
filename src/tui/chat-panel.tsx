import { Box, Text } from 'ink';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import { WaypointCard } from './waypoint-card.js';
import { theme } from './theme.js';

interface ChatPanelProps {
  events: readonly OrchestratorEvent[];
}

interface WaypointGroup {
  waypointId: string;
  goal: string;
  strategy: string;
  events: OrchestratorEvent[];
  /**
   * When non-null, this waypoint is step `current` of `total` in a plan
   * decomposition. Used to render a "plan step N/M" chip in the card header.
   * Derived from `plan-completed` events: each plan claims the next N
   * waypoint-started events as its steps, in order.
   */
  planStepInfo?: { current: number; total: number; planGoal: string };
}

/**
 * One `plan-completed` event + the waypoint ids it (transitively) produced.
 * Built forward in event order: the plan fires, then the next `stepCount`
 * `waypoint-started` events are its steps in sequence.
 */
interface PlanRecord {
  readonly planGoal: string;
  readonly stepCount: number;
  readonly durationMs: number;
  readonly parseOk: boolean;
  readonly ts: number;
  readonly stepWaypointIds: readonly string[];
}

/**
 * Scan the event log and produce:
 *   1. The list of `PlanRecord`s (plan-completed → step waypoints).
 *   2. The waypoint groups, each tagged with planStepInfo when it belongs
 *      to a plan.
 *
 * The join is order-sensitive: a plan's steps are the next N waypoints
 * started after the plan-completed event, regardless of goal text. This
 * mirrors the orchestrator's enqueue-then-drain execution model.
 *
 * If a plan's steps never fully start (e.g. user interrupted mid-voyage),
 * the partially-filled PlanRecord is still returned so the banner can show
 * "decomposed into N, only M ran".
 */
function derivePlansAndGroups(
  events: readonly OrchestratorEvent[]
): { plans: readonly PlanRecord[]; groups: readonly WaypointGroup[] } {
  const plans: PlanRecord[] = [];
  const groups = new Map<string, WaypointGroup>();

  // Active plan being filled: steps claimed so far, total expected.
  let activePlan: {
    planGoal: string;
    stepCount: number;
    durationMs: number;
    parseOk: boolean;
    ts: number;
    stepWaypointIds: string[];
  } | null = null;

  for (const e of events) {
    if (e.type === 'plan-completed') {
      // Flush any in-progress plan (its steps were never fully started).
      if (activePlan !== null) {
        plans.push(activePlan);
        activePlan = null;
      }
      activePlan = {
        planGoal: e.goal,
        stepCount: e.stepCount,
        durationMs: e.durationMs,
        parseOk: e.parseOk,
        ts: e.ts,
        stepWaypointIds: [],
      };
      continue;
    }

    if (!('waypointId' in e)) continue;

    // Maintain the waypoint group (existing logic).
    const existing = groups.get(e.waypointId);
    if (existing) {
      existing.events.push(e);
      if (e.type === 'waypoint-started') {
        existing.goal = e.goal;
        existing.strategy = e.strategy;
      }
    } else {
      groups.set(e.waypointId, {
        waypointId: e.waypointId,
        goal: e.type === 'waypoint-started' ? e.goal : '(unknown goal)',
        strategy: e.type === 'waypoint-started' ? e.strategy : 'engineer',
        events: [e],
      });
    }

    // Claim waypoint-started events for the active plan.
    if (e.type === 'waypoint-started' && activePlan !== null) {
      activePlan.stepWaypointIds.push(e.waypointId);
      const idx = activePlan.stepWaypointIds.length; // 1-based
      const group = groups.get(e.waypointId);
      if (group !== undefined) {
        group.planStepInfo = {
          current: idx,
          total: activePlan.stepCount,
          planGoal: activePlan.planGoal,
        };
      }
      if (activePlan.stepWaypointIds.length >= activePlan.stepCount) {
        plans.push(activePlan);
        activePlan = null;
      }
    }
  }

  // Flush trailing plan (e.g. still in progress, or voyage ended mid-plan).
  if (activePlan !== null) {
    plans.push(activePlan);
  }

  return { plans, groups: Array.from(groups.values()) };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Extract self-evolution events (curiosity, memory consolidation) from
 * the stream. These are NOT waypoint-scoped — they fire between waypoints
 * (curiosity at idle, memory at dream/consolidation phase). Rendering them
 * inline with waypoints would break grouping; rendering them as a trailing
 * feed gives the operator visibility into the agent's autonomous inner
 * life without disrupting the waypoint timeline.
 *
 * Iteration 17 — prior to this, both events were silently swallowed by
 * the `default` branch in EventLine and the waypointId filter in
 * groupByWaypoint. The user had no visibility into self-evolution.
 */
interface EvolutionFeedEntry {
  readonly kind: 'curiosity' | 'memory';
  readonly ts: number;
  readonly text: string;
}

function deriveEvolutionFeed(
  events: readonly OrchestratorEvent[]
): readonly EvolutionFeedEntry[] {
  const entries: EvolutionFeedEntry[] = [];
  for (const e of events) {
    if (e.type === 'curiosity-completed') {
      const parts: string[] = [];
      parts.push(`+${e.backlogItemsAdded} backlog`);
      if (e.memoryEntriesAdded > 0) {
        parts.push(`+${e.memoryEntriesAdded} memory`);
      }
      parts.push(formatDuration(e.durationMs));
      entries.push({
        kind: 'curiosity',
        ts: e.ts,
        text: parts.join(' · '),
      });
    } else if (e.type === 'memory-consolidated') {
      entries.push({
        kind: 'memory',
        ts: e.ts,
        text: `${e.category} · ${e.entryCount} entr${e.entryCount === 1 ? 'y' : 'ies'} · ${formatBytes(e.bytesWritten)}`,
      });
    }
  }
  return entries;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

const EVOLUTION_ICON: Record<EvolutionFeedEntry['kind'], string> = {
  curiosity: '🔍',
  memory: '🧠',
};

function EvolutionFeed({ entries }: { entries: readonly EvolutionFeedEntry[] }): JSX.Element {
  if (entries.length === 0) return <></>;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={theme.text.muted} bold>
        Self-evolution
      </Text>
      {entries.map((entry, i) => {
        const color =
          entry.kind === 'curiosity' ? theme.evolution.curiosity : theme.evolution.memory;
        return (
          <Box flexDirection="row" gap={1} key={`evo-${entry.ts}-${i}`}>
            <Text color={color}>{EVOLUTION_ICON[entry.kind]}</Text>
            <Text color={color} bold>
              {entry.kind === 'curiosity' ? 'CURIOSITY' : 'MEMORY'}
            </Text>
            <Text color={theme.text.secondary}>{entry.text}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function truncateGoal(goal: string, max: number): string {
  if (goal.length <= max) return goal;
  return goal.slice(0, max - 1) + '…';
}

/**
 * Banner shown above the waypoint list when a `plan-completed` event has
 * fired. Renders one line per plan, in order:
 *
 *   🧩 PLAN · 2 steps · 342ms · ok
 *     refactor the parser module
 *
 * The icon `🧩` signals decomposition. Teal badge (theme.plan.badge) so the
 * eye picks plan events out from the lavender/sky waypoint stream.
 */
function PlanBanner({ plan }: { plan: PlanRecord }): JSX.Element {
  const parts: JSX.Element[] = [];
  parts.push(
    <Text key="label" color={theme.plan.badge} bold>
      🧩 PLAN
    </Text>
  );
  parts.push(
    <Text key="meta" color={theme.plan.meta}>
      {plan.stepCount} step{plan.stepCount === 1 ? '' : 's'}
    </Text>
  );
  parts.push(<Text key="dot1" color={theme.text.muted}>·</Text>);
  parts.push(
    <Text key="dur" color={theme.plan.meta}>
      {formatDuration(plan.durationMs)}
    </Text>
  );
  parts.push(<Text key="dot2" color={theme.text.muted}>·</Text>);
  parts.push(
    <Text key="ok" color={plan.parseOk ? theme.plan.badge : theme.waypoint.failed}>
      {plan.parseOk ? 'ok' : 'parse-fail'}
    </Text>
  );
  const ran = plan.stepWaypointIds.length;
  if (ran < plan.stepCount) {
    parts.push(<Text key="dot3" color={theme.text.muted}>·</Text>);
    parts.push(
      <Text key="partial" color={theme.waypoint.awaitingApproval}>
        {ran}/{plan.stepCount} ran
      </Text>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" gap={1}>
        {parts}
      </Box>
      <Text color={theme.plan.goal}>  {truncateGoal(plan.planGoal, 100)}</Text>
    </Box>
  );
}

/**
 * Renders the unified conversation surface: every user input (chat or code
 * task) enters the orchestrator and surfaces here as a waypoint group.
 *
 * Iteration 16: also renders PlanBanner(s) above the waypoint stream when
 * the planner decomposed a seed goal. The banner is the user-facing proof
 * that the planner ran — without it, a 5-step plan just looks like 5
 * unrelated waypoints.
 *
 * Prior to the 2026-07-21 unification, ChatPanel rendered two parallel
 * surfaces: a "conversation" array for chat path messages and waypoint
 * groups for code-task path. The split caused identity loss on the chat
 * path (the agent fell back to its base-model identity because no Odysseus
 * context loaded). Now there is one surface — every interaction is a
 * waypoint, some are 1-turn conversational waypoints, some are multi-turn
 * code-task waypoints. The agent is always the same agent.
 */
export function ChatPanel({ events }: ChatPanelProps): JSX.Element {
  const { plans, groups } = derivePlansAndGroups(events);
  const evolutionFeed = deriveEvolutionFeed(events);
  const hasWaypoints = groups.length > 0;
  const hasPlans = plans.length > 0;
  const hasEvolution = evolutionFeed.length > 0;

  return (
    <Box flexDirection="column">
      {!hasWaypoints && !hasPlans && !hasEvolution && (
        <Text color={theme.text.muted}>
          Chat with the agent, or describe a code change to start a voyage.
        </Text>
      )}

      {hasPlans && (
        <Box flexDirection="column">
          {plans.map((p, i) => (
            <PlanBanner key={`plan-${p.ts}-${i}`} plan={p} />
          ))}
        </Box>
      )}

      {hasWaypoints && (
        <Box flexDirection="column">
          {groups.map((g) => (
            <WaypointCard
              key={g.waypointId}
              waypointId={g.waypointId}
              goal={g.goal}
              strategy={g.strategy}
              events={g.events}
              {...(g.planStepInfo !== undefined ? { planStepInfo: g.planStepInfo } : {})}
            />
          ))}
        </Box>
      )}

      {hasEvolution && <EvolutionFeed entries={evolutionFeed} />}
    </Box>
  );
}
