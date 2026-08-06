/**
 * Importador/sincronizador das tabelas TUSS da ANS.
 *
 * - percorre TODAS as páginas disponíveis (descobertas em runtime, sem número fixo)
 * - páginas consumidas em paralelo com concorrência limitada
 * - upsert em lote por `codigo_tuss` (idempotente)
 * - nunca remove registros antigos
 * - retomável: grava progresso em `tuss_sync_log`
 */
import {
  buscarPagina,
  descobrirTotalPaginas,
  getOclConfig,
  sleep,
  type OclConcept,
  type OclConfig,
} from "./ocl-client.server";
import { mapearConceito, type TussRow } from "./mapper";

export type TussSyncOptions = {
  /** slug da tabela na ANS (padrão: tuss-22) */
  tabela?: string;
  /** páginas buscadas em paralelo (1-10) */
  concurrency?: number;
  /** páginas agrupadas por gravação em lote */
  batchPages?: number;
  /** tempo máximo de execução; ao estourar grava progresso e para */
  maxDurationMs?: number;
  /** página inicial (padrão: 1, ou retomada do log interrompido) */
  startPage?: number;
  /** retomar execução interrompida anterior */
  resume?: boolean;
};

export type TussSyncResult = {
  log_id: string;
  tabela: string;
  status: "concluida" | "interrompida" | "erro";
  paginas_total: number;
  paginas_processadas: number;
  quantidade_processada: number;
  quantidade_novas: number;
  quantidade_atualizadas: number;
  quantidade_erros: number;
  mensagem_erro: string | null;
};

export async function syncTabelaTuss(opts: TussSyncOptions = {}): Promise<TussSyncResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const tabela = opts.tabela ?? "tuss-22";
  const cfg: OclConfig = getOclConfig({ tabela });
  const concurrency = Math.min(Math.max(opts.concurrency ?? 6, 1), 10);
  const batchPages = Math.min(Math.max(opts.batchPages ?? 12, 1), 60);
  const maxDurationMs = opts.maxDurationMs ?? 120_000;
  const inicio = Date.now();

  let logId: string | null = null;
  let paginasProcessadas = 0;
  let processadas = 0;
  let novas = 0;
  let atualizadas = 0;
  let erros = 0;
  let paginaAtual = Math.max(opts.startPage ?? 1, 1);
  let totalPaginas = 0;

  if (opts.resume !== false && !opts.startPage) {
    const { data: pendente } = await supabaseAdmin
      .from("tuss_sync_log")
      .select("*")
      .eq("tabela", tabela)
      .eq("status", "interrompida")
      .order("data_inicio", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pendente) {
      logId = pendente.id as string;
      paginasProcessadas = (pendente.paginas_processadas as number) ?? 0;
      processadas = (pendente.quantidade_processada as number) ?? 0;
      novas = (pendente.quantidade_novas as number) ?? 0;
      atualizadas = (pendente.quantidade_atualizadas as number) ?? 0;
      erros = (pendente.quantidade_erros as number) ?? 0;
      paginaAtual = paginasProcessadas + 1;
      await supabaseAdmin
        .from("tuss_sync_log")
        .update({ status: "em_andamento", mensagem_erro: null })
        .eq("id", logId);
    }
  }

  if (!logId) {
    const { data: novoLog, error } = await supabaseAdmin
      .from("tuss_sync_log")
      .insert({ tabela, status: "em_andamento" })
      .select("id")
      .single();
    if (error || !novoLog) throw new Error(`Falha ao criar log TUSS: ${error?.message}`);
    logId = novoLog.id as string;
  }

  type LogPatch = Partial<{
    status: string;
    mensagem_erro: string | null;
    paginas_total: number;
    paginas_processadas: number;
    quantidade_processada: number;
    quantidade_novas: number;
    quantidade_atualizadas: number;
    quantidade_erros: number;
    data_fim: string | null;
  }>;

  const gravarLog = async (patch: LogPatch) => {
    await supabaseAdmin.from("tuss_sync_log").update(patch).eq("id", logId);
  };

  const finalizar = async (
    status: TussSyncResult["status"],
    mensagem_erro: string | null,
  ): Promise<TussSyncResult> => {
    const payload = {
      status,
      mensagem_erro,
      paginas_total: totalPaginas,
      paginas_processadas: paginasProcessadas,
      quantidade_processada: processadas,
      quantidade_novas: novas,
      quantidade_atualizadas: atualizadas,
      quantidade_erros: erros,
      data_fim: status === "interrompida" ? null : new Date().toISOString(),
    };
    await gravarLog(payload);
    return { log_id: logId!, tabela, ...payload, status } as TussSyncResult;
  };

  try {
    totalPaginas = await descobrirTotalPaginas(cfg);
    await gravarLog({ paginas_total: totalPaginas });
    if (!totalPaginas) return finalizar("concluida", null);

    while (paginaAtual <= totalPaginas) {
      if (Date.now() - inicio > maxDurationMs) {
        return finalizar("interrompida", "Tempo máximo de execução atingido — será retomada.");
      }

      const paginas: number[] = [];
      for (let p = paginaAtual; p < paginaAtual + batchPages && p <= totalPaginas; p++) {
        paginas.push(p);
      }

      const conceitos: OclConcept[] = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < paginas.length) {
          const page = paginas[cursor++];
          try {
            const { itens } = await buscarPagina(cfg, page);
            conceitos.push(...itens);
          } catch (err) {
            erros++;
            console.error(`[sync-tuss] erro na página ${page}:`, err);
          }
          await sleep(60);
        }
      };
      await Promise.all(Array.from({ length: concurrency }, worker));

      const res = await persistir(supabaseAdmin, conceitos, tabela);
      processadas += res.processadas;
      novas += res.novas;
      atualizadas += res.atualizadas;
      erros += res.erros;

      paginaAtual += paginas.length;
      paginasProcessadas = paginaAtual - 1;
      await gravarLog({
        paginas_processadas: paginasProcessadas,
        quantidade_processada: processadas,
        quantidade_novas: novas,
        quantidade_atualizadas: atualizadas,
        quantidade_erros: erros,
      });
    }

    return finalizar("concluida", null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-tuss] falha geral:", err);
    return finalizar("erro", msg.slice(0, 1000));
  }
}

