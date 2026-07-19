import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileNoThrow } from '../../src/util/exec.js';
import { CerebellumOrchestrator } from '../../src/cerebellum/orchestrator.js';
import type { LLMProvider, LLMCompletion } from '../../src/llm/provider.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { FileWriteTool } from '../../src/tools/file.js';
import { App } from '../../src/tui/app.js';

async function initRepo(dir: string): Promise<void> {
  await execFileNoThrow('git', ['init'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.email', 't@t.t'], { cwd: dir });
  await execFileNoThrow('git', ['config', 'user.name', 'T'], { cwd: dir });
}

function staticProvider(content: string): LLMProvider {
  return {
    async complete(): Promise<LLMCompletion> {
      return {
        content,
        model: 'mock',
        usage: { inputTokens: 1, outputTokens: 1 },
        finishReason: 'stop',
      };
    },
    async *stream() {
      yield '';
    },
    getModel() {
      return 'mock';
    },
  };
}

describe('TUI smoke', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'ody-tui-'));
    await initRepo(workdir);
    await writeFile(
      join(workdir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
        },
        include: ['*.ts'],
      })
    );
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  test('App renders title banner + status bar without crashing', () => {
    const registry = new ToolRegistry();
    registry.register(new FileWriteTool());
    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider: staticProvider('DONE'),
      registry,
      tracePath: join(workdir, 'trace.jsonl'),
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    const instance = render(React.createElement(App, { orch, model: 'mock-model' }));
    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('ODYSSEUS');
    expect(frame).toContain('mock-model');
    expect(frame).toContain('voyage console');
    instance.unmount();
  });

  test('App reflects an empty state before any waypoint starts', () => {
    const registry = new ToolRegistry();
    registry.register(new FileWriteTool());
    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider: staticProvider('DONE'),
      registry,
      tracePath: join(workdir, 'trace.jsonl'),
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    const instance = render(React.createElement(App, { orch, model: 'mock' }));
    const frame = instance.lastFrame() ?? '';
    expect(frame).toContain('No waypoints yet');
    expect(frame).toContain('phase: idle');
    instance.unmount();
  });

  test('App shows brain state indicator + backlog size in status bar', () => {
    const registry = new ToolRegistry();
    registry.register(new FileWriteTool());
    const orch = new CerebellumOrchestrator({
      cwd: workdir,
      provider: staticProvider('DONE'),
      registry,
      tracePath: join(workdir, 'trace.jsonl'),
      verifyLayers: ['syntax'],
      autoApprove: true,
    });

    const instance = render(React.createElement(App, { orch, model: 'mock' }));
    const frame = instance.lastFrame() ?? '';
    // Brain state glyph + label for 'idle' must render.
    expect(frame).toContain('idle');
    // Backlog counter must render even at 0.
    expect(frame).toContain('backlog: 0');
    instance.unmount();
  });
});
