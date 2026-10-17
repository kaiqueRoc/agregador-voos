import { describe, expect, it } from "vitest";
import { todayIn } from "../../../../src/shared/utils/dates.js";

describe("todayIn", () => {
  // 01:00 UTC de 18/10 ainda é 22:00 de 17/10 em São Paulo.
  const now = new Date("2026-10-18T01:00:00Z");

  it("devolve o dia em UTC quando o fuso é UTC", () => {
    expect(todayIn("UTC", now)).toBe("2026-10-18");
  });

  it("usa o dia do fuso pedido, não o do servidor", () => {
    expect(todayIn("America/Sao_Paulo", now)).toBe("2026-10-17");
  });
});
