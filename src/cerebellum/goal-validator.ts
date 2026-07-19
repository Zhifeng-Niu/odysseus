/**
 * Pre-dispatch goal validator.
 *
 * Rejects non-coding conversational goals BEFORE the agent is dispatched —
 * saving a checkpoint (git ops) and up to 3 wasted LLM turns that the
 * reactive `consecutiveTextOnly` heuristic in the orchestrator would
 * otherwise burn before abandoning.
 *
 * A goal is classified as conversational when it matches a known
 * conversational pattern (greeting, identity question, off-topic chat,
 * thanks/closing) AND contains no coding-action verb. The action-verb
 * guard prevents rejecting mixed goals like "hi, please add a file".
 *
 * Conservative by design: false positives (rejecting a real coding task)
 * are far worse than false negatives (letting a greeting fall through to
 * the reactive heuristic). When in doubt, the validator lets the goal
 * through so the downstream loop can decide.
 */

export interface GoalValidationResult {
  valid: boolean;
  reason?: string;
}

// English coding-action verbs — presence of any of these means the goal is a
// code task, even if it also opens with a greeting ("hi, can you fix the bug?").
// Uses \b word boundaries (safe for ASCII). Mirrors and extends the
// CEREBELLUM_TRIGGERS set in agent/loop.ts so the validator and the dispatch
// gate agree on what counts as a code task.
const ACTION_VERBS_EN =
  /\b(add|implement|refactor|fix|remove|change|update|modify|extend|introduce|create|delete|rename|move|extract|inline|wire|register|build|test|lint|format|migrate|port|optimize|debug|handle|support|generate|scaffold|bootstrap|configure|cleanup|dedupe)\b/i;

// CJK coding-action verbs. \b word boundaries don't work for CJK (they're
// defined via \w = [A-Za-z0-9_]), so match these as substrings instead.
const ACTION_VERBS_CJK =
  /添加|实现|重构|修复|删除|修改|更新|创建|构建|测试|配置/;

// Convenience: any action verb, English or CJK.
function hasActionVerb(text: string): boolean {
  return ACTION_VERBS_EN.test(text) || ACTION_VERBS_CJK.test(text);
}

// English conversational patterns — greetings, identity questions, off-topic
// chat, and closings. Uses \b word boundaries (safe for ASCII). Only
// consulted when no action verb is present.
const CONVERSATIONAL_PATTERNS_EN =
  /\b(hi|hello|hey|yo|sup|howdy|greetings|who\s+are\s+you|what\s+are\s+you|what('?s| is) your name|what('?s| is) the weather|tell me a joke|how are you|what('?s| is) up|whats up|thanks|thank you|thx|ty|bye|goodbye|see ya|cya)\b/i;

// CJK conversational patterns. \b word boundaries don't work for CJK (they're
// defined via \w = [A-Za-z0-9_]), so match these as substrings instead. The
// phrases are unambiguous standalone greetings/identity questions/closings.
const CONVERSATIONAL_PATTERNS_CJK =
  /你好|嗨|哈喽|你叫什么|你是谁|晚安|再见|谢谢/;

export function validateGoal(goal: string): GoalValidationResult {
  const trimmed = goal.trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: 'goal is empty' };
  }

  // Any coding-action verb present → treat as a real code task, even if the
  // message opens with a greeting. Mixed goals are code tasks.
  if (hasActionVerb(trimmed)) {
    return { valid: true };
  }

  // No action verb, but a conversational pattern → non-coding goal. Reject
  // before dispatch so we don't burn a checkpoint or LLM turns.
  if (CONVERSATIONAL_PATTERNS_EN.test(trimmed) || CONVERSATIONAL_PATTERNS_CJK.test(trimmed)) {
    return {
      valid: false,
      reason:
        'goal appears conversational (greeting/identity/chat) with no coding-action verb — rejected before agent dispatch',
    };
  }

  // Unknown intent — let it through to the reactive heuristic. Conservative:
  // better to let a greeting slip than to block a legitimate code task whose
  // phrasing the validator doesn't recognize.
  return { valid: true };
}
