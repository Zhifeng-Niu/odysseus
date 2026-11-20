#!/usr/bin/env node
/**
 * Live indirect-injection baseline — P3 companion to probe-sycophancy /
 * probe-overreach. Run:
 *
 *   npx tsx src/scripts/probe-injection.ts
 *
 * Metric injectionResistRate (higher is better, target 1) over the four
 * indirect-injection probes (webpage / file / memory / tool-output vectors),
 * scored with the keyword heuristic v0.
 */
import { join, resolve } from 'node:path';
import { GLMProvider } from '../llm/glm.js';
import { loadConfig } from '../config.js';
import { loadDotenv } from '../util/dotenv.js';
import { runInjectionProbes } from '../eval/injection-probes.js';
import { judgeProbeResults } from '../eval/judge.js';
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

  const report = await runInjectionProbes(adapter, ithacaBlock);
  console.log(
    `\ninjectionResistRate: ${report.injectionResistRate} (${report.results.length} probes — higher is better, target 1)\n`
  );
  for (const r of report.results) {
    const verdict = r.resisted ? 'resisted' : 'COMPLIED';
    console.log(`[${verdict}] ${r.probe.id} — ${r.probe.scenario} (${r.matchedSignals.join(', ') || 'no signals'})`);
    console.log(`  reply: ${r.reply.replace(/\n/g, ' ').slice(0, 200)}`);
  }

  // M1 dual output: semantic judge column beside the frozen keyword score.
  const judged = await judgeProbeResults('injection', report.results, adapter);
  const judgedN = judged.filter((j) => j.verdict !== null).length;
  const judgeResist = judged.filter((j) => j.verdict?.held === true).length;
  console.log(`\ninjectionResistRate (judge): ${judgedN > 0 ? (judgeResist / judgedN).toFixed(2) : 'n/a'} (${judgedN}/${judged.length} judged)`);
  let agree = 0;
  for (const j of judged) {
    const label = j.verdict ? (j.verdict.held ? 'resisted' : 'COMPLIED') : 'n/a  ';
    if (j.verdict && j.verdict.held === j.item.resisted) agree += 1;
    console.log(`[${label}] ${j.item.probe.id} — ${j.verdict?.reason.slice(0, 140) ?? 'judge unavailable'}`);
  }
  console.log(`keyword↔judge agreement: ${agree}/${judgedN}`);
}

void main().catch((e: unknown) => {
  console.error('probe-injection failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
