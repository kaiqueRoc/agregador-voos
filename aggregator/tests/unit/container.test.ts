import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env/load-config.js";
import { buildContainer } from "../../src/container.js";
import { silentLogger } from "../mocks/telemetry/silent-logger.js";

describe("buildContainer", () => {
  it("monta só os providers habilitados e funciona sem Redis", async () => {
    const container = await buildContainer(
      loadConfig({ CACHE_ENABLED: "false", PROVIDER_B_ENABLED: "false" }),
      silentLogger,
    );
    const report = await container.checkReadiness.execute();
    expect(Object.keys(report.circuits)).toEqual(["provider-a", "provider-c"]);
    expect(report.cacheHealthy).toBe(true);
    await container.close();
  });
});
