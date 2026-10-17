import { describe, expect, it } from "vitest";
import type { ProviderResult } from "../../../../src/core/entities/provider-result.js";
import { CheapestStrategy } from "../../../../src/core/entities/selection-strategy.js";
import { SearchFlightsUseCase } from "../../../../src/core/use-cases/search-flights.js";
import { offer, QUERY } from "../../../mocks/factories/offer-factory.js";
import {
  FakeFlightOffersGateway,
  providerResult,
} from "../../../mocks/gateways/fake-flight-offers-gateway.js";
import { FakeSearchRecorder } from "../../../mocks/repositories/fake-search-recorder.js";
import { FakeSearchMetrics } from "../../../mocks/telemetry/fake-search-metrics.js";

function setup(results: ProviderResult[]) {
  const recorder = new FakeSearchRecorder();
  const metrics = new FakeSearchMetrics();
  const useCase = new SearchFlightsUseCase({
    gateway: new FakeFlightOffersGateway(results),
    strategy: new CheapestStrategy(),
    recorder,
    metrics,
  });
  return { useCase, recorder, metrics };
}

describe("SearchFlightsUseCase", () => {
  it("consolida o mesmo voo vendido por dois providers numa oferta só", async () => {
    const { useCase } = setup([
      providerResult({ provider: "provider-a", offers: [offer({ provider: "provider-a" })] }),
      providerResult({ provider: "provider-b", offers: [offer({ provider: "provider-b" })] }),
    ]);

    const outcome = await useCase.execute(QUERY);

    expect(outcome.flights).toHaveLength(1);
  });

  it("marca como parcial quando algum provider falhou", async () => {
    const { useCase } = setup([
      providerResult({ provider: "provider-a", offers: [offer()] }),
      providerResult({ provider: "provider-b", status: "timeout" }),
    ]);

    const outcome = await useCase.execute(QUERY);

    expect({ partial: outcome.partial, unavailable: outcome.unavailable }).toEqual({
      partial: true,
      unavailable: false,
    });
  });

  it("marca como indisponível quando nenhum provider respondeu", async () => {
    const { useCase } = setup([
      providerResult({ provider: "provider-a", status: "error" }),
      providerResult({ provider: "provider-b", status: "circuit_open" }),
    ]);

    const outcome = await useCase.execute(QUERY);

    expect(outcome.unavailable).toBe(true);
  });

  it("registra a busca nas métricas e no recorder", async () => {
    const { useCase, recorder, metrics } = setup([providerResult({ offers: [offer()] })]);

    const outcome = await useCase.execute(QUERY, "req-1");

    expect([recorder.outcomes, metrics.recorded]).toEqual([[outcome], [outcome]]);
  });
});
