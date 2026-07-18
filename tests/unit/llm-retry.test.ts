import { describe, test, expect, vi } from 'vitest';
import { withRetry } from '../../src/llm/retry.js';

describe('withRetry', () => {
  test('returns value on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on failure then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('throws after max attempts', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('permanent'));
    await expect(withRetry(fn, { maxAttempts: 2, baseDelayMs: 1 })).rejects.toThrow('permanent');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('does not retry when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('non-retryable'));
    await expect(
      withRetry(fn, {
        maxAttempts: 3,
        baseDelayMs: 1,
        shouldRetry: (err) => !err.message.includes('non-retryable'),
      })
    ).rejects.toThrow('non-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
