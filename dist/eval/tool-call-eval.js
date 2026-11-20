const ALL_VERDICTS = [
    'ok',
    'wrong-name',
    'malformed-json',
    'hallucinated-param',
    'missing-param',
    'wrong-type',
    'disallowed-value',
];
/**
 * Classify one tool call against its spec (or the whole spec list).
 * `name`/`argsJson` come straight from a provider ToolCall's
 * `function.name` / `function.arguments`.
 */
export function evaluateToolCall(name, argsJson, specs) {
    const spec = specs.find((s) => s.function.name === name);
    if (!spec)
        return 'wrong-name';
    let parsed;
    try {
        parsed = JSON.parse(argsJson);
    }
    catch {
        return 'malformed-json';
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return 'malformed-json';
    }
    const args = parsed;
    const properties = readProperties(spec.function.parameters);
    const required = readRequired(spec.function.parameters);
    for (const key of Object.keys(args)) {
        if (!(key in properties))
            return 'hallucinated-param';
    }
    for (const key of required) {
        if (!(key in args))
            return 'missing-param';
    }
    for (const key of Object.keys(args)) {
        const propSchema = properties[key];
        const value = args[key];
        if (!typeMatches(propSchema, value))
            return 'wrong-type';
        if (!enumAllows(propSchema, value))
            return 'disallowed-value';
    }
    return 'ok';
}
export function summarizeToolCalls(verdicts) {
    const counts = Object.fromEntries(ALL_VERDICTS.map((v) => [v, 0]));
    for (const verdict of verdicts) {
        counts[verdict] += 1;
    }
    const total = verdicts.length;
    const rates = Object.fromEntries(ALL_VERDICTS.map((v) => [v, total > 0 ? counts[v] / total : 0]));
    const errors = total - counts['ok'];
    return {
        total,
        counts,
        rates,
        errorRate: total > 0 ? errors / total : 0,
    };
}
// ---------------------------------------------------------------------------
// JSON Schema narrowing (small, typed, no `as any`)
// ---------------------------------------------------------------------------
function readProperties(schema) {
    const raw = schema['properties'];
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        return {};
    return raw;
}
function readRequired(schema) {
    const raw = schema['required'];
    if (!Array.isArray(raw))
        return [];
    return raw.filter((entry) => typeof entry === 'string');
}
function typeMatches(propSchema, value) {
    if (typeof propSchema !== 'object' || propSchema === null)
        return true;
    const type = propSchema['type'];
    switch (type) {
        case 'string':
            return typeof value === 'string';
        case 'number':
            return typeof value === 'number';
        case 'integer':
            return typeof value === 'number' && Number.isInteger(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'array':
            return Array.isArray(value);
        case 'object':
            return typeof value === 'object' && value !== null && !Array.isArray(value);
        case 'null':
            return value === null;
        default:
            return true; // unknown/absent schema type — nothing to check
    }
}
function enumAllows(propSchema, value) {
    if (typeof propSchema !== 'object' || propSchema === null)
        return true;
    const allowed = propSchema['enum'];
    if (!Array.isArray(allowed))
        return true;
    return allowed.some((entry) => entry === value);
}
//# sourceMappingURL=tool-call-eval.js.map