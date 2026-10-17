import type { Offer } from "./offer.js";

export type ProviderStatus = "ok" | "error" | "timeout" | "circuit_open";

/** O que cada provider devolveu numa busca. Falha é resultado, não exceção. */
export interface ProviderResult {
  provider: string;
  status: ProviderStatus;
  offers: Offer[];
  latencyMs: number;
  cached: boolean;
  discarded: number;
  error?: string;
}
