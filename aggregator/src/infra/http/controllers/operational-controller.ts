/** Página inicial, liveness, readiness e métricas. */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { CheckReadinessUseCase } from "../../../core/use-cases/check-readiness.js";
import * as metrics from "../../telemetry/metrics/metrics.js";
import { isInternalRequest } from "../middlewares/client-network.js";

const DAY_MS = 86_400_000;
const SAMPLE_SEARCH_DAYS_AHEAD = 30;

function sampleTravelDate(): string {
  return new Date(Date.now() + SAMPLE_SEARCH_DAYS_AHEAD * DAY_MS).toISOString().slice(0, 10);
}

const upOrDown = (healthy: boolean) => (healthy ? "up" : "down");

export class OperationalController {
  constructor(private readonly checkReadiness: CheckReadinessUseCase) {}

  /** Quem abre a URL no navegador vê o que dá para fazer, com um link de teste pronto. */
  home(request: FastifyRequest) {
    const base = `${request.headers["x-forwarded-proto"] ?? request.protocol}://${request.host}`;
    const date = sampleTravelDate();
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
  }

  /** Liveness: o processo está de pé. Não olha dependências de propósito. */
  health() {
    return { status: "ok" };
  }

  /** Degradado responde 200, e não 503: 503 tiraria a instância do balanceador à toa. */
  async ready() {
    const report = await this.checkReadiness.execute();
    return {
      status: report.degraded ? "degraded" : "ok",
      redis: upOrDown(report.cacheHealthy),
      database: upOrDown(report.databaseHealthy),
      providers: Object.fromEntries(
        Object.entries(report.circuits).map(([name, circuit]) => [name, { circuit }]),
      ),
    };
  }

  /** Só para a rede interna (Prometheus): quem vem da internet recebe 404. */
  async metrics(request: FastifyRequest, reply: FastifyReply) {
    if (!isInternalRequest(request)) return reply.status(404).send();
    reply.header("content-type", metrics.registry.contentType);
    return metrics.registry.metrics();
  }
}
