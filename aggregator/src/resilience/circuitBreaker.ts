/**
 * Circuit breaker por provider. N falhas seguidas abrem o circuito (chamadas
 * falham na hora, sem gastar os 3s); após `resetTimeoutMs`, uma chamada de
 * teste (half-open) decide se fecha ou reabre. Estado em memória do processo.
 */

export type CircuitState = "closed" | "open" | "half_open";

export class CircuitOpenError extends Error {
  override name = "CircuitOpenError";
  constructor(readonly provider: string) {
    super(`circuito aberto para ${provider}`);
  }
}

export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeoutMs: number;
  now?: () => number;
  onStateChange?: (name: string, state: CircuitState) => void;
}

export class CircuitBreaker {
  private current: CircuitState = "closed";
  private failures = 0;
  private openedAt = 0;
  private trialInFlight = false;
  private readonly now: () => number;

  constructor(
    readonly name: string,
    private readonly opts: CircuitBreakerOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  get state(): CircuitState {
    if (this.current === "open" && this.now() - this.openedAt >= this.opts.resetTimeoutMs) {
      this.transition("half_open");
    }
    return this.current;
  }

  /** Pede permissão para chamar o provider; lança `CircuitOpenError` se negada. */
  acquire(): void {
    const state = this.state;
    if (state === "open") throw new CircuitOpenError(this.name);
    if (state === "half_open") {
      if (this.trialInFlight) throw new CircuitOpenError(this.name);
      this.trialInFlight = true;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.trialInFlight = false;
    this.transition("closed");
  }

  recordFailure(): void {
    this.trialInFlight = false;
    this.failures++;
    if (this.current === "half_open" || this.failures >= this.opts.failureThreshold) {
      this.openedAt = this.now();
      this.transition("open");
    }
  }

  private transition(next: CircuitState): void {
    if (next === this.current) return;
    this.current = next;
    this.opts.onStateChange?.(this.name, next);
  }
}
