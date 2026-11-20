import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { theme } from './theme.js';
const PHASE_INDICATOR = {
    idle: { glyph: '○', color: theme.text.muted },
    running: { glyph: '◐', color: theme.waypoint.iteration },
    'awaiting-approval': { glyph: '⏸', color: theme.waypoint.awaitingApproval },
};
const BRAIN_GLYPH = {
    idle: { glyph: '◌', color: theme.text.muted, label: 'idle' },
    wakeful: { glyph: '◉', color: theme.waypoint.committed, label: 'wakeful' },
    dreaming: { glyph: '✦', color: theme.waypoint.iteration, label: 'dreaming' },
    reflecting: { glyph: '⤴', color: theme.toolCall.name, label: 'reflecting' },
    consolidating: { glyph: '⤻', color: theme.assistant.label, label: 'consolidating' },
};
export function StatusBar({ model, phase, waypointsTotal, waypointsCommitted, brainState, backlogSize, }) {
    const indicator = PHASE_INDICATOR[phase];
    const brain = BRAIN_GLYPH[brainState];
    return (_jsxs(Box, { flexDirection: "row", gap: 1, borderStyle: "single", borderTop: true, borderBottom: false, borderLeft: false, borderRight: false, borderColor: theme.chrome.borderDim, paddingX: 0, children: [_jsx(Text, { color: indicator.color, children: indicator.glyph }), _jsx(Text, { color: theme.text.secondary, children: model }), _jsx(Text, { color: theme.text.muted, children: "\u00B7" }), _jsxs(Text, { color: theme.text.secondary, children: [waypointsCommitted, "/", waypointsTotal, " committed"] }), _jsx(Text, { color: theme.text.muted, children: "\u00B7" }), _jsxs(Text, { color: theme.text.secondary, children: ["phase: ", _jsx(Text, { color: indicator.color, children: phase })] }), _jsx(Text, { color: theme.text.muted, children: "\u00B7" }), _jsxs(Text, { color: brain.color, children: [brain.glyph, " ", brain.label] }), _jsx(Text, { color: theme.text.muted, children: "\u00B7" }), _jsxs(Text, { color: theme.text.secondary, children: ["backlog: ", _jsx(Text, { color: backlogSize > 0 ? theme.waypoint.iteration : theme.text.muted, children: backlogSize })] })] }));
}
//# sourceMappingURL=status-bar.js.map