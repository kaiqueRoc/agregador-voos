import type {
  SqlClient,
  SqlPool,
} from "../../../src/infra/database/repositories/postgres-search-recorder.js";

/** Pool que registra os comandos recebidos e falha sob demanda. */
export class FakePool implements SqlPool {
  readonly log: string[] = [];
  failOn?: RegExp;
  delayMs = 0;
  ended = false;

  async connect(): Promise<SqlClient> {
    return {
      query: async (text: string) => {
        if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
        const cmd = text.trim().split(/\s+/).slice(0, 3).join(" ");
        this.log.push(cmd);
        if (this.failOn?.test(text)) throw new Error("db error");
        return { rows: [] };
      },
      release: () => this.log.push("release"),
    };
  }
  async query(text: string) {
    if (this.failOn?.test(text)) throw new Error("db down");
    return { rows: [] };
  }
  async end() {
    this.ended = true;
  }
}
