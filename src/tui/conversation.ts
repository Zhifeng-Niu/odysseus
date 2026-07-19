import type { LLMProvider } from '../llm/provider.js';

/**
 * Conversation mode — the user-facing "chat with the agent" path.
 *
 * This is intentionally separate from `OrchestratorEvent` and the voyage
 * loop. Orchestrator owns *autonomous* operation (wakeful → dreaming →
 * consolidating). Conversation is the *interactive* surface: user asks,
 * agent answers, no backlog, no dreamer, no checkpoint.
 *
 * The two paths meet at the TUI input box — `classifyInput` decides which
 * one a given keystroke submits to.
 */

export interface ConversationMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly ts: number;
}

/**
 * Keywords that signal a code-change request. When matched, the input is
 * dispatched to the voyage loop (orchestrator + waypoint pipeline) instead
 * of the lightweight chat path.
 *
 * Mirrored from `src/agent/loop.ts` (CEREBELLUM_TRIGGERS) so the CLI and
 * TUI agree on the boundary. Keep the two regexes in sync.
 */
const CODE_CHANGE_TRIGGERS =
  /\b(add|implement|refactor|fix|remove|change|update|modify|extend|introduce|添加|修复|重构|实现|新增|删除|修改)\b/i;

/**
 * Returns `'goal'` when the input looks like a code-change request, `'chat'`
 * otherwise. Conservative: ambiguous inputs go to chat, because a wrong
 * "chat" answer is recoverable (user just asks again), while a wrong "goal"
 * answer kicks off a full voyage.
 *
 * Slash-prefixed inputs (`/dream`, `/status`, etc.) are treated as commands
 * — the caller is expected to intercept them before calling this.
 */
export function classifyInput(text: string): 'chat' | 'goal' {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'chat';
  if (trimmed.startsWith('/')) return 'chat';
  return CODE_CHANGE_TRIGGERS.test(trimmed) ? 'goal' : 'chat';
}

/**
 * One round of chat: send user message, get assistant response.
 *
 * Stateless — conversation history is the caller's responsibility. The TUI
 * keeps a rolling buffer in component state; future iterations may persist
 * it to `.odysseus/conversation.jsonl` for cross-session continuity.
 */
export async function chatWithProvider(
  provider: LLMProvider,
  userMessage: string,
  options?: { systemPrompt?: string }
): Promise<string> {
  const completion = await provider.complete(userMessage, {
    ...(options?.systemPrompt !== undefined
      ? { systemPrompt: options.systemPrompt }
      : {}),
  });
  return completion.content;
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `msg_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

export function makeUserMessage(content: string): ConversationMessage {
  return {
    id: nextId(),
    role: 'user',
    content,
    ts: Date.now(),
  };
}

export function makeAssistantMessage(content: string): ConversationMessage {
  return {
    id: nextId(),
    role: 'assistant',
    content,
    ts: Date.now(),
  };
}
