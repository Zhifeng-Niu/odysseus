import { describe, test, expect } from 'vitest';
import {
  selectStrategy,
  ENGINEER_STRATEGY,
  CONVERSATIONAL_DONE_MARKER,
  detectConversationalDone,
} from '../../src/cerebellum/strategy.js';

describe('selectStrategy (Iteration 0: engineer only)', () => {
  test('returns engineer strategy by default', () => {
    const result = selectStrategy({ goal: 'add a tool', allowedStrategies: ['engineer'] });
    expect(result.name).toBe('engineer');
    expect(result.systemPrompt.length).toBeGreaterThan(0);
  });

  test('respects explicit override when allowed', () => {
    const result = selectStrategy({
      goal: 'try something different',
      requestedStrategy: 'engineer',
      allowedStrategies: ['engineer'],
    });
    expect(result.name).toBe('engineer');
  });

  test('falls back to engineer if requested strategy is not in allowed list', () => {
    const result = selectStrategy({
      goal: 'x',
      requestedStrategy: 'creative',
      allowedStrategies: ['engineer'],
    });
    expect(result.name).toBe('engineer');
  });

  test('ENGINEER_STRATEGY has expected shape', () => {
    expect(ENGINEER_STRATEGY.name).toBe('engineer');
    expect(typeof ENGINEER_STRATEGY.systemPrompt).toBe('string');
    // maxIterations is optional — engineer strategy leaves it undefined so
    // the loop runs until DONE / interrupt / conversational stop / loop
    // detector, not an arbitrary iter cap.
    expect(ENGINEER_STRATEGY.maxIterations).toBeUndefined();
  });

  test('ENGINEER_STRATEGY prompt teaches the agent about [CONVERSATIONAL-DONE]', () => {
    // The prompt is the contract. If this assertion fails, the strategy
    // prompt no longer teaches the agent how to end a conversational turn
    // — the orchestrator's detection logic would then dangle.
    expect(ENGINEER_STRATEGY.systemPrompt).toContain(CONVERSATIONAL_DONE_MARKER);
  });
});

describe('detectConversationalDone', () => {
  test('marker alone on its own line at end of reply', () => {
    const result = detectConversationalDone(
      'Hi! I am Odysseus.\n[CONVERSATIONAL-DONE]',
    );
    expect(result.found).toBe(true);
    expect(result.cleanContent).toBe('Hi! I am Odysseus.');
  });

  test('marker at the very start', () => {
    const result = detectConversationalDone(
      '[CONVERSATIONAL-DONE]\nOkay, bye.',
    );
    expect(result.found).toBe(true);
    expect(result.cleanContent).toBe('Okay, bye.');
  });

  test('marker is case-insensitive', () => {
    const result = detectConversationalDone('hi\n[conversational-done]');
    expect(result.found).toBe(true);
    expect(result.cleanContent).toBe('hi');
  });

  test('marker surrounded by extra blank lines collapses cleanly', () => {
    const result = detectConversationalDone(
      'Hello.\n\n\n[CONVERSATIONAL-DONE]\n\n',
    );
    expect(result.found).toBe(true);
    expect(result.cleanContent).toBe('Hello.');
  });

  test('marker mid-sentence does NOT match (avoids false positive)', () => {
    // The agent might discuss the marker in prose ("I will not emit
    // [CONVERSATIONAL-DONE] because this is a code task"). That must NOT
    // trigger detection — the marker has to be on its own line.
    const result = detectConversationalDone(
      'I will now describe the [CONVERSATIONAL-DONE] protocol and how it works.',
    );
    expect(result.found).toBe(false);
    // cleanContent equals input trimmed when marker not found:
    expect(result.cleanContent).toBe(
      'I will now describe the [CONVERSATIONAL-DONE] protocol and how it works.',
    );
  });

  test('empty input returns empty clean content, no detection', () => {
    const result = detectConversationalDone('   ');
    expect(result.found).toBe(false);
    expect(result.cleanContent).toBe('');
  });

  test('marker with trailing whitespace on same line still detected', () => {
    const result = detectConversationalDone(
      'Reply text here.\n[CONVERSATIONAL-DONE]   ',
    );
    expect(result.found).toBe(true);
    expect(result.cleanContent).toBe('Reply text here.');
  });
});
