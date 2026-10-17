/**
 * E2E contra a stack DE VERDADE (mocks originais, Redis, Postgres), via HTTP.
 * Só roda com E2E_BASE_URL definido:
 *
 *   E2E_BASE_URL=http://localhost:8000 npm run test:e2e        # stack local
 *   E2E_BASE_URL=http://<ip-da-vm>:8000 npm run test:e2e       # deploy
 */
import { describe, expect, it } from "vitest";

const BASE = process.env.E2E_BASE_URL?.replace(/\/$/, "");

// Data única por execução: a primeira busca nunca vem do cache.
const day = new Date(Date.now() + (60 + Math.floor(Math.random() * 300)) * 86_400_000);
const QUERY = { origin: "GRU", destination: "GIG", date: day.toISOString().slice(0, 10) };

interface SearchBody {
  flights: {
    provider: string;
    offersCompared: number;
    price: { amount: number; currency: string };
  }[];
  meta: {
    total: number;
    partial: boolean;
    providers: { name: string; status: string; cached: boolean; discarded: number }[];
  };
  details?: Record<string, unknown>;
}

async function search(body: unknown): Promise<{ status: number; body: SearchBody }> {
  const res = await fetch(`${BASE}/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as SearchBody };
}

describe.skipIf(!BASE)(`stack em ${BASE}`, () => {
  it("está de pé, com Redis e Postgres conectados", async () => {
    expect((await fetch(`${BASE}/health`)).status).toBe(200);
    const ready = await (await fetch(`${BASE}/ready`)).json();
    expect(ready).toMatchObject({ redis: "up", database: "up" });
  });

  it("consulta os 3 providers, consolida em 60 voos e descarta os registros sujos", async () => {
    const { status, body } = await search(QUERY); // data inédita: nada vem do cache
    expect(status).toBe(200);

    const providers = Object.fromEntries(body.meta.providers.map((p) => [p.name, p]));
    expect(Object.keys(providers)).toEqual(["provider-a", "provider-b", "provider-c"]);

    // Com chaos ligado algum provider pode falhar; sem chaos, a busca é completa.
    if (!body.meta.partial) expect(body.meta.total).toBe(60);
    // Os mocks enviam 1 tarifa em USD (B) e 1 tarifa zerada (C) por busca.
    for (const name of ["provider-b", "provider-c"]) {
      if (providers[name]?.status === "ok") expect(providers[name]?.discarded).toBe(1);
    }
  });

  it("ordena por preço e devolve a mesma lista na busca repetida (cache)", async () => {
    const first = await search(QUERY);
    const second = await search(QUERY);
    const prices = first.body.flights.map((f) => f.price.amount);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(second.body.flights).toEqual(first.body.flights);
    expect(second.body.meta.providers.every((p) => p.cached)).toBe(true);
  });

  it("exibe só ofertas válidas em BRL, com voos disputados entre providers", async () => {
    const { body } = await search(QUERY);
    for (const f of body.flights) {
      expect(f.price.currency).toBe("BRL");
      expect(f.price.amount).toBeGreaterThan(0);
      expect(["provider-a", "provider-b", "provider-c"]).toContain(f.provider);
    }
    expect(body.flights.some((f) => f.offersCompared > 1)).toBe(true);
  });

  it("rejeita entrada inválida com 400 e detalhes por campo", async () => {
    const { status, body } = await search({
      origin: "GRU",
      destination: "GRU",
      date: "2026-02-30",
    });
    expect(status).toBe(400);
    expect(body.details).toHaveProperty("date");
  });

  it("responde rápido com cache quente", async () => {
    await search(QUERY);
    const started = performance.now();
    await search(QUERY);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
