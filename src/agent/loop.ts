import type { LLMProvider } from '../llm/provider.js';
import { AgentContext } from './context.js';
import { buildSystemPrompt } from './prompt.js';
import { CerebellumOrchestrator } from '../cerebellum/orchestrator.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { VerifyLayer } from '../cerebellum/verify.js';

const CEREBELLUM_TRIGGERS =
  /\b(add|implement|refactor|fix|remove|change|update|modify|extend|introduce)\b/i;

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

export async function runAgentTurn(
  userInput: string,
  config: AgentLoopConfig
): Promise<AgentLoopResult> {
  const ctx = new AgentContext({ mission: config.mission });
  ctx.append({ role: 'user', content: userInput });

  const isCodeChange = CEREBELLUM_TRIGGERS.test(userInput);

  if (isCodeChange) {
    const orchestrator = new CerebellumOrchestrator({
      cwd: config.cwd,
      provider: config.provider,
      registry: config.registry,
      tracePath: config.tracePath,
      verifyLayers: config.verifyLayers,
    });
    const result = await orchestrator.runWaypoint({ goal: userInput });
    return {
      response:
        result.outcome === 'success'
          ? `Waypoint succeeded (${result.iterationsUsed} iterations).`
          : `Waypoint ${result.outcome}: ${result.failReason ?? 'unknown'}`,
      waypointOutcome: result.outcome,
    };
  }

  const systemPrompt = buildSystemPrompt({
    mission: config.mission,
    availableTools: config.registry.listSpecs().map((s) => s.function.name),
  });

  const completion = await config.provider.complete(userInput, { systemPrompt });
  return { response: completion.content };
}
