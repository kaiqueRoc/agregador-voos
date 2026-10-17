/** Entry point: carrega config, monta dependências, sobe o HTTP e trata shutdown. */
import { loadConfig } from "./config/env/load-config.js";
import { buildContainer } from "./container.js";
import { buildApp } from "./infra/http/build-app.js";
import { createLogger } from "./infra/telemetry/logger/create-logger.js";
import { todayIn } from "./shared/utils/dates.js";

const config = loadConfig();
const logger = createLogger(config);

const container = await buildContainer(config, logger);
const app = buildApp({
  ...container,
  logger,
  rateLimit: config.rateLimit,
  today: () => todayIn(config.searchTimezone),
});

logger.info(
  {
    strategy: config.selection.strategy,
    providers: config.providers.filter((p) => p.enabled).map((p) => p.name),
    cache: config.cache.enabled,
    persistence: config.persistence.enabled,
  },
  "starting",
);

await app.listen({ port: config.port, host: config.host });

// Graceful shutdown: para de aceitar conexões, termina as em voo, espera as
// gravações pendentes no banco e fecha Redis/Postgres.
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  logger.info({ signal }, "shutting_down");
  try {
    await app.close();
    await container.close();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "shutdown_failed");
    process.exit(1);
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, shutdown);
}
