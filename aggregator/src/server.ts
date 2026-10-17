/** Entry point: carrega config, monta dependências, sobe o HTTP e trata shutdown. */
import { pino } from "pino";
import { loadConfig } from "./config.js";
import { buildContainer } from "./container.js";
import { buildApp } from "./http/app.js";

const config = loadConfig();

const logger = pino({
  level: config.logLevel,
  base: { service: "flight-aggregator" },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Nunca logar credenciais, mesmo que um dia alguém logue headers ou config.
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.databaseUrl"],
    censor: "[redacted]",
  },
  ...(config.logPretty ? { transport: { target: "pino-pretty" } } : {}),
});

const container = await buildContainer(config, logger);
const app = buildApp({ ...container, logger, rateLimit: config.rateLimit });

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
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    logger.info({ signal }, "shutting_down");
    await app.close();
    await container.close();
    process.exit(0);
  });
}
