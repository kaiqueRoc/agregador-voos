import { type Logger as PinoLogger, pino } from "pino";
import type { Config } from "../../../config/env/load-config.js";

export function createLogger(config: Pick<Config, "logLevel" | "logPretty">): PinoLogger {
  return pino({
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
}
