/**
 * Grava cada busca no Postgres em background, numa transação, com no máximo
 * `maxPending` gravações em andamento. Acima disso descarta (métrica + log):
 * perder um ponto de analytics é aceitável; acumular memória com o banco lento, não.
 */
import { type AggregatedFlight, flightId } from "../../../core/entities/aggregated-flight.js";
import { commissionCents } from "../../../core/entities/offer.js";
import type { ProviderResult } from "../../../core/entities/provider-result.js";
import type { SearchOutcome } from "../../../core/entities/search-outcome.js";
import type { SearchRecorder } from "../../../core/repositories/search-recorder.js";
import type { Logger } from "../../telemetry/logger/logger.js";
import * as metrics from "../../telemetry/metrics/metrics.js";
import { MIGRATION_LOCK_ID, SCHEMA_SQL } from "../migrations/analytics-schema.js";

/** O pedaço do `pg` que usamos (permite um fake nos testes). */
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}
export interface SqlPool {
  connect(): Promise<SqlClient>;
  query(text: string, values?: unknown[]): Promise<unknown>;
  end(): Promise<void>;
}

export interface Statement {
  text: string;
  values: unknown[];
}

/** [coluna, tipo no Postgres, como extrair o valor]: fonte única de verdade de cada tabela. */
type Column<T> = [name: string, type: string, value: (row: T) => unknown];

const SEARCH_COLUMNS: Column<SearchOutcome>[] = [
  ["id", "uuid", (o) => o.id],
  ["request_id", "text", (o) => o.requestId ?? null],
  ["origin", "text", (o) => o.query.origin],
  ["destination", "text", (o) => o.query.destination],
  ["travel_date", "date", (o) => o.query.date],
  ["strategy", "text", (o) => o.strategy],
  ["partial", "bool", (o) => o.partial],
  ["unavailable", "bool", (o) => o.unavailable],
  ["flights_count", "int", (o) => o.flights.length],
  ["duration_ms", "int", (o) => o.durationMs],
];

const PROVIDER_COLUMNS: Column<ProviderResult>[] = [
  ["provider", "text", (p) => p.provider],
  ["status", "text", (p) => p.status],
  ["offers", "int", (p) => p.offers.length],
  ["discarded", "int", (p) => p.discarded],
  ["cached", "bool", (p) => p.cached],
  ["latency_ms", "int", (p) => p.latencyMs],
];

const FLIGHT_COLUMNS: Column<AggregatedFlight>[] = [
  ["flight_id", "text", flightId],
  ["airline", "text", (f) => f.selected.airline],
  ["departure_at", "timestamp", (f) => f.selected.departureAt],
  ["arrival_at", "timestamp", (f) => f.selected.arrivalAt],
  ["offers_compared", "smallint", (f) => f.candidates.length],
  ["selected_provider", "text", (f) => f.selected.provider],
  ["selected_price_cents", "int", (f) => f.selected.priceCents],
  ["selected_commission_cents", "int", (f) => Math.round(commissionCents(f.selected))],
  ["cheapest_provider", "text", (f) => f.cheapest.provider],
  ["cheapest_price_cents", "int", (f) => f.cheapest.priceCents],
  ["cheapest_commission_cents", "int", (f) => Math.round(commissionCents(f.cheapest))],
];

function insertOne<T>(table: string, columns: Column<T>[], row: T): Statement {
  const params = columns.map((_, i) => `$${i + 1}`).join(", ");
  return {
    text: `INSERT INTO ${table} (${columns.map(([name]) => name).join(", ")}) VALUES (${params})`,
    values: columns.map(([, , value]) => value(row)),
  };
}

/** Insert em lote: um array por coluna + `unnest` (1 comando para N linhas). */
function insertMany<T>(
  table: string,
  columns: Column<T>[],
  searchId: string,
  rows: T[],
): Statement {
  const names = ["search_id", ...columns.map(([name]) => name)].join(", ");
  const arrays = columns.map(([, type], i) => `$${i + 2}::${type}[]`).join(", ");
  return {
    text: `INSERT INTO ${table} (${names}) SELECT $1, * FROM unnest(${arrays})`,
    values: [searchId, ...columns.map(([, , value]) => rows.map(value))],
  };
}

/** Os comandos que gravam uma busca. Função pura. */
export function searchStatements(outcome: SearchOutcome): Statement[] {
  return [
    insertOne("searches", SEARCH_COLUMNS, outcome),
    insertMany("search_providers", PROVIDER_COLUMNS, outcome.id, outcome.providers),
    insertMany("search_flights", FLIGHT_COLUMNS, outcome.id, outcome.flights),
  ];
}

export class PostgresSearchRecorder implements SearchRecorder {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly pool: SqlPool,
    private readonly logger: Logger,
    private readonly maxPending = 200,
  ) {}

  /** Cria/atualiza o schema na subida. O advisory lock evita corrida entre réplicas. */
  migrate(): Promise<void> {
    return this.transaction([
      { text: "SELECT pg_advisory_xact_lock($1)", values: [MIGRATION_LOCK_ID] },
      { text: SCHEMA_SQL, values: [] },
    ]);
  }

  record(outcome: SearchOutcome): void {
    if (this.pending.size >= this.maxPending) {
      metrics.searchesPersisted.inc({ result: "dropped" });
      this.logger.warn({ searchId: outcome.id }, "search_persist_dropped");
      return;
    }
    const job = this.transaction(searchStatements(outcome))
      .then(() => metrics.searchesPersisted.inc({ result: "ok" }))
      .catch((err: unknown) => {
        metrics.searchesPersisted.inc({ result: "error" });
        this.logger.warn({ searchId: outcome.id, err }, "search_persist_failed");
      })
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false; // banco fora é exatamente o que esta checagem responde
    }
  }

  /** Espera as gravações pendentes (graceful shutdown) e fecha o pool. */
  async close(): Promise<void> {
    await Promise.allSettled(this.pending);
    await this.pool.end();
  }

  private async transaction(statements: Statement[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const { text, values } of statements) {
        await client.query(text, values.length ? values : undefined);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch((rollbackErr: unknown) => {
        this.logger.warn({ err: rollbackErr }, "postgres_rollback_failed");
      });
      throw err;
    } finally {
      client.release();
    }
  }
}
