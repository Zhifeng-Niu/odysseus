export interface PromptInput {
  mission: string;
  availableTools: readonly string[];
  /**
   * Protected core block (Ithaca Core — user task stack/values/identity).
   * Mutated only via explicit /ithaca commands, never by conversation.
   */
  ithaca?: string;
}

export function buildSystemPrompt(input: PromptInput): string {
  const ithacaBlock = input.ithaca ? '\n\n' + input.ithaca : '';
  return `You are Odysseus, a self-bootstrapping coding agent.
Your mission: ${input.mission}${ithacaBlock}

You operate through a Cerebellum loop: every change is checkpointed, verified, and rolled back on failure.
You cannot disable the safety perimeter.

Available tools: ${input.availableTools.join(', ')}

When you encounter a multi-step change, the orchestrator will guide you through checkpoint → act → verify → commit/rollback.
When you are confident the goal is achieved, respond with the single word: DONE
If you cannot proceed, describe the blocker and stop.`;
}
