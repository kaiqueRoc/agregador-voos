import { describe, expect, it } from "vitest";
import { loadConfig } from "../../../../src/config/env/load-config.js";

describe("loadConfig", () => {
  it("defaults seguem o enunciado: 3s, TTL de 5 min, comissões 1 / 1,5 / 2%", () => {
    const cfg = loadConfig({});
    expect(cfg.providerTimeoutMs).toBe(3000);
    expect(cfg.cache.ttlSeconds).toBe(300);
    expect(cfg.providers.map((p) => [p.name, p.commissionBps])).toEqual([
      ["provider-a", 100],
      ["provider-b", 150],
      ["provider-c", 200],
    ]);
    expect(cfg.selection).toEqual({
      strategy: "balanced",
      toleranceBps: 200,
      toleranceMaxCents: 3000,
    });
  });

  it("feature flags via env", () => {
    const cfg = loadConfig({
      SELECTION_STRATEGY: "cheapest",
      PROVIDER_C_ENABLED: "false",
      CACHE_ENABLED: "0",
      PROVIDER_B_COMMISSION_BPS: "175",
    });
    expect(cfg.selection.strategy).toBe("cheapest");
    expect(cfg.providers.find((p) => p.name === "provider-c")?.enabled).toBe(false);
    expect(cfg.cache.enabled).toBe(false);
    expect(cfg.providers.find((p) => p.name === "provider-b")?.commissionBps).toBe(175);
  });

  it("falha na subida com config inválida (fail fast)", () => {
    expect(() => loadConfig({ SELECTION_STRATEGY: "random" })).toThrow();
    expect(() => loadConfig({ PROVIDER_TIMEOUT_MS: "-1" })).toThrow();
    expect(() => loadConfig({ PROVIDER_A_URL: "não é url" })).toThrow();
    expect(() => loadConfig({ SEARCH_TIMEZONE: "Marte/Olympus" })).toThrow();
  });

  it("recusa subir com todos os providers desligados", () => {
    const allDisabled = {
      PROVIDER_A_ENABLED: "false",
      PROVIDER_B_ENABLED: "false",
      PROVIDER_C_ENABLED: "false",
    };
    expect(() => loadConfig(allDisabled)).toThrow(/pelo menos um PROVIDER/);
  });
});
