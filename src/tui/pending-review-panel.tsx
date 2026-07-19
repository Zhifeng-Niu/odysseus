import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { join } from 'node:path';
import { listPendingReview, type PendingItem } from '../cerebellum/pending-review.js';
import { theme } from './theme.js';

interface PendingReviewPanelProps {
  /** Directory containing `pending-review.json` (same root as backlog). */
  rootDir: string;
  /**
   * Revision counter — bump to trigger a re-read. The App bumps this when
   * a `dream-completed` event arrives so the panel reflects new proposals
   * without polling on a timer.
   */
  revision: number;
}

interface LoadState {
  readonly items: readonly PendingItem[];
  readonly error: string | null;
}

/**
 * Renders the pending-review queue (dream/reflect proposals awaiting user
 * decision). Pulls from `pending-review.json` on every `revision` bump.
 *
 * Read-only by design in this first cut — the panel surfaces what the
 * dreamer proposed, but approve/reject is intentionally *not* wired to a
 * keystroke. Approving a proposal is a meaningful commitment (it seeds
 * the next voyage), so the user does it through an explicit channel
 * (slash command or future dedicated UI) rather than a stray keypress
 * while typing in the input box.
 *
 * Hidden entirely when empty so the TUI stays quiet while there's nothing
 * to review.
 */
export function PendingReviewPanel({
  rootDir,
  revision,
}: PendingReviewPanelProps): JSX.Element {
  const fullRootDir = join(rootDir, '.odysseus');
  const [state, setState] = useState<LoadState>({ items: [], error: null });

  useEffect(() => {
    let cancelled = false;
    listPendingReview(fullRootDir)
      .then((items) => {
        if (!cancelled) setState({ items, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setState({ items: [], error: msg });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fullRootDir, revision]);

  if (state.items.length === 0 && state.error === null) {
    return <></>;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" gap={1}>
        <Text color={theme.chrome.prompt} bold>
          pending review
        </Text>
        <Text color={theme.text.muted}>
          ({state.items.length}) — dream proposals waiting for your decision
        </Text>
      </Box>
      {state.error !== null && (
        <Text color={theme.waypoint.failed}>error: {state.error}</Text>
      )}
      {state.items.map((item, idx) => (
        <Box key={item.id} flexDirection="row" gap={1}>
          <Text color={theme.text.secondary}>#{idx + 1}</Text>
          <Text color={theme.text.muted}>({item.origin})</Text>
          <Text color={theme.text.primary}>{item.goal}</Text>
          <Text color={theme.text.muted}>{item.id}</Text>
        </Box>
      ))}
      <Text color={theme.text.muted} italic>
        review these in .odysseus/pending-review.json — slash-command approve/reject to follow
      </Text>
    </Box>
  );
}
