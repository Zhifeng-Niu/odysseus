import { join } from 'node:path';
import { enqueuePendingReview, autoApproveAllPendingReview, shouldAutoApprove, } from './pending-review.js';
import { writeMemory as writeMemoryEntry } from './memory.js';
import { CURIOSITY_SYSTEM_PROMPT } from './prompts.js';
import { isDuplicateGoal, buildSucceededGoalSet, normalizeGoal, } from './dreamer-dedup.js';
import { appendExploration, loadRecentExplorationsSync, joinWithTraceOutcomes, } from './exploration-log.js';
import { analyzeExplorationOutcomes, } from './exploration-feedback.js';
import { extractJsonObject } from './extract-json.js';
import { coerceBacklogItem, coerceMemoryEntry, } from './llm-result.js';
import { buildCuriosityUserPrompt, } from './curiosity-prompt.js';
// Re-export extracted symbols so existing importers don't change.
export { buildCuriosityUserPrompt, loadSelfModelForCuriosity, } from './curiosity-prompt.js';
/**
 * Returns true when the curiosity phase should fire. Defaults to ON — a
 * truly autonomous agent generates its own exploration goals. Gated by
 * three safety layers: (1) `didRealWork` — only after real side-effects,
 * (2) `backlog-empty` — only when dreamer produced nothing, (3)
 * `pending-review` queue — proposals wait for review unless auto-approve
 * is on. Set `ODYSSEUS_CURIOSITY=0` to disable entirely.
 */
export function shouldRunCuriosity() {
    const v = process.env.ODYSSEUS_CURIOSITY;
    if (v === undefined || v === '')
        return true;
    return v !== '0' && v !== 'false' && v !== 'no';
}
/**
 * Run a single curiosity pass: LLM call + persist backlog/memory items.
 * Failure modes mirror dream(): LLM throws → rethrown; malformed JSON →
 * { parseOk: false }; junk/duplicate items → silently dropped/skipped.
 */
