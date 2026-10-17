/** Data de hoje (YYYY-MM-DD) num fuso: às 23h em São Paulo, em UTC já é amanhã. */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
}
