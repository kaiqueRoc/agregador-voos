/** Contrato HTTP público da busca: validação da entrada. */
import { z } from "zod";

const iata = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "código IATA de 3 letras")
  .transform((s) => s.toUpperCase());

const isoDate = z.iso.date("data no formato YYYY-MM-DD");

/**
 * Aceita os nomes em inglês e, por conveniência, os do enunciado (origem/destino/data).
 * `today` é injetado para os testes não dependerem do relógio.
 */
export function searchRequestSchema(today: () => string) {
  return z
    .preprocess(
      (body) => {
        if (!body || typeof body !== "object") return body;
        const b = body as Record<string, unknown>;
        return {
          origin: b.origin ?? b.origem,
          destination: b.destination ?? b.destino,
          date: b.date ?? b.data,
        };
      },
      z.object({ origin: iata, destination: iata, date: isoDate }),
    )
    .refine((q) => q.origin !== q.destination, {
      message: "origem e destino devem ser diferentes",
      path: ["destination"],
    })
    .refine((q) => q.date >= today(), {
      message: "data no passado: a busca precisa ser de hoje em diante",
      path: ["date"],
    });
}
