import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";

/**
 * Modelos de mensagem (message templates) da clínica.
 * Leitura: o navegador lê comunicacao_whatsapp_modelos direto (RLS de dono).
 * Escrita: só por aqui, porque o status espelha a análise da Meta.
 *
 * POST { acao: "salvar", modelo, enviar?: boolean, exemplo_midia?: {base64,mime,nome} }
 *      Salva o rascunho; com enviar=true submete para análise da Meta
 *      (cria, ou edita se o modelo já existe na Meta).
 * POST { acao: "mapear", id, finalidade, variaveis }
 *      Só ajustes internos (para que serve o modelo e de onde vem cada variável).
 * POST { acao: "sincronizar" }
 *      Puxa todos os modelos da WABA (inclusive criados no Gerenciador do
 *      WhatsApp) e atualiza status/motivo de rejeição.
 * POST { acao: "excluir", id }
 *      Exclui na Meta (se já foi submetido) e localmente.
 */

const FINALIDADES = [
  "geral",
  "chamada",
  "lembrete_consulta",
  "confirmacao_agendamento",
  "envio_documento",
  "retorno",
  "cobranca",
];
const MAX_EXEMPLO_BYTES = 5 * 1024 * 1024;

function base64ParaBytes(b64: string): Uint8Array {
  const limpo = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(limpo);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function normalizarModelo(m: any) {
  const formato = m?.parameter_format === "NAMED" ? "NAMED" : "POSITIONAL";
  let cabecalho: any = null;
  const tipoCab = m?.cabecalho?.tipo;
  if (tipoCab === "TEXT")
    cabecalho = {
      tipo: "TEXT",
      texto: String(m.cabecalho.texto || ""),
      exemplo: String(m.cabecalho.exemplo || ""),
    };
  else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(tipoCab))
    cabecalho = { tipo: tipoCab, handle: m.cabecalho.handle || null };
  const botoes = Array.isArray(m?.botoes)
    ? m.botoes.slice(0, 10).map((b: any) => {
        if (b.tipo === "URL")
          return {
            tipo: "URL",
            texto: String(b.texto || ""),
            url: String(b.url || ""),
            exemplo: b.exemplo ? String(b.exemplo) : undefined,
          };
        if (b.tipo === "PHONE_NUMBER")
          return {
            tipo: "PHONE_NUMBER",
            texto: String(b.texto || ""),
            telefone: String(b.telefone || ""),
          };
        return { tipo: "QUICK_REPLY", texto: String(b.texto || "") };
      })
    : [];
  const exemplos =
    formato === "NAMED"
      ? m?.corpo_exemplos && !Array.isArray(m.corpo_exemplos)
        ? m.corpo_exemplos
        : {}
      : Array.isArray(m?.corpo_exemplos)
        ? m.corpo_exemplos.map(String)
        : [];
  return {
    nome: String(m?.nome || "")
      .trim()
      .toLowerCase(),
    idioma: String(m?.idioma || "pt_BR"),
    categoria: ["UTILITY", "MARKETING", "AUTHENTICATION"].includes(m?.categoria)
      ? m.categoria
      : "UTILITY",
    finalidade: FINALIDADES.includes(m?.finalidade) ? m.finalidade : "geral",
    parameter_format: formato as "POSITIONAL" | "NAMED",
    cabecalho,
    corpo: String(m?.corpo || ""),
    corpo_exemplos: exemplos,
    rodape: m?.rodape ? String(m.rodape) : null,
    botoes,
    variaveis: m?.variaveis && typeof m.variaveis === "object" ? m.variaveis : {},
  };
}

