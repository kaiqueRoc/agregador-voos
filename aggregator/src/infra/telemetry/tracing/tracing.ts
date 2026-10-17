/**
 * OpenTelemetry: traces de HTTP de entrada, fetch para os providers (undici) e
 * Redis e Postgres, exportados via OTLP/HTTP. Logs pino ganham trace_id.
 *
 * Precisa carregar ANTES da aplicação para instrumentar os módulos — por isso
 * roda via `node --import ./dist/infra/telemetry/tracing/tracing.js dist/server.js`.
 * Com OTEL_ENABLED diferente de "true" não carrega nada.
 */
if (process.env.OTEL_ENABLED === "true") {
  // O app é ESM: as instrumentações de pacotes (ioredis, pino, pg) só enxergam
  // `import` com o hook do import-in-the-middle registrado ANTES dos imports.
  const { register } = await import("node:module");
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");
  const { resourceFromAttributes } = await import("@opentelemetry/resources");
  const { HttpInstrumentation } = await import("@opentelemetry/instrumentation-http");
  const { UndiciInstrumentation } = await import("@opentelemetry/instrumentation-undici");
  const { IORedisInstrumentation } = await import("@opentelemetry/instrumentation-ioredis");
  const { PgInstrumentation } = await import("@opentelemetry/instrumentation-pg");
  const { PinoInstrumentation } = await import("@opentelemetry/instrumentation-pino");

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": process.env.OTEL_SERVICE_NAME ?? "flight-aggregator",
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => /^\/(health|ready|metrics)/.test(req.url ?? ""),
      }),
      new UndiciInstrumentation(),
      new IORedisInstrumentation(),
      new PgInstrumentation(),
      // Injeta trace_id/span_id em cada linha de log: do log direto ao trace no Jaeger.
      new PinoInstrumentation(),
    ],
  });
  sdk.start();
  process.once("SIGTERM", () => void sdk.shutdown());
}

export {};
