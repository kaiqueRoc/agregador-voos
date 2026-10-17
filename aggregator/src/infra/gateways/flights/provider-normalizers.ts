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
import { normalizeAirline } from "../../../core/entities/airline.js";
import type { LocalDateTime, Offer } from "../../../core/entities/offer.js";
import type { SearchQuery } from "../../../core/entities/search-query.js";

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
type FieldMapper = (record: RawRecord) => RecordFields;

// ---------------------------------------------------------------- validação

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_LOCAL = /^(\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d)(:\d{2}(\.\d+)?)?$/;

function requireField(record: RawRecord, name: string): unknown {
  const value = record[name];
  if (value === undefined || value === null) throw new InvalidRecord(`campo ausente: ${name}`);
  return value;
}

function ensurePositiveCents(cents: number): number {
  if (cents <= 0) throw new InvalidRecord(`preço não positivo: ${cents}`);
  return cents;
}

/** Valor decimal (ex.: 412.88) → centavos. `Math.round` absorve o ruído do float (0.1 + 0.2). */
function decimalToCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidRecord(`preço inválido: ${JSON.stringify(value)}`);
  }
  return ensurePositiveCents(Math.round(value * 100));
}

function parseIntegerCents(value: unknown): number {
  if (!Number.isSafeInteger(value)) {
    throw new InvalidRecord(`amount deveria ser inteiro em centavos: ${JSON.stringify(value)}`);
  }
  return ensurePositiveCents(value as number);
}

/** Sem câmbio confiável, converter seria inventar preço: descarta. */
function requireBrl(value: unknown): void {
  const currency = String(value ?? "?").toUpperCase();
  if (currency !== "BRL") throw new InvalidRecord(`moeda não suportada: ${currency}`);
}

function parseAirline(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InvalidRecord(`companhia inválida: ${JSON.stringify(value)}`);
  }
  return normalizeAirline(value);
}

function parseTime(value: unknown): string {
  if (typeof value !== "string" || !HHMM.test(value)) {
    throw new InvalidRecord(`horário inválido: ${JSON.stringify(value)}`);
  }
  return value;
}

/** ISO com ou sem segundos → "YYYY-MM-DDTHH:MM". */
function parseLocalDateTime(value: unknown): LocalDateTime {
  const match = typeof value === "string" ? ISO_LOCAL.exec(value) : null;
  if (!match?.[1]) throw new InvalidRecord(`data/hora inválida: ${JSON.stringify(value)}`);
  return match[1];
}

function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** HH:MM + data da busca. Chegada <= partida: o voo virou a meia-noite. */
function toDateTimes(day: string, departure: string, arrival: string) {
  const arrivalDay = arrival <= departure ? nextDay(day) : day;
  return { departureAt: `${day}T${departure}`, arrivalAt: `${arrivalDay}T${arrival}` };
}

function listIn(payload: unknown, listField: string): unknown[] {
  const list = (payload as RawRecord | null)?.[listField];
  if (!Array.isArray(list)) throw new ProviderPayloadError(`esperava lista em '${listField}'`);
  return list;
}

function toOffer(item: unknown, ctx: NormalizeContext, toFields: FieldMapper): Offer {
  if (!item || typeof item !== "object") throw new InvalidRecord("registro não é objeto");
  return {
    ...toFields(item as RawRecord),
    provider: ctx.provider,
    origin: ctx.query.origin,
    destination: ctx.query.destination,
    currency: "BRL",
    commissionBps: ctx.commissionBps,
  };
}

/** Motivo do descarte; erro que não é de registro inválido é bug e sobe. */
function discardReason(err: unknown): string {
  if (!(err instanceof InvalidRecord)) throw err;
  return err.message;
}

function normalizeRecords(
  payload: unknown,
  listField: string,
  ctx: NormalizeContext,
  toFields: FieldMapper,
): NormalizationResult {
  const result: NormalizationResult = { offers: [], discarded: [] };
  for (const item of listIn(payload, listField)) {
    try {
      result.offers.push(toOffer(item, ctx, toFields));
    } catch (err) {
      result.discarded.push(discardReason(err));
    }
  }
  return result;
}

// ------------------------------------------------------------------ providers

export const normalizeA: Normalizer = (payload, ctx) =>
  normalizeRecords(payload, "flights", ctx, (record) => {
    const departureAt = parseLocalDateTime(requireField(record, "depart_at"));
    const arrivalAt = parseLocalDateTime(requireField(record, "arrive_at"));
    if (arrivalAt <= departureAt) throw new InvalidRecord("chegada antes da partida");
    return {
      airline: parseAirline(requireField(record, "company")),
      departureAt,
      arrivalAt,
      priceCents: decimalToCents(requireField(record, "price")),
    };
  });

export const normalizeB: Normalizer = (payload, ctx) =>
  normalizeRecords(payload, "results", ctx, (record) => {
    requireBrl(record.currency);
    return {
      airline: parseAirline(requireField(record, "airline_name")),
      ...toDateTimes(
        ctx.query.date,
        parseTime(requireField(record, "departure")),
        parseTime(requireField(record, "arrival")),
      ),
      priceCents: parseIntegerCents(requireField(record, "amount")),
    };
  });

export const normalizeC: Normalizer = (payload, ctx) =>
  normalizeRecords(payload, "data", ctx, (record) => ({
    airline: parseAirline(requireField(record, "carrier")),
    ...toDateTimes(
      ctx.query.date,
      parseTime(requireField(record, "departure_time")),
      parseTime(requireField(record, "arrival_time")),
    ),
    priceCents: decimalToCents(requireField(record, "fare")),
  }));

export const NORMALIZERS: Record<string, Normalizer> = {
  "provider-a": normalizeA,
  "provider-b": normalizeB,
  "provider-c": normalizeC,
};
