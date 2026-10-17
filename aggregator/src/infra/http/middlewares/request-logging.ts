/**
 * "Canonical log line": UMA linha por requisição, no fim, com rota, status,
 * latência e o que os handlers puserem em `request.logContext`.
 * Nível: error para 5xx (bug nosso), warn para 503 (providers fora), debug para
 * probes, info para o resto.
 */
import { type FastifyReply, type FastifyRequest, LogController } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Campos extras que entram na linha de log da requisição. */
    logContext: Record<string, unknown>;
  }
}

const PROBES = new Set(["/health", "/ready", "/metrics"]);

type LogLevel = "debug" | "info" | "warn" | "error";

export function routeOf(request: FastifyRequest): string {
  return request.routeOptions.url ?? "unmatched";
}

export class CanonicalLogController extends LogController {
  /** Silenciado: tudo vai na linha do fim. */
  override incomingRequest(): void {}

  override requestCompleted(
    error: Error | null | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    const route = routeOf(request);
    const line = {
      method: request.method,
      route,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
      ...request.logContext,
      ...(error ? { err: error } : {}),
    };

    reply.log[levelFor(reply.statusCode, route, error)](line, "request_completed");
  }
}

function levelFor(statusCode: number, route: string, error: unknown): LogLevel {
  // 503 = nenhum provider respondeu: degradação externa, não bug nosso.
  if (statusCode === 503) return "warn";
  if (statusCode >= 500 || error) return "error";
  return PROBES.has(route) ? "debug" : "info";
}
