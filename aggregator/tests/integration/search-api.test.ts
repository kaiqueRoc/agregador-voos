/**
 * Integração: app Fastify completa (rotas → serviço → clientes → normalizadores
 * → agregação → cache), só com fetch e Redis falsos. Os payloads imitam os mocks
 * reais, incluindo os registros sujos.
 */

import { Writable } from "node:stream";
import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it, vi } from "vitest";
import { BalancedStrategy } from "../../src/core/entities/selection-strategy.js";
import { CheckReadinessUseCase } from "../../src/core/use-cases/check-readiness.js";
import { SearchFlightsUseCase } from "../../src/core/use-cases/search-flights.js";
import { RedisOfferCache } from "../../src/infra/gateways/flights/offer-cache.js";
import { ProviderClient } from "../../src/infra/gateways/flights/provider-client.js";
import { ProviderGateway } from "../../src/infra/gateways/flights/provider-gateway.js";
import {
  NORMALIZERS,
  type Normalizer,
} from "../../src/infra/gateways/flights/provider-normalizers.js";
import { CircuitBreaker } from "../../src/infra/gateways/resilience/circuit-breaker.js";
import { buildApp } from "../../src/infra/http/build-app.js";
import { PrometheusSearchMetrics } from "../../src/infra/telemetry/metrics/prometheus-search-metrics.js";
import { COMMISSION_BPS } from "../mocks/factories/offer-factory.js";
import { hangingFetch, jsonResponse } from "../mocks/gateways/fake-fetch.js";
import { FakeKeyValueStore } from "../mocks/gateways/fake-key-value-store.js";
import { FakeSearchRecorder } from "../mocks/repositories/fake-search-recorder.js";
import { silentLogger } from "../mocks/telemetry/silent-logger.js";

const PAYLOADS: Record<string, unknown> = {
  "provider-a": {
    flights: [
      // Mesmo voo nos 3 providers: B mais barato e com comissão maior que A.
      {
        company: "LATAM",
        price: 1000.0,
        depart_at: "2026-10-20T08:00:00",
        arrive_at: "2026-10-20T11:10:00",
      },
      // Mesmo voo em A e C: C só 1,2% mais caro → vale a comissão maior.
      {
        company: "GOL",
        price: 500.0,
        depart_at: "2026-10-20T08:50:00",
        arrive_at: "2026-10-20T12:05:00",
      },
      {
        company: "VOEPASS",
        price: 480.0,
        depart_at: "2026-10-20T22:30:00",
        arrive_at: "2026-10-21T01:15:00",
      },
    ],
  },
  "provider-b": {
    results: [
      {
        airline_name: "Latam",
        amount: 98_500,
        currency: "BRL",
        departure: "08:00",
        arrival: "11:10",
      },
      {
        airline_name: "Azul",
        amount: 76_107,
        currency: "BRL",
        departure: "08:15",
        arrival: "11:30",
      },
      {
        airline_name: "Copa Airlines",
        amount: 21_000,
        currency: "USD",
        departure: "14:40",
        arrival: "18:05",
      },
    ],
  },
  "provider-c": {
    data: [
      { carrier: "Latam Airlines", fare: 1012.0, departure_time: "08:00", arrival_time: "11:10" },
      { carrier: "Gol Linhas Aéreas", fare: 506.0, departure_time: "08:50", arrival_time: "12:05" },
      { carrier: "Gol", fare: 0.0, departure_time: "15:00", arrival_time: "18:20" },
    ],
  },
};

type Behavior = "ok" | "500" | "hang";

