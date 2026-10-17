export interface SearchQuery {
  origin: string; // IATA, maiúsculo
  destination: string;
  date: string; // YYYY-MM-DD
}

/** Identifica a busca (rota + data), para chaves de cache e de deduplicação de chamadas. */
export function searchKey({ origin, destination, date }: SearchQuery): string {
  return `${origin}:${destination}:${date}`;
}
