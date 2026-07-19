import { render } from 'ink';
import React from 'react';
import type { CerebellumOrchestrator } from '../cerebellum/orchestrator.js';
import { App } from './app.js';

export interface TuiOptions {
  orch: CerebellumOrchestrator;
  model: string;
}

/**
 * Boot the Ink-rendered TUI. Returns the Ink instance so the caller can
 * `unmount()` on external shutdown signals (rare — Ctrl+C is handled inside).
 *
 * This entry point assumes the caller has already wired `orch` with the
 * correct provider / registry / tracePath. The TUI itself never touches
 * those dependencies directly — it only consumes the event stream and
 * invokes the command surface (approve/reject/injectMessage/interrupt).
 */
export function startTui({ orch, model }: TuiOptions): { unmount: () => void } {
  const instance = render(React.createElement(App, { orch, model }));
  return { unmount: () => instance.unmount() };
}
