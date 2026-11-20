/**
 * Per-waypoint transcript compaction (Aspiration 4).
 *
 * Today the orchestrator appends every tool call and its full result to
 * the message history with no compaction (9 `history.push` sites, 0
 * eviction). Per-waypoint token cost therefore scales with iteration
 * count × accumulated tool-result size. This module extracts a pure
 * function that turns a list of tool-call entries into a compact
 * one-line-per-call summary, so the caller can replace verbose history
 * with the compressed form when the conversation exceeds a threshold.
 *
 * Pure function, no I/O, no LLM calls.
 */
/** Maximum characters preserved from each outcome before truncation. */
const MAX_OUTCOME_LEN = 120;
/**
 * Truncate a string to `maxLen` characters, appending an ellipsis when
 * truncation occurs. Single-line aware — collapses internal newlines to
 * spaces so the summary stays one-line-per-call.
 */
function squash(value, maxLen) {
    const flat = value.replace(/\s+/g, ' ').trim();
    if (flat.length <= maxLen)
        return flat;
    return flat.slice(0, maxLen - 1) + '…';
}
/**
 * Compress a list of tool-call entries into a compact one-line-per-call
 * summary string.
 *
 * Each line has the shape:
 *
 *     <tool> | <target> → <outcome>
 *
 * where `outcome` is squashed to a single line and truncated to
 * {@link MAX_OUTCOME_LEN} characters. An empty input yields an empty
 * string (no trailing newline).
 *
 * @param entries  Ordered list of tool-call records.
 * @returns Newline-joined compact summary, or `''` when `entries` is
 *          empty.
 */
export function compressTranscript(entries) {
    if (entries.length === 0)
        return '';
    return entries
        .map((e) => {
        const tool = squash(e.tool, 40);
        const target = squash(e.target, 80);
        const outcome = squash(e.outcome, MAX_OUTCOME_LEN);
        return `${tool} | ${target} → ${outcome}`;
    })
        .join('\n');
}
//# sourceMappingURL=transcript-compressor.js.map