function setup(
  behaviors: Partial<Record<string, Behavior>> = {},
  logger?: FastifyBaseLogger,
  rateLimit?: { max: number; timeWindowMs: number },
) {
  const store = new FakeKeyValueStore();
  const cache = new RedisOfferCache(store, 300, silentLogger);
  const calls: Record<string, number> = {};

  const clients = Object.keys(PAYLOADS).map((name) => {
    const fetchImpl: typeof fetch = async (input, init) => {
      calls[name] = (calls[name] ?? 0) + 1;
      const behavior = behaviors[name] ?? "ok";
      if (behavior === "hang") return hangingFetch(input, init);
      if (behavior === "500") return jsonResponse({ detail: "provider indisponível" }, 500);
      return jsonResponse(PAYLOADS[name]);
    };
    return new ProviderClient({
      config: {
        name,
        url: `http://${name}/search`,
        enabled: true,
        commissionBps: COMMISSION_BPS[name] ?? 0,
      },
      normalizer: NORMALIZERS[name] as Normalizer,
      breaker: new CircuitBreaker(name, { failureThreshold: 5, resetTimeoutMs: 30_000 }),
      timeoutMs: 200,
      retryPolicy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 2 },
      logger: silentLogger,
      fetch: fetchImpl,
    });
  });

  const recorder = new FakeSearchRecorder();
  const gateway = new ProviderGateway(clients, cache);
  const searchFlights = new SearchFlightsUseCase({
    gateway,
    strategy: new BalancedStrategy(200, 3000),
    recorder,
    metrics: new PrometheusSearchMetrics(),
  });
  const checkReadiness = new CheckReadinessUseCase({ gateway, cache, database: recorder });
  return {
    app: buildApp({ searchFlights, checkReadiness, logger, rateLimit, today: () => TODAY }),
    store,
    calls,
    recorder,
  };
}

/** "Hoje" fixo nos testes: a data das buscas (2026-10-20) nunca vira passado. */
const TODAY = "2026-10-17";
const BODY = { origin: "gru", destination: "GIG", date: "2026-10-20" };

