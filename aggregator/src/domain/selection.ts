/**
 * Estratégias (Strategy pattern) para escolher UMA oferta quando vários
 * providers vendem o mesmo voo. A regra e seus trade-offs estão no README.
 */
import type { StrategyName } from "../config.js";
import { commissionCents, compareStrings, type Offer } from "./types.js";

export interface SelectionStrategy {
  readonly name: StrategyName;
  select(offers: readonly Offer[]): Offer;
}

/** Menor preço; empate pelo nome do provider, para a escolha ser determinística. */
export const cheapestFirst = (a: Offer, b: Offer): number =>
  a.priceCents - b.priceCents || compareStrings(a.provider, b.provider);

const mostProfitableFirst = (a: Offer, b: Offer): number =>
  commissionCents(b) - commissionCents(a) || cheapestFirst(a, b);

function first(offers: readonly Offer[], compare: (a: Offer, b: Offer) => number): Offer {
  const [best] = [...offers].sort(compare);
  if (!best) throw new Error("select() chamado sem ofertas");
  return best;
}

export class CheapestStrategy implements SelectionStrategy {
  readonly name = "cheapest" as const;
  select(offers: readonly Offer[]): Offer {
    return first(offers, cheapestFirst);
  }
}

export class MaxCommissionStrategy implements SelectionStrategy {
  readonly name = "max_commission" as const;
  select(offers: readonly Offer[]): Offer {
    return first(offers, mostProfitableFirst);
  }
}

/** Maior comissão entre as ofertas até X% (limitado a R$ Y) acima da mais barata. */
export class BalancedStrategy implements SelectionStrategy {
  readonly name = "balanced" as const;

  constructor(
    private readonly toleranceBps: number,
    private readonly toleranceMaxCents: number,
  ) {}

  /** Preço máximo aceitável: vale o menor entre o limite percentual e o absoluto. */
  ceiling(cheapestCents: number): number {
    const byPercent = Math.floor((cheapestCents * this.toleranceBps) / 10_000);
    return cheapestCents + Math.min(byPercent, this.toleranceMaxCents);
  }

  select(offers: readonly Offer[]): Offer {
    const limit = this.ceiling(first(offers, cheapestFirst).priceCents);
    return first(
      offers.filter((o) => o.priceCents <= limit),
      mostProfitableFirst,
    );
  }
}

export function buildStrategy(cfg: {
  strategy: StrategyName;
  toleranceBps: number;
  toleranceMaxCents: number;
}): SelectionStrategy {
  switch (cfg.strategy) {
    case "cheapest":
      return new CheapestStrategy();
    case "max_commission":
      return new MaxCommissionStrategy();
    case "balanced":
      return new BalancedStrategy(cfg.toleranceBps, cfg.toleranceMaxCents);
  }
}
