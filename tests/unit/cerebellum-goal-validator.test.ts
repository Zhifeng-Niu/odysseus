import { describe, test, expect } from 'vitest';
import { validateGoal } from '../../src/cerebellum/goal-validator.js';

describe('goal-validator', () => {
  describe('rejects conversational goals', () => {
    const conversational = [
      'hi',
      'hello there',
      'hey',
      '你好',
      '嗨',
      'who are you?',
      "what's your name?",
      '你是谁',
      '你叫什么',
      "what's the weather like?",
      'tell me a joke',
      'how are you doing?',
      'thanks!',
      'thank you',
      '谢谢',
      'bye',
      'goodbye',
      '再见',
    ];
    for (const goal of conversational) {
      test(`rejects: ${JSON.stringify(goal)}`, () => {
        const result = validateGoal(goal);
        expect(result.valid).toBe(false);
        expect(result.reason).toBeDefined();
      });
    }
  });

  describe('rejects informational questions', () => {
    const questions = [
      'what can you do?',
      'how does the orchestrator work?',
      'how to use this program?',
      'why is this happening?',
      'explain how the verify gate works',
      'what is a waypoint?',
      'when does the voyage stop?',
      'where is the config file?',
      '如何使用这个工具',
      '为什么会这样',
      '是什么意思',
      '你能做什么',
      '请问怎么用',
    ];
    for (const goal of questions) {
      test(`rejects question: ${JSON.stringify(goal)}`, () => {
        const result = validateGoal(goal);
        expect(result.valid).toBe(false);
        expect(result.reason).toBeDefined();
      });
    }
  });

  describe('accepts coding goals', () => {
    const coding = [
      'add a file with const v = 1',
      'fix the bug in the parser',
      'refactor the orchestrator loop',
      'remove the dead code in utils',
      'update the README',
      'implement feature X',
      '添加去重逻辑',
      '修复 bug',
      'create a new tool',
      'delete the old config',
      'rename the function',
      'wire the new module into the registry',
      'build the dist folder',
      'test the validator',
      'configure tsconfig',
    ];
    for (const goal of coding) {
      test(`accepts: ${JSON.stringify(goal)}`, () => {
        const result = validateGoal(goal);
        expect(result.valid).toBe(true);
      });
    }
  });

  describe('accepts mixed goals (greeting + action)', () => {
    const mixed = [
      'hi, can you add a file?',
      'hello, please fix the bug',
      '你好，请帮我添加一个文件',
    ];
    for (const goal of mixed) {
      test(`accepts mixed: ${JSON.stringify(goal)}`, () => {
        // Action verb present → must NOT be rejected as conversational,
        // even though it opens with a greeting.
        const result = validateGoal(goal);
        expect(result.valid).toBe(true);
      });
    }
  });

  describe('edge cases', () => {
    test('rejects empty goal', () => {
      expect(validateGoal('').valid).toBe(false);
      expect(validateGoal('   ').valid).toBe(false);
    });

    test('lets unknown intent through (conservative)', () => {
      // No action verb, no conversational pattern — don't block it; let the
      // reactive heuristic in the orchestrator decide.
      expect(validateGoal('the sky is blue').valid).toBe(true);
      expect(validateGoal('random musings about life').valid).toBe(true);
    });
  });
});
