import type { KeyValueStore } from "../../../src/infra/gateways/flights/offer-cache.js";

/** Redis em memória com o mesmo contrato que usamos do ioredis. */
export class FakeKeyValueStore implements KeyValueStore {
  readonly data = new Map<string, { value: string; ttl: number }>();
  failing = false;

  async mget(...keys: string[]) {
    this.failIfDown();
    return keys.map((k) => this.data.get(k)?.value ?? null);
  }
  async set(key: string, value: string, _mode: "EX", seconds: number) {
    this.failIfDown();
    this.data.set(key, { value, ttl: seconds });
    return "OK";
  }
  async ping() {
    this.failIfDown();
    return "PONG";
  }

  private failIfDown(): void {
    if (this.failing) throw new Error("redis down");
  }
}
