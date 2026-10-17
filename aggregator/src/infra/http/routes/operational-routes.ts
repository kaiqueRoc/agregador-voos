import type { FastifyPluginAsync } from "fastify";
import type { OperationalController } from "../controllers/operational-controller.js";

export interface OperationalRoutesOptions {
  controller: OperationalController;
}

export const operationalRoutes: FastifyPluginAsync<OperationalRoutesOptions> = async (
  app,
  { controller },
) => {
  app.get("/", async (request) => controller.home(request));
  app.get("/health", async () => controller.health());
  app.get("/ready", async () => controller.ready());
  app.get("/metrics", async (request, reply) => controller.metrics(request, reply));
};
