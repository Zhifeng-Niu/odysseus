import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadRecentExplorationsSync, joinWithTraceOutcomes, formatExplorationsMarkdown, } from './exploration-log.js';
import { computeExplorationStats, formatExplorationFeedback, } from './exploration-feedback.js';
/**
 * Read the self-model markdown from `{rootDir}/self-model.md`. This is the
 * primary seed for curiosity — aspirations live there. Returns the empty
 * string if the file is missing so curiosity degrades gracefully (no
 * aspirations → no proposals).
 *
 * Read synchronously to keep the curiosity function's signature simple.
 */
export function loadSelfModelForCuriosity(rootDir) {
    try {
        const path = join(rootDir, 'self-model.md');
        const raw = readFileSync(path, 'utf8').trim();
        if (raw.length === 0)
            return '';
        return raw;
    }
    catch {
        // ENOENT or any read error — self-model is best-effort. Curiosity with
        // no self-model produces no proposals (the aspirations are the seed).
        return '';
    }
}
export function buildCuriosityUserPrompt(input) {
    const selfModel = loadSelfModelForCuriosity(input.rootDir);
    const selfModelBlock = selfModel.length === 0
        ? '(self-model missing — no aspirations to explore. Return empty arrays.)'
        : selfModel;
    const recent = input.recentTrace.length === 0
        ? '(no recent waypoints)'
        : input.recentTrace
            .slice(-10)
            .map((r) => `- [${r.outcome}] ${r.goal}${r.fail_reason ? ` — FAIL: ${r.fail_reason.slice(0, 200)}` : ''}`)
            .join('\n');
    const hasMemory = input.memorySnapshot.some((s) => s.entries.length > 0);
    const memoryBlock = !hasMemory
        ? '(memory empty — fresh agent)'
        : input.memorySnapshot
            .map((snap) => {
            if (snap.entries.length === 0)
                return '';
            const titles = snap.entries.map((e) => `  - ${e.title}`).join('\n');
            return `### ${snap.category} (${snap.entries.length})\n${titles}`;
        })
            .filter(Boolean)
            .join('\n\n');
    // Cross-voyage curiosity memory: surface recent proposals joined with
    // their latest trace outcome so the LLM sees what it already tried.
    // Path mirrors trace.jsonl location (sibling under .odysseus/). Reading
    // sync because the prompt builder is sync (called once per curiosity
    // pass; cost is negligible — explorations.jsonl grows linearly with
    // curiosity invocations, bounded by DEFAULT_EXPLORATION_LIMIT).
    const explorationsPath = join(input.rootDir, 'explorations.jsonl');
    const recentExplorations = loadRecentExplorationsSync(explorationsPath);
    const outcomes = joinWithTraceOutcomes(recentExplorations, input.recentTrace);
    const explorationsMd = formatExplorationsMarkdown(outcomes);
    const explorationsBlock = explorationsMd.length === 0
        ? '(no prior explorations — fresh curiosity memory)'
        : explorationsMd;
    // Exploration-outcome feedback loop (aspiration #3): compute per-goal
    // stats (consecutive failures, last succeeded) and surface actionable
    // guidance — demoted explorations to skip, shipped explorations to close.
    const stats = computeExplorationStats(outcomes, input.recentTrace);
    const feedbackMd = formatExplorationFeedback(stats);
    const feedbackBlock = feedbackMd.length === 0
        ? '(no exploration feedback — all explorations are fresh or neutral)'
        : feedbackMd;
    return `<self-model>
${selfModelBlock}
</self-model>

<recent>
${recent}
</recent>

<memory>
${memoryBlock}
</memory>

<explorations>
${explorationsBlock}
</explorations>

<feedback>
${feedbackBlock}
</feedback>

What is the smallest concrete step toward one of your aspirations? Return JSON.`;
}
//# sourceMappingURL=curiosity-prompt.js.map