export async function curiosity(input) {
    const start = Date.now();
    const completion = await input.provider.complete(buildCuriosityUserPrompt(input), {
        systemPrompt: CURIOSITY_SYSTEM_PROMPT,
        temperature: 0.8, // high temp for divergent exploration, slightly lower than dreamer (0.9) — curiosity is more focused
        maxTokens: 1800, // cap reflects current self-model + memory title footprint; bump if truncated JSON reappears
    });
    const extracted = extractJsonObject(completion.content);
    if (!extracted.ok) {
        return {
            backlogItemsAdded: 0,
            backlogItemsSkipped: 0,
            memoryEntriesAdded: 0,
            addedBacklogItems: [],
            addedMemoryEntries: [],
            rawResponse: completion.content,
            durationMs: Date.now() - start,
            parseOk: false,
            ...(extracted.error !== undefined ? { parseError: extracted.error } : {}),
        };
    }
    const parsed = extracted.value;
    const maxBacklog = input.maxBacklogItems ?? 2;
    const maxMemory = input.maxMemoryEntries ?? 2;
    const rawBacklog = Array.isArray(parsed.backlogItems) ? parsed.backlogItems : [];
    const rawMemory = Array.isArray(parsed.memoryEntries) ? parsed.memoryEntries : [];
    const backlogItems = [];
    for (const raw of rawBacklog) {
        if (backlogItems.length >= maxBacklog)
            break;
        const item = coerceBacklogItem(raw);
        if (item)
            backlogItems.push(item);
    }
    const memoryEntries = [];
    for (const raw of rawMemory) {
        if (memoryEntries.length >= maxMemory)
            break;
        const entry = coerceMemoryEntry(raw);
        if (entry)
            memoryEntries.push(entry);
    }
    // Dedup against succeeded goals + same-pass items (reuses dreamer helpers).
    const seenGoals = buildSucceededGoalSet(input.recentTrace);
    const addedBacklogItems = [];
    let backlogItemsSkipped = 0;
    const explorationsPath = join(input.rootDir, 'explorations.jsonl');
    for (const item of backlogItems) {
        if (isDuplicateGoal(item.goal, seenGoals)) {
            backlogItemsSkipped += 1;
            continue;
        }
        const options = item.priority !== undefined ? { priority: item.priority } : {};
        try {
            const enqueued = await enqueuePendingReview(input.rootDir, item.goal, 'curiosity', options);
            addedBacklogItems.push({
                id: enqueued.id,
                goal: item.goal,
                priority: enqueued.priority,
            });
            seenGoals.add(item.goal);
            // Record proposal for cross-voyage memory. Best-effort.
            try {
                await appendExploration(explorationsPath, {
                    goal: item.goal,
                    origin: 'curiosity',
                    priority: enqueued.priority,
                    ...(input.voyageId !== undefined ? { voyage_id: input.voyageId } : {}),
                });
            }
            catch {
                // Exploration log is best-effort; enqueue already succeeded.
            }
        }
        catch {
            // empty-goal validation etc — skip silently
        }
    }
    // Exploration-outcome feedback loop (aspiration #3): filter out proposals
    // whose aspiration was demoted (3 consecutive failures).
    const demotedAspirations = new Set();
    try {
        const explPath = join(input.rootDir, 'explorations.jsonl');
        const recent = loadRecentExplorationsSync(explPath);
        const outcomes = joinWithTraceOutcomes(recent, input.recentTrace);
        const entries = [];
        for (const o of outcomes) {
            if (o.traceOutcome !== null) {
                entries.push({
                    aspiration: o.exploration.goal,
                    outcome: o.traceOutcome,
                });
            }
        }
        for (const a of analyzeExplorationOutcomes(entries)) {
            if (a.action === 'demote')
                demotedAspirations.add(normalizeGoal(a.aspiration));
        }
    }
    catch {
        // Feedback analysis is best-effort — never block proposals on it.
    }
    if (demotedAspirations.size > 0) {
        const kept = addedBacklogItems.filter((item) => {
            if (demotedAspirations.has(normalizeGoal(item.goal))) {
                backlogItemsSkipped += 1;
                console.warn(`[curiosity] demoting exploration (3 consecutive failures): ${item.goal.slice(0, 120)}`);
                return false;
            }
            return true;
        });
        addedBacklogItems.length = 0;
        for (const k of kept)
            addedBacklogItems.push(k);
    }
    // Auto-approve moves this pass's proposals to the backlog so the next
    // voyage iteration can execute them. Reuses the dreamer's pipeline —
    // pending-review + auto-approve are origin-agnostic.
    if (shouldAutoApprove() && addedBacklogItems.length > 0) {
        try {
            const approved = await autoApproveAllPendingReview(input.rootDir);
            if (approved.length > 0) {
                addedBacklogItems.length = 0;
                for (const bl of approved) {
                    addedBacklogItems.push({
                        id: bl.id,
                        goal: bl.goal,
                        priority: bl.priority,
                    });
                }
            }
        }
        catch {
            // Auto-approve failure is non-fatal.
        }
    }
    // Curiosity memories use source='dream' — structurally identical to dream
    // memories; a 'curiosity' source would cascade through consumers for no gain.
    const addedMemoryEntries = [];
    for (const entry of memoryEntries) {
        try {
            const written = await writeMemoryEntry(input.rootDir, {
                category: entry.category,
                title: entry.title,
                source: 'dream',
                body: entry.body,
            });
            addedMemoryEntries.push({
                id: written.id,
                category: entry.category,
                title: entry.title,
            });
        }
        catch {
            // skip silently
        }
    }
    return {
        backlogItemsAdded: addedBacklogItems.length,
        backlogItemsSkipped,
        memoryEntriesAdded: addedMemoryEntries.length,
        addedBacklogItems,
        addedMemoryEntries,
        rawResponse: completion.content,
        durationMs: Date.now() - start,
        parseOk: true,
    };
}
//# sourceMappingURL=curiosity.js.map