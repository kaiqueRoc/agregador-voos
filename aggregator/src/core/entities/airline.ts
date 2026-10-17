/**
 * Grafia canônica da companhia ("Latam Airlines" → LATAM, "Passaredo" → VOEPASS).
 * Sem ela, a deduplicação não reconhece o mesmo voo vendido por providers diferentes.
 */

const ALIASES: Record<string, string> = {
  latam: "LATAM",
  tam: "LATAM",
  gol: "GOL",
  azul: "AZUL",
  voepass: "VOEPASS",
  passaredo: "VOEPASS",
};

const NOISE = /\b(linhas aereas|airlines?|s\.?a\.?)\b/g;

function foldAirlineName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Companhia desconhecida vira o nome sem acento/sufixo em maiúsculas. */
export function normalizeAirline(name: string): string {
  const folded = foldAirlineName(name);
  return ALIASES[folded] ?? folded.toUpperCase();
}
