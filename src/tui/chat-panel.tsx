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
}

/**
 * Group the flat event log by waypointId. Events that lack a waypointId
 * (voyage-* events) are surfaced as a header banner instead.
 *
 * The grouping is O(n) per render — fine for typical session sizes (<10k
 * events). If this becomes hot we can memoize by event-log revision.
 */
function groupByWaypoint(events: readonly OrchestratorEvent[]): WaypointGroup[] {
  const groups = new Map<string, WaypointGroup>();
  for (const e of events) {
    if (!('waypointId' in e)) continue;
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
  }
  return Array.from(groups.values());
}

/**
 * Renders the unified conversation surface: every user input (chat or code
 * task) enters the orchestrator and surfaces here as a waypoint group.
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
  const groups = groupByWaypoint(events);
  const hasWaypoints = groups.length > 0;

  return (
    <Box flexDirection="column">
      {!hasWaypoints && (
        <Text color={theme.text.muted}>
          Chat with the agent, or describe a code change to start a voyage.
        </Text>
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
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
