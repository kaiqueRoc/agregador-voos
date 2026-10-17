/**
 * Integração com Postgres DE VERDADE: schema, inserts com unnest e a view de
 * analytics. Roda só com TEST_DATABASE_URL definido (a CI sobe um Postgres;
 * localmente: `make up` (ou `docker compose -f docker/docker-compose.yml up -d postgres`) e
 * `TEST_DATABASE_URL=postgres://aggregator:aggregator@localhost:5433/aggregator npm test`).
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresSearchRecorder } from "../../src/infra/database/repositories/postgres-search-recorder.js";
import { sampleOutcome } from "../mocks/factories/search-outcome-factory.js";
import { silentLogger } from "../mocks/telemetry/silent-logger.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("Postgres real", () => {
  let pool: pg.Pool;
  let recorder: PostgresSearchRecorder;
  const id = crypto.randomUUID();

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    recorder = new PostgresSearchRecorder(pool, silentLogger);
    await recorder.migrate();
    await recorder.migrate(); // idempotente
  });

  afterAll(async () => {
    await pool.query("DELETE FROM searches WHERE id = $1", [id]);
    await recorder.close();
  });

  it("grava a busca e a view calcula a economia da estratégia", async () => {
    recorder.record(sampleOutcome({ id }));
    await new Promise((r) => setTimeout(r, 300));

    const providers = await pool.query(
      "SELECT provider, status FROM search_providers WHERE search_id = $1 ORDER BY provider",
      [id],
    );
    expect(providers.rows).toEqual([
      { provider: "provider-a", status: "ok" },
      { provider: "provider-c", status: "timeout" },
    ]);

    const econ = await pool.query(
      `SELECT flight_id, switched, customer_premium_cents, commission_uplift_cents
         FROM flight_selection_economics
        WHERE search_id = $1 AND flight_id LIKE 'LATAM%'`,
      [id],
    );
    expect(econ.rows[0]).toEqual({
      flight_id: "LATAM-GRUGIG-202610200800",
      switched: true,
      customer_premium_cents: 1200, // cliente pagou R$ 12 a mais
      commission_uplift_cents: 1024, // empresa ganhou R$ 10,24 a mais
    });
  });
});
