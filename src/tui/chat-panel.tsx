import { Box, Text } from 'ink';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import { WaypointCard } from './waypoint-card.js';
import { theme } from './theme.js';
import type { ConversationMessage } from './conversation.js';

interface ChatPanelProps {
  events: readonly OrchestratorEvent[];
  conversation: readonly ConversationMessage[];
  chatPending: boolean;
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

export function ChatPanel({ events, conversation, chatPending }: ChatPanelProps): JSX.Element {
  const groups = groupByWaypoint(events);
  const hasConversation = conversation.length > 0;
  const hasWaypoints = groups.length > 0;

  return (
    <Box flexDirection="column">
      {!hasConversation && !hasWaypoints && (
        <Text color={theme.text.muted}>
          Chat with the agent, or describe a code change to start a voyage.
        </Text>
      )}

      {hasConversation && (
        <Box flexDirection="column" marginBottom={1}>
          {conversation.map((m) => (
            <Box key={m.id} flexDirection="row" gap={1}>
              <Text color={m.role === 'user' ? theme.chrome.prompt : theme.text.secondary} bold>
                {m.role === 'user' ? 'you' : 'agent'}
              </Text>
              <Text color={theme.text.primary}>{m.content}</Text>
            </Box>
          ))}
          {chatPending && (
            <Box flexDirection="row" gap={1}>
              <Text color={theme.text.secondary} bold>agent</Text>
              <Text color={theme.text.muted} italic>…</Text>
            </Box>
          )}
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
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
