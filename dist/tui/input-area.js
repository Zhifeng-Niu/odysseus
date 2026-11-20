import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { theme } from './theme.js';
/**
 * Minimal single-line input. We hand-roll this rather than pulling in
 * `ink-text-input` to keep the dependency surface small for the spike —
 * features like clipboard paste, history navigation, and multi-line wrap
 * are intentionally out of scope for v1.
 *
 * Keybindings:
 *   - Enter        submit
 *   - Backspace    delete last char
 *   - Ctrl+C       handled at the App level via `useApp().exit()`
 *   - All other    append to buffer
 */
export function InputArea({ onSubmit, disabled, prompt = '›' }) {
    const [value, setValue] = useState('');
    useInput((input, key) => {
        if (disabled)
            return;
        if (key.return) {
            const trimmed = value.trim();
            if (trimmed.length > 0) {
                onSubmit(trimmed);
            }
            setValue('');
            return;
        }
        if (key.backspace || key.delete) {
            setValue((v) => v.slice(0, -1));
            return;
        }
        if (input && !key.ctrl && !key.meta) {
            setValue((v) => v + input);
        }
    });
    return (_jsxs(Box, { flexDirection: "row", gap: 1, children: [_jsx(Text, { color: disabled ? theme.text.dim : theme.chrome.prompt, bold: true, children: prompt }), _jsxs(Text, { color: disabled ? theme.text.dim : theme.text.primary, children: [value, !disabled && (_jsx(Text, { color: theme.chrome.cursor, children: "\u258F" }))] }), disabled && (_jsx(Text, { color: theme.text.muted, italic: true, children: "(frozen \u2014 resolve the approval gate above)" }))] }));
}
//# sourceMappingURL=input-area.js.map