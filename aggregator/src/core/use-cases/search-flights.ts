/**
 * Caso de uso "buscar voos": obter as ofertas, consolidar e registrar.
 * Como as ofertas chegam (cache, paralelismo, resiliência) é com o gateway.
 */
import { randomUUID } from "node:crypto";
import { aggregate } from "../entities/aggregated-flight.js";
import type { ProviderResult } from "../entities/provider-result.js";
import type { SearchOutcome } from "../entities/search-outcome.js";
import type { SearchQuery } from "../entities/search-query.js";
import type { SelectionStrategy } from "../entities/selection-strategy.js";
import type { FlightOffersGateway } from "../gateways/flight-offers-gateway.js";
import type { SearchMetrics } from "../gateways/search-metrics.js";
import type { SearchRecorder } from "../repositories/search-recorder.js";

export interface SearchFlightsDeps {
  gateway: FlightOffersGateway;
  strategy: SelectionStrategy;
  recorder: SearchRecorder;
  metrics: SearchMetrics;
}

export class SearchFlightsUseCase {
  constructor(private readonly deps: SearchFlightsDeps) {}

  async execute(query: SearchQuery, requestId?: string): Promise<SearchOutcome> {
    const started = performance.now();
    const providers = await this.deps.gateway.fetchAll(query);
    const outcome: SearchOutcome = {
      ...this.consolidate(query, providers, requestId),
      durationMs: Math.round(performance.now() - started),
    };

    this.deps.metrics.recordSearch(outcome);
    this.deps.recorder.record(outcome); // fire-and-forget: o banco nunca atrasa a resposta
    return outcome;
  }

  private consolidate(
    query: SearchQuery,
    providers: ProviderResult[],
    requestId?: string,
  ): Omit<SearchOutcome, "durationMs"> {
    const failed = providers.filter((p) => p.status !== "ok").length;
    return {
      id: randomUUID(),
      requestId,
      query,
      flights: aggregate(
        providers.flatMap((p) => p.offers),
        this.deps.strategy,
      ),
      providers,
      strategy: this.deps.strategy.name,
      partial: failed > 0,
      unavailable: providers.length > 0 && failed === providers.length,
    };
  }
}
