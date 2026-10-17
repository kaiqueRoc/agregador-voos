import { describe, expect, it } from "vitest";
import { normalizeAirline } from "../../src/domain/airlines.js";

describe("normalizeAirline", () => {
  it.each([
    ["LATAM", "LATAM"],
    ["Latam", "LATAM"],
    ["Latam Airlines", "LATAM"],
    ["GOL", "GOL"],
    ["Gol Linhas Aéreas", "GOL"],
    ["AZUL", "AZUL"],
    ["Azul Linhas Aereas", "AZUL"],
    ["  azul  ", "AZUL"],
    ["VOEPASS", "VOEPASS"],
    ["Passaredo", "VOEPASS"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeAirline(input)).toBe(expected);
  });

  it("companhia desconhecida vira forma canônica estável", () => {
    expect(normalizeAirline("Copa Airlines")).toBe("COPA");
    expect(normalizeAirline("COPA")).toBe("COPA");
  });
});
