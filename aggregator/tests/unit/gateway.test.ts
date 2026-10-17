import { describe, expect, it, vi } from "vitest";
import { RedisOfferCache } from "../../src/cache/offerCache.js";
import { ProviderClient } from "../../src/providers/client.js";
import { ProviderGateway } from "../../src/providers/gateway.js";
import { normalizeA } from "../../src/providers/normalizers.js";
import { CircuitBreaker } from "../../src/resilience/circuitBreaker.js";
import { FakeStore, jsonResponse, offer, QUERY, silentLogger } from "../helpers.js";

function clientWith(commissionBps: number, fetchImpl: typeof fetch) {
  return new ProviderClient({
    config: { name: "provider-a", url: "http://a/search", enabled: true, commissionBps },
    normalizer: normalizeA,
    breaker: new CircuitBreaker("provider-a", { failureThreshold: 5, resetTimeoutMs: 30_000 }),
    timeoutMs: 1000,
    retryPolicy: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    logger: silentLogger,
    fetch: fetchImpl,
  });
}

describe("ProviderGateway", () => {
  it("cache hit não chama o provider e usa a comissão ATUAL da config", async () => {
    const cache = new RedisOfferCache(new FakeStore(), 300, silentLogger);
    await cache.set("provider-a", QUERY, [offer({ provider: "provider-a", commissionBps: 100 })]);

    const fetchMock = vi.fn<typeof fetch>();
    const [result] = await new ProviderGateway([clientWith(175, fetchMock)], cache).fetchAll(QUERY);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ cached: true, status: "ok" });
    expect(result?.offers[0]?.commissionBps).toBe(175);
  });

  it("só grava no cache o que deu certo", async () => {
    const store = new FakeStore();
    const cache = new RedisOfferCache(store, 300, silentLogger);
    const failing = clientWith(100, async () => jsonResponse({}, 500));
    await new ProviderGateway([failing], cache).fetchAll(QUERY);
    expect(store.data.size).toBe(0);
  });

  it("expõe o estado dos circuitos", () => {
    const gateway = new ProviderGateway(
      [clientWith(100, vi.fn())],
      new RedisOfferCache(new FakeStore(), 300, silentLogger),
    );
    expect(gateway.circuits()).toEqual({ "provider-a": "closed" });
  });
});
