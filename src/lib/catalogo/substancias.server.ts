import type { SupabaseClient } from "@supabase/supabase-js";

export type SubstanciaCatalogo = {
  id_substancia: string;
  nome_exibicao: string;
  lista_portaria344?: string | null;
};

/**
 * Busca de substâncias para vincular medicamentos de protocolo.
 *
 * `buscar_genericos` só devolve substâncias com genérico cadastrado; biológicos
 * e oncológicos (trastuzumabe, pertuzumabe, gosserrelina) só existem como
 * referência, então a tabela `substancias` também é consultada. `nome_dcb` fica
 * em maiúsculas e sem acento (public.normaliza_substancia).
 */
export async function buscarSubstanciasCatalogo(
  supabase: SupabaseClient,
  termo: string,
): Promise<SubstanciaCatalogo[]> {
  const dcb = termo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[%_,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const [gen, todas] = await Promise.all([
    supabase.rpc("buscar_genericos", { termo }),
    dcb
      ? supabase
          .from("substancias")
          .select("id_substancia, nome_exibicao, lista_portaria344")
          .ilike("nome_dcb", `%${dcb}%`)
          .order("nome_exibicao")
          .limit(30)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (gen.error && todas.error) throw new Error(gen.error.message);
  const hits = new Map<string, SubstanciaCatalogo>();
  for (const h of [
    ...((gen.data as SubstanciaCatalogo[] | null) || []),
    ...((todas.data as SubstanciaCatalogo[] | null) || []),
  ])
    if (!hits.has(h.id_substancia))
      hits.set(h.id_substancia, {
        id_substancia: h.id_substancia,
        nome_exibicao: h.nome_exibicao,
        lista_portaria344: h.lista_portaria344 ?? null,
      });
  return [...hits.values()];
}
