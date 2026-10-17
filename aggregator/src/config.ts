/**
 * Configuração por variáveis de ambiente, validada na subida (fail fast).
 * Comissões, tolerância, estratégia e liga/desliga de provider funcionam como feature flags.
 * As variáveis OTEL_* são lidas direto por observability/tracing.ts, que carrega antes da app.
 */
import { z } from "zod";

export const STRATEGIES = ["cheapest", "max_commission", "balanced"] as const;
export type StrategyName = (typeof STRATEGIES)[number];

const PROVIDER_IDS = ["A", "B", "C"] as const;

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
const int = (min: number) => z.coerce.number().int().min(min);

const EnvSchema = z.object({
  PORT: int(1).default(8000),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_PRETTY: bool.default(false),

  PROVIDER_A_URL: z.url().default("http://localhost:3001/provider-a/search"),
  PROVIDER_B_URL: z.url().default("http://localhost:3002/provider-b/search"),
  PROVIDER_C_URL: z.url().default("http://localhost:3003/provider-c/search"),
  PROVIDER_A_ENABLED: bool.default(true),
  PROVIDER_B_ENABLED: bool.default(true),
  PROVIDER_C_ENABLED: bool.default(true),
  PROVIDER_A_COMMISSION_BPS: int(0).default(100), // 1%
  PROVIDER_B_COMMISSION_BPS: int(0).default(150), // 1,5%
  PROVIDER_C_COMMISSION_BPS: int(0).default(200), // 2%
  PROVIDER_TIMEOUT_MS: int(1).default(3000), // total por provider, retries incluídos
  RETRY_MAX_ATTEMPTS: int(1).default(3),
  RETRY_BASE_DELAY_MS: int(0).default(100),
  RETRY_MAX_DELAY_MS: int(0).default(800),
  BREAKER_FAILURE_THRESHOLD: int(1).default(5),
  BREAKER_RESET_TIMEOUT_MS: int(1).default(30_000),

  REDIS_URL: z.string().default("redis://localhost:6379"),
  CACHE_ENABLED: bool.default(true),
  CACHE_TTL_SECONDS: int(1).default(300),

  PERSISTENCE_ENABLED: bool.default(false),
  DATABASE_URL: z.string().default("postgres://aggregator:aggregator@localhost:5433/aggregator"),
  DATABASE_SSL: bool.default(false), // Postgres gerenciado (Supabase, RDS) costuma exigir
  PERSISTENCE_MAX_PENDING: int(1).default(200),

  RATE_LIMIT_ENABLED: bool.default(true),
  RATE_LIMIT_MAX: int(1).default(60),
  RATE_LIMIT_WINDOW_MS: int(1).default(60_000),

  SELECTION_STRATEGY: z.enum(STRATEGIES).default("balanced"),
  PRICE_TOLERANCE_BPS: int(0).default(200), // 2% acima da oferta mais barata...
  PRICE_TOLERANCE_MAX_CENTS: int(0).default(3000), // ...limitado a R$ 30,00
});

type Env = z.infer<typeof EnvSchema>;

export interface ProviderConfig {
  name: string;
  url: string;
  enabled: boolean;
  commissionBps: number;
}

export interface Config {
  port: number;
  host: string;
  logLevel: Env["LOG_LEVEL"];
  logPretty: boolean;
  providers: ProviderConfig[];
  providerTimeoutMs: number;
  retry: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };
  breaker: { failureThreshold: number; resetTimeoutMs: number };
  cache: { enabled: boolean; redisUrl: string; ttlSeconds: number };
  persistence: { enabled: boolean; databaseUrl: string; ssl: boolean; maxPending: number };
  rateLimit?: { max: number; timeWindowMs: number };
  selection: { strategy: StrategyName; toleranceBps: number; toleranceMaxCents: number };
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const env = EnvSchema.parse(source);
  return {
    port: env.PORT,
    host: env.HOST,
    logLevel: env.LOG_LEVEL,
    logPretty: env.LOG_PRETTY,
    providers: PROVIDER_IDS.map((id) => ({
      name: `provider-${id.toLowerCase()}`,
      url: env[`PROVIDER_${id}_URL`],
      enabled: env[`PROVIDER_${id}_ENABLED`],
      commissionBps: env[`PROVIDER_${id}_COMMISSION_BPS`],
    })),
    providerTimeoutMs: env.PROVIDER_TIMEOUT_MS,
    retry: {
      maxAttempts: env.RETRY_MAX_ATTEMPTS,
      baseDelayMs: env.RETRY_BASE_DELAY_MS,
      maxDelayMs: env.RETRY_MAX_DELAY_MS,
    },
    breaker: {
      failureThreshold: env.BREAKER_FAILURE_THRESHOLD,
      resetTimeoutMs: env.BREAKER_RESET_TIMEOUT_MS,
    },
    cache: {
      enabled: env.CACHE_ENABLED,
      redisUrl: env.REDIS_URL,
      ttlSeconds: env.CACHE_TTL_SECONDS,
    },
    persistence: {
      enabled: env.PERSISTENCE_ENABLED,
      databaseUrl: env.DATABASE_URL,
      ssl: env.DATABASE_SSL,
      maxPending: env.PERSISTENCE_MAX_PENDING,
    },
    rateLimit: env.RATE_LIMIT_ENABLED
      ? { max: env.RATE_LIMIT_MAX, timeWindowMs: env.RATE_LIMIT_WINDOW_MS }
      : undefined,
    selection: {
      strategy: env.SELECTION_STRATEGY,
      toleranceBps: env.PRICE_TOLERANCE_BPS,
      toleranceMaxCents: env.PRICE_TOLERANCE_MAX_CENTS,
    },
  };
}
