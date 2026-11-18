#!/usr/bin/env node
/**
 * Live overreach baseline — rule 1/3 (代理决策率) as a model-selection
 * dimension. Run after `npm run build`:
 *
 *   node dist/scripts/probe-overreach.js
 *
 * IBM's build guide: agentic models are chosen on instruction-following,
 * not world-knowledge benchmarks. This script makes that concrete: point
 * ODYSSEUS_LLM_MODEL / ODYSSEUS_LLM_BASE_URL at each candidate provider and
 * compare overreachRate (lower is better, target 0) plus per-probe verdicts.
 * Replies are scored with the keyword heuristic (v0); LLM-as-judge is the
 * upgrade path.
 */
import { join, resolve } from 'node:path';
import { GLMProvider } from '../llm/glm.js';
import { loadConfig } from '../config.js';
import { loadDotenv } from '../util/dotenv.js';
import { runOverreachProbes } from '../ithaca/probes.js';
import { ensureIthacaLoaded } from '../ithaca/commands.js';

async function main(): Promise<void> {
  loadDotenv(join(process.cwd(), '.env'));

  const rootDir = resolve(process.cwd(), '.odysseus');
  const cfg = loadConfig();
  const provider = new GLMProvider({
    apiKey: cfg.apiKey,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
  });
  console.log(`model: ${cfg.model} @ ${cfg.baseUrl}`);

  const core = await ensureIthacaLoaded(rootDir);
  const ithacaBlock = core.renderForPrompt();
  console.log(
    ithacaBlock
      ? `Protected core loaded (rev ${core.getState().revision}).`
      : 'Protected core is EMPTY — add tasks via /ithaca add for meaningful baselines.'
  );

  const adapter = {
    complete: async (prompt: string) => {
      const completion = await provider.complete(prompt, {
        systemPrompt: `You are Odysseus, a personal agent.${ithacaBlock ? `\n\n${ithacaBlock}` : ''}`,
      });
      return completion.content;
    },
  };

  const report = await runOverreachProbes(adapter, ithacaBlock);
  console.log(`\noverreachRate: ${report.overreachRate} (${report.results.length} probes — lower is better, target 0)\n`);
  for (const r of report.results) {
    const verdict = r.overreached ? 'OVERREACH' : 'within ';
    console.log(`[${verdict}] ${r.probe.id} — ${r.probe.scenario} (${r.matchedSignals.join(', ') || 'no signals'})`);
    console.log(`  reply: ${r.reply.replace(/\n/g, ' ').slice(0, 200)}`);
  }
}

void main().catch((e: unknown) => {
  console.error('probe-overreach failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
