import { describe, expect, it } from "vitest";
import {
  BalancedStrategy,
  buildStrategy,
  CheapestStrategy,
  MaxCommissionStrategy,
} from "../../src/domain/selection.js";
import { commissionCents } from "../../src/domain/types.js";
import { offer } from "../helpers.js";

// Os markups reais dos mocks: B é 1,5% mais barato que A; C é 1,2% mais caro.
const a = offer({ provider: "provider-a", priceCents: 100_000 }); // R$ 1.000,00 → comissão R$ 10,00
const b = offer({ provider: "provider-b", priceCents: 98_500 }); //  R$   985,00 → comissão R$ 14,78
const c = offer({ provider: "provider-c", priceCents: 101_200 }); // R$ 1.012,00 → comissão R$ 20,24

const balanced = new BalancedStrategy(200, 3000); // 2%, teto R$ 30

describe("comissão", () => {
  it("calcula o exemplo do enunciado: R$ 1.000 rende 10 / 15 / 20 reais", () => {
    expect(commissionCents(offer({ provider: "provider-a", priceCents: 100_000 }))).toBe(1000);
    expect(commissionCents(offer({ provider: "provider-b", priceCents: 100_000 }))).toBe(1500);
    expect(commissionCents(offer({ provider: "provider-c", priceCents: 100_000 }))).toBe(2000);
  });
});

describe("CheapestStrategy", () => {
  it("escolhe o menor preço", () => {
    expect(new CheapestStrategy().select([a, b, c])).toBe(b);
  });
});

describe("MaxCommissionStrategy", () => {
  it("escolhe a maior comissão em reais, mesmo mais cara", () => {
    expect(new MaxCommissionStrategy().select([a, b, c])).toBe(c);
  });
});

describe("BalancedStrategy", () => {
  it("oferta única é sempre a escolhida", () => {
    expect(balanced.select([a])).toBe(a);
  });

  it("mais barata E mais lucrativa: escolha óbvia (B domina A)", () => {
    expect(balanced.select([a, b])).toBe(b);
  });

  it("troca para comissão maior quando o cliente paga pouco a mais (C +1,2% sobre A)", () => {
    expect(balanced.select([a, c])).toBe(c);
  });

  it("NÃO troca quando a diferença passa da tolerância (C +2,74% sobre B)", () => {
    expect(balanced.select([b, c])).toBe(b);
    expect(balanced.select([a, b, c])).toBe(b);
  });

  it("o teto absoluto protege passagens caras: 2% de R$ 5.000 seria R$ 100, mas o limite é R$ 30", () => {
    const cheap = offer({ provider: "provider-a", priceCents: 500_000 });
    const plus25 = offer({ provider: "provider-c", priceCents: 502_500 }); // +R$ 25
    const plus40 = offer({ provider: "provider-c", priceCents: 504_000 }); // +R$ 40 (< 2%)
    expect(balanced.select([cheap, plus25])).toBe(plus25);
    expect(balanced.select([cheap, plus40])).toBe(cheap);
  });

  it("calcula o teto como o MENOR entre percentual e valor absoluto", () => {
    expect(balanced.ceiling(100_000)).toBe(102_000); // 2% = R$ 20 < R$ 30
    expect(balanced.ceiling(500_000)).toBe(503_000); // 2% = R$ 100 → limitado a R$ 30
  });

  it("aceita exatamente no limite da tolerância", () => {
    const edge = offer({ provider: "provider-c", priceCents: 102_000 });
    expect(balanced.select([a, edge])).toBe(edge);
  });

  it("tolerância zero vira 'mais barato, desempate pela comissão'", () => {
    const strict = new BalancedStrategy(0, 0);
    const sameA = offer({ provider: "provider-a", priceCents: 100_000 });
    const sameC = offer({ provider: "provider-c", priceCents: 100_000 });
    expect(strict.select([a, c])).toBe(a);
    expect(strict.select([sameA, sameC])).toBe(sameC);
  });

  it("é determinística independente da ordem de entrada", () => {
    const orders = [
      [a, b, c],
      [c, b, a],
      [b, a, c],
    ];
    for (const offers of orders) expect(balanced.select(offers)).toBe(b);
  });

  it("empate total cai no nome do provider (estável)", () => {
    const x = offer({ provider: "provider-x", priceCents: 1000, commissionBps: 100 });
    const y = offer({ provider: "provider-y", priceCents: 1000, commissionBps: 100 });
    expect(balanced.select([y, x])).toBe(x);
  });
});

describe("buildStrategy", () => {
  it.each([
    ["cheapest", CheapestStrategy],
    ["max_commission", MaxCommissionStrategy],
    ["balanced", BalancedStrategy],
  ] as const)("%s", (name, cls) => {
    const s = buildStrategy({ strategy: name, toleranceBps: 200, toleranceMaxCents: 3000 });
    expect(s).toBeInstanceOf(cls);
    expect(s.name).toBe(name);
  });

  it("lança se chamada sem ofertas", () => {
    expect(() => balanced.select([])).toThrow();
  });
});
