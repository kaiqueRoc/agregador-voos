import type { ProviderResult } from "../entities/provider-result.js";
import type { SearchQuery } from "../entities/search-query.js";

export type CircuitState = "closed" | "open" | "half_open";

/** Ofertas de todos os providers de voos para uma busca. */
export interface FlightOffersGateway {
  fetchAll(query: SearchQuery): Promise<ProviderResult[]>;
  /** Estado do circuit breaker de cada provider. */
  circuits(): Record<string, CircuitState>;
}
