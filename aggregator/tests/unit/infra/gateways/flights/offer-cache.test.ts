import { describe, expect, it } from "vitest";
import {
  cacheKey,
  RedisOfferCache,
} from "../../../../../src/infra/gateways/flights/offer-cache.js";
import { offer, QUERY } from "../../../../mocks/factories/offer-factory.js";
import { FakeKeyValueStore } from "../../../../mocks/gateways/fake-key-value-store.js";
import { silentLogger } from "../../../../mocks/telemetry/silent-logger.js";

const PROVIDERS = ["provider-a", "provider-b"];

describe("RedisOfferCache", () => {
  it("grava com TTL e lê de volta as mesmas ofertas", async () => {
    const store = new FakeKeyValueStore();
    const cache = new RedisOfferCache(store, 300, silentLogger);
    const offers = [offer({ provider: "provider-a" })];

    await cache.set("provider-a", QUERY, offers);
    const hits = await cache.getMany(PROVIDERS, QUERY);

    expect(store.data.get(cacheKey("provider-a", QUERY))?.ttl).toBe(300);
    expect(hits.get("provider-a")).toEqual(offers);
    expect(hits.has("provider-b")).toBe(false);
  });

  it("chave separa provider, rota e data", () => {
    expect(cacheKey("provider-a", QUERY)).toBe("offers:v2:provider-a:GRU:GIG:2026-10-20");
  });

  it("Redis fora do ar vira cache miss, sem lançar", async () => {
    const store = new FakeKeyValueStore();
    store.failing = true;
    const cache = new RedisOfferCache(store, 300, silentLogger);
    await expect(cache.set("provider-a", QUERY, [offer()])).resolves.toBeUndefined();
    await expect(cache.getMany(PROVIDERS, QUERY)).resolves.toEqual(new Map());
    await expect(cache.isHealthy()).resolves.toBe(false);
  });

  it("entrada corrompida é ignorada", async () => {
    const store = new FakeKeyValueStore();
    store.data.set(cacheKey("provider-a", QUERY), { value: "{não é json", ttl: 300 });
    const cache = new RedisOfferCache(store, 300, silentLogger);
    expect((await cache.getMany(PROVIDERS, QUERY)).size).toBe(0);
  });
});
