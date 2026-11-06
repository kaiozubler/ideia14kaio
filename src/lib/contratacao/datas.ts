import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

/** "6 de dezembro de 2026" a partir de AAAA-MM-DD. */
export function dataCobranca(iso: string): string {
  return format(parseISO(iso), "d 'de' MMMM 'de' yyyy", { locale: ptBR });
}
