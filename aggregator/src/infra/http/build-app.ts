/**
 * Monta a aplicação Fastify a partir de casos de uso já construídos (nada de
 * conectar em Redis aqui): os testes injetam fakes e usam `app.inject()`.
 */
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from "fastify";
import type { CheckReadinessUseCase } from "../../core/use-cases/check-readiness.js";
import type { SearchFlightsUseCase } from "../../core/use-cases/search-flights.js";
import * as metrics from "../telemetry/metrics/metrics.js";
import { OperationalController } from "./controllers/operational-controller.js";
import { SearchController } from "./controllers/search-controller.js";
import { CanonicalLogController, routeOf } from "./middlewares/request-logging.js";
import { operationalRoutes } from "./routes/operational-routes.js";
import { type RateLimitOptions, searchRoutes } from "./routes/search-routes.js";

export interface AppDeps {
  searchFlights: SearchFlightsUseCase;
  checkReadiness: CheckReadinessUseCase;
  /** Sem logger, a app roda sem log (testes). */
  logger?: FastifyBaseLogger;
  /** Sem limite, a busca não é limitada (testes). */
  rateLimit?: RateLimitOptions;
  /** Data de hoje (YYYY-MM-DD), no fuso da config: busca com data anterior é recusada. */
  today: () => string;
}

const ERROR_CODES: Record<number, string> = { 429: "rate_limited", 500: "internal_error" };

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    ...(deps.logger ? { loggerInstance: deps.logger } : { logger: false }),
    logController: new CanonicalLogController(),
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });

  registerHooks(app);
  app.register(searchRoutes, {
    controller: new SearchController(deps.searchFlights, deps.today),
    rateLimit: deps.rateLimit,
  });
  app.register(operationalRoutes, {
    controller: new OperationalController(deps.checkReadiness),
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;
    request.logContext.err = error; // entra na linha de log da requisição
    reply.status(status).send({
      error: ERROR_CODES[status] ?? "bad_request",
      message: status === 500 ? "Erro interno" : error.message,
    });
  });
  return app;
}

/** Request ID na resposta e métricas RED de toda requisição. */
function registerHooks(app: FastifyInstance): void {
  app.decorateRequest("logContext");
  app.addHook("onRequest", async (request, reply) => {
    request.logContext = {};
    reply.header("x-request-id", request.id);
  });

  app.addHook("onResponse", async (request, reply) => {
    const labels = {
      method: request.method,
      route: routeOf(request),
      status_code: String(reply.statusCode),
    };
    metrics.httpRequests.inc(labels);
    metrics.httpDuration.observe(labels, reply.elapsedTime / 1000);
  });
}
