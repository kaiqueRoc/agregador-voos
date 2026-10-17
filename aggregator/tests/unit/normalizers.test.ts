import { describe, expect, it } from "vitest";
import {
  normalizeA,
  normalizeB,
  normalizeC,
  ProviderPayloadError,
} from "../../src/providers/normalizers.js";
import { QUERY } from "../helpers.js";

const ctx = (provider: string, commissionBps = 100) => ({ query: QUERY, provider, commissionBps });

describe("normalizeA", () => {
  it("converte o contrato do provider A para Offer", () => {
    const { offers, discarded } = normalizeA(
      {
        flights: [
          {
            company: "LATAM",
            price: 801.48,
            depart_at: "2026-10-20T08:00:00",
            arrive_at: "2026-10-20T11:10:00",
          },
        ],
      },
      ctx("provider-a", 100),
    );
    expect(discarded).toEqual([]);
    expect(offers).toEqual([
      {
        provider: "provider-a",
        airline: "LATAM",
        origin: "GRU",
        destination: "GIG",
        departureAt: "2026-10-20T08:00",
        arrivalAt: "2026-10-20T11:10",
        priceCents: 80_148,
        currency: "BRL",
        commissionBps: 100,
      },
    ]);
  });

  it("não sofre com erro de ponto flutuante ao converter reais em centavos", () => {
    const { offers } = normalizeA(
      {
        flights: [
          {
            company: "GOL",
            price: 0.1 + 0.2, // 0.30000000000000004
            depart_at: "2026-10-20T08:00:00",
            arrive_at: "2026-10-20T09:00:00",
          },
        ],
      },
      ctx("provider-a"),
    );
    expect(offers[0]?.priceCents).toBe(30);
  });

  it("descarta registro com chegada antes da partida", () => {
    const { offers, discarded } = normalizeA(
      {
        flights: [
          {
            company: "GOL",
            price: 500,
            depart_at: "2026-10-20T10:00:00",
            arrive_at: "2026-10-20T09:00:00",
          },
        ],
      },
      ctx("provider-a"),
    );
    expect(offers).toHaveLength(0);
    expect(discarded).toEqual(["chegada antes da partida"]);
  });
});

describe("normalizeB", () => {
  it("converte centavos, normaliza companhia e resolve HH:MM com a data da busca", () => {
    const { offers } = normalizeB(
      {
        results: [
          {
            airline_name: "Passaredo",
            amount: 46_190,
            currency: "BRL",
            departure: "22:30",
            arrival: "01:15",
          },
        ],
      },
      ctx("provider-b", 150),
    );
    expect(offers[0]).toMatchObject({
      airline: "VOEPASS",
      priceCents: 46_190,
      departureAt: "2026-10-20T22:30",
      arrivalAt: "2026-10-21T01:15", // virou a meia-noite
      commissionBps: 150,
    });
  });

  it("descarta tarifa em moeda estrangeira (não fazemos câmbio)", () => {
    const { offers, discarded } = normalizeB(
      {
        results: [
          {
            airline_name: "Copa Airlines",
            amount: 21_000,
            currency: "USD",
            departure: "14:40",
            arrival: "18:05",
          },
        ],
      },
      ctx("provider-b"),
    );
    expect(offers).toHaveLength(0);
    expect(discarded).toEqual(["moeda não suportada: USD"]);
  });

  it("descarta amount que não é inteiro em centavos", () => {
    const { discarded } = normalizeB(
      {
        results: [
          {
            airline_name: "Gol",
            amount: 123.45,
            currency: "BRL",
            departure: "10:00",
            arrival: "11:00",
          },
        ],
      },
      ctx("provider-b"),
    );
    expect(discarded).toHaveLength(1);
  });
});

describe("normalizeC", () => {
  it("descarta tarifa zerada (assento esgotado) sem perder os registros válidos", () => {
    const { offers, discarded } = normalizeC(
      {
        data: [
          {
            carrier: "Latam Airlines",
            fare: 812.3,
            departure_time: "08:00",
            arrival_time: "11:10",
          },
          { carrier: "Gol", fare: 0.0, departure_time: "15:00", arrival_time: "18:20" },
        ],
      },
      ctx("provider-c", 200),
    );
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ airline: "LATAM", priceCents: 81_230 });
    expect(discarded).toEqual(["preço não positivo: 0"]);
  });

  it.each([
    [{ carrier: "Gol", departure_time: "15:00", arrival_time: "18:20" }, "campo ausente: fare"],
    [
      { carrier: "Gol", fare: "abc", departure_time: "15:00", arrival_time: "18:20" },
      'preço inválido: "abc"',
    ],
    [
      { carrier: "Gol", fare: 10, departure_time: "25:00", arrival_time: "18:20" },
      "horário inválido",
    ],
    [
      { carrier: "", fare: 10, departure_time: "15:00", arrival_time: "18:20" },
      "companhia inválida",
    ],
    ["não sou objeto", "registro não é objeto"],
  ])("descarta registro inválido %#", (record, reason) => {
    const { offers, discarded } = normalizeC({ data: [record] }, ctx("provider-c"));
    expect(offers).toHaveLength(0);
    expect(discarded[0]).toContain(reason);
  });
});

describe("envelope inválido", () => {
  it.each([
    [normalizeA, { results: [] }],
    [normalizeB, { flights: [] }],
    [normalizeC, null],
    [normalizeC, { data: "não é lista" }],
  ])("lança ProviderPayloadError %#", (normalize, payload) => {
    expect(() => normalize(payload, ctx("x"))).toThrow(ProviderPayloadError);
  });
});
