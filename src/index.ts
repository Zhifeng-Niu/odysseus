import { loadConfig } from './config.js';
import { GLMProvider } from './llm/glm.js';
import { ToolRegistry } from './tools/registry.js';
import { FileReadTool, FileWriteTool, FileEditTool } from './tools/file.js';
import { GitTool } from './tools/git.js';
import { runAgentTurn } from './agent/loop.js';
import { loadDotenv } from './util/dotenv.js';
import { join } from 'node:path';

async function main(): Promise<void> {
  const cwd = process.cwd();
  loadDotenv(join(cwd, '.env'));
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

  const tracePath = join(cwd, '.odysseus', 'trace.jsonl');

  // Iteration 0 ships argv-only; REPL is a candidate for a later iteration
  const userInput = process.argv.slice(2).join(' ').trim();
  if (!userInput) {
    console.error('Usage: odysseus <your request>');
    console.error('Example: odysseus add a bash tool to the tools registry');
    process.exit(1);
  }

  const result = await runAgentTurn(userInput, {
    cwd,
    provider,
    registry,
    tracePath,
    verifyLayers: ['syntax'],
    mission: 'Iterate on the Odysseus spike codebase (Iteration 0 seed → co-evolution)',
  });

  console.log(result.response);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
