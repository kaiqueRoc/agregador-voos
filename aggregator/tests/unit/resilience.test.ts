import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "../../src/resilience/circuitBreaker.js";
import { backoffDelay, retry } from "../../src/resilience/retry.js";

describe("CircuitBreaker", () => {
  const setup = () => {
    let now = 0;
    const changes: string[] = [];
    const breaker = new CircuitBreaker("p", {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      now: () => now,
      onStateChange: (_n, s) => changes.push(s),
    });
    return { breaker, changes, advance: (ms: number) => (now += ms) };
  };

  it("abre após N falhas consecutivas e rejeita na hora", () => {
    const { breaker } = setup();
    for (let i = 0; i < 3; i++) {
      breaker.acquire();
      breaker.recordFailure();
    }
    expect(breaker.state).toBe("open");
    expect(() => breaker.acquire()).toThrow(CircuitOpenError);
  });

  it("sucesso zera o contador de falhas", () => {
    const { breaker } = setup();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.state).toBe("closed");
  });

  it("half-open deixa passar UMA chamada de teste; sucesso fecha", () => {
    const { breaker, advance, changes } = setup();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    advance(1000);
    expect(breaker.state).toBe("half_open");
    breaker.acquire(); // chamada de teste
    expect(() => breaker.acquire()).toThrow(CircuitOpenError); // concorrente barrada
    breaker.recordSuccess();
    expect(breaker.state).toBe("closed");
    expect(changes).toEqual(["open", "half_open", "closed"]);
  });

  it("falha no half-open reabre e reinicia a espera", () => {
    const { breaker, advance } = setup();
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    advance(1000);
    breaker.acquire();
    breaker.recordFailure();
    expect(breaker.state).toBe("open");
    advance(999);
    expect(breaker.state).toBe("open");
    advance(1);
    expect(breaker.state).toBe("half_open");
  });
});

describe("backoffDelay", () => {
  const policy = { maxAttempts: 5, baseDelayMs: 100, maxDelayMs: 800 };

  it("cresce exponencialmente até o teto (com random = 1, o máximo)", () => {
    const max = () => 0.9999999;
    expect([1, 2, 3, 4, 5].map((n) => backoffDelay(policy, n, max))).toEqual([
      99, 199, 399, 799, 799,
    ]);
  });

  it("full jitter: random = 0 dá espera zero", () => {
    expect(backoffDelay(policy, 3, () => 0)).toBe(0);
  });
});

describe("retry", () => {
  const policy = { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 10 };
  const delay = vi.fn(async () => {});

  it("repete erros retentáveis até dar certo", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    const onRetry = vi.fn();
    await expect(retry(fn, { policy, isRetryable: () => true, onRetry, delay })).resolves.toBe(
      "ok",
    );
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it("desiste após maxAttempts", async () => {
    const fn = vi.fn(async () => {
      throw new Error("sempre");
    });
    await expect(retry(fn, { policy, isRetryable: () => true, delay })).rejects.toThrow("sempre");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("não repete erro não retentável", async () => {
    const fn = vi.fn(async () => {
      throw new Error("4xx");
    });
    await expect(retry(fn, { policy, isRetryable: () => false, delay })).rejects.toThrow("4xx");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("não repete depois que o orçamento (signal) acabou", async () => {
    const controller = new AbortController();
    const fn = vi.fn(async () => {
      controller.abort();
      throw new Error("lento");
    });
    await expect(
      retry(fn, { policy, isRetryable: () => true, signal: controller.signal, delay }),
    ).rejects.toThrow("lento");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
