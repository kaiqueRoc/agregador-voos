import type { KeyValueStore } from "../src/cache/offerCache.js";
import { aggregate } from "../src/domain/aggregation.js";
import { BalancedStrategy } from "../src/domain/selection.js";
import type { Offer, SearchQuery } from "../src/domain/types.js";
import type { Logger } from "../src/observability/logger.js";
import type { SearchRecorder } from "../src/persistence/searchRecorder.js";
import type { SearchOutcome } from "../src/services/searchService.js";

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };

export const QUERY: SearchQuery = { origin: "GRU", destination: "GIG", date: "2026-10-20" };

export const COMMISSION_BPS: Record<string, number> = {
  "provider-a": 100,
  "provider-b": 150,
  "provider-c": 200,
};

export function offer(overrides: Partial<Offer> = {}): Offer {
  const provider = overrides.provider ?? "provider-a";
  return {
    provider,
    airline: "LATAM",
    origin: "GRU",
    destination: "GIG",
    departureAt: "2026-10-20T08:00",
    arrivalAt: "2026-10-20T11:10",
    priceCents: 100_000,
    currency: "BRL",
    commissionBps: COMMISSION_BPS[provider] ?? 100,
    ...overrides,
  };
}

/** Redis em memória com o mesmo contrato que usamos do ioredis. */
export class FakeStore implements KeyValueStore {
  readonly data = new Map<string, { value: string; ttl: number }>();
  failing = false;

  async mget(...keys: string[]) {
    if (this.failing) throw new Error("redis down");
    return keys.map((k) => this.data.get(k)?.value ?? null);
  }
  async set(key: string, value: string, _mode: "EX", seconds: number) {
    if (this.failing) throw new Error("redis down");
    this.data.set(key, { value, ttl: seconds });
    return "OK";
  }
  async ping() {
    if (this.failing) throw new Error("redis down");
    return "PONG";
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** fetch que nunca responde, mas respeita o AbortSignal — simula provider pendurado. */
export const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });

/** Recorder que só guarda o que recebeu. */
export class FakeRecorder implements SearchRecorder {
  readonly outcomes: SearchOutcome[] = [];
  healthy = true;
  record(outcome: SearchOutcome): void {
    this.outcomes.push(outcome);
  }
  async isHealthy() {
    return this.healthy;
  }
  async close() {}
}

/** Resultado de busca realista: LATAM vendido por A e C (C escolhido), GOL só no B, C em timeout. */
export function sampleOutcome(overrides: Partial<SearchOutcome> = {}): SearchOutcome {
  const offers = [
    offer({ provider: "provider-a", priceCents: 100_000 }),
    offer({ provider: "provider-c", priceCents: 101_200 }),
    offer({ provider: "provider-b", airline: "GOL", priceCents: 50_000 }),
  ];
  return {
    id: "8f0e3a1c-0000-4000-8000-000000000001",
    requestId: "req-1",
    query: QUERY,
    flights: aggregate(offers, new BalancedStrategy(200, 3000)),
    providers: [
      {
        provider: "provider-a",
        status: "ok",
        offers: offers.slice(0, 1),
        latencyMs: 120,
        cached: false,
        discarded: 0,
      },
      {
        provider: "provider-c",
        status: "timeout",
        offers: [],
        latencyMs: 3000,
        cached: false,
        discarded: 0,
      },
    ],
    strategy: "balanced",
    partial: true,
    unavailable: false,
    durationMs: 3001,
    ...overrides,
  };
}
