import type { SearchOutcome } from "../../../src/core/entities/search-outcome.js";
import type { SearchMetrics } from "../../../src/core/gateways/search-metrics.js";

export class FakeSearchMetrics implements SearchMetrics {
  readonly recorded: SearchOutcome[] = [];
  recordSearch(outcome: SearchOutcome): void {
    this.recorded.push(outcome);
  }
}
