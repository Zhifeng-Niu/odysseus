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
// English coding-action verbs — presence of any of these means the goal is a
// code task, even if it also opens with a greeting ("hi, can you fix the bug?").
// Uses \b word boundaries (safe for ASCII). Mirrors and extends the
// CEREBELLUM_TRIGGERS set in agent/loop.ts so the validator and the dispatch
// gate agree on what counts as a code task.
const ACTION_VERBS_EN = /\b(add|implement|refactor|fix|remove|change|update|modify|extend|introduce|create|delete|rename|move|extract|inline|wire|register|build|test|lint|format|migrate|port|optimize|debug|handle|support|generate|scaffold|bootstrap|configure|cleanup|dedupe)\b/i;
// CJK coding-action verbs. \b word boundaries don't work for CJK (they're
// defined via \w = [A-Za-z0-9_]), so match these as substrings instead.
const ACTION_VERBS_CJK = /添加|实现|重构|修复|删除|修改|更新|创建|构建|测试|配置/;
// Convenience: any action verb, English or CJK.
function hasActionVerb(text) {
    return ACTION_VERBS_EN.test(text) || ACTION_VERBS_CJK.test(text);
}
// English conversational patterns — greetings, identity questions, off-topic
// chat, and closings. Uses \b word boundaries (safe for ASCII). Only
// consulted when no action verb is present.
const CONVERSATIONAL_PATTERNS_EN = /\b(hi|hello|hey|yo|sup|howdy|greetings|who\s+are\s+you|what\s+are\s+you|what('?s| is) your name|what('?s| is) the weather|tell me a joke|how are you|what('?s| is) up|whats up|thanks|thank you|thx|ty|bye|goodbye|see ya|cya)\b/i;
// CJK conversational patterns. \b word boundaries don't work for CJK (they're
// defined via \w = [A-Za-z0-9_]), so match these as substrings instead. The
// phrases are unambiguous standalone greetings/identity questions/closings.
const CONVERSATIONAL_PATTERNS_CJK = /你好|嗨|哈喽|你叫什么|你是谁|晚安|再见|谢谢/;
// English interrogative question patterns — "what can you do?", "how does X
// work?", "why does Y happen?", "explain Z". These are informational queries,
// not code tasks: the agent would only reply with text (triggering the
// reactive conversational-stop heuristic after 3 wasted turns). Catching them
// here short-circuits before any checkpoint or LLM work.
//
// Safe because the action-verb guard above already returned: any question
// that also names a code action ("how to add a file", "explain how to fix
// the parser") carries an action verb and passes BEFORE this check runs. So
// these patterns only fire on purely informational questions.
const QUESTION_PATTERNS_EN = /\b(what\s+can\s+you\s+do|how\s+(to|do|does|did|can|long|many|much)|why\s+(is|are|was|were|do|does|did|can|don'?t|doesn'?t|isn'?t|aren'?t)|explain|what\s+(is|are|was|were|does|do|can)|when\s+(is|are|do|does|did|will)|where\s+(is|are|do|does|did|can))\b/i;
// CJK interrogative patterns. "如何" (how), "为什么" (why), "是什么" (what is),
// "怎么做" (how to do), "你能做什么" (what can you do). As with English, the
// action-verb guard has already returned, so these only match purely
// informational CJK questions.
const QUESTION_PATTERNS_CJK = /如何|为什么|是什么|怎么做|怎么办|你能做什么|是什么意思|请问/;
export function validateGoal(goal) {
    const trimmed = goal.trim();
    if (trimmed.length === 0) {
        return { valid: false, reason: 'goal is empty' };
    }
    // Any coding-action verb present → treat as a real code task, even if the
    // message opens with a greeting or question. Mixed goals are code tasks.
    if (hasActionVerb(trimmed)) {
        return { valid: true };
    }
    // No action verb, but a conversational pattern → non-coding goal. Reject
    // before dispatch so we don't burn a checkpoint or LLM turns.
    if (CONVERSATIONAL_PATTERNS_EN.test(trimmed) || CONVERSATIONAL_PATTERNS_CJK.test(trimmed)) {
        return {
            valid: false,
            reason: 'goal appears conversational (greeting/identity/chat) with no coding-action verb — rejected before agent dispatch',
        };
    }
    // No action verb, but an interrogative question → non-coding informational
    // query. Reject before dispatch for the same reason as conversational input.
    if (QUESTION_PATTERNS_EN.test(trimmed) || QUESTION_PATTERNS_CJK.test(trimmed)) {
        return {
            valid: false,
            reason: 'goal appears to be an informational question with no coding-action verb — rejected before agent dispatch',
        };
    }
    // Unknown intent — let it through to the reactive heuristic. Conservative:
    // better to let a greeting slip than to block a legitimate code task whose
    // phrasing the validator doesn't recognize.
    return { valid: true };
}
//# sourceMappingURL=goal-validator.js.map