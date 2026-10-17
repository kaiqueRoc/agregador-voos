import type { SearchOutcome } from "../entities/search-outcome.js";

/** Telemetria de negócio da busca; a implementação fica em infra/telemetry. */
export interface SearchMetrics {
  recordSearch(outcome: SearchOutcome): void;
}
