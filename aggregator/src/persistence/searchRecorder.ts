/**
 * Registro das buscas para analytics. `record()` não devolve promise de
 * propósito: quem chama não espera o banco.
 */
import type { SearchOutcome } from "../services/searchService.js";

export interface SearchRecorder {
  record(outcome: SearchOutcome): void;
  isHealthy(): Promise<boolean>;
  /** Espera as gravações pendentes (graceful shutdown) e libera recursos. */
  close(): Promise<void>;
}

/** Usado com PERSISTENCE_ENABLED=false e nos testes. */
export class NoopSearchRecorder implements SearchRecorder {
  record(): void {}
  async isHealthy(): Promise<boolean> {
    return true;
  }
  async close(): Promise<void> {}
}
