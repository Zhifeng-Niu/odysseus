import type { LLMProvider } from '../llm/provider.js';
import { CerebellumOrchestrator } from '../cerebellum/orchestrator.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { VerifyLayer } from '../cerebellum/verify.js';
import type { OrchestratorEvent } from '../orchestrator/events.js';

export interface AgentLoopConfig {
  cwd: string;
  provider: LLMProvider;
  registry: ToolRegistry;
  tracePath: string;
  verifyLayers: readonly VerifyLayer[];
  mission: string;
}

export interface AgentLoopResult {
  response: string;
  waypointOutcome?: 'success' | 'failure' | 'abandoned';
}

/**
 * Run a single user input through the unified agent runtime.
 *
 * Every CLI input — code task OR conversational — flows through the same
 * CerebellumOrchestrator. This is the path-unification contract from
 * iteration 1 extended to the CLI surface. The self-model
 * (`.odysseus/self-model.md`) is loaded fresh on every waypoint start by
 * the engineer strategy, so even a "who are you?" question gets the
 * Odysseus identity rather than the base-model default.
 *
 * The agent's actual reply (the assistant message text) is captured by
 * subscribing to the orchestrator's `assistant-message` event stream.
 * The last such message before the waypoint ends becomes the CLI's
 * stdout. If no assistant message was emitted (e.g. LLM error on first
 * turn), we fall back to a structured outcome description.
 *
 * autoApprove is forced ON for CLI mode because there is no TUI to handle
 * the approval gate. This matches the pre-existing CLI behavior for code
 * tasks; we're just extending it to cover conversational inputs too.
 */
export async function runAgentTurn(
  userInput: string,
  config: AgentLoopConfig
): Promise<AgentLoopResult> {
  const orchestrator = new CerebellumOrchestrator({
    cwd: config.cwd,
    provider: config.provider,
    registry: config.registry,
    tracePath: config.tracePath,
    verifyLayers: config.verifyLayers,
    autoApprove: true,
  });

  let lastAssistantMessage = '';
  orchestrator.on('event', (event: OrchestratorEvent) => {
    if (event.type === 'assistant-message') {
      lastAssistantMessage = event.content;
    }
  });

  const result = await orchestrator.runWaypoint({ goal: userInput });

  // Prefer the agent's actual reply when available — this is what the user
  // is asking for in conversational/informational queries. For pure code
  // tasks that end in DONE, the reply is often just "DONE" and the
  // outcome description is more informative.
  if (lastAssistantMessage.trim().length > 0) {
    return {
      response: lastAssistantMessage,
      waypointOutcome: result.outcome,
    };
  }

  return {
    response:
      result.outcome === 'success'
        ? `Waypoint succeeded (${result.iterationsUsed} iterations).`
        : `Waypoint ${result.outcome}: ${result.failReason ?? 'unknown'}`,
    waypointOutcome: result.outcome,
  };
}
