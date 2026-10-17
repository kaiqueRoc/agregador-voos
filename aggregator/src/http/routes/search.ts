/** POST /search (contrato oficial) e GET /search (mesma busca, para testar no navegador). */
import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SearchOutcome, SearchService } from "../../services/searchService.js";
import { clientKey } from "../clientNetwork.js";
import { SearchRequestSchema, toResponse } from "../schemas.js";

export interface SearchRoutesOptions {
  service: SearchService;
  /** Limite de buscas por cliente; omitido = sem limite. */
  rateLimit?: { max: number; timeWindowMs: number };
}

/** Resumo da busca que entra na linha de log da requisição. */
function logFields(o: SearchOutcome) {
  const providers = o.providers.map((p) => [
    p.provider,
    { status: p.status, offers: p.offers.length, cached: p.cached, latencyMs: p.latencyMs },
  ]);
  return {
    searchId: o.id,
    search: {
      ...o.query,
      strategy: o.strategy,
      flights: o.flights.length,
      partial: o.partial,
      providers: Object.fromEntries(providers),
    },
  };
}

export const searchRoutes: FastifyPluginAsync<SearchRoutesOptions> = async (api, opts) => {
  // Registrado neste escopo: o limite vale só para a busca, nunca para os probes.
  if (opts.rateLimit) {
    await api.register(rateLimit, {
      max: opts.rateLimit.max,
      timeWindow: opts.rateLimit.timeWindowMs,
      keyGenerator: clientKey,
      errorResponseBuilder: (_req, ctx) => ({
        statusCode: 429,
        error: "rate_limited",
        message: `Limite de ${ctx.max} buscas por ${ctx.after}. Tente novamente em instantes.`,
      }),
    });
  }

  const search = async (input: unknown, request: FastifyRequest, reply: FastifyReply) => {
    const parsed = SearchRequestSchema.safeParse(input);
    if (!parsed.success) {
      const details = z.flattenError(parsed.error).fieldErrors;
      request.logContext.validation = details;
      return reply
        .status(400)
        .send({ error: "invalid_request", message: "Parâmetros de busca inválidos", details });
    }

    const outcome = await opts.service.search(parsed.data, request.id);
    Object.assign(request.logContext, logFields(outcome));

    // Nenhum provider respondeu: "não há voos" seria falso, é "não deu para consultar".
    if (outcome.unavailable) {
      return reply
        .status(503)
        .header("retry-after", "5")
        .send({ error: "providers_unavailable", ...toResponse(outcome) });
    }
    return toResponse(outcome);
  };

  api.post("/search", (request, reply) => search(request.body, request, reply));
  api.get("/search", (request, reply) => search(request.query, request, reply));
};
