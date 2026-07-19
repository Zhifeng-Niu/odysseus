import { Box, Text } from 'ink';
import type { OrchestratorEvent } from '../orchestrator/events.js';
import { theme } from './theme.js';

interface WaypointCardProps {
  waypointId: string;
  goal: string;
  strategy: string;
  events: readonly OrchestratorEvent[];
}

interface WaypointSummary {
  status: 'active' | 'committed' | 'rolled-back' | 'failed' | 'awaiting-approval';
  iterationsUsed: number;
  commitSha?: string;
  failReason?: string;
}

function summarize(events: readonly OrchestratorEvent[]): WaypointSummary {
  let status: WaypointSummary['status'] = 'active';
  let iterationsUsed = 0;
  let commitSha: string | undefined;
  let failReason: string | undefined;

  for (const e of events) {
    if (e.type === 'waypoint-iteration') {
      iterationsUsed = Math.max(iterationsUsed, e.iteration);
    } else if (e.type === 'waypoint-awaiting-approval') {
      status = 'awaiting-approval';
    } else if (e.type === 'waypoint-committed') {
      status = 'committed';
      commitSha = e.sha;
      iterationsUsed = e.iterationsUsed;
    } else if (e.type === 'waypoint-rolled-back') {
      status = 'rolled-back';
      failReason = e.reason;
      iterationsUsed = e.iterationsUsed;
    } else if (e.type === 'waypoint-failed') {
      status = 'failed';
      failReason = e.error;
    }
  }

  return { status, iterationsUsed, ...(commitSha !== undefined ? { commitSha } : {}), ...(failReason !== undefined ? { failReason } : {}) };
}

const STATUS_BADGE: Record<WaypointSummary['status'], { label: string; color: string }> = {
  active: { label: 'ACTIVE', color: theme.waypoint.started },
  'awaiting-approval': { label: 'AWAIT', color: theme.waypoint.awaitingApproval },
  committed: { label: 'OK', color: theme.waypoint.committed },
  'rolled-back': { label: 'ROLLBACK', color: theme.waypoint.rolledBack },
  failed: { label: 'FAIL', color: theme.waypoint.failed },
};

function shortId(waypointId: string): string {
  return waypointId.length > 14 ? waypointId.slice(0, 14) : waypointId;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export function WaypointCard({ waypointId, goal, strategy, events }: WaypointCardProps): JSX.Element {
  const summary = summarize(events);
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
        {events.map((e, i) => (
          <EventLine key={i} event={e} />
        ))}
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
