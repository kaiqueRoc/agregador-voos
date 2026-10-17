/**
 * Registro das buscas para analytics. `record()` não devolve promise de
 * propósito: quem chama não espera o banco.
 */
import type { SearchOutcome } from "../entities/search-outcome.js";
import type { HealthCheck } from "../gateways/health-check.js";

export interface SearchRecorder extends HealthCheck {
  record(outcome: SearchOutcome): void;
  /** Espera as gravações pendentes (graceful shutdown) e libera recursos. */
  close(): Promise<void>;
}
