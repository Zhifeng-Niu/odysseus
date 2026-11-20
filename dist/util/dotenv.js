import { readFileSync } from 'node:fs';
/**
 * Minimal .env loader — no dependencies.
 *
 * Parses KEY=VALUE pairs from a flat file into `target` (defaults to
 * process.env). Supports double-quoted, single-quoted, and bare values.
 * Full-line comments (`# ...`) and blank lines are ignored.
 *
 * Missing file is a no-op — lets callers unconditionally attempt to load
 * `.env` without guarding for its existence.
 */
export function loadDotenv(filePath, target = process.env, options = {}) {
    const preserveExisting = options.preserveExisting ?? true;
    let raw;
    try {
        raw = readFileSync(filePath, 'utf8');
    }
    catch {
        return {};
    }
    const parsed = {};
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith('#'))
            continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1)
            continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'")))) {
            value = value.slice(1, -1);
        }
        if (!key)
            continue;
        parsed[key] = value;
        if (preserveExisting && target[key] !== undefined)
            continue;
        target[key] = value;
    }
    return parsed;
}
//# sourceMappingURL=dotenv.js.map