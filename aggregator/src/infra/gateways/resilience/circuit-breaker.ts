/**
 * Circuit breaker por provider. N falhas seguidas abrem o circuito (chamadas
 * falham na hora, sem gastar os 3s); após `resetTimeoutMs`, uma chamada de
 * teste (half-open) decide se fecha ou reabre. Estado em memória do processo.
 */
import type { CircuitState } from "../../../core/gateways/flight-offers-gateway.js";

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

  /** Só consulta: aberto há mais de `resetTimeoutMs` já conta como half-open. */
  get state(): CircuitState {
    return this.current === "open" && this.resetTimeoutElapsed() ? "half_open" : this.current;
  }

  /** Pede permissão para chamar o provider. No half-open, só a chamada de teste passa. */
  tryAcquire(): boolean {
    const state = this.state;
    if (state === "open") return false;
    if (state === "half_open") {
      if (this.trialInFlight) return false;
      this.transition("half_open");
      this.trialInFlight = true;
    }
    return true;
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

  private resetTimeoutElapsed(): boolean {
    return this.now() - this.openedAt >= this.opts.resetTimeoutMs;
  }

  private transition(next: CircuitState): void {
    if (next === this.current) return;
    this.current = next;
    this.opts.onStateChange?.(this.name, next);
  }
}
