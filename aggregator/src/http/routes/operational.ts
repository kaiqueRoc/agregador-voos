/** Rotas de operação: página inicial, liveness, readiness e métricas. */
import type { FastifyPluginAsync } from "fastify";
import type { OfferCache } from "../../cache/offerCache.js";
import * as metrics from "../../observability/metrics.js";
import type { SearchRecorder } from "../../persistence/searchRecorder.js";
import type { SearchService } from "../../services/searchService.js";
import { isInternalRequest } from "../clientNetwork.js";

export interface OperationalRoutesOptions {
  service: SearchService;
  cache: OfferCache;
  recorder: SearchRecorder;
}

const DAY_MS = 86_400_000;

export const operationalRoutes: FastifyPluginAsync<OperationalRoutesOptions> = async (
  app,
  { service, cache, recorder },
) => {
  /** Quem abre a URL no navegador vê o que dá para fazer, com um link de teste pronto. */
  app.get("/", async (request) => {
    const base = `${request.headers["x-forwarded-proto"] ?? request.protocol}://${request.host}`;
    const date = new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10);
    const tryUrl = `${base}/search?origin=GRU&destination=GIG&date=${date}`;
    return {
      service: "Agregador de Provedores de Voos",
      description:
        "Consulta 3 provedores em paralelo, deduplica os voos e escolhe a oferta que maximiza a comissão sem pesar para o cliente.",
      endpoints: {
        "POST /search": { body: { origin: "GRU", destination: "GIG", date } },
        "GET /search": tryUrl,
        "GET /health": `${base}/health`,
        "GET /ready": `${base}/ready`,
      },
      try: tryUrl,
    };
  });

  /** Liveness: o processo está de pé. Não olha dependências de propósito. */
  app.get("/health", async () => ({ status: "ok" }));

  /**
   * Readiness. Redis, banco ou provider fora DEGRADAM o serviço, mas a busca
   * continua respondendo: 200 com `degraded`, e não 503 (que tiraria a
   * instância do balanceador à toa).
   */
  app.get("/ready", async () => {
    const [redis, database] = await Promise.all([cache.isHealthy(), recorder.isHealthy()]);
    const circuits = service.providerCircuits();
    const degraded = !redis || !database || Object.values(circuits).some((c) => c !== "closed");
    return {
      status: degraded ? "degraded" : "ok",
      redis: redis ? "up" : "down",
      database: database ? "up" : "down",
      providers: Object.fromEntries(
        Object.entries(circuits).map(([name, circuit]) => [name, { circuit }]),
      ),
    };
  });

  /** Só para a rede interna (Prometheus): quem vem da internet recebe 404. */
  app.get("/metrics", async (request, reply) => {
    if (!isInternalRequest(request)) return reply.status(404).send();
    reply.header("content-type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });
};
