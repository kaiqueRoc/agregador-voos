/** Composition root: o único lugar que sabe montar as peças de verdade. */
import { Redis } from "ioredis";
import pg from "pg";
import type { Config, ProviderConfig } from "./config/env/load-config.js";
import { buildStrategy } from "./core/entities/selection-strategy.js";
import type { SearchRecorder } from "./core/repositories/search-recorder.js";
import { CheckReadinessUseCase } from "./core/use-cases/check-readiness.js";
import { SearchFlightsUseCase } from "./core/use-cases/search-flights.js";
import { NoopSearchRecorder } from "./infra/database/repositories/noop-search-recorder.js";
import { PostgresSearchRecorder } from "./infra/database/repositories/postgres-search-recorder.js";
import {
  NoopOfferCache,
  type OfferCache,
  RedisOfferCache,
} from "./infra/gateways/flights/offer-cache.js";
import { ProviderClient } from "./infra/gateways/flights/provider-client.js";
import { ProviderGateway } from "./infra/gateways/flights/provider-gateway.js";
import { NORMALIZERS } from "./infra/gateways/flights/provider-normalizers.js";
import { CircuitBreaker } from "./infra/gateways/resilience/circuit-breaker.js";
import type { Logger } from "./infra/telemetry/logger/logger.js";
import * as metrics from "./infra/telemetry/metrics/metrics.js";
import { PrometheusSearchMetrics } from "./infra/telemetry/metrics/prometheus-search-metrics.js";

export interface Container {
  searchFlights: SearchFlightsUseCase;
  checkReadiness: CheckReadinessUseCase;
  close(): Promise<void>;
}

function buildCache(config: Config, logger: Logger): { cache: OfferCache; redis?: Redis } {
  if (!config.cache.enabled) return { cache: new NoopOfferCache() };
  const redis = new Redis(config.cache.redisUrl, {
    // Redis fora não pode segurar a busca: falha rápido e vira cache miss.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    commandTimeout: 250,
    connectTimeout: 2000,
  });

  redis.on("error", (err) => logger.warn({ err }, "redis_error"));
  return { cache: new RedisOfferCache(redis, config.cache.ttlSeconds, logger), redis };
}

/** Banco fora na subida não impede o serviço de subir: analytics não bloqueia busca. */
async function buildRecorder(config: Config, logger: Logger): Promise<SearchRecorder> {
  if (!config.persistence.enabled) return new NoopSearchRecorder();
  const pool = new pg.Pool({
    connectionString: config.persistence.databaseUrl,
    ssl: config.persistence.ssl ? { rejectUnauthorized: false } : undefined,
    max: 5,
    connectionTimeoutMillis: 2000,
    query_timeout: 3000,
    idleTimeoutMillis: 30_000,
  });
  pool.on("error", (err) => logger.warn({ err }, "postgres_pool_error"));

  const recorder = new PostgresSearchRecorder(pool, logger, config.persistence.maxPending);
  try {
    await recorder.migrate();
    logger.info({}, "postgres_schema_ready");
  } catch (err) {
    logger.error({ err }, "postgres_migration_failed");
  }
  return recorder;
}

/** Breaker que publica cada mudança de estado em métrica e log. */
function buildBreaker(provider: string, config: Config, logger: Logger): CircuitBreaker {
  metrics.circuitState.set({ provider }, metrics.CIRCUIT_STATE_VALUE.closed);
  return new CircuitBreaker(provider, {
    ...config.breaker,
    onStateChange: (name, state) => {
      metrics.circuitState.set({ provider: name }, metrics.CIRCUIT_STATE_VALUE[state]);
      logger.warn({ provider: name, state }, "circuit_state_changed");
    },
  });
}

function buildClient(provider: ProviderConfig, config: Config, logger: Logger): ProviderClient {
  const normalizer = NORMALIZERS[provider.name];
  if (!normalizer) throw new Error(`sem normalizador para ${provider.name}`);
  return new ProviderClient({
    config: provider,
    normalizer,
    breaker: buildBreaker(provider.name, config, logger),
    timeoutMs: config.providerTimeoutMs,
    retryPolicy: config.retry,
    logger,
  });
}

function buildClients(config: Config, logger: Logger): ProviderClient[] {
  return config.providers
    .filter((provider) => provider.enabled)
    .map((provider) => buildClient(provider, config, logger));
}

export async function buildContainer(config: Config, logger: Logger): Promise<Container> {
  const { cache, redis } = buildCache(config, logger);
  const recorder = await buildRecorder(config, logger);
  const gateway = new ProviderGateway(buildClients(config, logger), cache);

  return {
    searchFlights: new SearchFlightsUseCase({
      gateway,
      strategy: buildStrategy(config.selection),
      recorder,
      metrics: new PrometheusSearchMetrics(),
    }),
    checkReadiness: new CheckReadinessUseCase({ gateway, cache, database: recorder }),
    async close() {
      await recorder.close();
      await redis?.quit().catch(() => redis?.disconnect());
    },
  };
}
