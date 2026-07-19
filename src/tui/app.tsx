import { Box, Text, useApp, useInput } from 'ink';
import { useMemo, useState } from 'react';
import type { CerebellumOrchestrator } from '../cerebellum/orchestrator.js';
import { useOrchestratorEvents, findPendingApproval } from './hooks.js';
import { ChatPanel } from './chat-panel.js';
import { ApprovalGate } from './approval-gate.js';
import { InputArea } from './input-area.js';
import { StatusBar } from './status-bar.js';
import { theme } from './theme.js';

interface AppProps {
  orch: CerebellumOrchestrator;
  model: string;
}

/**
 * Root component for the Odysseus TUI voyage console.
 *
 * Layout (top → bottom):
 *   ┌─ Title banner ────────────────────────┐
 *   │ ChatPanel (scrollable waypoint log)    │
 *   │ ApprovalGate (when pending)             │
 *   │ InputArea (frozen while gate is active) │
 *   └─ StatusBar ────────────────────────────┘
 *
 * Key routing:
 *   - When an approval gate is pending, [a]/[r] are captured here.
 *   - Otherwise, keystrokes flow to InputArea for goal/inject submission.
 *   - Ctrl+C interrupts the active waypoint (if any) and exits on second press.
 */
export function App({ orch, model }: AppProps): JSX.Element {
  const { events } = useOrchestratorEvents(orch);
  const { exit } = useApp();
  const [exitArmed, setExitArmed] = useState(false);

  const pendingApproval = useMemo(() => findPendingApproval(events), [events]);

  const waypointsTotal = useMemo(() => {
    const ids = new Set<string>();
    for (const e of events) {
      if (e.type === 'waypoint-started') ids.add(e.waypointId);
    }
    return ids.size;
  }, [events]);

  const waypointsCommitted = useMemo(() => {
    const ids = new Set<string>();
    for (const e of events) {
      if (e.type === 'waypoint-committed') ids.add(e.waypointId);
    }
    return ids.size;
  }, [events]);

  const phase: 'idle' | 'running' | 'awaiting-approval' =
    pendingApproval !== null
      ? 'awaiting-approval'
      : waypointsTotal > waypointsCommitted
        ? 'running'
        : 'idle';

  // Global key routing for the approval gate + Ctrl+C. useInput here is
  // always active; InputArea's own useInput is gated by its `disabled` prop.
  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (phase === 'running' || phase === 'awaiting-approval') {
        orch.interrupt('user pressed Ctrl+C');
      } else if (exitArmed) {
        exit();
      } else {
        setExitArmed(true);
        setTimeout(() => setExitArmed(false), 1500);
      }
      return;
    }
    if (pendingApproval !== null) {
      if (input === 'a') {
        orch.approve(pendingApproval.waypointId);
      } else if (input === 'r') {
        orch.reject(pendingApproval.waypointId, 'rejected via TUI');
      }
    }
  });

  function handleInputSubmit(text: string): void {
    if (pendingApproval !== null) return;
    // If a voyage is already running, treat the input as a steering message
    // injected into the next iteration. Otherwise, kick off a new voyage.
    if (phase === 'running') {
      orch.injectMessage(text);
    } else {
      void orch.runWaypoint({ goal: text });
    }
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={theme.chrome.prompt} bold>
          ODYSSEUS
        </Text>
        <Text color={theme.text.muted}>·</Text>
        <Text color={theme.text.secondary}>voyage console</Text>
      </Box>

      <ChatPanel events={events} />

      {pendingApproval !== null && (
        <ApprovalGate
          waypointId={pendingApproval.waypointId}
          iteration={pendingApproval.iteration}
          onApprove={() => orch.approve(pendingApproval.waypointId)}
          onReject={(reason) => orch.reject(pendingApproval.waypointId, reason)}
        />
      )}

      <InputArea onSubmit={handleInputSubmit} disabled={pendingApproval !== null} />

      <StatusBar
        model={model}
        phase={phase}
        waypointsTotal={waypointsTotal}
        waypointsCommitted={waypointsCommitted}
      />

      {exitArmed && (
        <Text color={theme.waypoint.awaitingApproval}>
          Press Ctrl+C again to exit.
        </Text>
      )}
    </Box>
  );
}
