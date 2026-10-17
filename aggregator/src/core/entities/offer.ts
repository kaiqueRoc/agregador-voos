/**
 * Modelo canônico. Tudo que vem de fora vira `Offer` na borda (infra/gateways/flights).
 * Dinheiro em centavos inteiros; comissão em basis points (100 bps = 1%).
 */

/** 100% em basis points. */
export const BPS_PER_UNIT = 10_000;

/** Hora local do aeroporto, sem fuso: "2026-10-20T08:00". */
export type LocalDateTime = string;

export interface Offer {
  provider: string;
  airline: string; // nome canônico (core/entities/airline)
  origin: string;
  destination: string;
  departureAt: LocalDateTime;
  arrivalAt: LocalDateTime;
  priceCents: number;
  currency: "BRL";
  commissionBps: number;
}

/**
 * Identidade do voo físico. Os providers não expõem número de voo: o mesmo
 * voo é a mesma companhia, rota e horário de partida.
 */
export function flightKey(offer: Offer): string {
  return `${offer.airline}|${offer.origin}|${offer.destination}|${offer.departureAt}`;
}

/** Quanto a empresa ganha se a oferta for emitida, em centavos (sem arredondar). */
export function commissionCents(offer: Offer): number {
  return (offer.priceCents * offer.commissionBps) / BPS_PER_UNIT;
}

/** Os horários são locais e sem fuso: o "Z" só serve para medir a diferença. */
export function durationMinutes(offer: Offer): number {
  return (Date.parse(`${offer.arrivalAt}Z`) - Date.parse(`${offer.departureAt}Z`)) / 60_000;
}
