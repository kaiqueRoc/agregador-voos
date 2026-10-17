import { aggregate } from "../../../src/core/entities/aggregated-flight.js";
import type { SearchOutcome } from "../../../src/core/entities/search-outcome.js";
import { BalancedStrategy } from "../../../src/core/entities/selection-strategy.js";
import { offer, QUERY } from "./offer-factory.js";

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
