/**
 * Monta a aplicação Fastify a partir de dependências já construídas (nada de
 * conectar em Redis aqui): os testes injetam fakes e usam `app.inject()`.
 */
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance } from "fastify";
import type { OfferCache } from "../cache/offerCache.js";
import * as metrics from "../observability/metrics.js";
import type { SearchRecorder } from "../persistence/searchRecorder.js";
import type { SearchService } from "../services/searchService.js";
import { CanonicalLogController, routeOf } from "./requestLogging.js";
import { operationalRoutes } from "./routes/operational.js";
import { searchRoutes } from "./routes/search.js";
import { todayIn } from "./schemas.js";

export interface AppDeps {
  service: SearchService;
  cache: OfferCache;
  recorder: SearchRecorder;
  /** Sem logger, a app roda sem log (testes). */
  logger?: FastifyBaseLogger;
  /** Sem limite, a busca não é limitada (testes). */
  rateLimit?: { max: number; timeWindowMs: number };
  /** Data de hoje para recusar busca no passado; padrão: hoje em São Paulo. */
  today?: () => string;
}

const ERROR_CODES: Record<number, string> = { 429: "rate_limited", 500: "internal_error" };

export function buildApp({
  service,
  cache,
  recorder,
  logger,
  rateLimit,
  today = () => todayIn("America/Sao_Paulo"),
}: AppDeps): FastifyInstance {
  const app = Fastify({
    ...(logger ? { loggerInstance: logger } : { logger: false }),
    logController: new CanonicalLogController(),
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });

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

  app.register(searchRoutes, { service, rateLimit, today });
  app.register(operationalRoutes, { service, cache, recorder });

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
