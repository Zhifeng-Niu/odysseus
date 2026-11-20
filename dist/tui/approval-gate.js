import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { theme } from './theme.js';
/**
 * Renders the approval prompt when a waypoint has passed verify and is
 * awaiting human sign-off before the irreversible commit.
 *
 * Keybindings are handled by the parent App via `useInput` — this component
 * is purely presentational. Keeping input handling at the App level avoids
 * double-binding when the input area is also active.
 */
export function ApprovalGate({ waypointId, iteration, }) {
    return (_jsxs(Box, { flexDirection: "column", borderStyle: "round", borderColor: theme.waypoint.awaitingApproval, paddingX: 1, marginY: 1, children: [_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: theme.waypoint.awaitingApproval, bold: true, children: "\u23F8 APPROVAL REQUIRED" }), _jsx(Text, { color: theme.text.muted, children: "\u00B7" }), _jsx(Text, { color: theme.chrome.prompt, children: waypointId }), _jsx(Text, { color: theme.text.muted, children: "\u00B7" }), _jsxs(Text, { color: theme.text.secondary, children: ["iter ", iteration] })] }), _jsx(Text, { color: theme.text.primary, children: "Verify passed. Commit this waypoint?" }), _jsxs(Box, { flexDirection: "row", gap: 2, marginTop: 1, children: [_jsx(Text, { color: theme.waypoint.committed, bold: true, children: "[a] approve" }), _jsx(Text, { color: theme.waypoint.failed, bold: true, children: "[r] reject" })] })] }));
}
//# sourceMappingURL=approval-gate.js.map