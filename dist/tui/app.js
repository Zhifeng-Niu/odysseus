import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useApp, useInput } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOrchestratorEvents, findPendingApproval, deriveBrainState, deriveBacklog, } from './hooks.js';
import { ChatPanel } from './chat-panel.js';
import { ApprovalGate } from './approval-gate.js';
import { InputArea } from './input-area.js';
import { StatusBar } from './status-bar.js';
import { PendingReviewPanel } from './pending-review-panel.js';
import { theme } from './theme.js';
/**
 * How long the TUI waits after the last user activity (input submit or
 * assistant reply) before automatically starting a voyage to drain the
 * backlog. Tuned via `ODYSSEUS_IDLE_MS` so test environments can shorten
 * it. Default 60s — long enough to read code without interruption, short
 * enough that the agent picks up approved pending-review items promptly.
 */
const IDLE_THRESHOLD_MS = Number(process.env.ODYSSEUS_IDLE_MS ?? 60_000);
const IDLE_POLL_MS = 5_000;
function idleTsBelowThreshold(idleMs) {
    return idleMs < IDLE_THRESHOLD_MS;
}
/**
 * Root component for the Odysseus TUI voyage console.
 *
 * Layout (top → bottom):
 *   ┌─ Title banner ────────────────────────┐
 *   │ ChatPanel (scrollable waypoint log)    │
 *   │ ApprovalGate (when pending)             │
 *   │ InputArea (frozen while gate is active) │
 *   └─ StatusBar (model · phase · brain) ────┘
 *
 * Key routing:
 *   - When an approval gate is pending, [a]/[r] are captured here.
 *   - Otherwise, keystrokes flow to InputArea for goal/inject submission.
 *   - Ctrl+C interrupts the active voyage (if any) and exits on second press.
 *
 * Voyage vs. waypoint: when not running, submit kicks off `runVoyage()`
 * (the full wakeful→dreaming→consolidating loop). This makes the brain
 * state indicator change visibly as the agent works through backlog items.
 */
