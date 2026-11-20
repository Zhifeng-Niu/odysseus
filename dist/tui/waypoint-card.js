import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { theme } from './theme.js';
function summarize(events) {
    let status = 'active';
    let iterationsUsed = 0;
    let commitSha;
    let failReason;
    for (const e of events) {
        if (e.type === 'waypoint-iteration') {
            iterationsUsed = Math.max(iterationsUsed, e.iteration);
        }
        else if (e.type === 'waypoint-awaiting-approval') {
            status = 'awaiting-approval';
        }
        else if (e.type === 'waypoint-committed') {
            status = 'committed';
            commitSha = e.sha;
            iterationsUsed = e.iterationsUsed;
        }
        else if (e.type === 'waypoint-rolled-back') {
            status = 'rolled-back';
            failReason = e.reason;
            iterationsUsed = e.iterationsUsed;
        }
        else if (e.type === 'waypoint-failed') {
            status = 'failed';
            failReason = e.error;
        }
    }
    return { status, iterationsUsed, ...(commitSha !== undefined ? { commitSha } : {}), ...(failReason !== undefined ? { failReason } : {}) };
}
const STATUS_BADGE = {
    active: { label: 'ACTIVE', color: theme.waypoint.started },
    'awaiting-approval': { label: 'AWAIT', color: theme.waypoint.awaitingApproval },
    committed: { label: 'OK', color: theme.waypoint.committed },
    'rolled-back': { label: 'ROLLBACK', color: theme.waypoint.rolledBack },
    failed: { label: 'FAIL', color: theme.waypoint.failed },
};
function shortId(waypointId) {
    return waypointId.length > 14 ? waypointId.slice(0, 14) : waypointId;
}
function shortSha(sha) {
    return sha.slice(0, 7);
}
export function WaypointCard({ waypointId, goal, strategy, events, planStepInfo, }) {
    const summary = summarize(events);
    const badge = STATUS_BADGE[summary.status];
    return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsxs(Text, { color: badge.color, bold: true, children: ["[", badge.label, "]"] }), _jsx(Text, { color: theme.chrome.prompt, bold: true, children: shortId(waypointId) }), planStepInfo !== undefined && (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.text.muted, children: "\u00B7" }), _jsxs(Text, { color: theme.plan.badge, bold: true, children: ["step ", planStepInfo.current, "/", planStepInfo.total] })] })), _jsx(Text, { color: theme.text.muted, children: "\u00B7" }), _jsx(Text, { color: theme.text.secondary, children: strategy }), _jsx(Text, { color: theme.text.muted, children: "\u00B7" }), _jsxs(Text, { color: theme.text.secondary, children: ["iter ", summary.iterationsUsed] }), summary.commitSha !== undefined && (_jsxs(_Fragment, { children: [_jsx(Text, { color: theme.text.muted, children: "\u00B7" }), _jsx(Text, { color: theme.toolCall.success, children: shortSha(summary.commitSha) })] }))] }), _jsxs(Text, { color: theme.text.primary, children: ["  ", goal] }), _jsx(Box, { flexDirection: "column", marginTop: 0, children: events.map((e, i) => (_jsx(EventLine, { event: e }, i))) }), summary.failReason !== undefined && (_jsxs(Text, { color: theme.waypoint.failed, children: ["  \u26A0 ", summary.failReason.slice(0, 200)] }))] }));
}
function EventLine({ event }) {
    switch (event.type) {
        case 'assistant-message':
            return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: theme.assistant.label, children: "  assistant \u203A" }), _jsxs(Text, { color: theme.assistant.text, children: ["  ", truncate(event.content, 500)] })] }));
        case 'tool-call-started':
            return (_jsxs(Text, { color: theme.toolCall.name, children: ['  ▸ ', event.tool, formatArgsPreview(event.args)] }));
        case 'tool-call-completed':
            return (_jsx(Text, { color: event.ok ? theme.toolCall.success : theme.toolCall.error, children: event.ok ? '    ✓ ok' : '    ✗ err' }));
        case 'verify-started':
            return _jsx(Text, { color: theme.verify.running, children: "  \u27F3 verify" });
        case 'verify-completed':
            return (_jsx(Text, { color: event.passed ? theme.verify.passed : theme.verify.failed, children: event.passed ? '  ✓ verify passed' : '  ✗ verify failed' }));
        case 'waypoint-awaiting-approval':
            return (_jsx(Text, { color: theme.waypoint.awaitingApproval, bold: true, children: '  ⏸ awaiting approval' }));
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
            return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: theme.evolution.selfMonitor, children: ['  ◌ self-monitor (call ', event.toolCallCount, ')'] }), event.message.length > 0 && (_jsxs(Text, { color: theme.text.secondary, children: ["    ", truncate(event.message, 300)] }))] }));
        case 'recovery-intervention':
            return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: theme.evolution.recovery, bold: true, children: ['  ⚡ recovery · ', event.tool] }), event.message.length > 0 && (_jsxs(Text, { color: theme.text.secondary, children: ["    ", truncate(event.message, 300)] }))] }));
        case 'misused-signal':
            return (_jsxs(Text, { color: theme.evolution.misuse, bold: true, children: ['  ⚠ misused-signal · ', event.signal, ' (', event.toolCallCount, ' tool call', event.toolCallCount === 1 ? '' : 's', ' refused)'] }));
        default:
            return null;
    }
}
function truncate(text, max) {
    if (text.length <= max)
        return text;
    return text.slice(0, max) + ' …';
}
function formatArgsPreview(args) {
    if (typeof args !== 'object' || args === null)
        return '';
    const entries = Object.entries(args);
    if (entries.length === 0)
        return '';
    const preview = entries
        .slice(0, 2)
        .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v.slice(0, 40)}"` : String(v)}`)
        .join(', ');
    return ` (${preview}${entries.length > 2 ? ', …' : ''})`;
}
//# sourceMappingURL=waypoint-card.js.map