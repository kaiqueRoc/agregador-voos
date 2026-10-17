/**
 * Chamada a UM provider: circuit breaker → orçamento de 3s (retries incluídos)
 * → retry com backoff → POST → normalização.
 *
 * `search()` nunca lança: falha de provider é um resultado (`status`), não exceção.
 */
import type { ProviderConfig } from "../../../config/env/load-config.js";
import type { ProviderResult } from "../../../core/entities/provider-result.js";
import type { SearchQuery } from "../../../core/entities/search-query.js";
import type { Logger } from "../../telemetry/logger/logger.js";
import * as metrics from "../../telemetry/metrics/metrics.js";
import type { CircuitBreaker } from "../resilience/circuit-breaker.js";
import { type RetryPolicy, retry } from "../resilience/retry.js";
import {
  type NormalizationResult,
  type Normalizer,
  ProviderPayloadError,
} from "./provider-normalizers.js";

class HttpStatusError extends Error {
  override name = "HttpStatusError";
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}

/** 5xx e falha de rede (fetch lança TypeError) podem passar; 4xx e payload inválido, não. */
function isRetryable(err: unknown): boolean {
  return err instanceof HttpStatusError ? err.status >= 500 : err instanceof TypeError;
}

type AttemptResult = Pick<ProviderResult, "status" | "offers" | "discarded" | "error">;

function failure(status: ProviderResult["status"], error: string): AttemptResult {
  return { status, offers: [], discarded: 0, error };
}

export interface ProviderClientDeps {
  config: ProviderConfig;
  normalizer: Normalizer;
  breaker: CircuitBreaker;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  logger: Logger;
  fetch?: typeof fetch;
}

export class ProviderClient {
  readonly name: string;
  readonly commissionBps: number;
  readonly breaker: CircuitBreaker;

  constructor(private readonly deps: ProviderClientDeps) {
    this.name = deps.config.name;
    this.commissionBps = deps.config.commissionBps;
    this.breaker = deps.breaker;
  }

  async search(query: SearchQuery): Promise<ProviderResult> {
    const started = performance.now();
    const result = await this.attempt(query);
    const latencyMs = Math.round(performance.now() - started);

    metrics.providerRequests.inc({ provider: this.name, status: result.status });
    if (result.status !== "circuit_open") {
      metrics.providerDuration.observe({ provider: this.name }, latencyMs / 1000);
    }
    return { provider: this.name, cached: false, latencyMs, ...result };
  }

  private async attempt(query: SearchQuery): Promise<AttemptResult> {
    if (!this.breaker.tryAcquire()) {
      return failure("circuit_open", `circuito aberto para ${this.name}`);
    }

    const budget = AbortSignal.timeout(this.deps.timeoutMs);
    try {
      const { offers, discarded } = await this.fetchOffers(query, budget);
      this.breaker.recordSuccess();
      return { status: "ok", offers, discarded: discarded.length };
    } catch (err) {
      this.breaker.recordFailure();
      const status = budget.aborted ? "timeout" : "error";
      const error = budget.aborted ? `excedeu ${this.deps.timeoutMs}ms` : String(err);
      this.deps.logger.warn({ provider: this.name, error }, `provider_${status}`);
      return failure(status, error);
    }
  }

  private async fetchOffers(query: SearchQuery, signal: AbortSignal): Promise<NormalizationResult> {
    const payload = await retry(() => this.post(query, signal), {
      policy: this.deps.retryPolicy,
      isRetryable,
      signal,
      onRetry: (attempt, err) => {
        metrics.providerRetries.inc({ provider: this.name });
        this.deps.logger.info({ provider: this.name, attempt, err }, "provider_retry");
      },
    });

    const result = this.deps.normalizer(payload, {
      query,
      provider: this.name,
      commissionBps: this.commissionBps,
    });
    if (result.discarded.length > 0) {
      metrics.offersDiscarded.inc({ provider: this.name }, result.discarded.length);
      this.deps.logger.info(
        { provider: this.name, reasons: [...new Set(result.discarded)] },
        "provider_records_discarded",
      );
    }
    return result;
  }

  private async post(query: SearchQuery, signal: AbortSignal): Promise<unknown> {
    const response = await (this.deps.fetch ?? fetch)(this.deps.config.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(query),
      signal,
    });
    if (!response.ok) throw new HttpStatusError(response.status);
    return response.json().catch((cause: unknown) => {
      throw new ProviderPayloadError("resposta não é JSON válido", { cause });
    });
  }
}
