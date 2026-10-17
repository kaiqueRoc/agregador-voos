import type { SearchRecorder } from "../../../core/repositories/search-recorder.js";

/** Usado com PERSISTENCE_ENABLED=false e nos testes. */
export class NoopSearchRecorder implements SearchRecorder {
  record(): void {}
  async isHealthy(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}
