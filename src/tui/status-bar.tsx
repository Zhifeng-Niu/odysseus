import { Box, Text } from 'ink';
import { theme } from './theme.js';

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
}

const PHASE_INDICATOR: Record<StatusBarProps['phase'], { glyph: string; color: string }> = {
  idle: { glyph: '○', color: theme.text.muted },
  running: { glyph: '◐', color: theme.waypoint.iteration },
  'awaiting-approval': { glyph: '⏸', color: theme.waypoint.awaitingApproval },
};

export function StatusBar({
  model,
  phase,
  waypointsTotal,
  waypointsCommitted,
}: StatusBarProps): JSX.Element {
  const indicator = PHASE_INDICATOR[phase];
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
    </Box>
  );
}
