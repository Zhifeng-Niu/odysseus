import { describe, test, expect, vi } from 'vitest';
import { withRetry, sleep } from '../../src/llm/retry.js';

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

  test('caps delay at maxDelayMs', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    await expect(
      withRetry(fn, { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 50 })
    ).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(4);
  });

  test('invokes onRetry callback between attempts', async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockResolvedValueOnce('ok');

    await withRetry(fn, {
      maxAttempts: 3,
      baseDelayMs: 1,
      onRetry,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    const [err, attempt] = onRetry.mock.calls[0]!;
    expect((err as Error).message).toBe('fail-1');
    expect(attempt).toBe(1);
  });

  test('sleep rejects synchronously when signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('pre-cancelled'));
    await expect(sleep(1000, controller.signal)).rejects.toThrow('pre-cancelled');
  });

  test('sleep removes abort listener after timer fires', async () => {
    const controller = new AbortController();
    const spy = vi.spyOn(controller.signal, 'removeEventListener');
    await sleep(5, controller.signal);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
