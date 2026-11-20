import { enqueuePendingReview, autoApproveAllPendingReview, shouldAutoApprove } from './pending-review.js';
import { writeMemory as writeMemoryEntry } from './memory.js';
import { DREAM_SYSTEM_PROMPT } from './prompts.js';
import { isDuplicateGoal, buildSucceededGoalSet, } from './dreamer-dedup.js';
import { extractJsonObject } from './extract-json.js';
import { coerceBacklogItem, coerceMemoryEntry, } from './llm-result.js';
import { buildUserPrompt } from './dreamer-prompt.js';
// Re-export moved symbols (Iteration 47 extraction) so existing importers
// (tests) do not need to know about the internal split. Same pattern as
// planner.ts re-exporting planner-policy.js (Iter 42) and curiosity.ts
// re-exporting curiosity-prompt.js (Iter 44).
export { buildUserPrompt } from './dreamer-prompt.js';
/**
 * Run a single dreaming pass: LLM call + persist backlog/memory items.
 *
 * Failure modes:
 * - LLM throws → rethrown (caller decides whether to abort voyage).
 * - LLM returns malformed JSON → returns { parseOk: false, parseError }, nothing persisted.
 * - LLM returns valid JSON with junk items → junk items silently dropped.
 * - LLM returns items that duplicate already-succeeded waypoints → skipped, counted.
 *
 * Near-duplicates across dreams are also dropped (Jaccard ≥ 0.5 vs succeeded set
 * or items already enqueued in this same pass).
 */
export async function dream(input) {
    const start = Date.now();
    const completion = await input.provider.complete(buildUserPrompt(input), {
        systemPrompt: DREAM_SYSTEM_PROMPT,
        temperature: 0.9, // high temp for divergent thinking
        maxTokens: 1500,
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
    const maxBacklog = input.maxBacklogItems ?? 5;
    const maxMemory = input.maxMemoryEntries ?? 3;
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
    // Persist backlog items with dedup against the succeeded-goal set AND
    // against items added earlier in this same pass. Both checks use the
    // raw goal string (isDuplicateGoal normalizes internally).
    const seenGoals = buildSucceededGoalSet(input.recentTrace);
    const addedBacklogItems = [];
    let backlogItemsSkipped = 0;
    for (const item of backlogItems) {
        if (isDuplicateGoal(item.goal, seenGoals)) {
            backlogItemsSkipped += 1;
            continue;
        }
        const options = item.priority !== undefined ? { priority: item.priority } : {};
        try {
            // Dreams go to the pending-review queue first (preserves audit log of
            // what the dreamer proposed). When ODYSSEUS_AUTO_APPROVE is enabled
            // (default), all pending items are moved into the backlog at the end
            // of this dream pass — see the auto-approve block below. This gives
            // the agent autonomous evolution (think → propose → execute) without a
            // human pressing 'approve', while keeping pending-review.json as an
            // audit trail of every dreamer-produced proposal.
            const enqueued = await enqueuePendingReview(input.rootDir, item.goal, 'dream', options);
            addedBacklogItems.push({
                id: enqueued.id,
                goal: item.goal,
                priority: enqueued.priority,
            });
            // Register the goal so subsequent items in this same dream cannot
            // sneak in a near-duplicate variant.
            seenGoals.add(item.goal);
        }
        catch {
            // empty-goal validation etc — skip silently
        }
    }
    // Auto-approve: when ODYSSEUS_AUTO_APPROVE is set (default ON), move every
    // pending item from this dream pass straight into the backlog so the next
    // voyage picks it up without waiting for user approval. Items that fail
    // to enqueue stay in pending-review.json for operator inspection.
    if (shouldAutoApprove() && addedBacklogItems.length > 0) {
        try {
            const approved = await autoApproveAllPendingReview(input.rootDir);
            // Refresh addedBacklogItems with the real backlog IDs (the pending IDs
            // were transient — pr_* ids become bl_* ids after approval). Preserve
            // order so callers can correlate which dream proposals actually shipped.
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
            // Auto-approve failure is non-fatal — items remain in pending-review
            // and the operator can approve them manually. The dream itself still
            // succeeded.
        }
    }
    // Persist memory entries with source='dream'.
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
//# sourceMappingURL=dreamer.js.map