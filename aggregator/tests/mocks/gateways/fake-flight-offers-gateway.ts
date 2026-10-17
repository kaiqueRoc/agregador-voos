import type { ProviderResult } from "../../../src/core/entities/provider-result.js";
import type {
  CircuitState,
  FlightOffersGateway,
} from "../../../src/core/gateways/flight-offers-gateway.js";

/** Gateway que devolve resultados fixos, sem rede. */
export class FakeFlightOffersGateway implements FlightOffersGateway {
  constructor(
    private readonly results: ProviderResult[] = [],
    private readonly states: Record<string, CircuitState> = {},
  ) {}

  async fetchAll(): Promise<ProviderResult[]> {
    return this.results;
  }

  circuits(): Record<string, CircuitState> {
    return this.states;
  }
}

export function providerResult(overrides: Partial<ProviderResult> = {}): ProviderResult {
  return {
    provider: "provider-a",
    status: "ok",
    offers: [],
    latencyMs: 10,
    cached: false,
    discarded: 0,
    ...overrides,
  };
}
