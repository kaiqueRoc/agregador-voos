/**
 * Retry com backoff exponencial e full jitter. O limite de tempo vem de fora,
 * pelo `signal`: abortado, não há nova tentativa.
 */
import { setTimeout as sleep } from "node:timers/promises";

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** Uniforme em [0, min(max, base·2^(n-1))]: espalha as retentativas em vez de sincronizá-las. */
export function backoffDelay(policy: RetryPolicy, attempt: number, random = Math.random): number {
  const cap = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.floor(random() * cap);
}

export interface RetryOptions {
  policy: RetryPolicy;
  isRetryable: (err: unknown) => boolean;
  signal?: AbortSignal;
  onRetry?: (attempt: number, err: unknown) => void;
  delay?: (ms: number, signal?: AbortSignal) => Promise<unknown>;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const delay = opts.delay ?? ((ms, signal) => sleep(ms, undefined, { signal }));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const exhausted = attempt >= opts.policy.maxAttempts;
      if (exhausted || opts.signal?.aborted || !opts.isRetryable(err)) throw err;
      opts.onRetry?.(attempt, err);
      await delay(backoffDelay(opts.policy, attempt), opts.signal);
    }
  }
}