export function App({ orch, model }) {
    const { events } = useOrchestratorEvents(orch);
    const { exit } = useApp();
    const [exitArmed, setExitArmed] = useState(false);
    // /ithaca command output — rendered as a local notice panel (the command
    // never enters the LLM path, so it has no assistant-message event).
    const [ithacaNotice, setIthacaNotice] = useState(null);
    // Idle tracking — lastActivity bumps on every user submit and every
    // orchestrator event (so an in-progress voyage counts as activity).
    // autoVoyageArmed gates the auto-drain: a single idle-triggered voyage
    // disarms until the user submits something new. This prevents the
    // "drain empty backlog → idle → drain again" tight loop.
    const [lastActivity, setLastActivity] = useState(() => Date.now());
    const autoVoyageArmedRef = useRef(true);
    const pendingApproval = useMemo(() => findPendingApproval(events), [events]);
    const waypointsTotal = useMemo(() => {
        const ids = new Set();
        for (const e of events) {
            if (e.type === 'waypoint-started')
                ids.add(e.waypointId);
        }
        return ids.size;
    }, [events]);
    const waypointsCommitted = useMemo(() => {
        const ids = new Set();
        for (const e of events) {
            if (e.type === 'waypoint-committed')
                ids.add(e.waypointId);
        }
        return ids.size;
    }, [events]);
    const brainState = useMemo(() => deriveBrainState(events), [events]);
    const backlog = useMemo(() => deriveBacklog(events), [events]);
    // Pending-review revision — bumped every time a `dream-completed` event
    // arrives, so the PendingReviewPanel re-reads `pending-review.json` and
    // surfaces new proposals without polling.
    const dreamRevision = useMemo(() => {
        let count = 0;
        for (const e of events) {
            if (e.type === 'dream-completed')
                count += 1;
        }
        return count;
    }, [events]);
    // A voyage is "running" if the brain is not idle. This captures both the
    // wakeful execution and the dreaming/reflecting/consolidating sub-phases.
    const voyageActive = brainState !== 'idle';
    // Orchestrator activity counts as "user is engaged" — a running voyage
    // should not trip the idle detector. This also covers the case where the
    // agent is mid-reply in conversation mode (chatPending is tracked
    // separately below).
    useEffect(() => {
        setLastActivity(Date.now());
    }, [events.length]);
    // Idle detector — every IDLE_POLL_MS, check if the user has been quiet
    // long enough that we should auto-drain the backlog. The drain itself
    // runs through `orch.runVoyage()` which no-ops gracefully when the
    // backlog is empty.
    useEffect(() => {
        const handle = setInterval(() => {
            if (pendingApproval !== null)
                return;
            if (voyageActive)
                return;
            if (!autoVoyageArmedRef.current)
                return;
            const idleMs = Date.now() - lastActivity;
            if (idleTsBelowThreshold(idleMs))
                return;
            autoVoyageArmedRef.current = false;
            void orch.runVoyage().catch(() => {
                // Swallow — the orchestrator emits failure events that the TUI
                // surfaces. Don't crash the idle loop.
            });
        }, IDLE_POLL_MS);
        return () => clearInterval(handle);
    }, [pendingApproval, voyageActive, lastActivity, orch]);
    // Perception hub — environment (file watcher) + temporal (daily tick)
    // channels drain into the backlog with origin 'perception'. The idle
    // auto-voyage above consumes them, so perception rides the same
    // single path as every other input: backlog → waypoint. Never an LLM
    // call from here.
    useEffect(() => {
        let cancelled = false;
        let timer;
        void (async () => {
            try {
                // M2 感知守卫：装配（含「保护核非空才放行 clock check-in」的 gate）
                // 收拢在 perception/bootstrap.ts——app.tsx 只消费现成的 hub。
                const { createVoyagePerceptionHub } = await import('../perception/bootstrap.js');
                const { resolve } = await import('node:path');
                const rootDir = resolve(process.cwd(), '.odysseus');
                const hub = await createVoyagePerceptionHub(rootDir);
                timer = setInterval(() => {
                    void hub.drainToBacklog(rootDir, new Date()).catch(() => undefined);
                }, 5 * 60_000);
                if (cancelled && timer)
                    clearInterval(timer);
            }
            catch {
                // Perception is best-effort; never crash the TUI boot over it.
            }
        })();
        return () => {
            cancelled = true;
            if (timer)
                clearInterval(timer);
        };
    }, []);
    const phase = pendingApproval !== null
        ? 'awaiting-approval'
        : waypointsTotal > waypointsCommitted || voyageActive
            ? 'running'
            : 'idle';
    // Global key routing for the approval gate + Ctrl+C. useInput here is
    // always active; InputArea's own useInput is gated by its `disabled` prop.
    useInput((input, key) => {
        if (key.ctrl && input === 'c') {
            if (phase === 'running' || phase === 'awaiting-approval') {
                orch.interrupt('user pressed Ctrl+C');
            }
            else if (exitArmed) {
                exit();
            }
            else {
                setExitArmed(true);
                setTimeout(() => setExitArmed(false), 1500);
            }
            return;
        }
        if (pendingApproval !== null) {
            if (input === 'a') {
                orch.approve(pendingApproval.waypointId);
            }
            else if (input === 'r') {
                orch.reject(pendingApproval.waypointId, 'rejected via TUI');
            }
        }
    });
    async function handleInputSubmit(text) {
        if (pendingApproval !== null)
            return;
        // Any explicit user input re-arms the auto-voyage trigger and bumps
        // activity — we know the user is here.
        setLastActivity(Date.now());
        autoVoyageArmedRef.current = true;
        // Slash commands are reserved for future TUI commands (/dream, /status,
        // /clear). /ithaca is dispatched locally — it is the ONLY write channel
        // into the protected core and must never go through the LLM.
        if (text.startsWith('/ithaca')) {
            try {
                const { handleIthacaCommand } = await import('../ithaca/commands.js');
                const { resolve } = await import('node:path');
                const output = await handleIthacaCommand(resolve(process.cwd(), '.odysseus'), text);
                setIthacaNotice(output);
            }
            catch (e) {
                setIthacaNotice(`✗ Ithaca: ${e instanceof Error ? e.message : String(e)}`);
            }
            return;
        }
        if (text.startsWith('/')) {
            // TODO: dispatch remaining slash commands here (/dream, /status, /clear)
        }
        // If a voyage is already running, treat the input as a steering message
        // injected into the next iteration. Mid-voyage is not the moment to
        // start a parallel conversation.
        if (voyageActive) {
            orch.injectMessage(text);
            return;
        }
        // UNIFIED PATH — every non-slash input enters the same agent runtime.
        // There is no longer a separate "chat" code path. The orchestrator owns
        // both code-task and conversational inputs:
        //   - Code tasks ("fix X", "add Y") run the full engineer strategy with
        //     tools, checkpoint, verify, etc.
        //   - Conversational inputs ("hi", "who are you") flow through the same
        //     engineer prompt, which has a CONVERSATION CASE section. The agent
        //     replies once, the orchestrator's consecutiveTextOnly threshold is
        //     lowered to 1 via the conversational hint, and the waypoint ends
        //     cleanly as 'abandoned' (no work, no harm).
        //
        // This kills the "two minds" anti-pattern where chat path lacked
        // identity injection (causing the GLM/Z.ai identity leak on 2026-07-20).
        // Identity is now continuous because there is only one path.
        void orch.runVoyage({ seedGoal: text });
    }
    return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: theme.chrome.prompt, bold: true, children: "ODYSSEUS" }), _jsx(Text, { color: theme.text.muted, children: "\u00B7" }), _jsx(Text, { color: theme.text.secondary, children: "voyage console" })] }), _jsx(ChatPanel, { events: events }), pendingApproval !== null && (_jsx(ApprovalGate, { waypointId: pendingApproval.waypointId, iteration: pendingApproval.iteration, onApprove: () => orch.approve(pendingApproval.waypointId), onReject: (reason) => orch.reject(pendingApproval.waypointId, reason) })), ithacaNotice && (_jsx(Box, { borderStyle: "round", paddingX: 1, flexDirection: "column", children: ithacaNotice.split('\n').map((line, i) => (_jsx(Text, { children: line }, i))) })), _jsx(InputArea, { onSubmit: handleInputSubmit, disabled: pendingApproval !== null }), _jsx(PendingReviewPanel, { rootDir: process.cwd(), revision: dreamRevision }), _jsx(StatusBar, { model: model, phase: phase, waypointsTotal: waypointsTotal, waypointsCommitted: waypointsCommitted, brainState: brainState, backlogSize: backlog.size }), exitArmed && (_jsx(Text, { color: theme.waypoint.awaitingApproval, children: "Press Ctrl+C again to exit." }))] }));
}
//# sourceMappingURL=app.js.map