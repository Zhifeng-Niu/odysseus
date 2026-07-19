import { describe, test, expect } from 'vitest';
import { selectStrategy, ENGINEER_STRATEGY } from '../../src/cerebellum/strategy.js';

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
});
