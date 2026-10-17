/**
 * Caso de uso "buscar voos": obter as ofertas, consolidar e registrar.
 * Como as ofertas chegam (cache, paralelismo, resiliência) é com o ProviderGateway.
 */
import { randomUUID } from "node:crypto";
import { type AggregatedFlight, aggregate } from "../domain/aggregation.js";
import type { SelectionStrategy } from "../domain/selection.js";
import { commissionCents, type SearchQuery } from "../domain/types.js";
import * as metrics from "../observability/metrics.js";
import type { SearchRecorder } from "../persistence/searchRecorder.js";
import type { ProviderResult } from "../providers/client.js";
import type { ProviderGateway } from "../providers/gateway.js";

export interface SearchOutcome {
  id: string;
  requestId?: string;
  query: SearchQuery;
  flights: AggregatedFlight[];
  providers: ProviderResult[];
  strategy: SelectionStrategy["name"];
  /** Algum provider falhou: pode haver voos que não apareceram. */
  partial: boolean;
  /** Nenhum provider respondeu: não dá para dizer se há voos. */
  unavailable: boolean;
  durationMs: number;
}

export class SearchService {
  constructor(
    private readonly gateway: ProviderGateway,
    private readonly strategy: SelectionStrategy,
    private readonly recorder: SearchRecorder,
  ) {}

  providerCircuits() {
    return this.gateway.circuits();
  }

  async search(query: SearchQuery, requestId?: string): Promise<SearchOutcome> {
    const started = performance.now();
    const providers = await this.gateway.fetchAll(query);
    const failed = providers.filter((p) => p.status !== "ok").length;

    const outcome: SearchOutcome = {
      id: randomUUID(),
      requestId,
      query,
      flights: aggregate(
        providers.flatMap((p) => p.offers),
        this.strategy,
      ),
      providers,
      strategy: this.strategy.name,
      partial: failed > 0,
      unavailable: providers.length > 0 && failed === providers.length,
      durationMs: Math.round(performance.now() - started),
    };

    recordMetrics(outcome);
    this.recorder.record(outcome); // fire-and-forget: o banco nunca atrasa a resposta
    return outcome;
  }
}

function recordMetrics({ flights, partial, unavailable }: SearchOutcome): void {
  metrics.searchRequests.inc({
    outcome: unavailable ? "failed" : partial ? "partial" : "complete",
  });

  for (const { selected, cheapest, candidates } of flights) {
    metrics.selectedOffers.inc({
      provider: selected.provider,
      contested: String(candidates.length > 1),
    });
    // Quanto a estratégia rendeu a mais, e quanto isso custou ao cliente.
    metrics.commissionUplift.inc(commissionCents(selected) - commissionCents(cheapest));
    metrics.customerPremium.inc(selected.priceCents - cheapest.priceCents);
  }
}
