/** Contrato HTTP público: validação da entrada e formato da saída. */
import { z } from "zod";
import { flightId } from "../domain/aggregation.js";
import { durationMinutes } from "../domain/types.js";
import type { SearchOutcome } from "../services/searchService.js";

const iata = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "código IATA de 3 letras")
  .transform((s) => s.toUpperCase());

const isoDate = z.iso.date("data no formato YYYY-MM-DD");

/** Data de hoje (YYYY-MM-DD) num fuso: às 23h em São Paulo, em UTC já é amanhã. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}

/**
 * Aceita os nomes em inglês e, por conveniência, os do enunciado (origem/destino/data).
 * `today` é injetado para os testes não dependerem do relógio.
 */
export function searchRequestSchema(today: () => string) {
  return z
    .preprocess(
      (body) => {
        if (!body || typeof body !== "object") return body;
        const b = body as Record<string, unknown>;
        return {
          origin: b.origin ?? b.origem,
          destination: b.destination ?? b.destino,
          date: b.date ?? b.data,
        };
      },
      z.object({ origin: iata, destination: iata, date: isoDate }),
    )
    .refine((q) => q.origin !== q.destination, {
      message: "origem e destino devem ser diferentes",
      path: ["destination"],
    })
    .refine((q) => q.date >= today(), {
      message: "data no passado: a busca precisa ser de hoje em diante",
      path: ["date"],
    });
}

const toMoney = (cents: number) => ({ amount: cents / 100, currency: "BRL" as const });

export function toResponse(outcome: SearchOutcome) {
  return {
    query: outcome.query,
    flights: outcome.flights.map((f) => ({
      id: flightId(f),
      airline: f.selected.airline,
      origin: f.selected.origin,
      destination: f.selected.destination,
      departureAt: f.selected.departureAt,
      arrivalAt: f.selected.arrivalAt,
      durationMinutes: durationMinutes(f.selected),
      price: toMoney(f.selected.priceCents),
      provider: f.selected.provider,
      offersCompared: f.candidates.length,
    })),
    meta: {
      total: outcome.flights.length,
      partial: outcome.partial,
      strategy: outcome.strategy,
      durationMs: outcome.durationMs,
      providers: outcome.providers.map((p) => ({
        name: p.provider,
        status: p.status,
        offers: p.offers.length,
        cached: p.cached,
        latencyMs: p.latencyMs,
        discarded: p.discarded,
        ...(p.error ? { error: p.error } : {}),
      })),
    },
  };
}
