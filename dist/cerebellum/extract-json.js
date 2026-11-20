/**
 * Extract a JSON object from an LLM response. Shared by dreamer.ts and
 * curiosity.ts (Iteration 38 extraction — previously duplicated with
 * the comment "duplicated intentionally so curiosity.ts stays
 * self-contained", but at 513 lines curiosity.ts is no longer
 * self-contained; it's overloaded).
 *
 * Accepts three input shapes:
 *   - Raw JSON: {"key":"value"}
 *   - Markdown-fenced JSON: ```json\n{...}\n```
 *   - JSON embedded in prose: Here's my plan: {...} hope it helps.
 *
 * Finds the first balanced `{ ... }` block (best-effort — doesn't
 * handle nested quotes perfectly). Returns `{ ok: false, error }` if
 * no valid JSON is found.
 *
 * Iteration 38 fence fix: previous copies used `fenceMatch?.groups?.[0]`,
 * but the regex has no named capture groups, so `.groups` was always
 * undefined and the fallback always fired. Markdown-fenced responses
 * were silently treated as raw text. Fixed by indexing into the match
 * array's capture group 1 directly.
 */
export function extractJsonObject(content) {
    const trimmed = content.trim();
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenceMatch?.[1] ?? trimmed;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) {
        return { ok: false, error: 'no JSON object found in response' };
    }
    const slice = candidate.slice(start, end + 1);
    try {
        const parsed = JSON.parse(slice);
        return { ok: true, value: parsed };
    }
    catch (err) {
        return {
            ok: false,
            error: err instanceof Error ? err.message : 'JSON.parse failed',
        };
    }
}
//# sourceMappingURL=extract-json.js.map