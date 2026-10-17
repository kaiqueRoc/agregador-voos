import { commissionCents } from "../../../core/entities/offer.js";
import type { SearchOutcome } from "../../../core/entities/search-outcome.js";
import type { SearchMetrics } from "../../../core/gateways/search-metrics.js";
import * as metrics from "./metrics.js";

/**
 * Contadores Prometheus só sobem: valor negativo lançaria erro dentro da busca.
 * Uma estratégia que escolha comissão menor conta 0 de ganho, sem derrubar a resposta.
 */
const nonNegative = (value: number) => Math.max(0, value);

export class PrometheusSearchMetrics implements SearchMetrics {
  recordSearch(outcome: SearchOutcome): void {
    metrics.searchRequests.inc({ outcome: completenessLabel(outcome) });

    for (const { selected, cheapest, candidates } of outcome.flights) {
      metrics.selectedOffers.inc({
        provider: selected.provider,
        contested: String(candidates.length > 1),
      });
      // Quanto a estratégia rendeu a mais, e quanto isso custou ao cliente.
      metrics.commissionUplift.inc(
        nonNegative(commissionCents(selected) - commissionCents(cheapest)),
      );
      metrics.customerPremium.inc(nonNegative(selected.priceCents - cheapest.priceCents));
    }
  }
}

function completenessLabel({ partial, unavailable }: SearchOutcome): string {
  if (unavailable) return "failed";
  return partial ? "partial" : "complete";
}
