import { Box, Text } from 'ink';
import { theme } from './theme.js';

interface ApprovalGateProps {
  waypointId: string;
  iteration: number;
  onApprove: () => void;
  onReject: (reason: string) => void;
}

/**
 * Renders the approval prompt when a waypoint has passed verify and is
 * awaiting human sign-off before the irreversible commit.
 *
 * Keybindings are handled by the parent App via `useInput` — this component
 * is purely presentational. Keeping input handling at the App level avoids
 * double-binding when the input area is also active.
 */
export function ApprovalGate({
  waypointId,
  iteration,
}: ApprovalGateProps): JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.waypoint.awaitingApproval}
      paddingX={1}
      marginY={1}
    >
      <Box flexDirection="row" gap={1}>
        <Text color={theme.waypoint.awaitingApproval} bold>
          ⏸ APPROVAL REQUIRED
        </Text>
        <Text color={theme.text.muted}>·</Text>
        <Text color={theme.chrome.prompt}>{waypointId}</Text>
        <Text color={theme.text.muted}>·</Text>
        <Text color={theme.text.secondary}>iter {iteration}</Text>
      </Box>
      <Text color={theme.text.primary}>
        Verify passed. Commit this waypoint?
      </Text>
      <Box flexDirection="row" gap={2} marginTop={1}>
        <Text color={theme.waypoint.committed} bold>
          [a] approve
        </Text>
        <Text color={theme.waypoint.failed} bold>
          [r] reject
        </Text>
      </Box>
    </Box>
  );
}