/** Sincronização da TUSS-22 (Procedimentos em Saúde). */
export function syncTuss22(opts: Omit<TussSyncOptions, "tabela"> = {}) {
  return syncTabelaTuss({ ...opts, tabela: "tuss-22" });
}

type AdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

async function persistir(supabaseAdmin: AdminClient, conceitos: OclConcept[], tabela: string) {
  let novas = 0;
  let atualizadas = 0;
  let erros = 0;

  const agora = new Date().toISOString();
  const porCodigo = new Map<string, TussRow>();
  for (const c of conceitos) {
    const row = mapearConceito(c, tabela, agora);
    if (!row) {
      erros++;
      continue;
    }
    porCodigo.set(row.codigo_tuss, row);
  }

  const rows = [...porCodigo.values()];
  if (!rows.length) return { processadas: 0, novas, atualizadas, erros };

  // quais já existem? (para contar novas x atualizadas)
  const codigos = rows.map((r) => r.codigo_tuss);
  const existentes = new Set<string>();
  for (let i = 0; i < codigos.length; i += 500) {
    const { data } = await supabaseAdmin
      .from("tuss_procedimentos")
      .select("codigo_tuss")
      .in("codigo_tuss", codigos.slice(i, i + 500));
    for (const r of data ?? []) existentes.add(r.codigo_tuss as string);
  }

  for (let i = 0; i < rows.length; i += 250) {
    const lote = rows.slice(i, i + 250);
    const { error } = await supabaseAdmin
      .from("tuss_procedimentos")
      .upsert(lote as never, { onConflict: "codigo_tuss" });
    if (error) {
      erros += lote.length;
      console.error("[sync-tuss] upsert falhou:", error.message);
      continue;
    }
    for (const r of lote) {
      if (existentes.has(r.codigo_tuss)) atualizadas++;
      else novas++;
    }
  }

  return { processadas: rows.length, novas, atualizadas, erros };
}
