/** Métricas Prometheus expostas em GET /metrics. */
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

// RED por rota. `route` é o template ("/search"), nunca a URL crua (cardinalidade).
export const httpRequests = new Counter({
  name: "http_requests_total",
  help: "Requisições HTTP por rota, método e status",
  labelNames: ["method", "route", "status_code"] as const,
  registers: [registry],
});

export const httpDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "Latência HTTP por rota, método e status",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5],
  registers: [registry],
});

export const searchRequests = new Counter({
  name: "aggregator_search_requests_total",
  help: "Buscas recebidas, por resultado",
  labelNames: ["outcome"] as const, // complete | partial | failed
  registers: [registry],
});

export const providerRequests = new Counter({
  name: "aggregator_provider_requests_total",
  help: "Consultas a providers, por resultado",
  labelNames: ["provider", "status"] as const, // ok | error | timeout | circuit_open | cache_hit
  registers: [registry],
});

export const providerDuration = new Histogram({
  name: "aggregator_provider_duration_seconds",
  help: "Latência de cada provider (retries incluídos)",
  labelNames: ["provider"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3],
  registers: [registry],
});

export const providerRetries = new Counter({
  name: "aggregator_provider_retries_total",
  help: "Retentativas por provider",
  labelNames: ["provider"] as const,
  registers: [registry],
});

export const offersDiscarded = new Counter({
  name: "aggregator_offers_discarded_total",
  help: "Registros descartados na normalização (preço zerado, moeda estrangeira...)",
  labelNames: ["provider"] as const,
  registers: [registry],
});

export const circuitState = new Gauge({
  name: "aggregator_circuit_state",
  help: "Estado do circuit breaker (0=closed, 1=half_open, 2=open)",
  labelNames: ["provider"] as const,
  registers: [registry],
});

export const cacheOperations = new Counter({
  name: "aggregator_cache_operations_total",
  help: "Operações de cache",
  labelNames: ["result"] as const, // hit | miss | error
  registers: [registry],
});

// Métricas de negócio: quem vence, o quanto a estratégia rende e quanto custa ao cliente.
export const selectedOffers = new Counter({
  name: "aggregator_selected_offers_total",
  help: "Voos exibidos por provider escolhido (contested = havia mais de um provider)",
  labelNames: ["provider", "contested"] as const,
  registers: [registry],
});

export const commissionUplift = new Counter({
  name: "aggregator_selection_commission_uplift_cents_total",
  help: "Comissão extra (centavos) obtida por não exibir a oferta mais barata",
  registers: [registry],
});

export const customerPremium = new Counter({
  name: "aggregator_selection_customer_premium_cents_total",
  help: "Quanto (centavos) o cliente paga a mais por não receber a oferta mais barata",
  registers: [registry],
});

export const searchesPersisted = new Counter({
  name: "aggregator_searches_persisted_total",
  help: "Gravação das buscas no banco de analytics",
  labelNames: ["result"] as const, // ok | error | dropped
  registers: [registry],
});

export const CIRCUIT_STATE_VALUE = { closed: 0, half_open: 1, open: 2 } as const;
