import type { SearchOutcome } from "../../../src/core/entities/search-outcome.js";
import type { SearchRecorder } from "../../../src/core/repositories/search-recorder.js";

/** Recorder que só guarda o que recebeu. */
export class FakeSearchRecorder implements SearchRecorder {
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
