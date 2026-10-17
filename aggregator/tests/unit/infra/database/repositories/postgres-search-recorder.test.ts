import { describe, expect, it } from "vitest";
import {
  PostgresSearchRecorder,
  type Statement,
  searchStatements,
} from "../../../../../src/infra/database/repositories/postgres-search-recorder.js";
import { sampleOutcome } from "../../../../mocks/factories/search-outcome-factory.js";
import { FakePool } from "../../../../mocks/repositories/fake-sql-pool.js";
import { silentLogger } from "../../../../mocks/telemetry/silent-logger.js";

const flush = () => new Promise((r) => setTimeout(r, 20));

/** Valor de uma coluna num INSERT gerado, achado pelo NOME (e não pela posição). */
function column(stmt: Statement | undefined, name: string): unknown {
  const names =
    /\(([^)]*)\)/
      .exec(stmt?.text ?? "")?.[1]
      ?.split(",")
      .map((n) => n.trim()) ?? [];
  return stmt?.values[names.indexOf(name)];
}

describe("searchStatements", () => {
  const [search, providers, flights] = searchStatements(sampleOutcome());

  it("grava a busca", () => {
    expect(search?.text).toMatch(/^INSERT INTO searches/);
    expect(column(search, "origin")).toBe("GRU");
    expect(column(search, "partial")).toBe(true);
    expect(column(search, "flights_count")).toBe(2);
  });

  it("grava os providers em lote (um array por coluna)", () => {
    expect(providers?.text).toMatch(/unnest\(\$2::text\[\]/);
    expect(column(providers, "provider")).toEqual(["provider-a", "provider-c"]);
    expect(column(providers, "status")).toEqual(["ok", "timeout"]);
  });

  it("grava a oferta escolhida e a mais barata lado a lado", () => {
    const ids = column(flights, "flight_id") as string[];
    const latam = ids.indexOf("LATAM-GRUGIG-202610200800");
    const at = (name: string) => (column(flights, name) as unknown[])[latam];

    expect(at("offers_compared")).toBe(2);
    expect(at("selected_provider")).toBe("provider-c"); // +1,2% → vale a comissão maior
    expect(at("selected_price_cents")).toBe(101_200);
    expect(at("selected_commission_cents")).toBe(2024); // 2% de R$ 1.012,00
    expect(at("cheapest_provider")).toBe("provider-a");
    expect(at("cheapest_price_cents")).toBe(100_000);
    expect(at("cheapest_commission_cents")).toBe(1000);
  });
});

describe("PostgresSearchRecorder", () => {
  it("grava busca, providers e voos numa transação", async () => {
    const pool = new FakePool();
    new PostgresSearchRecorder(pool, silentLogger).record(sampleOutcome());
    await flush();
    expect(pool.log).toEqual([
      "BEGIN",
      "INSERT INTO searches",
      "INSERT INTO search_providers",
      "INSERT INTO search_flights",
      "COMMIT",
      "release",
    ]);
  });

  it("record() não espera o banco e nunca lança, mesmo com o banco falhando", async () => {
    const pool = new FakePool();
    pool.failOn = /search_flights/;
    const recorder = new PostgresSearchRecorder(pool, silentLogger);
    expect(() => recorder.record(sampleOutcome())).not.toThrow();
    await flush();
    expect(pool.log).toContain("ROLLBACK");
    expect(pool.log).not.toContain("COMMIT");
    expect(recorder.pendingCount).toBe(0);
  });

  it("descarta acima do limite de gravações pendentes (memória limitada)", async () => {
    const pool = new FakePool();
    pool.delayMs = 50;
    const recorder = new PostgresSearchRecorder(pool, silentLogger, 2);
    for (let i = 0; i < 5; i++) recorder.record(sampleOutcome({ id: `id-${i}` }));
    expect(recorder.pendingCount).toBe(2);
    await recorder.close();
    expect(pool.log.filter((l) => l === "INSERT INTO searches")).toHaveLength(2);
  });

  it("close() espera as gravações pendentes antes de fechar o pool", async () => {
    const pool = new FakePool();
    pool.delayMs = 30;
    const recorder = new PostgresSearchRecorder(pool, silentLogger);
    recorder.record(sampleOutcome());
    await recorder.close();
    expect(pool.log).toContain("COMMIT");
    expect(pool.ended).toBe(true);
  });

  it("migração roda sob advisory lock", async () => {
    const pool = new FakePool();
    await new PostgresSearchRecorder(pool, silentLogger).migrate();
    expect(pool.log.slice(0, 2)).toEqual(["BEGIN", "SELECT pg_advisory_xact_lock($1)"]);
    expect(pool.log).toContain("COMMIT");
  });

  it("isHealthy reflete o banco", async () => {
    const pool = new FakePool();
    const recorder = new PostgresSearchRecorder(pool, silentLogger);
    expect(await recorder.isHealthy()).toBe(true);
    pool.failOn = /SELECT 1/;
    expect(await recorder.isHealthy()).toBe(false);
  });
});
