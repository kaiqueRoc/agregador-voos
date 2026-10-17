/**
 * Anti-corruption layer: o contrato legado de cada provider vira `Offer`.
 *
 * | provider | lista   | companhia    | preço               | horários                    |
 * |----------|---------|--------------|---------------------|-----------------------------|
 * | A        | flights | company      | price (reais)       | depart_at/arrive_at ISO     |
 * | B        | results | airline_name | amount (centavos)   | departure/arrival HH:MM     |
 * | C        | data    | carrier      | fare (reais)        | departure_time/arrival_time |
 *
 * Registro inválido é descartado sozinho (com o motivo); lista ausente invalida
 * a resposta inteira (`ProviderPayloadError`).
 */
import { normalizeAirline } from "../domain/airlines.js";
import type { LocalDateTime, Offer, SearchQuery } from "../domain/types.js";

export class ProviderPayloadError extends Error {
  override name = "ProviderPayloadError";
}

class InvalidRecord extends Error {}

export interface NormalizeContext {
  query: SearchQuery;
  provider: string;
  commissionBps: number;
}

export interface NormalizationResult {
  offers: Offer[];
  discarded: string[]; // motivo de cada registro descartado
}

export type Normalizer = (payload: unknown, ctx: NormalizeContext) => NormalizationResult;

type RawRecord = Record<string, unknown>;
type RecordFields = Pick<Offer, "airline" | "departureAt" | "arrivalAt" | "priceCents">;

// ---------------------------------------------------------------- validação

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_LOCAL = /^(\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d)(:\d{2}(\.\d+)?)?$/;

function required(r: RawRecord, name: string): unknown {
  if (r[name] === undefined || r[name] === null) throw new InvalidRecord(`campo ausente: ${name}`);
  return r[name];
}

function positiveCents(cents: number): number {
  if (cents <= 0) throw new InvalidRecord(`preço não positivo: ${cents}`);
  return cents;
}

/** `Math.round` absorve o ruído binário do float (0.1 + 0.2). */
function reaisToCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidRecord(`preço inválido: ${JSON.stringify(value)}`);
  }
  return positiveCents(Math.round(value * 100));
}

function airline(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidRecord(`companhia inválida: ${JSON.stringify(value)}`);
  }
  return normalizeAirline(value);
}

function hhmm(value: unknown): string {
  if (typeof value !== "string" || !HHMM.test(value)) {
    throw new InvalidRecord(`horário inválido: ${JSON.stringify(value)}`);
  }
  return value;
}

/** ISO com ou sem segundos → "YYYY-MM-DDTHH:MM". */
function isoMinutes(value: unknown): LocalDateTime {
  const match = typeof value === "string" ? ISO_LOCAL.exec(value) : null;
  if (!match?.[1]) throw new InvalidRecord(`data/hora inválida: ${JSON.stringify(value)}`);
  return match[1];
}

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** HH:MM + data da busca. Chegada <= partida: o voo virou a meia-noite. */
function toDateTimes(day: string, departure: string, arrival: string) {
  const arrivalDay = arrival <= departure ? nextDay(day) : day;
  return { departureAt: `${day}T${departure}`, arrivalAt: `${arrivalDay}T${arrival}` };
}

function normalizeRecords(
  payload: unknown,
  listField: string,
  ctx: NormalizeContext,
  toFields: (r: RawRecord) => RecordFields,
): NormalizationResult {
  const list = (payload as RawRecord | null)?.[listField];
  if (!Array.isArray(list)) throw new ProviderPayloadError(`esperava lista em '${listField}'`);

  const result: NormalizationResult = { offers: [], discarded: [] };
  for (const item of list) {
    try {
      if (!item || typeof item !== "object") throw new InvalidRecord("registro não é objeto");
      result.offers.push({
        ...toFields(item as RawRecord),
        provider: ctx.provider,
        origin: ctx.query.origin,
        destination: ctx.query.destination,
        currency: "BRL",
        commissionBps: ctx.commissionBps,
      });
    } catch (err) {
      if (!(err instanceof InvalidRecord)) throw err;
      result.discarded.push(err.message);
    }
  }
  return result;
}

// ------------------------------------------------------------------ providers

export const normalizeA: Normalizer = (payload, ctx) =>
  normalizeRecords(payload, "flights", ctx, (r) => {
    const departureAt = isoMinutes(required(r, "depart_at"));
    const arrivalAt = isoMinutes(required(r, "arrive_at"));
    if (arrivalAt <= departureAt) throw new InvalidRecord("chegada antes da partida");
    return {
      airline: airline(required(r, "company")),
      departureAt,
      arrivalAt,
      priceCents: reaisToCents(required(r, "price")),
    };
  });

export const normalizeB: Normalizer = (payload, ctx) =>
  normalizeRecords(payload, "results", ctx, (r) => {
    // Sem câmbio confiável, converter seria inventar preço: descarta.
    const currency = String(r.currency ?? "?").toUpperCase();
    if (currency !== "BRL") throw new InvalidRecord(`moeda não suportada: ${currency}`);

    const amount = required(r, "amount");
    if (!Number.isSafeInteger(amount)) {
      throw new InvalidRecord(`amount deveria ser inteiro em centavos: ${JSON.stringify(amount)}`);
    }
    return {
      airline: airline(required(r, "airline_name")),
      ...toDateTimes(ctx.query.date, hhmm(required(r, "departure")), hhmm(required(r, "arrival"))),
      priceCents: positiveCents(amount as number),
    };
  });

export const normalizeC: Normalizer = (payload, ctx) =>
  normalizeRecords(payload, "data", ctx, (r) => ({
    airline: airline(required(r, "carrier")),
    ...toDateTimes(
      ctx.query.date,
      hhmm(required(r, "departure_time")),
      hhmm(required(r, "arrival_time")),
    ),
    priceCents: reaisToCents(required(r, "fare")),
  }));

export const NORMALIZERS: Record<string, Normalizer> = {
  "provider-a": normalizeA,
  "provider-b": normalizeB,
  "provider-c": normalizeC,
};
