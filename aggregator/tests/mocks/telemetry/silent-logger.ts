import type { Logger } from "../../../src/infra/telemetry/logger/logger.js";

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
