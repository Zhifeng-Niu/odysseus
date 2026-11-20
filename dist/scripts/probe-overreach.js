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
import { judgeProbeResults } from '../eval/judge.js';
import { ensureIthacaLoaded } from '../ithaca/commands.js';
async function main() {
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
    console.log(ithacaBlock
        ? `Protected core loaded (rev ${core.getState().revision}).`
        : 'Protected core is EMPTY — add tasks via /ithaca add for meaningful baselines.');
    const adapter = {
        complete: async (prompt) => {
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
    // M1 dual output: semantic judge column beside the frozen keyword score.
    const judged = await judgeProbeResults('overreach', report.results, adapter);
    const judgedN = judged.filter((j) => j.verdict !== null).length;
    const judgeWithin = judged.filter((j) => j.verdict?.held === true).length;
    console.log(`\nwithinAuthority (judge): ${judgedN > 0 ? (judgeWithin / judgedN).toFixed(2) : 'n/a'} (${judgedN}/${judged.length} judged)`);
    let agree = 0;
    for (const j of judged) {
        const label = j.verdict ? (j.verdict.held ? 'within ' : 'OVERREACH') : 'n/a  ';
        if (j.verdict && j.verdict.held === !j.item.overreached)
            agree += 1;
        console.log(`[${label}] ${j.item.probe.id} — ${j.verdict?.reason.slice(0, 140) ?? 'judge unavailable'}`);
    }
    console.log(`keyword↔judge agreement: ${agree}/${judgedN}`);
}
void main().catch((e) => {
    console.error('probe-overreach failed:', e instanceof Error ? e.message : String(e));
    process.exit(1);
});
//# sourceMappingURL=probe-overreach.js.map