#!/usr/bin/env node
/**
 * Live sycophancy baseline — RQ4 (Calypso test). Run after `npm run build`:
 *
 *   node dist/scripts/probe-sycophancy.js
 *
 * Sends the six target-conflict probes to the real provider with the
 * current protected core as system context, scores replies with the
 * keyword heuristic, and prints holdRate + per-probe verdicts. This is
 * the real-model baseline the unit tests cannot produce (they use
 * scripted providers to validate harness mechanics only).
 */
import { join, resolve } from 'node:path';
import { GLMProvider } from '../llm/glm.js';
import { loadConfig } from '../config.js';
import { loadDotenv } from '../util/dotenv.js';
import { runSycophancyProbes } from '../ithaca/probes.js';
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

  const core = await ensureIthacaLoaded(rootDir);
  const ithacaBlock = core.renderForPrompt();
  console.log(
    ithacaBlock
      ? `Protected core loaded (rev ${core.getState().revision}).`
      : 'Protected core is EMPTY — add tasks via /ithaca add for meaningful baselines.'
  );

  // Adapter: probes speak the minimal ProviderLike protocol; GLMProvider
  // speaks ChatMessage[]. The protected core rides as the system prompt so
  // the model answers under the same conditions as real waypoints.
  const adapter = {
    complete: async (prompt: string) => {
      const completion = await provider.complete(prompt, {
        systemPrompt: `You are Odysseus, a personal agent.${ithacaBlock ? `\n\n${ithacaBlock}` : ''}`,
      });
      return completion.content;
    },
  };

  const report = await runSycophancyProbes(adapter, ithacaBlock);
  console.log(`\nholdRate: ${report.holdRate} (${report.results.length} probes)\n`);
  for (const r of report.results) {
    const verdict = r.heldCourse ? 'HOLD ' : 'YIELD';
    console.log(`[${verdict}] ${r.probe.id} — ${r.probe.scenario} (${r.matchedSignals.join(', ') || 'no signals'})`);
    console.log(`  reply: ${r.reply.replace(/\n/g, ' ').slice(0, 200)}`);
  }

  // M1 dual output: semantic judge column beside the frozen keyword score.
  const judged = await judgeProbeResults('sycophancy', report.results, adapter);
  const judgedN = judged.filter((j) => j.verdict !== null).length;
  const judgeHeld = judged.filter((j) => j.verdict?.held === true).length;
  console.log(`\nholdRate (judge): ${judgedN > 0 ? (judgeHeld / judgedN).toFixed(2) : 'n/a'} (${judgedN}/${judged.length} judged)`);
  let agree = 0;
  for (const j of judged) {
    const label = j.verdict ? (j.verdict.held ? 'HOLD ' : 'YIELD') : 'n/a  ';
    if (j.verdict && j.verdict.held === j.item.heldCourse) agree += 1;
    console.log(`[${label}] ${j.item.probe.id} — ${j.verdict?.reason.slice(0, 140) ?? 'judge unavailable'}`);
  }
  console.log(`keyword↔judge agreement: ${agree}/${judgedN}`);
}

void main().catch((e: unknown) => {
  console.error('probe-sycophancy failed:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
