/**
 * Cache das ofertas normalizadas de cada provider (Redis, TTL de 5 min).
 * Redis é otimização, não dependência: qualquer erro vira cache miss.
 */
import type { Offer } from "../../../core/entities/offer.js";
import { type SearchQuery, searchKey } from "../../../core/entities/search-query.js";
import type { HealthCheck } from "../../../core/gateways/health-check.js";
import type { Logger } from "../../telemetry/logger/logger.js";
import * as metrics from "../../telemetry/metrics/metrics.js";

/** O pedaço do Redis que usamos (permite um fake em memória nos testes). */
export interface KeyValueStore {
  mget(...keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  ping(): Promise<string>;
}

export interface OfferCache extends HealthCheck {
  /** Ofertas cacheadas por provider; quem não está no cache fica de fora do Map. */
  getMany(providers: readonly string[], query: SearchQuery): Promise<Map<string, Offer[]>>;
  set(provider: string, query: SearchQuery, offers: readonly Offer[]): Promise<void>;
}

export function cacheKey(provider: string, query: SearchQuery): string {
  return `offers:v2:${provider}:${searchKey(query)}`;
}

export class RedisOfferCache implements OfferCache {
  constructor(
    private readonly store: KeyValueStore,
    private readonly ttlSeconds: number,
    private readonly logger: Logger,
  ) {}

  async getMany(providers: readonly string[], query: SearchQuery): Promise<Map<string, Offer[]>> {
    const hits = new Map<string, Offer[]>();
    if (providers.length === 0) return hits;

    const raws = await this.store
      .mget(...providers.map((p) => cacheKey(p, query)))
      .catch((err: unknown) => this.fail("cache_read_failed", err));
    if (!raws) return hits;

    for (const [i, provider] of providers.entries()) {
      const raw = raws[i];
      if (raw == null) {
        metrics.cacheOperations.inc({ result: "miss" });
        continue;
      }
      try {
        hits.set(provider, JSON.parse(raw) as Offer[]); // gravado por set(), mesmo formato
        metrics.cacheOperations.inc({ result: "hit" });
      } catch (err) {
        this.fail("cache_entry_invalid", err); // corrompida: trata como miss
      }
    }
    return hits;
  }

  async set(provider: string, query: SearchQuery, offers: readonly Offer[]): Promise<void> {
    await this.store
      .set(cacheKey(provider, query), JSON.stringify(offers), "EX", this.ttlSeconds)
      .catch((err: unknown) => this.fail("cache_write_failed", err));
  }

  async isHealthy(): Promise<boolean> {
    return (await this.store.ping().catch(() => "")) === "PONG";
  }

  private fail(event: string, err: unknown): undefined {
    metrics.cacheOperations.inc({ result: "error" });
    this.logger.warn({ err }, event);
    return undefined;
  }
}

/** Usado com CACHE_ENABLED=false. */
export class NoopOfferCache implements OfferCache {
  async getMany(): Promise<Map<string, Offer[]>> {
    return new Map();
  }
  async set(): Promise<void> {}
  async isHealthy(): Promise<boolean> {
    return true;
  }
}