describe("POST /search", () => {
  it("consolida, deduplica, aplica a regra de negócio e ordena", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "POST", url: "/search", payload: BODY });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.query).toEqual({ origin: "GRU", destination: "GIG", date: "2026-10-20" });
    expect(body.meta.partial).toBe(false);
    expect(body.meta.strategy).toBe("balanced");

    // 9 registros → 2 sujos descartados → 7 ofertas → 4 voos únicos
    expect(body.meta.total).toBe(4);
    expect(body.flights.map((f: { id: string }) => f.id)).toEqual([
      "VOEPASS-GRUGIG-202610202230", // R$ 480,00
      "GOL-GRUGIG-202610200850", //     R$ 506,00 (C, dentro da tolerância sobre A)
      "AZUL-GRUGIG-202610200815", //    R$ 761,07
      "LATAM-GRUGIG-202610200800", //   R$ 985,00 (B, C passaria da tolerância)
    ]);

    const [voepass, gol, , latam] = body.flights;
    expect(gol).toMatchObject({ provider: "provider-c", price: { amount: 506, currency: "BRL" } });
    expect(latam).toMatchObject({ provider: "provider-b", offersCompared: 3 });
    expect(voepass).toMatchObject({
      arrivalAt: "2026-10-21T01:15",
      durationMinutes: 165,
    });

    const discarded = Object.fromEntries(
      body.meta.providers.map((p: { name: string; discarded: number }) => [p.name, p.discarded]),
    );
    expect(discarded).toEqual({ "provider-a": 0, "provider-b": 1, "provider-c": 1 });
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("aceita também os nomes do enunciado (origem/destino/data)", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/search",
      payload: { origem: "GRU", destino: "GIG", data: "2026-10-20" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("segue respondendo quando um provider falha e marca a resposta como parcial", async () => {
    const { app } = setup({ "provider-c": "500" });
    const body = (await app.inject({ method: "POST", url: "/search", payload: BODY })).json();
    expect(body.meta.partial).toBe(true);
    expect(
      body.meta.providers.find((p: { name: string }) => p.name === "provider-c"),
    ).toMatchObject({
      status: "error",
      offers: 0,
    });
    // Sem C, o GOL 08:50 só tem a oferta de A.
    expect(body.flights.find((f: { airline: string }) => f.airline === "GOL").provider).toBe(
      "provider-a",
    );
  });

  it("provider pendurado não segura a busca além do timeout", async () => {
    const { app } = setup({ "provider-a": "hang" });
    const started = performance.now();
    const body = (await app.inject({ method: "POST", url: "/search", payload: BODY })).json();
    expect(performance.now() - started).toBeLessThan(1500);
    expect(body.meta.providers[0]).toMatchObject({ name: "provider-a", status: "timeout" });
    expect(body.flights.length).toBeGreaterThan(0);
  });

  it("todos os providers fora: 503 com Retry-After (e não 'nenhum voo')", async () => {
    const { app } = setup({ "provider-a": "500", "provider-b": "500", "provider-c": "500" });
    const res = await app.inject({ method: "POST", url: "/search", payload: BODY });
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.json()).toMatchObject({
      error: "providers_unavailable",
      flights: [],
      meta: { partial: true, total: 0 },
    });
  });

  it("buscas idênticas simultâneas fazem UMA chamada por provider (single-flight)", async () => {
    const { app, calls } = setup();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({ method: "POST", url: "/search", payload: BODY }),
      ),
    );
    expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    expect(calls).toEqual({ "provider-a": 1, "provider-b": 1, "provider-c": 1 });
  });

  it("segunda busca igual vem do cache, sem chamar os providers", async () => {
    const { app, calls, store } = setup();
    const first = (await app.inject({ method: "POST", url: "/search", payload: BODY })).json();
    const second = (await app.inject({ method: "POST", url: "/search", payload: BODY })).json();

    expect(calls).toEqual({ "provider-a": 1, "provider-b": 1, "provider-c": 1 });
    expect(store.data.size).toBe(3);
    expect(second.flights).toEqual(first.flights);
    expect(second.meta.providers.every((p: { cached: boolean }) => p.cached)).toBe(true);
  });

  it("não cacheia provider que falhou: só ele é reconsultado na próxima busca", async () => {
    const { app, calls, store } = setup({ "provider-c": "500" });
    await app.inject({ method: "POST", url: "/search", payload: BODY });
    await app.inject({ method: "POST", url: "/search", payload: BODY });

    expect(store.data.size).toBe(2);
    expect(calls["provider-a"]).toBe(1);
    expect(calls["provider-b"]).toBe(1);
    expect(calls["provider-c"]).toBe(4); // 2 buscas × 2 tentativas
  });

  it("Redis fora do ar não impede a busca", async () => {
    const { app, store } = setup();
    store.failing = true;
    const res = await app.inject({ method: "POST", url: "/search", payload: BODY });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta.total).toBe(4);
  });

  it.each([
    [{ origin: "GRU", destination: "GIG" }, "date"],
    [{ origin: "GR", destination: "GIG", date: "2026-10-20" }, "origin"],
    [{ origin: "GRU", destination: "GRU", date: "2026-10-20" }, "destination"],
    [{ origin: "GRU", destination: "GIG", date: "2026-02-30" }, "date"],
    [{ origin: "GRU", destination: "GIG", date: "20/10/2026" }, "date"],
  ])("valida a entrada → 400 %#", async (payload, field) => {
    const { app, calls } = setup();
    const res = await app.inject({ method: "POST", url: "/search", payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toHaveProperty(field);
    expect(calls).toEqual({});
  });

  it("recusa data no passado com 400 e explica o motivo", async () => {
    const { app, calls } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/search",
      payload: { ...BODY, date: "2026-10-16" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().details.date[0]).toContain("passado");
    expect(calls).toEqual({}); // nenhum provider consultado
  });

  it("aceita a data de hoje", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/search",
      payload: { ...BODY, date: TODAY },
    });
    expect(res.statusCode).toBe(200);
  });

  it("JSON malformado → 400", async () => {
    const { app } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/search",
      headers: { "content-type": "application/json" },
      payload: "{oops",
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("navegador", () => {
  it("GET / mostra o que a API faz, com link de teste clicável", async () => {
    const { app } = setup();
    const res = await app.inject({
      url: "/",
      headers: { host: "x.trycloudflare.com", "x-forwarded-proto": "https" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().try).toMatch(
      /^https:\/\/x\.trycloudflare\.com\/search\?origin=GRU&destination=GIG&date=\d{4}-\d{2}-\d{2}$/,
    );
  });

  it("GET /search com query string dá o mesmo resultado que o POST", async () => {
    const { app } = setup();
    const viaGet = await app.inject({ url: "/search?origin=gru&destination=GIG&date=2026-10-20" });
    const viaPost = await app.inject({ method: "POST", url: "/search", payload: BODY });
    expect(viaGet.statusCode).toBe(200);
    expect(viaGet.json().flights).toEqual(viaPost.json().flights);
  });

  it("GET /search valida igual ao POST", async () => {
    const { app } = setup();
    const res = await app.inject({ url: "/search?origin=GRU" });
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toHaveProperty("destination");
  });
});

describe("rotas operacionais", () => {
  it("sobe com uma instância pino real (como em produção)", async () => {
    const { app } = setup({}, pino({ level: "silent" }));
    expect((await app.inject("/health")).statusCode).toBe(200);
  });

  it("GET /health", async () => {
    const { app } = setup();
    expect((await app.inject("/health")).json()).toEqual({ status: "ok" });
  });

  it("GET /ready reporta Redis, banco e circuitos", async () => {
    const { app, store, recorder } = setup();
    expect((await app.inject("/ready")).json()).toMatchObject({
      status: "ok",
      redis: "up",
      database: "up",
    });
    store.failing = true;
    recorder.healthy = false;
    expect((await app.inject("/ready")).json()).toMatchObject({
      status: "degraded",
      redis: "down",
      database: "down",
    });
  });

  it("GET /metrics expõe RED por rota com o template, não a URL crua", async () => {
    const { app } = setup();
    await app.inject({ method: "POST", url: "/search", payload: BODY });
    await app.inject("/nao-existe?x=1");
    const body = (await app.inject("/metrics")).body;
    expect(body).toMatch(/http_requests_total\{method="POST",route="\/search",status_code="200"\}/);
    expect(body).toMatch(/http_requests_total\{method="GET",route="unmatched",status_code="404"\}/);
    expect(body).toContain("aggregator_selected_offers_total");
  });

  it("GET /metrics expõe métricas Prometheus", async () => {
    const { app } = setup();
    await app.inject({ method: "POST", url: "/search", payload: BODY });
    const res = await app.inject("/metrics");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("aggregator_provider_requests_total");
    expect(res.body).toContain("aggregator_selection_commission_uplift_cents_total");
  });
});

describe("respostas determinísticas", () => {
  it("mesma busca sem cache gera exatamente a mesma resposta", async () => {
    vi.useRealTimers();
    const run = async () => {
      const { app } = setup();
      const body = (await app.inject({ method: "POST", url: "/search", payload: BODY })).json();
      return body.flights;
    };
    expect(await run()).toEqual(await run());
  });
});

describe("persistência", () => {
  it("entrega cada busca ao recorder, com id e request id", async () => {
    const { app, recorder } = setup();
    const res = await app.inject({
      method: "POST",
      url: "/search",
      payload: BODY,
      headers: { "x-request-id": "req-123" },
    });
    expect(res.headers["x-request-id"]).toBe("req-123");
    expect(recorder.outcomes).toHaveLength(1);
    expect(recorder.outcomes[0]).toMatchObject({ requestId: "req-123", partial: false });
    expect(recorder.outcomes[0]?.flights).toHaveLength(4);
  });
});

describe("log canônico", () => {
  function capture() {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        for (const l of String(chunk).split("\n").filter(Boolean)) lines.push(JSON.parse(l));
        cb();
      },
    });
    return { lines, logger: pino({ level: "info" }, stream) };
  }

  it("UMA linha por busca, com o resumo da busca e dos providers", async () => {
    const { lines, logger } = capture();
    const { app } = setup({ "provider-c": "500" }, logger);
    await app.inject({ method: "POST", url: "/search", payload: BODY });

    const requestLines = lines.filter((l) => l.msg === "request_completed");
    expect(requestLines).toHaveLength(1);
    expect(lines.some((l) => l.msg === "incoming request")).toBe(false);
    expect(requestLines[0]).toMatchObject({
      level: 30,
      method: "POST",
      route: "/search",
      statusCode: 200,
      search: {
        origin: "GRU",
        destination: "GIG",
        partial: true,
        providers: { "provider-c": { status: "error" } },
      },
    });
    expect(requestLines[0]).toHaveProperty("reqId");
    expect(requestLines[0]).toHaveProperty("durationMs");
  });

  it("503 (providers fora) é warn, não error: não é bug nosso", async () => {
    const { lines, logger } = capture();
    const { app } = setup(
      { "provider-a": "500", "provider-b": "500", "provider-c": "500" },
      logger,
    );
    await app.inject({ method: "POST", url: "/search", payload: BODY });
    const line = lines.find((l) => l.msg === "request_completed");
    expect(line).toMatchObject({ statusCode: 503, level: 40 });
  });

  it("probes não aparecem em info", async () => {
    const { lines, logger } = capture();
    const { app } = setup({}, logger);
    await app.inject("/health");
    await app.inject("/ready");
    expect(lines.filter((l) => l.msg === "request_completed")).toHaveLength(0);
  });

  it("400 de validação loga os campos inválidos", async () => {
    const { lines, logger } = capture();
    const { app } = setup({}, logger);
    await app.inject({ method: "POST", url: "/search", payload: { origin: "GRU" } });
    const line = lines.find((l) => l.msg === "request_completed");
    expect(line).toMatchObject({ statusCode: 400, validation: { destination: expect.any(Array) } });
  });
});

describe("rate limit", () => {
  const limited = () => setup({}, undefined, { max: 2, timeWindowMs: 60_000 });

  it("429 depois do limite, com Retry-After", async () => {
    const { app } = limited();
    const codes = [];
    for (let i = 0; i < 3; i++) {
      codes.push((await app.inject({ method: "POST", url: "/search", payload: BODY })).statusCode);
    }
    expect(codes).toEqual([200, 200, 429]);
    const res = await app.inject({ method: "POST", url: "/search", payload: BODY });
    expect(res.headers["retry-after"]).toBeTruthy();
    expect(res.json()).toMatchObject({ error: "rate_limited" });
  });

  it("conta por cliente real (CF-Connecting-IP), não pelo IP do tunnel", async () => {
    const { app } = limited();
    const from = (ip: string) =>
      app.inject({
        method: "POST",
        url: "/search",
        payload: BODY,
        headers: { "cf-connecting-ip": ip },
      });
    await from("1.1.1.1");
    await from("1.1.1.1");
    expect((await from("1.1.1.1")).statusCode).toBe(429);
    expect((await from("2.2.2.2")).statusCode).toBe(200);
  });

  it("probes e /metrics nunca são limitados", async () => {
    const { app } = limited();
    for (let i = 0; i < 5; i++) {
      expect((await app.inject("/health")).statusCode).toBe(200);
      expect((await app.inject("/metrics")).statusCode).toBe(200);
    }
  });

  it("IP público com CF-Connecting-IP forjado não escapa do limite", async () => {
    const { app } = limited();
    const spoofed = (fake: string) =>
      app.inject({
        method: "POST",
        url: "/search",
        payload: BODY,
        remoteAddress: "198.51.100.7",
        headers: { "cf-connecting-ip": fake },
      });
    await spoofed("1.1.1.1");
    await spoofed("2.2.2.2");
    expect((await spoofed("3.3.3.3")).statusCode).toBe(429);
  });

  it("/metrics não responde para acesso direto pelo IP público", async () => {
    const { app } = limited();
    const res = await app.inject({ url: "/metrics", remoteAddress: "198.51.100.7" });
    expect(res.statusCode).toBe(404);
  });

  it("/metrics não responde para quem vem da internet (via Cloudflare)", async () => {
    const { app } = limited();
    const res = await app.inject({ url: "/metrics", headers: { "cf-connecting-ip": "8.8.8.8" } });
    expect(res.statusCode).toBe(404);
  });
});
