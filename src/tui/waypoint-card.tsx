import { Box, Text } from 'ink';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import { theme } from './theme.js';
import {
  collapseToolCalls,
  summarizeWaypoint,
  type CollapsedToolCalls,
  type WaypointSummary,
} from './waypoint-summary.js';

interface WaypointCardProps {
  waypointId: string;
  goal: string;
  strategy: string;
  events: readonly OrchestratorEvent[];
  /**
   * When non-null, this waypoint is step `current` of `total` in a plan
   * decomposition produced by the planner. Rendered as a "step N/M" chip
   * in the header so multi-step plans read as a sequence rather than a
   * list of unrelated waypoints.
   *
   * Iteration 16 — planner observability. Optional; absent for user-,
   * reflect-, dream-, curiosity-, and system-origin waypoints.
   */
  planStepInfo?: { current: number; total: number; planGoal: string };
}

const STATUS_BADGE: Record<WaypointSummary['status'], { label: string; color: string }> = {
  active: { label: 'ACTIVE', color: theme.waypoint.started },
  'awaiting-approval': { label: 'AWAIT', color: theme.waypoint.awaitingApproval },
  committed: { label: 'OK', color: theme.waypoint.committed },
  'rolled-back': { label: 'ROLLBACK', color: theme.waypoint.rolledBack },
  failed: { label: 'FAIL', color: theme.waypoint.failed },
  chat: { label: 'CHAT', color: theme.text.secondary },
};

function shortId(waypointId: string): string {
  return waypointId.length > 14 ? waypointId.slice(0, 14) : waypointId;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function WaypointCard({
  waypointId,
  goal,
  strategy,
  events,
  planStepInfo,
}: WaypointCardProps): JSX.Element {
  const summary = summarizeWaypoint(events);
  const badge = STATUS_BADGE[summary.status];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={badge.color} bold>
          [{badge.label}]
        </Text>
        <Text color={theme.chrome.prompt} bold>
          {shortId(waypointId)}
        </Text>
        {planStepInfo !== undefined && (
          <>
            <Text color={theme.text.muted}>·</Text>
            <Text color={theme.plan.badge} bold>
              step {planStepInfo.current}/{planStepInfo.total}
            </Text>
          </>
        )}
        <Text color={theme.text.muted}>·</Text>
        <Text color={theme.text.secondary}>{strategy}</Text>
        <Text color={theme.text.muted}>·</Text>
        <Text color={theme.text.secondary}>iter {summary.iterationsUsed}</Text>
        {summary.commitSha !== undefined && (
          <>
            <Text color={theme.text.muted}>·</Text>
            <Text color={theme.toolCall.success}>{shortSha(summary.commitSha)}</Text>
          </>
        )}
      </Box>
      <Text color={theme.text.primary}>  {goal}</Text>

      <Box flexDirection="column" marginTop={0}>
        {collapseToolCalls(events).map((item, i) =>
          'type' in item && item.type === 'collapsed-tool-calls' ? (
            <CollapsedLine key={i} group={item as CollapsedToolCalls} />
          ) : (
            <EventLine key={i} event={item as OrchestratorEvent} />
          )
        )}
      </Box>

      {summary.failReason !== undefined && (
        <Text color={theme.waypoint.failed}>  ⚠ {summary.failReason.slice(0, 200)}</Text>
      )}
    </Box>
  );
}

function EventLine({ event }: { event: OrchestratorEvent }): JSX.Element | null {
  switch (event.type) {
    case 'assistant-message':
      return (
        <Box flexDirection="column">
          <Text color={theme.assistant.label}>  assistant ›</Text>
          <Text color={theme.assistant.text}>  {truncate(event.content, 500)}</Text>
        </Box>
      );
    case 'tool-call-started':
      return (
        <Text color={theme.toolCall.name}>
          {'  ▸ '}
          {event.tool}
          {formatArgsPreview(event.args)}
        </Text>
      );
    case 'tool-call-completed':
      return (
        <Text color={event.ok ? theme.toolCall.success : theme.toolCall.error}>
          {event.ok ? '    ✓ ok' : '    ✗ err'}
        </Text>
      );
    case 'verify-started':
      return <Text color={theme.verify.running}>  ⟳ verify</Text>;
    case 'verify-completed':
      return (
        <Text color={event.passed ? theme.verify.passed : theme.verify.failed}>
          {event.passed ? '  ✓ verify passed' : '  ✗ verify failed'}
        </Text>
      );
    case 'waypoint-awaiting-approval':
      return (
        <Text color={theme.waypoint.awaitingApproval} bold>
          {'  ⏸ awaiting approval'}
        </Text>
      );
    // ─── Iteration 17: surface previously-hidden waypoint-scoped events ──
    // These three describe the agent's inner life during a waypoint:
    //   - self-monitor: periodic context-aware nudge injected into the LLM
    //   - recovery-intervention: stuck-loop detector injected a hint
    //   - misused-signal: hard gate refused tool calls on a CONVERSATIONAL-
    //     DONE turn (protocol violation, surfaced back to the LLM)
    // Without these cases the events were silently swallowed by the
    // `default: return null` branch — the user had no visibility into
    // self-monitoring, recovery, or protocol-enforcement activity.
    case 'self-monitor':
      return (
        <Box flexDirection="column">
          <Text color={theme.evolution.selfMonitor}>
            {'  ◌ self-monitor (call '}
            {event.toolCallCount}
            {')'}
          </Text>
          {event.message.length > 0 && (
            <Text color={theme.text.secondary}>    {truncate(event.message, 300)}</Text>
          )}
        </Box>
      );
    case 'recovery-intervention':
      return (
        <Box flexDirection="column">
          <Text color={theme.evolution.recovery} bold>
            {'  ⚡ recovery · '}
            {event.tool}
          </Text>
          {event.message.length > 0 && (
            <Text color={theme.text.secondary}>    {truncate(event.message, 300)}</Text>
          )}
        </Box>
      );
    case 'misused-signal':
      return (
        <Text color={theme.evolution.misuse} bold>
          {'  ⚠ misused-signal · '}
          {event.signal}
          {' ('}
          {event.toolCallCount}
          {' tool call'}
          {event.toolCallCount === 1 ? '' : 's'}
          {' refused)'}
        </Text>
      );
    default:
      return null;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + ' …';
}

function formatArgsPreview(args: unknown): string {
  if (typeof args !== 'object' || args === null) return '';
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return '';
  const preview = entries
    .slice(0, 2)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v.slice(0, 40)}"` : String(v)}`)
    .join(', ');
  return ` (${preview}${entries.length > 2 ? ', …' : ''})`;
}

function CollapsedLine({ group }: { group: CollapsedToolCalls }): JSX.Element {
  const breakdown = Object.entries(group.tools)
    .map(([tool, n]) => (n > 1 ? `${tool} ×${n}` : tool))
    .join(', ');
  return (
    <Text color={theme.text.muted}>
      {'  · '}
      {group.count} tool calls ok（{breakdown}）
    </Text>
  );
}
