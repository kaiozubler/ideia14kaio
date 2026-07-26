/**
 * Sincronizador da base local de interações medicamentosas (CRF-MG).
 *
 * Características:
 *  - lento e seguro: lotes pequenos, concorrência limitada, intervalo entre chamadas
 *  - idempotente: upsert por api_interacao_id e por par canônico
 *  - retomável: grava checkpoint em interacoes_sync_log.ultimo_medicamento_processado
 *  - resiliente: erro em um medicamento não cancela a rotina
 */
import {
  buscarInteracoesDoMedicamento,
  getCrfmgConfig,
  listarMedicamentos,
  RateLimitPersistenteError,
  sleep,
  type CrfmgConfig,
  type CrfmgInteracao,
  type CrfmgMedicamento,
} from "./crfmg.server";

export type SyncOptions = {
  /** requisições simultâneas (máx. recomendado: 3) */
  concurrency?: number;
  /** tamanho do lote processado antes de gravar checkpoint */
  batchSize?: number;
  /** intervalo entre chamadas em ms */
  delayMs?: number;
  /** tempo máximo de execução; ao estourar grava checkpoint e para */
  maxDurationMs?: number;
  /** retomar a última sincronização interrompida */
  resume?: boolean;
};

export type SyncResult = {
  log_id: string;
  status: "concluida" | "interrompida" | "erro";
  quantidade_processada: number;
  quantidade_novas: number;
  quantidade_atualizadas: number;
  quantidade_erros: number;
  ultimo_medicamento_processado: string | null;
  mensagem_erro: string | null;
};

export function normalizar(txt: string): string {
  return (txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

const clean = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return s || null;
};

export async function sincronizarInteracoes(opts: SyncOptions = {}): Promise<SyncResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const concurrency = Math.min(Math.max(opts.concurrency ?? 2, 1), 3);
  const batchSize = Math.max(opts.batchSize ?? 10, 1);
  const maxDurationMs = opts.maxDurationMs ?? 45_000;
  const cfg: CrfmgConfig = getCrfmgConfig(opts.delayMs ? { delayMs: opts.delayMs } : {});
  const iniciadoEm = Date.now();

  // ---- 1. Log: retomar interrompido ou criar novo -------------------------
  let logId: string | null = null;
  let checkpoint: string | null = null;
  let novas = 0;
  let atualizadas = 0;
  let erros = 0;
  let processadas = 0;

  if (opts.resume !== false) {
    const { data: pendente } = await supabaseAdmin
      .from("interacoes_sync_log")
      .select("*")
      .eq("status", "interrompida")
      .order("data_inicio", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pendente) {
      logId = pendente.id as string;
      checkpoint = (pendente.ultimo_medicamento_processado as string) ?? null;
      novas = pendente.quantidade_novas ?? 0;
      atualizadas = pendente.quantidade_atualizadas ?? 0;
      erros = pendente.quantidade_erros ?? 0;
      processadas = pendente.quantidade_processada ?? 0;
      await supabaseAdmin
        .from("interacoes_sync_log")
        .update({ status: "em_andamento", mensagem_erro: null })
        .eq("id", logId);
    }
  }

  if (!logId) {
    const { data: novoLog, error } = await supabaseAdmin
      .from("interacoes_sync_log")
      .insert({ status: "em_andamento" })
      .select("id")
      .single();
    if (error || !novoLog) throw new Error(`Falha ao criar log de sincronização: ${error?.message}`);
    logId = novoLog.id as string;
  }

  type LogPatch = Partial<{
    status: string;
    mensagem_erro: string | null;
    quantidade_processada: number;
    quantidade_novas: number;
    quantidade_atualizadas: number;
    quantidade_erros: number;
    ultimo_medicamento_processado: string | null;
    data_fim: string | null;
  }>;

  const gravarLog = async (patch: LogPatch) => {
    await supabaseAdmin.from("interacoes_sync_log").update(patch).eq("id", logId);
  };

  const finalizar = async (
    status: SyncResult["status"],
    mensagem_erro: string | null,
  ): Promise<SyncResult> => {
    const payload = {
      status,
      mensagem_erro,
      quantidade_processada: processadas,
      quantidade_novas: novas,
      quantidade_atualizadas: atualizadas,
      quantidade_erros: erros,
      ultimo_medicamento_processado: checkpoint,
      data_fim: status === "interrompida" ? null : new Date().toISOString(),
    };
    await gravarLog(payload);
    return { log_id: logId!, ...payload, status } as SyncResult;
  };

  try {
    // ---- 2. Catálogo de fármacos (1 requisição) -------------------------
    const catalogo = await listarMedicamentos(cfg);
    catalogo.sort((a, b) => a.id - b.id);

    if (catalogo.length) {
      const rows = catalogo.map((m) => ({
        api_id: m.id,
        nome: m.nome,
        nome_normalizado: normalizar(m.nome),
        indicacoes: clean(m.indicacoes),
        ultima_sincronizacao: new Date().toISOString(),
      }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await supabaseAdmin
          .from("medicamentos_crfmg")
          .upsert(rows.slice(i, i + 200), { onConflict: "api_id" });
        if (error) throw new Error(`Upsert catálogo falhou: ${error.message}`);
      }
      // vincula o catálogo às substâncias/medicamentos internos
      await supabaseAdmin.rpc("vincular_crfmg_substancias");
    }

    // mapa api_id -> uuid interno
    const uuidPorApiId = new Map<number, string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from("medicamentos_crfmg")
        .select("id, api_id")
        .range(from, from + 999);
      if (error) throw new Error(`Leitura do catálogo falhou: ${error.message}`);
      for (const r of data ?? []) uuidPorApiId.set(r.api_id as number, r.id as string);
      if (!data || data.length < 1000) break;
    }

    // ---- 3. Retomada -----------------------------------------------------
    let pendentes: CrfmgMedicamento[] = catalogo;
    if (checkpoint) {
      const idx = catalogo.findIndex((m) => m.nome === checkpoint);
      if (idx >= 0) pendentes = catalogo.slice(idx + 1);
    }

    // ---- 4. Loop em lotes pequenos, com concorrência limitada ------------
    for (let b = 0; b < pendentes.length; b += batchSize) {
      if (Date.now() - iniciadoEm > maxDurationMs) {
        return finalizar("interrompida", "Tempo máximo de execução atingido — será retomada.");
      }

      const lote = pendentes.slice(b, b + batchSize);
      const coletadas: CrfmgInteracao[] = [];
      let cursor = 0;

      const worker = async () => {
        while (cursor < lote.length) {
          const med = lote[cursor++];
          try {
            const inter = await buscarInteracoesDoMedicamento(cfg, med.nome);
            coletadas.push(...inter);
          } catch (err) {
            if (err instanceof RateLimitPersistenteError) throw err;
            erros++;
            console.error(`[sync-interacoes] erro em "${med.nome}":`, err);
          }
          processadas++;
          if (cfg.delayMs > 0) await sleep(cfg.delayMs);
        }
      };

      try {
        await Promise.all(Array.from({ length: concurrency }, worker));
      } catch (err) {
        if (err instanceof RateLimitPersistenteError) {
          checkpoint = lote[Math.max(cursor - 1, 0)]?.nome ?? checkpoint;
          return finalizar("interrompida", err.message);
        }
        throw err;
      }

      // ---- 5. Atualização incremental (nunca apaga tudo) -----------------
      const res = await persistirInteracoes(supabaseAdmin, coletadas, uuidPorApiId);
      novas += res.novas;
      atualizadas += res.atualizadas;
      erros += res.erros;

      checkpoint = lote[lote.length - 1]?.nome ?? checkpoint;
      await gravarLog({
        quantidade_processada: processadas,
        quantidade_novas: novas,
        quantidade_atualizadas: atualizadas,
        quantidade_erros: erros,
        ultimo_medicamento_processado: checkpoint,
      });
    }

    checkpoint = null;
    return finalizar("concluida", null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync-interacoes] falha geral:", err);
    return finalizar("erro", msg.slice(0, 1000));
  }
}

