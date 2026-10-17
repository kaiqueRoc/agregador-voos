/** POST /search (contrato oficial) e GET /search (mesma busca, para testar no navegador). */
import rateLimit from "@fastify/rate-limit";
import type { FastifyPluginAsync } from "fastify";
import type { SearchController } from "../controllers/search-controller.js";
import { clientKey } from "../middlewares/client-network.js";

export interface RateLimitOptions {
  max: number;
  timeWindowMs: number;
}

export interface SearchRoutesOptions {
  controller: SearchController;
  /** Limite de buscas por cliente; omitido = sem limite. */
  rateLimit?: RateLimitOptions;
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

  const { controller } = opts;
  api.post("/search", (request, reply) => controller.search(request.body, request, reply));
  api.get("/search", (request, reply) => controller.search(request.query, request, reply));
};
