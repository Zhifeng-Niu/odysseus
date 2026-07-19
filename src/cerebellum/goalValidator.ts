/**
 * Boolean goal validator.
 *
 * Returns `true` only for goals that look like concrete code tasks. A goal is
 * rejected (`false`) when it is:
 *
 *   1. Pure conversational input — a greeting, identity question, off-topic
 *      chat, or closing with no file reference — OR
 *   2. Missing a file-path pattern, i.e. it contains no source-file
 *      extension (.ts/.js/.py) and no `src/` path prefix. Real code tasks
 *      almost always name the file they touch.
 *
 * Mixed goals ("hello, please update src/config.js") pass: a present
 * file-path pattern means the goal is not *purely* conversational.
 *
 * This complements `validateGoal` in `goal-validator.ts`, which returns a
 * richer `{ valid, reason }` result and uses an action-verb guard. This
 * function is intentionally stricter: it requires an explicit file path,
 * so the only way to pass is to name a file.
 */

// Source-file extensions and the `src/` path prefix that mark a goal as a
// concrete code task touching a specific file. `\b` after the extension
// prevents matching inside longer tokens (e.g. "foots").
const FILE_PATH_PATTERN = /(\.(ts|js|py|test\.ts)\b)|(src\/)/i;

// English conversational patterns — greetings, identity questions, off-topic
// chat, and closings. `\b` word boundaries are safe for ASCII.
const CONVERSATIONAL_PATTERN_EN =
  /\b(hi|hello|hey|yo|sup|howdy|greetings|who\s+are\s+you|what\s+are\s+you|what('?s| is) your name|what('?s| is) the weather|tell me a joke|how are you|what('?s| is) up|whats up|thanks|thank you|thx|ty|bye|goodbye|see ya|cya)\b/i;

// CJK conversational patterns. `\b` is defined via `\w` (= [A-Za-z0-9_]) and
// so does not work for CJK; these unambiguous phrases are matched as
// substrings instead.
const CONVERSATIONAL_PATTERN_CJK =
  /你好|嗨|哈喽|你叫什么|你是谁|晚安|再见|谢谢/;

export function goalValidator(goal: string): boolean {
  const trimmed = goal.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const hasFilePath = FILE_PATH_PATTERN.test(trimmed);
  const isConversational =
    CONVERSATIONAL_PATTERN_EN.test(trimmed) ||
    CONVERSATIONAL_PATTERN_CJK.test(trimmed);

  // Pure conversational input — greeting/chat with no file reference.
  if (isConversational && !hasFilePath) {
    return false;
  }

  // Missing a file-path pattern — not a concrete code task.
  if (!hasFilePath) {
    return false;
  }

  return true;
}
