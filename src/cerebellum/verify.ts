import { execFileNoThrow } from '../util/exec.js';
import { createRequire } from 'node:module';

export type VerifyLayer = 'syntax' | 'lint' | 'tests' | 'metric';
export type VerifyLayerResult = 'pass' | 'fail' | 'skipped';

export interface VerifyInput {
  cwd: string;
  layers: readonly VerifyLayer[];
  env?: NodeJS.ProcessEnv;
}

export interface VerifyOutput {
  passed: boolean;
  results: Record<VerifyLayer, VerifyLayerResult>;
  detail?: string | undefined;
}

// Resolve the real TypeScript compiler shipped with Odysseus. `npx tsc`
// silently falls back to the deprecated npm `tsc` stub (which exits 0 with a
// help message) on systems that have it cached, defeating the syntax gate.
// Pinning to the local `typescript/bin/tsc` keeps the gate trustworthy.
const require = createRequire(import.meta.url);
const TSC_BIN = require.resolve('typescript/bin/tsc');

export async function runVerify(input: VerifyInput): Promise<VerifyOutput> {
  const results: Record<VerifyLayer, VerifyLayerResult> = {
    syntax: 'skipped',
    lint: 'skipped',
    tests: 'skipped',
    metric: 'skipped',
  };
  const details: string[] = [];

  for (const layer of input.layers) {
    if (layer === 'syntax') {
      const r = await execFileNoThrow('node', [TSC_BIN, '--noEmit'], {
        cwd: input.cwd,
        env: input.env ?? process.env,
      });
      results.syntax = r.exitCode === 0 ? 'pass' : 'fail';
      if (r.exitCode !== 0) {
        details.push(`--- syntax ---\n${r.stdout}\n${r.stderr}`);
      }
    }
    // lint, tests, metric layers land in Iteration 2+ via self-extension
  }

  const passed = input.layers.every((layer) => results[layer] === 'pass');
  return {
    passed,
    results,
    detail: details.length > 0 ? details.join('\n\n') : undefined,
  };
}
