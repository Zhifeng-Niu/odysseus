/**
 * P0 eval layer — rule-based function-calling verdicts.
 *
 * Metric family from IBM's ai-agent-evaluation page: per-call rule checks
 * catch the mechanical failure modes an LLM judge would gloss over — wrong
 * tool name, malformed arguments JSON, hallucinated params, missing
 * required params, wrong value types, disallowed enum values.
 *
 * Verdict precedence: wrong-name → malformed-json → hallucinated-param →
 * missing-param → wrong-type → disallowed-value → ok. One primary verdict
 * per call; aggregation lives in summarizeToolCalls below (suite-local on
 * purpose — same style as ithaca/probes.ts: two metrics, no generic
 * indirection).
 */
import type { ToolSpec } from '../llm/provider.js';

export type ToolCallVerdict =
  | 'ok'
  | 'wrong-name'
  | 'malformed-json'
  | 'hallucinated-param'
  | 'missing-param'
  | 'wrong-type'
  | 'disallowed-value';

const ALL_VERDICTS: readonly ToolCallVerdict[] = [
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
export function evaluateToolCall(
  name: string,
  argsJson: string,
  specs: readonly ToolSpec[]
): ToolCallVerdict {
  const spec = specs.find((s) => s.function.name === name);
  if (!spec) return 'wrong-name';

  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    return 'malformed-json';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'malformed-json';
  }
  const args = parsed as Record<string, unknown>;

  const properties = readProperties(spec.function.parameters);
  const required = readRequired(spec.function.parameters);

  for (const key of Object.keys(args)) {
    if (!(key in properties)) return 'hallucinated-param';
  }
  for (const key of required) {
    if (!(key in args)) return 'missing-param';
  }
  for (const key of Object.keys(args)) {
    const propSchema = properties[key];
    const value = args[key];
    if (!typeMatches(propSchema, value)) return 'wrong-type';
    if (!enumAllows(propSchema, value)) return 'disallowed-value';
  }
  return 'ok';
}

export interface ToolCallSummary {
  readonly total: number;
  readonly counts: Readonly<Record<ToolCallVerdict, number>>;
  readonly rates: Readonly<Record<ToolCallVerdict, number>>;
  /** Share of calls that are not 'ok' — lower is better, target 0. */
  readonly errorRate: number;
}

export function summarizeToolCalls(
  verdicts: readonly ToolCallVerdict[]
): ToolCallSummary {
  const counts = Object.fromEntries(
    ALL_VERDICTS.map((v) => [v, 0])
  ) as Record<ToolCallVerdict, number>;
  for (const verdict of verdicts) {
    counts[verdict] += 1;
  }
  const total = verdicts.length;
  const rates = Object.fromEntries(
    ALL_VERDICTS.map((v) => [v, total > 0 ? counts[v] / total : 0])
  ) as Record<ToolCallVerdict, number>;
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

function readProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const raw = schema['properties'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return raw as Record<string, unknown>;
}

function readRequired(schema: Record<string, unknown>): readonly string[] {
  const raw = schema['required'];
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is string => typeof entry === 'string');
}

function typeMatches(propSchema: unknown, value: unknown): boolean {
  if (typeof propSchema !== 'object' || propSchema === null) return true;
  const type = (propSchema as Record<string, unknown>)['type'];
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

function enumAllows(propSchema: unknown, value: unknown): boolean {
  if (typeof propSchema !== 'object' || propSchema === null) return true;
  const allowed = (propSchema as Record<string, unknown>)['enum'];
  if (!Array.isArray(allowed)) return true;
  return allowed.some((entry) => entry === value);
}
