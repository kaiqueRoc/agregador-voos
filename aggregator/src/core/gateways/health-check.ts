/** Dependência externa que sabe dizer se está respondendo (cache, banco). */
export interface HealthCheck {
  isHealthy(): Promise<boolean>;
}
