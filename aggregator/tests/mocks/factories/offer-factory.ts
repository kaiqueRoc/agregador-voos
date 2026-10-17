import type { Offer } from "../../../src/core/entities/offer.js";
import type { SearchQuery } from "../../../src/core/entities/search-query.js";

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
