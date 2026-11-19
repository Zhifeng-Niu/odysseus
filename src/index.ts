import { loadConfig } from './config.js';
import { GLMProvider } from './llm/glm.js';
import { ToolRegistry } from './tools/registry.js';
import { FileReadTool, FileWriteTool, FileEditTool } from './tools/file.js';
import { GitTool } from './tools/git.js';
import { BashTool } from './tools/bash.js';
import { runAgentTurn } from './agent/loop.js';
import { installProcessGuards } from './agent/guards.js';
import { CerebellumOrchestrator } from './cerebellum/orchestrator.js';
import { shouldAutoApprove } from './cerebellum/pending-review-auto.js';
import { startTui } from './tui/index.js';
import { loadDotenv } from './util/dotenv.js';
import { recordEvent } from './trace/event-log.js';
import { join } from 'node:path';

function isInteractive(): boolean {
  return process.stdout.isTTY === true && process.stdin.isTTY === true;
}

async function runCli(
  cwd: string,
  provider: GLMProvider,
  registry: ToolRegistry,
  tracePath: string
): Promise<void> {
  const userInput = process.argv.slice(2).join(' ').trim();
  if (!userInput) {
    console.error('Usage: odysseus <your request>');
    console.error('Example: odysseus add a bash tool to the tools registry');
    console.error('       (in a TTY, run with no args to launch the voyage console)');
    process.exit(1);
  }

  const result = await runAgentTurn(userInput, {
    cwd,
    provider,
    registry,
    tracePath,
    // Iteration 20 — progress gate first: cheapest check, and blocks the
    // empty-commit false-success pattern before tsc/vitest burn cycles on
    // a waypoint that produced nothing. See src/cerebellum/verify.ts.
    verifyLayers: ['progress', 'syntax', 'tests'],
    mission: 'Iterate on the Odysseus spike codebase (Iteration 0 seed → co-evolution)',
  });

  console.log(result.response);
}

function runVoyageConsole(
  cwd: string,
  provider: GLMProvider,
  registry: ToolRegistry,
  tracePath: string,
  model: string
): void {
  // Unified autonomy switch — reuse shouldAutoApprove() so the voyage
  // waypoint gate and the dreamer pending-review gate read the same
  // ODYSSEUS_AUTO_APPROVE env var. Default ON: the agent's dreaming →
  // backlog → wakeful waypoint loop is meant to self-iterate without
  // per-waypoint TTY authorization. Operators who want supervised runs
  // opt out with ODYSSEUS_AUTO_APPROVE=0, which simultaneously gates
  // dreamer auto-approve AND voyage waypoint auto-approve.
  const autoApprove = shouldAutoApprove();
  const orch = new CerebellumOrchestrator({
    cwd,
    provider,
    registry,
    tracePath,
    // Iteration 20 — progress gate first (cheapest, blocks empty commits).
    verifyLayers: ['progress', 'syntax', 'tests'],
    autoApprove,
  });

  // Append-only event recorder — used for development retrospective.
  // Records every tool call, assistant message, verify outcome, and
  // brain-state transition. See src/trace/event-log.ts for the reader.
  const eventLogPath = join(cwd, '.odysseus', 'events.jsonl');
  orch.on('event', (e) => {
    recordEvent(eventLogPath, e);
  });

  startTui({ orch, model });
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  loadDotenv(join(cwd, '.env'));

  // Crash guards — absorb stray rejections/exceptions (report to stderr +
  // the event log), never take a live session down. Never call exit here.
  installProcessGuards({
    onError: (kind, err) => {
      process.stderr.write(`[guard] ${kind}: ${err.message}\n`);
      try {
        recordEvent(join(cwd, '.odysseus', 'events.jsonl'), {
          type: kind,
          source: 'agent',
          data: { message: err.message },
        } as never);
      } catch {
        // Event-log failure must not turn a guard into a crash.
      }
    },
  });

  // /ithaca — protected core; local-only, never enters the LLM, works without an API key.
  const userInput = process.argv.slice(2).join(' ').trim();
  // /ithaca — protected core; local-only, never enters the LLM, works without an API key.
  if (userInput.startsWith('/ithaca')) return (await import('./ithaca/commands.js')).runIthacaCli(userInput);

  const config = loadConfig();
  const provider = new GLMProvider({
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.baseUrl,
  });

  const registry = new ToolRegistry();
  registry.register(new FileReadTool());
  registry.register(new FileWriteTool());
  registry.register(new FileEditTool());
  registry.register(new GitTool());
  // Pre-execution existence check: skip re-registration if 'bash' already
  // exists in the tools map (e.g. registry was pre-populated by a caller).
  if (!registry.get('bash')) {
    registry.register(new BashTool());
  }

  const tracePath = join(cwd, '.odysseus', 'trace.jsonl');

  if (isInteractive() && process.argv.slice(2).length === 0) {
    runVoyageConsole(cwd, provider, registry, tracePath, config.model);
    return;
  }

  await runCli(cwd, provider, registry, tracePath);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
