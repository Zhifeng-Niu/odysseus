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

export function ChatPanel({ events }: ChatPanelProps): JSX.Element {
  const groups = groupByWaypoint(events);

  return (
    <Box flexDirection="column">
      {groups.length === 0 && (
        <Text color={theme.text.muted}>No waypoints yet — submit a goal below.</Text>
      )}
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
  );
}
