/**
 * Ofertas de todos os providers para uma busca: cache primeiro (uma ida ao
 * Redis), depois só os que faltaram, em paralelo. Só sucesso vai para o cache.
 */
import type { OfferCache } from "../cache/offerCache.js";
import type { SearchQuery } from "../domain/types.js";
import * as metrics from "../observability/metrics.js";
import type { CircuitState } from "../resilience/circuitBreaker.js";
import type { ProviderClient, ProviderResult } from "./client.js";

export class ProviderGateway {
  /** Chamadas em andamento por provider+busca (single-flight). */
  private readonly inFlight = new Map<string, Promise<ProviderResult>>();

  constructor(
    private readonly clients: readonly ProviderClient[],
    private readonly cache: OfferCache,
  ) {}

  circuits(): Record<string, CircuitState> {
    return Object.fromEntries(this.clients.map((c) => [c.name, c.breaker.state]));
  }

  async fetchAll(query: SearchQuery): Promise<ProviderResult[]> {
    const cached = await this.cache.getMany(
      this.clients.map((c) => c.name),
      query,
    );

    return Promise.all(
      this.clients.map((client): ProviderResult | Promise<ProviderResult> => {
        const hit = cached.get(client.name);
        if (!hit) return this.fetchShared(client, query);

        metrics.providerRequests.inc({ provider: client.name, status: "cache_hit" });
        // A comissão vem sempre da config atual, nunca do que estava no cache.
        const offers = hit.map((o) => ({ ...o, commissionBps: client.commissionBps }));
        return {
          provider: client.name,
          status: "ok",
          offers,
          latencyMs: 0,
          cached: true,
          discarded: 0,
        };
      }),
    );
  }

  /**
   * Buscas idênticas simultâneas compartilham a mesma chamada ao provider.
   * Sem isso, um pico com cache frio (cache stampede) multiplica a carga.
   */
  private fetchShared(client: ProviderClient, query: SearchQuery): Promise<ProviderResult> {
    const key = `${client.name}:${query.origin}:${query.destination}:${query.date}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const call = client
      .search(query)
      .then(async (result) => {
        if (result.status === "ok") await this.cache.set(client.name, query, result.offers);
        return result;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, call);
    return call;
  }
}
