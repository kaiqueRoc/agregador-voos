/** Consolidação: agrupa as ofertas do mesmo voo, escolhe uma e ordena. */
import { compareStrings } from "../../shared/utils/compare-strings.js";
import { flightKey, type Offer } from "./offer.js";
import { cheapestFirst, type SelectionStrategy } from "./selection-strategy.js";

export interface AggregatedFlight {
  selected: Offer;
  cheapest: Offer;
  /** Todas as ofertas do voo, da mais barata à mais cara. */
  candidates: Offer[];
}

/** Identificador estável e legível: `LATAM-GRUGIG-202610200800`. */
export function flightId({ selected }: AggregatedFlight): string {
  const departure = selected.departureAt.replace(/\D/g, "");
  return `${selected.airline}-${selected.origin}${selected.destination}-${departure}`;
}

/**
 * Ordem total: preço exibido, partida, companhia, provider. Os dois últimos só
 * desempatam, para buscas idênticas devolverem sempre a mesma lista.
 */
function compareFlights({ selected: a }: AggregatedFlight, { selected: b }: AggregatedFlight) {
  return (
    a.priceCents - b.priceCents ||
    compareStrings(a.departureAt, b.departureAt) ||
    compareStrings(a.airline, b.airline) ||
    compareStrings(a.provider, b.provider)
  );
}

export function aggregate(offers: Offer[], strategy: SelectionStrategy): AggregatedFlight[] {
  const groups = Map.groupBy(offers, flightKey);
  return [...groups.values()]
    .map((group) => {
      const candidates = group.toSorted(cheapestFirst);
      return { selected: strategy.select(group), cheapest: candidates[0] as Offer, candidates };
    })
    .sort(compareFlights);
}