export const Route = createFileRoute("/api/comunicacao/modelos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        let body: any;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const meta = await import("@/lib/comunicacao/meta.server");
        const { respostaDeErro } = await import("@/lib/comunicacao/envio.server");
        const db = supabaseAdmin as any;

        try {
          if (body.acao === "salvar") {
            const m = normalizarModelo(body.modelo);
            const id: string | null = body.modelo?.id || null;
            let atual: any = null;
            if (id) {
              const { data } = await db
                .from("comunicacao_whatsapp_modelos")
                .select("*")
                .eq("id", id)
                .eq("id_medico", userId)
                .maybeSingle();
              if (!data)
                return Response.json(
                  { error: "modelo_inexistente", message: "Modelo não encontrado." },
                  { status: 404 },
                );
              atual = data;
              // Nome/idioma identificam o modelo na Meta: não mudam depois de submetido.
              if (atual.meta_template_id) {
                m.nome = atual.nome;
                m.idioma = atual.idioma;
              }
              if (
                m.cabecalho &&
                m.cabecalho.tipo !== "TEXT" &&
                !m.cabecalho.handle &&
                atual.cabecalho?.tipo === m.cabecalho.tipo
              ) {
                m.cabecalho.handle = atual.cabecalho.handle || null;
              }
            }

            const erros = meta.validarModelo(m as any);
            if (erros.length)
              return Response.json(
                { error: "validacao", message: erros.join(" "), erros },
                { status: 400 },
              );

            let conexao: Awaited<ReturnType<typeof meta.exigirConexaoAtiva>> | null = null;
            if (body.enviar) {
              conexao = await meta.exigirConexaoAtiva(db, userId);
              if (m.cabecalho && m.cabecalho.tipo !== "TEXT") {
                const ex = body.exemplo_midia;
                if (ex?.base64) {
                  const bytes = base64ParaBytes(String(ex.base64));
                  if (bytes.byteLength > MAX_EXEMPLO_BYTES) {
                    return Response.json(
                      { error: "validacao", message: "Arquivo de exemplo acima de 5MB." },
                      { status: 400 },
                    );
                  }
                  m.cabecalho.handle = await meta.gerarHandleExemplo(
                    conexao,
                    bytes,
                    String(ex.mime || "application/pdf"),
                    String(ex.nome || "exemplo"),
                  );
                } else if (!m.cabecalho.handle && !atual?.meta_template_id) {
                  return Response.json(
                    {
                      error: "validacao",
                      message:
                        "Cabeçalho de mídia: anexe um arquivo de exemplo para a análise da Meta.",
                    },
                    { status: 400 },
                  );
                }
              }
            }

            const linha: Record<string, unknown> = { ...m, id_medico: userId };
            let salvo: any;
            if (atual) {
              const { data, error } = await db
                .from("comunicacao_whatsapp_modelos")
                .update(linha)
                .eq("id", atual.id)
                .select("*")
                .single();
              if (error) throw new Error(error.message);
              salvo = data;
            } else {
              const { data, error } = await db
                .from("comunicacao_whatsapp_modelos")
                .insert(linha)
                .select("*")
                .single();
              if (error) {
                if (error.code === "23505") {
                  return Response.json(
                    { error: "validacao", message: "Já existe um modelo com esse nome e idioma." },
                    { status: 409 },
                  );
                }
                throw new Error(error.message);
              }
              salvo = data;
            }

            if (body.enviar && conexao) {
              if (salvo.meta_template_id) {
                // Edição de modelo existente: a Meta aceita alterar os componentes
                // (com limite de edições por dia/mês para modelos aprovados).
                const payload = meta.payloadCriacaoModelo(salvo);
                await meta.graph(conexao, salvo.meta_template_id, {
                  method: "POST",
                  body: { category: payload.category, components: payload.components },
                });
                const { data } = await db
                  .from("comunicacao_whatsapp_modelos")
                  .update({
                    status: "PENDING",
                    motivo_rejeicao: null,
                    sincronizado_em: new Date().toISOString(),
                  })
                  .eq("id", salvo.id)
                  .select("*")
                  .single();
                salvo = data || salvo;
              } else {
                const r = await meta.criarModeloNaMeta(conexao, salvo);
                const { data } = await db
                  .from("comunicacao_whatsapp_modelos")
                  .update({
                    meta_template_id: String(r.id),
                    status: r.status || "PENDING",
                    categoria: r.category || salvo.categoria,
                    motivo_rejeicao: null,
                    sincronizado_em: new Date().toISOString(),
                  })
                  .eq("id", salvo.id)
                  .select("*")
                  .single();
                salvo = data || salvo;
              }
            }
            return Response.json({ ok: true, modelo: salvo });
          }

          if (body.acao === "mapear") {
            const upd: Record<string, unknown> = {};
            if (FINALIDADES.includes(body.finalidade)) upd.finalidade = body.finalidade;
            if (body.variaveis && typeof body.variaveis === "object")
              upd.variaveis = body.variaveis;
            const { data, error } = await db
              .from("comunicacao_whatsapp_modelos")
              .update(upd)
              .eq("id", body.id)
              .eq("id_medico", userId)
              .select("*")
              .single();
            if (error) throw new Error(error.message);
            return Response.json({ ok: true, modelo: data });
          }

          if (body.acao === "sincronizar") {
            const conexao = await meta.exigirConexaoAtiva(db, userId);
            const remotos = await meta.listarModelosDaMeta(conexao);
            const { data: locais } = await db
              .from("comunicacao_whatsapp_modelos")
              .select("id,nome,idioma,meta_template_id,status")
              .eq("id_medico", userId);
            const agora = new Date().toISOString();
            let novos = 0;
            let atualizados = 0;
            for (const t of remotos) {
              const conv = meta.modeloDaMeta(t);
              const local = (locais || []).find(
                (l: any) =>
                  l.meta_template_id === String(t.id) ||
                  (l.nome === t.name && l.idioma === t.language),
              );
              if (local) {
                await db
                  .from("comunicacao_whatsapp_modelos")
                  .update({ ...conv, sincronizado_em: agora })
                  .eq("id", local.id);
                atualizados++;
              } else {
                await db
                  .from("comunicacao_whatsapp_modelos")
                  .insert({ ...conv, id_medico: userId, sincronizado_em: agora });
                novos++;
              }
            }
            const idsRemotos = new Set(remotos.map((t: any) => String(t.id)));
            const sumidos = (locais || []).filter(
              (l: any) => l.meta_template_id && !idsRemotos.has(l.meta_template_id),
            );
            for (const l of sumidos) {
              await db
                .from("comunicacao_whatsapp_modelos")
                .update({ status: "DELETED", sincronizado_em: agora })
                .eq("id", l.id);
            }
            return Response.json({ ok: true, novos, atualizados, removidos: sumidos.length });
          }

          if (body.acao === "excluir") {
            const { data: m } = await db
              .from("comunicacao_whatsapp_modelos")
              .select("*")
              .eq("id", body.id)
              .eq("id_medico", userId)
              .maybeSingle();
            if (!m)
              return Response.json(
                { error: "modelo_inexistente", message: "Modelo não encontrado." },
                { status: 404 },
              );
            if (m.meta_template_id && m.status !== "DELETED") {
              const conexao = await meta.exigirConexaoAtiva(db, userId);
              await meta.excluirModeloNaMeta(conexao, m);
            }
            await db.from("comunicacao_whatsapp_modelos").delete().eq("id", m.id);
            return Response.json({ ok: true });
          }

          return Response.json({ error: "acao_invalida" }, { status: 400 });
        } catch (e) {
          return respostaDeErro(e);
        }
      },
    },
  },
});
