import type { AggregatedFlight } from "./aggregated-flight.js";
import type { ProviderResult } from "./provider-result.js";
import type { SearchQuery } from "./search-query.js";
import type { StrategyName } from "./selection-strategy.js";

export interface SearchOutcome {
  id: string;
  requestId?: string;
  query: SearchQuery;
  flights: AggregatedFlight[];
  providers: ProviderResult[];
  strategy: StrategyName;
  /** Algum provider falhou: pode haver voos que não apareceram. */
  partial: boolean;
  /** Nenhum provider respondeu: não dá para dizer se há voos. */
  unavailable: boolean;
  durationMs: number;
}
