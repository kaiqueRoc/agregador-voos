/** Composition root: o único lugar que sabe montar as peças de verdade. */
import { Redis } from "ioredis";
import pg from "pg";
import { NoopOfferCache, type OfferCache, RedisOfferCache } from "./cache/offerCache.js";
import type { Config } from "./config.js";
import { buildStrategy } from "./domain/selection.js";
import type { Logger } from "./observability/logger.js";
import * as metrics from "./observability/metrics.js";
import { PostgresSearchRecorder } from "./persistence/postgresSearchRecorder.js";
import { NoopSearchRecorder, type SearchRecorder } from "./persistence/searchRecorder.js";
import { ProviderClient } from "./providers/client.js";
import { ProviderGateway } from "./providers/gateway.js";
import { NORMALIZERS } from "./providers/normalizers.js";
import { CircuitBreaker } from "./resilience/circuitBreaker.js";
import { SearchService } from "./services/searchService.js";

export interface Container {
  service: SearchService;
  cache: OfferCache;
  recorder: SearchRecorder;
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
  redis.on("error", (err) => logger.warn({ err: String(err) }, "redis_error"));
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
  pool.on("error", (err) => logger.warn({ err: String(err) }, "postgres_pool_error"));

  const recorder = new PostgresSearchRecorder(pool, logger, config.persistence.maxPending);
  try {
    await recorder.migrate();
    logger.info({}, "postgres_schema_ready");
  } catch (err) {
    logger.error({ err: String(err) }, "postgres_migration_failed");
  }
  return recorder;
}

function buildClients(config: Config, logger: Logger): ProviderClient[] {
  return config.providers
    .filter((p) => p.enabled)
    .map((p) => {
      const normalizer = NORMALIZERS[p.name];
      if (!normalizer) throw new Error(`sem normalizador para ${p.name}`);
      metrics.circuitState.set({ provider: p.name }, metrics.CIRCUIT_STATE_VALUE.closed);
      const breaker = new CircuitBreaker(p.name, {
        ...config.breaker,
        onStateChange: (name, state) => {
          metrics.circuitState.set({ provider: name }, metrics.CIRCUIT_STATE_VALUE[state]);
          logger.warn({ provider: name, state }, "circuit_state_changed");
        },
      });
      return new ProviderClient({
        config: p,
        normalizer,
        breaker,
        timeoutMs: config.providerTimeoutMs,
        retryPolicy: config.retry,
        logger,
      });
    });
}

export async function buildContainer(config: Config, logger: Logger): Promise<Container> {
  const { cache, redis } = buildCache(config, logger);
  const recorder = await buildRecorder(config, logger);
  const gateway = new ProviderGateway(buildClients(config, logger), cache);

  return {
    service: new SearchService(gateway, buildStrategy(config.selection), recorder),
    cache,
    recorder,
    async close() {
      await recorder.close();
      await redis?.quit().catch(() => redis?.disconnect());
    },
  };
}
