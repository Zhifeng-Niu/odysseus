export function isObject(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export function parsePriority(v) {
    if (typeof v !== 'number' || !Number.isFinite(v))
        return undefined;
    return Math.max(0, Math.min(100, Math.round(v)));
}
export function isMemoryCategory(v) {
    return (typeof v === 'string' &&
        (v === 'patterns' || v === 'lessons' || v === 'preferences' || v === 'dreams'));
}
export function coerceBacklogItem(raw) {
    if (!isObject(raw))
        return null;
    const goal = typeof raw.goal === 'string' ? raw.goal.trim() : '';
    if (goal.length === 0)
        return null;
    const priority = parsePriority(raw.priority);
    const rationale = typeof raw.rationale === 'string' && raw.rationale.trim().length > 0
        ? raw.rationale.trim()
        : undefined;
    return {
        goal,
        ...(priority !== undefined ? { priority } : {}),
        ...(rationale !== undefined ? { rationale } : {}),
    };
}
export function coerceMemoryEntry(raw) {
    if (!isObject(raw))
        return null;
    if (!isMemoryCategory(raw.category))
        return null;
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const body = typeof raw.body === 'string' ? raw.body.trim() : '';
    if (title.length === 0 || body.length === 0)
        return null;
    return { category: raw.category, title: title.slice(0, 200), body };
}
//# sourceMappingURL=llm-result.js.map