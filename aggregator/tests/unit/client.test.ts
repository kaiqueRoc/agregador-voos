import { describe, expect, it, vi } from "vitest";
import { ProviderClient } from "../../src/providers/client.js";
import { normalizeA } from "../../src/providers/normalizers.js";
import { CircuitBreaker } from "../../src/resilience/circuitBreaker.js";
import { hangingFetch, jsonResponse, QUERY, silentLogger } from "../helpers.js";

const PAYLOAD = {
  flights: [
    {
      company: "LATAM",
      price: 801.48,
      depart_at: "2026-10-20T08:00:00",
      arrive_at: "2026-10-20T11:10:00",
    },
  ],
};

function makeClient(
  fetchImpl: typeof fetch,
  opts: { timeoutMs?: number; threshold?: number } = {},
) {
  const breaker = new CircuitBreaker("provider-a", {
    failureThreshold: opts.threshold ?? 5,
    resetTimeoutMs: 30_000,
  });
  return new ProviderClient({
    config: { name: "provider-a", url: "http://a/search", enabled: true, commissionBps: 100 },
    normalizer: normalizeA,
    breaker,
    timeoutMs: opts.timeoutMs ?? 3000,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    logger: silentLogger,
    fetch: fetchImpl,
  });
}

describe("ProviderClient", () => {
  it("faz POST com origin/destination/date e normaliza a resposta", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(PAYLOAD));
    const result = await makeClient(fetchMock).search(QUERY);

    expect(result.status).toBe("ok");
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0]?.priceCents).toBe(80_148);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://a/search");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(QUERY);
  });

  it("repete após 5xx e devolve sucesso", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ detail: "provider indisponível" }, 500))
      .mockResolvedValueOnce(jsonResponse(PAYLOAD));
    const result = await makeClient(fetchMock).search(QUERY);
    expect(result.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("repete após erro de rede (fetch lança TypeError)", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(PAYLOAD));
    expect((await makeClient(fetchMock).search(QUERY)).status).toBe("ok");
  });

  it("não repete 4xx", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 400));
    const result = await makeClient(fetchMock).search(QUERY);
    expect(result.status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("devolve erro depois de esgotar as tentativas", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 503));
    const result = await makeClient(fetchMock).search(QUERY);
    expect(result.status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("respeita o orçamento de tempo: provider pendurado vira timeout, sem lançar", async () => {
    const started = performance.now();
    const result = await makeClient(hangingFetch, { timeoutMs: 100 }).search(QUERY);
    expect(result.status).toBe("timeout");
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("payload fora do contrato vira erro (sem retry)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ unexpected: true }));
    const result = await makeClient(fetchMock).search(QUERY);
    expect(result.status).toBe("error");
    expect(result.error).toContain("ProviderPayloadError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("corpo que não é JSON vira erro", async () => {
    const fetchMock = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect((await makeClient(fetchMock).search(QUERY)).status).toBe("error");
  });

  it("abre o circuito após falhas seguidas e para de chamar o provider", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}, 400));
    const client = makeClient(fetchMock, { threshold: 2 });
    await client.search(QUERY);
    await client.search(QUERY);
    const result = await client.search(QUERY);
    expect(result.status).toBe("circuit_open");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(client.breaker.state).toBe("open");
  });
});
