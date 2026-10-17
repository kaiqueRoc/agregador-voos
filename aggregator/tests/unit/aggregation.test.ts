import { describe, expect, it } from "vitest";
import { aggregate } from "../../src/domain/aggregation.js";
import { BalancedStrategy, CheapestStrategy } from "../../src/domain/selection.js";
import { offer } from "../helpers.js";

describe("aggregate", () => {
  it("deduplica o mesmo voo vendido por providers diferentes", () => {
    const flights = aggregate(
      [
        offer({ provider: "provider-a", priceCents: 100_000 }),
        offer({ provider: "provider-b", priceCents: 98_500 }),
        offer({ provider: "provider-c", priceCents: 101_200 }),
      ],
      new BalancedStrategy(200, 3000),
    );
    expect(flights).toHaveLength(1);
    expect(flights[0]?.selected.provider).toBe("provider-b");
    expect(flights[0]?.candidates.map((o) => o.provider)).toEqual([
      "provider-b",
      "provider-a",
      "provider-c",
    ]);
  });

  it("não junta voos diferentes (outra companhia ou outro horário)", () => {
    const flights = aggregate(
      [
        offer({ airline: "LATAM", departureAt: "2026-10-20T08:00" }),
        offer({ airline: "GOL", departureAt: "2026-10-20T08:00" }),
        offer({ airline: "LATAM", departureAt: "2026-10-20T09:00" }),
      ],
      new CheapestStrategy(),
    );
    expect(flights).toHaveLength(3);
  });

  it("ordena por preço, depois partida, companhia e provider", () => {
    const flights = aggregate(
      [
        offer({ airline: "GOL", priceCents: 50_000, departureAt: "2026-10-20T10:00" }),
        offer({ airline: "AZUL", priceCents: 50_000, departureAt: "2026-10-20T10:00" }),
        offer({ airline: "LATAM", priceCents: 50_000, departureAt: "2026-10-20T07:00" }),
        offer({ airline: "VOEPASS", priceCents: 30_000, departureAt: "2026-10-20T22:00" }),
      ],
      new CheapestStrategy(),
    );
    expect(flights.map((f) => f.selected.airline)).toEqual(["VOEPASS", "LATAM", "AZUL", "GOL"]);
  });

  it("é determinística: mesma entrada em qualquer ordem gera a mesma saída", () => {
    const input = [
      offer({ provider: "provider-a", airline: "GOL", priceCents: 70_000 }),
      offer({ provider: "provider-c", airline: "GOL", priceCents: 70_500 }),
      offer({ provider: "provider-b", airline: "AZUL", priceCents: 60_000 }),
      offer({ provider: "provider-a", airline: "AZUL", priceCents: 61_000 }),
    ];
    const strategy = new BalancedStrategy(200, 3000);
    const expected = aggregate(input, strategy);
    expect(aggregate([...input].reverse(), strategy)).toEqual(expected);
  });

  it("lista vazia gera resultado vazio", () => {
    expect(aggregate([], new CheapestStrategy())).toEqual([]);
  });
});
