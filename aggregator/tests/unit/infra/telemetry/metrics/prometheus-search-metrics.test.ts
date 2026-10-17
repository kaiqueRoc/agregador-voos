import { describe, expect, it } from "vitest";
import { PrometheusSearchMetrics } from "../../../../../src/infra/telemetry/metrics/prometheus-search-metrics.js";
import { offer } from "../../../../mocks/factories/offer-factory.js";
import { sampleOutcome } from "../../../../mocks/factories/search-outcome-factory.js";

describe("PrometheusSearchMetrics", () => {
  it("não lança quando a oferta escolhida rende menos comissão que a mais barata", () => {
    const cheapest = offer({ provider: "provider-c", priceCents: 100_000, commissionBps: 200 });
    const selected = offer({ provider: "provider-a", priceCents: 101_000, commissionBps: 100 });
    const outcome = sampleOutcome({
      flights: [{ selected, cheapest, candidates: [cheapest, selected] }],
    });

    expect(() => new PrometheusSearchMetrics().recordSearch(outcome)).not.toThrow();
  });
});
