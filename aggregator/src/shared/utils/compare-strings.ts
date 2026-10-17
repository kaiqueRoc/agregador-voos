/** Comparação por code unit: ao contrário de `localeCompare`, não depende do locale. */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
