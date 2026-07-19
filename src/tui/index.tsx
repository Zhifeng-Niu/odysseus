import { render } from 'ink';
import React from 'react';
import type { CerebellumOrchestrator } from '../cerebellum/orchestrator.js';
import type { LLMProvider } from '../llm/provider.js';
import { App } from './app.js';

export interface TuiOptions {
  orch: CerebellumOrchestrator;
  model: string;
  /**
   * Provider used for the conversation path (chat with the agent). The
   * orchestrator keeps its own internal provider for autonomous voyage;
   * the TUI needs this separate reference so user-facing chat bypasses
   * the waypoint pipeline entirely.
   */
  provider: LLMProvider;
}

/**
 * Boot the Ink-rendered TUI. Returns the Ink instance so the caller can
 * `unmount()` on external shutdown signals (rare — Ctrl+C is handled inside).
 *
 * This entry point assumes the caller has already wired `orch` with the
 * correct provider / registry / tracePath. The TUI consumes the event
 * stream, invokes the command surface (approve/reject/injectMessage/
 * interrupt), and uses `provider` directly for conversation-mode turns.
 */
export function startTui({ orch, model, provider }: TuiOptions): { unmount: () => void } {
  const instance = render(React.createElement(App, { orch, model, provider }));
  return { unmount: () => instance.unmount() };
}
