import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { theme } from './theme.js';

interface InputAreaProps {
  /**
   * Called when the user presses Enter. The component clears its buffer
   * after invoking the handler.
   */
  onSubmit: (text: string) => void;
  /**
   * When true, the input area shows but ignores keystrokes (e.g. while an
   * approval gate is active).
   */
  disabled: boolean;
  /**
   * Short hint shown to the left of the cursor (e.g. "›", "restricted").
   */
  prompt?: string;
}

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
export function InputArea({ onSubmit, disabled, prompt = '›' }: InputAreaProps): JSX.Element {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (disabled) return;
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

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={disabled ? theme.text.dim : theme.chrome.prompt} bold>
        {prompt}
      </Text>
      <Text color={disabled ? theme.text.dim : theme.text.primary}>
        {value}
        {!disabled && (
          <Text color={theme.chrome.cursor}>▏</Text>
        )}
      </Text>
      {disabled && (
        <Text color={theme.text.muted} italic>
          (frozen — resolve the approval gate above)
        </Text>
      )}
    </Box>
  );
}
