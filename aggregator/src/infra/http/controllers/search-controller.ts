/** POST /search e GET /search: valida, delega ao caso de uso e converte em HTTP. */
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SearchOutcome } from "../../../core/entities/search-outcome.js";
import type { SearchFlightsUseCase } from "../../../core/use-cases/search-flights.js";
import { toResponse } from "./search-presenter.js";
import { searchRequestSchema } from "./search-request-schema.js";

export class SearchController {
  private readonly schema;

  constructor(
    private readonly searchFlights: SearchFlightsUseCase,
    today: () => string,
  ) {
    this.schema = searchRequestSchema(today);
  }

  async search(input: unknown, request: FastifyRequest, reply: FastifyReply) {
    const parsed = this.schema.safeParse(input);
    if (!parsed.success) return rejectInvalid(parsed.error, request, reply);

    const outcome = await this.searchFlights.execute(parsed.data, request.id);
    Object.assign(request.logContext, toLogFields(outcome));

    // Nenhum provider respondeu: "não há voos" seria falso, é "não deu para consultar".
    if (outcome.unavailable) {
      return reply
        .status(503)
        .header("retry-after", "5")
        .send({ error: "providers_unavailable", ...toResponse(outcome) });
    }
    return toResponse(outcome);
  }
}

function rejectInvalid(error: z.ZodError, request: FastifyRequest, reply: FastifyReply) {
  const details = z.flattenError(error).fieldErrors;
  request.logContext.validation = details;
  return reply
    .status(400)
    .send({ error: "invalid_request", message: "Parâmetros de busca inválidos", details });
}

/** Resumo da busca que entra na linha de log da requisição. */
function toLogFields(outcome: SearchOutcome) {
  const providers = outcome.providers.map((p) => [
    p.provider,
    { status: p.status, offers: p.offers.length, cached: p.cached, latencyMs: p.latencyMs },
  ]);
  return {
    searchId: outcome.id,
    search: {
      ...outcome.query,
      strategy: outcome.strategy,
      flights: outcome.flights.length,
      partial: outcome.partial,
      providers: Object.fromEntries(providers),
    },
  };
}
