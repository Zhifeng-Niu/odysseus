const DEFAULT_SHOULD_RETRY = (_err) => true;
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
        reject(signal.reason ?? new Error('aborted'));
        return;
    }
    const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('aborted'));
    };
    const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
});
export async function withRetry(fn, options) {
    const maxDelay = options.maxDelayMs ?? 30_000;
    const shouldRetry = options.shouldRetry ?? DEFAULT_SHOULD_RETRY;
    let lastErr;
    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
        try {
            return await fn(attempt);
        }
        catch (err) {
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
//# sourceMappingURL=retry.js.map