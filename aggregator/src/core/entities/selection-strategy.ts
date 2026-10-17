/**
 * Estratégias (Strategy pattern) para escolher UMA oferta quando vários
 * providers vendem o mesmo voo. A regra e seus trade-offs estão no README.
 */
import { compareStrings } from "../../shared/utils/compare-strings.js";
import { BPS_PER_UNIT, commissionCents, type Offer } from "./offer.js";

export const STRATEGY_NAMES = ["cheapest", "max_commission", "balanced"] as const;
export type StrategyName = (typeof STRATEGY_NAMES)[number];

export interface SelectionStrategy {
  readonly name: StrategyName;
  select(offers: readonly Offer[]): Offer;
}

/** Menor preço; empate pelo nome do provider, para a escolha ser determinística. */
export const cheapestFirst = (a: Offer, b: Offer): number =>
  a.priceCents - b.priceCents || compareStrings(a.provider, b.provider);

const mostProfitableFirst = (a: Offer, b: Offer): number =>
  commissionCents(b) - commissionCents(a) || cheapestFirst(a, b);

/** A primeira oferta na ordem de `compare`, sem ordenar a lista inteira. */
function pickBest(offers: readonly Offer[], compare: (a: Offer, b: Offer) => number): Offer {
  const [head, ...rest] = offers;
  if (!head) throw new Error("select() chamado sem ofertas");
  return rest.reduce((best, offer) => (compare(offer, best) < 0 ? offer : best), head);
}

export class CheapestStrategy implements SelectionStrategy {
  readonly name = "cheapest" as const;
  select(offers: readonly Offer[]): Offer {
    return pickBest(offers, cheapestFirst);
  }
}

export class MaxCommissionStrategy implements SelectionStrategy {
  readonly name = "max_commission" as const;
  select(offers: readonly Offer[]): Offer {
    return pickBest(offers, mostProfitableFirst);
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
    const byPercent = Math.floor((cheapestCents * this.toleranceBps) / BPS_PER_UNIT);
    return cheapestCents + Math.min(byPercent, this.toleranceMaxCents);
  }

  select(offers: readonly Offer[]): Offer {
    const limit = this.ceiling(pickBest(offers, cheapestFirst).priceCents);
    const affordable = offers.filter((offer) => offer.priceCents <= limit);
    return pickBest(affordable, mostProfitableFirst);
  }
}

export function buildStrategy(selection: {
  strategy: StrategyName;
  toleranceBps: number;
  toleranceMaxCents: number;
}): SelectionStrategy {
  switch (selection.strategy) {
    case "cheapest":
      return new CheapestStrategy();
    case "max_commission":
      return new MaxCommissionStrategy();
    case "balanced":
      return new BalancedStrategy(selection.toleranceBps, selection.toleranceMaxCents);
  }
}
