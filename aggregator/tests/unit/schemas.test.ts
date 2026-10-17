import { describe, expect, it } from "vitest";
import { todayIn } from "../../src/http/schemas.js";

describe("todayIn", () => {
  it("usa o dia do fuso, não o do servidor (UTC)", () => {
    // 01:00 UTC de 18/10 ainda é 22:00 de 17/10 em São Paulo.
    const now = new Date("2026-10-18T01:00:00Z");
    expect(todayIn("UTC", now)).toBe("2026-10-18");
    expect(todayIn("America/Sao_Paulo", now)).toBe("2026-10-17");
  });
});
