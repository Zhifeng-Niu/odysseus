/**
 * E2E task-completion proof — the mission acceptance line:
 * "an agent that does not crash and can complete a task".
 *
 * A scripted fake provider drives the REAL orchestrator through the full
 * waypoint path: lazy git checkpoint → file-write → syntax verify →
 * checkpoint commit → DONE. Plus graceful-degradation proofs: a provider
 * that dies mid-waypoint must resolve (never throw past the loop), leave
 * the orchestrator reusable, and rollbacks must leave the git repo usable.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CerebellumOrchestrator } from '../../src/cerebellum/orchestrator.js';
import type { LLMProvider, LLMCompletion } from '../../src/llm/provider.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { FileReadTool, FileWriteTool } from '../../src/tools/file.js';

function makeGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-task-'));
  const git = (args: string[]): void => {
    execFileSync('git', args, { cwd: dir });
  };
  git(['init']);
  git(['config', 'user.email', 'test@odysseus.local']);
  git(['config', 'user.name', 'odysseus-test']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# task fixture\n');
  git(['add', '-A']);
  git(['commit', '-m', 'init']);
  return dir;
}

function gitLog(root: string): string {
  return execFileSync('git', ['log', '--oneline'], { cwd: root }).toString();
}

function providerFromScript(
  script: Array<() => Promise<LLMCompletion>>
): LLMProvider {
  let call = 0;
  return {
    async complete(): Promise<LLMCompletion> {
      const step = script[Math.min(call, script.length - 1)];
      call += 1;
      return step();
    },
    async *stream() {
      yield '';
    },
    getModel() {
      return 'scripted';
    },
  };
}

let toolCallCounter = 0;

function completionWithToolCall(
  toolName: string,
  args: Record<string, unknown>
): () => Promise<LLMCompletion> {
  toolCallCounter += 1;
  const callId = `call_${toolCallCounter}`;
  return async () => ({
    content: '',
    model: 'scripted',
    usage: { inputTokens: 10, outputTokens: 5 },
    finishReason: 'tool_calls',
    toolCalls: [
      {
        id: callId,
        type: 'function',
        function: { name: toolName, arguments: JSON.stringify(args) },
      },
    ],
  });
}

function doneCompletion(): () => Promise<LLMCompletion> {
  return async () => ({
    content: 'DONE',
    model: 'scripted',
    usage: { inputTokens: 10, outputTokens: 5 },
    finishReason: 'stop',
  });
}

describe('E2E task completion (the acceptance line)', () => {
  let workdir: string;
  let registry: ToolRegistry;
  let tracePath: string;

  beforeEach(() => {
    workdir = makeGitRepo();
    registry = new ToolRegistry();
    registry.register(new FileWriteTool());
    registry.register(new FileReadTool());
    tracePath = path.join(workdir, '.odysseus', 'trace.jsonl');
    fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(workdir, { recursive: true, force: true });
  });

  test('real code task: write file → syntax verify → checkpoint commit → DONE', async () => {
    const artifact = path.join(workdir, 'out.ts');
    const provider = providerFromScript([
      completionWithToolCall('file-write', {
        path: artifact,
        content: 'export const solved = true;',
      }),
      doneCompletion(),
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    const result = await orch.runWaypoint({ goal: 'add a file that exports solved = true' });
    expect(result.outcome).toBe('success');

    // The artifact really exists with the right content.
    expect(fs.readFileSync(artifact, 'utf8')).toContain('export const solved = true;');

    // The lazy git checkpoint really committed (mission line: 能完成 task,
    // not just pretend — the repo history must show the checkpoint commit).
    const log = gitLog(workdir);
    expect(log).toContain('checkpoint/');
  });

  test('provider crash mid-waypoint resolves gracefully; orchestrator stays reusable', async () => {
    const boom: LLMProvider = {
      complete: async () => {
        throw new Error('provider socket died');
      },
      async *stream() {
        yield '';
      },
      getModel() {
        return 'scripted';
      },
    };

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider: boom,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    // Must RESOLVE with a failure outcome — never throw past the loop.
    const result = await orch.runWaypoint({ goal: 'this will fail at the provider' });
    expect(result.outcome).not.toBe('success');
    expect(String(result.failReason ?? '')).toContain('provider socket died');

    // The repo was not corrupted by the failed waypoint: a FRESH orchestrator
    // with a healthy provider still completes a task on it.
    const artifact = path.join(workdir, 'recovered.ts');
    const provider = providerFromScript([
      completionWithToolCall('file-write', {
        path: artifact,
        content: 'export const recovered = true;',
      }),
      doneCompletion(),
    ]);
    const orch2 = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });
    const retry = await orch2.runWaypoint({ goal: 'recover with a working provider' });
    expect(retry.outcome).toBe('success');
    expect(fs.existsSync(artifact)).toBe(true);
  });

  test('failed verify rolls back the checkpoint; git repo stays usable', async () => {
    const badFile = path.join(workdir, 'bad.ts');
    const provider = providerFromScript([
      completionWithToolCall('file-write', {
        path: badFile,
        content: 'export const v: number = "type error";',
      }),
      doneCompletion(),
    ]);

    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider,
      registry,
      tracePath,
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    const result = await orch.runWaypoint({ goal: 'write intentionally broken code' });
    expect(result.outcome).not.toBe('success');

    // Rollback actually removed the bad artifact...
    expect(fs.existsSync(badFile)).toBe(false);

    // ...and the repo remains usable: a follow-up commit still works.
    fs.writeFileSync(path.join(workdir, 'after.txt'), 'still alive');
    execFileSync('git', ['add', '-A'], { cwd: workdir });
    execFileSync('git', ['commit', '-m', 'post-rollback proof'], { cwd: workdir });
    expect(gitLog(workdir)).toContain('post-rollback proof');
  });
});
