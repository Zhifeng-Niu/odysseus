export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number) => void;
}

const DEFAULT_SHOULD_RETRY = (_err: unknown): boolean => true;

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true }
    );
  });

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions
): Promise<T> {
  const maxDelay = options.maxDelayMs ?? 30_000;
  const shouldRetry = options.shouldRetry ?? DEFAULT_SHOULD_RETRY;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= options.maxAttempts || !shouldRetry(err)) {
        throw err;
      }
      options.onRetry?.(err, attempt);
      const delay = Math.min(maxDelay, options.baseDelayMs * 2 ** (attempt - 1));
      const jittered = Math.random() * delay;
      await sleep(jittered);
    }
  }
  throw lastErr;
}