type AdminClient = Awaited<
  typeof import("@/integrations/supabase/client.server")
>["supabaseAdmin"];

async function persistirInteracoes(
  supabaseAdmin: AdminClient,
  interacoes: CrfmgInteracao[],
  uuidPorApiId: Map<number, string>,
) {
  let novas = 0;
  let atualizadas = 0;
  let erros = 0;

  // deduplica por par canônico dentro do próprio lote
  const porPar = new Map<
    string,
    { api_interacao_id: number; m1: string; m2: string; acao: string | null; mecanismo_efeito: string | null; recomendacoes: string | null }
  >();

  for (const it of interacoes) {
    const u1 = uuidPorApiId.get(it?.medicamento1?.id);
    const u2 = uuidPorApiId.get(it?.medicamento2?.id);
    if (!u1 || !u2 || u1 === u2) {
      erros++;
      continue;
    }
    // ordenação canônica: menor UUID sempre em medicamento_1_id
    const [m1, m2] = u1 < u2 ? [u1, u2] : [u2, u1];
    porPar.set(`${m1}|${m2}`, {
      api_interacao_id: it.id,
      m1,
      m2,
      acao: clean(it.acao),
      mecanismo_efeito: clean(it.mecanismo_efeito),
      recomendacoes: clean(it.recomendacoes),
    });
  }

  if (!porPar.size) return { novas, atualizadas, erros };

  const agora = new Date().toISOString();
  const pares = [...porPar.values()];

  // quais já existem? (para contar novas x atualizadas)
  const { data: existentes } = await supabaseAdmin
    .from("interacoes")
    .select("medicamento_1_id, medicamento_2_id")
    .in("medicamento_1_id", [...new Set(pares.map((p) => p.m1))]);
  const chavesExistentes = new Set(
    (existentes ?? []).map((r) => `${r.medicamento_1_id}|${r.medicamento_2_id}`),
  );

  for (const p of pares) {
    const row = {
      api_interacao_id: p.api_interacao_id,
      medicamento_1_id: p.m1,
      medicamento_2_id: p.m2,
      acao: p.acao,
      mecanismo_efeito: p.mecanismo_efeito,
      recomendacoes: p.recomendacoes,
      ultima_sincronizacao: agora,
    };
    const jaExiste = chavesExistentes.has(`${p.m1}|${p.m2}`);
    const { error } = await supabaseAdmin
      .from("interacoes")
      .upsert(row, { onConflict: "medicamento_1_id,medicamento_2_id" });
    if (error) {
      erros++;
      console.error("[sync-interacoes] upsert falhou:", error.message);
      continue;
    }
    if (jaExiste) atualizadas++;
    else novas++;
  }

  return { novas, atualizadas, erros };
}