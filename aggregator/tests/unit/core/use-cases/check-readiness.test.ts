import { describe, expect, it } from "vitest";
import type { CircuitState } from "../../../../src/core/gateways/flight-offers-gateway.js";
import { CheckReadinessUseCase } from "../../../../src/core/use-cases/check-readiness.js";
import { FakeFlightOffersGateway } from "../../../mocks/gateways/fake-flight-offers-gateway.js";

const healthy = { isHealthy: async () => true };
const down = { isHealthy: async () => false };

function check(circuits: Record<string, CircuitState>, cache = healthy, database = healthy) {
  const gateway = new FakeFlightOffersGateway([], circuits);
  return new CheckReadinessUseCase({ gateway, cache, database }).execute();
}

describe("CheckReadinessUseCase", () => {
  it("não está degradado com tudo de pé e circuitos fechados", async () => {
    const report = await check({ "provider-a": "closed" });

    expect(report.degraded).toBe(false);
  });

  it("degrada quando um circuito não está fechado", async () => {
    const report = await check({ "provider-a": "closed", "provider-b": "half_open" });

    expect(report.degraded).toBe(true);
  });

  it("degrada quando o cache está fora", async () => {
    const report = await check({}, down);

    expect(report).toMatchObject({ degraded: true, cacheHealthy: false });
  });

  it("degrada quando o banco está fora", async () => {
    const report = await check({}, healthy, down);

    expect(report).toMatchObject({ degraded: true, databaseHealthy: false });
  });
});
