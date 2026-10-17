/**
 * Quem está do outro lado da conexão. Na rede interna (containers do compose,
 * o Cloudflare Tunnel) o header `CF-Connecting-IP` é confiável; vindo direto da
 * internet (IP público da VM), não: qualquer um pode forjá-lo.
 */
import type { FastifyRequest } from "fastify";

const PRIVATE_IPV4 = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

export function isPrivateIp(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/, "");
  return v4 === "::1" || /^f[cd]/i.test(v4) || PRIVATE_IPV4.some((range) => range.test(v4));
}

function cloudflareClientIp(request: FastifyRequest): string | undefined {
  const header = request.headers["cf-connecting-ip"];
  return Array.isArray(header) ? header[0] : header;
}

/** IP real do cliente (para o rate limit). O header só vale se veio pela rede interna. */
export function clientKey(request: FastifyRequest): string {
  if (!isPrivateIp(request.ip)) return request.ip;
  return cloudflareClientIp(request) ?? request.ip;
}

/** Requisição da rede interna que não veio repassada da internet pelo tunnel. */
export function isInternalRequest(request: FastifyRequest): boolean {
  return isPrivateIp(request.ip) && !cloudflareClientIp(request);
}
