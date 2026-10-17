/**
 * Modelo canônico. Tudo que vem de fora vira `Offer` na borda (providers/normalizers).
 * Dinheiro em centavos inteiros; comissão em basis points (100 bps = 1%).
 */

export interface SearchQuery {
  origin: string; // IATA, maiúsculo
  destination: string;
  date: string; // YYYY-MM-DD
}

/** Hora local do aeroporto, sem fuso: "2026-10-20T08:00". */
export type LocalDateTime = string;

export interface Offer {
  provider: string;
  airline: string; // nome canônico (domain/airlines)
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
export function flightKey(o: Offer): string {
  return `${o.airline}|${o.origin}|${o.destination}|${o.departureAt}`;
}

/** Quanto a empresa ganha se a oferta for emitida, em centavos (sem arredondar). */
export function commissionCents(o: Offer): number {
  return (o.priceCents * o.commissionBps) / 10_000;
}

export function durationMinutes(o: Offer): number {
  return (Date.parse(`${o.arrivalAt}Z`) - Date.parse(`${o.departureAt}Z`)) / 60_000;
}

/** Comparação por code unit: ao contrário de `localeCompare`, não depende do locale. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
