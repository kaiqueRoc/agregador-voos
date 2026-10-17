/** Contrato HTTP público da busca: formato da resposta. */
import { type AggregatedFlight, flightId } from "../../../core/entities/aggregated-flight.js";
import { durationMinutes } from "../../../core/entities/offer.js";
import type { ProviderResult } from "../../../core/entities/provider-result.js";
import type { SearchOutcome } from "../../../core/entities/search-outcome.js";

const toMoney = (cents: number) => ({ amount: cents / 100, currency: "BRL" as const });

function toFlightResponse(flight: AggregatedFlight) {
  const { selected } = flight;
  return {
    id: flightId(flight),
    airline: selected.airline,
    origin: selected.origin,
    destination: selected.destination,
    departureAt: selected.departureAt,
    arrivalAt: selected.arrivalAt,
    durationMinutes: durationMinutes(selected),
    price: toMoney(selected.priceCents),
    provider: selected.provider,
    offersCompared: flight.candidates.length,
  };
}

function toProviderResponse(result: ProviderResult) {
  return {
    name: result.provider,
    status: result.status,
    offers: result.offers.length,
    cached: result.cached,
    latencyMs: result.latencyMs,
    discarded: result.discarded,
    ...(result.error ? { error: result.error } : {}),
  };
}

export function toResponse(outcome: SearchOutcome) {
  return {
    query: outcome.query,
    flights: outcome.flights.map(toFlightResponse),
    meta: {
      total: outcome.flights.length,
      partial: outcome.partial,
      strategy: outcome.strategy,
      durationMs: outcome.durationMs,
      providers: outcome.providers.map(toProviderResponse),
    },
  };
}
