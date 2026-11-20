import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { join } from 'node:path';
import { listPendingReview } from '../cerebellum/pending-review.js';
import { theme } from './theme.js';
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
export function PendingReviewPanel({ rootDir, revision, }) {
    const fullRootDir = join(rootDir, '.odysseus');
    const [state, setState] = useState({ items: [], error: null });
    useEffect(() => {
        let cancelled = false;
        listPendingReview(fullRootDir)
            .then((items) => {
            if (!cancelled)
                setState({ items, error: null });
        })
            .catch((err) => {
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
        return _jsx(_Fragment, {});
    }
    return (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: theme.chrome.prompt, bold: true, children: "pending review" }), _jsxs(Text, { color: theme.text.muted, children: ["(", state.items.length, ") \u2014 dream proposals waiting for your decision"] })] }), state.error !== null && (_jsxs(Text, { color: theme.waypoint.failed, children: ["error: ", state.error] })), state.items.map((item, idx) => (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsxs(Text, { color: theme.text.secondary, children: ["#", idx + 1] }), _jsxs(Text, { color: theme.text.muted, children: ["(", item.origin, ")"] }), _jsx(Text, { color: theme.text.primary, children: item.goal }), _jsx(Text, { color: theme.text.muted, children: item.id })] }, item.id))), _jsx(Text, { color: theme.text.muted, italic: true, children: "review these in .odysseus/pending-review.json \u2014 slash-command approve/reject to follow" })] }));
}
//# sourceMappingURL=pending-review-panel.js.map