/**
 * Readiness. Cache, banco ou provider fora DEGRADAM o serviço, mas a busca
 * continua respondendo: por isso o resultado é "degradado", e não "fora".
 */
import type { CircuitState, FlightOffersGateway } from "../gateways/flight-offers-gateway.js";
import type { HealthCheck } from "../gateways/health-check.js";

export interface ReadinessReport {
  degraded: boolean;
  cacheHealthy: boolean;
  databaseHealthy: boolean;
  circuits: Record<string, CircuitState>;
}

export interface CheckReadinessDeps {
  gateway: FlightOffersGateway;
  cache: HealthCheck;
  database: HealthCheck;
}

export class CheckReadinessUseCase {
  constructor(private readonly deps: CheckReadinessDeps) {}

  async execute(): Promise<ReadinessReport> {
    const [cacheHealthy, databaseHealthy] = await Promise.all([
      this.deps.cache.isHealthy(),
      this.deps.database.isHealthy(),
    ]);
    const circuits = this.deps.gateway.circuits();
    const anyCircuitOpen = Object.values(circuits).some((state) => state !== "closed");
    return {
      degraded: !cacheHealthy || !databaseHealthy || anyCircuitOpen,
      cacheHealthy,
      databaseHealthy,
      circuits,
    };
  }
}
