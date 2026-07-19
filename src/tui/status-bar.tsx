import { Box, Text } from 'ink';
import { theme } from './theme.js';
import type { BrainState } from '../cerebellum/brain-state.js';

interface StatusBarProps {
  model: string;
  /**
   * 'idle' — no waypoint running
   * 'running' — a waypoint is in progress
   * 'awaiting-approval' — blocked on the approval gate
   */
  phase: 'idle' | 'running' | 'awaiting-approval';
  waypointsTotal: number;
  waypointsCommitted: number;
  /** Current brain state — drives the right-most status indicator. */
  brainState: BrainState;
  /** Items queued in the backlog — the agent's pending self-evolution work. */
  backlogSize: number;
}

const PHASE_INDICATOR: Record<StatusBarProps['phase'], { glyph: string; color: string }> = {
  idle: { glyph: '○', color: theme.text.muted },
  running: { glyph: '◐', color: theme.waypoint.iteration },
  'awaiting-approval': { glyph: '⏸', color: theme.waypoint.awaitingApproval },
};

const BRAIN_GLYPH: Record<BrainState, { glyph: string; color: string; label: string }> = {
  idle: { glyph: '◌', color: theme.text.muted, label: 'idle' },
  wakeful: { glyph: '◉', color: theme.waypoint.committed, label: 'wakeful' },
  dreaming: { glyph: '✦', color: theme.waypoint.iteration, label: 'dreaming' },
  reflecting: { glyph: '⤴', color: theme.toolCall.name, label: 'reflecting' },
  consolidating: { glyph: '⤻', color: theme.assistant.label, label: 'consolidating' },
};

export function StatusBar({
  model,
  phase,
  waypointsTotal,
  waypointsCommitted,
  brainState,
  backlogSize,
}: StatusBarProps): JSX.Element {
  const indicator = PHASE_INDICATOR[phase];
  const brain = BRAIN_GLYPH[brainState];
  return (
    <Box
      flexDirection="row"
      gap={1}
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={theme.chrome.borderDim}
      paddingX={0}
    >
      <Text color={indicator.color}>{indicator.glyph}</Text>
      <Text color={theme.text.secondary}>{model}</Text>
      <Text color={theme.text.muted}>·</Text>
      <Text color={theme.text.secondary}>
        {waypointsCommitted}/{waypointsTotal} committed
      </Text>
      <Text color={theme.text.muted}>·</Text>
      <Text color={theme.text.secondary}>
        phase: <Text color={indicator.color}>{phase}</Text>
      </Text>
      <Text color={theme.text.muted}>·</Text>
      <Text color={brain.color}>
        {brain.glyph} {brain.label}
      </Text>
      <Text color={theme.text.muted}>·</Text>
      <Text color={theme.text.secondary}>
        backlog: <Text color={backlogSize > 0 ? theme.waypoint.iteration : theme.text.muted}>{backlogSize}</Text>
      </Text>
    </Box>
  );
}
