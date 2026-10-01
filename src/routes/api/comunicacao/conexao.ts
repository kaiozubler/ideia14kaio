import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";

/**
 * Conexão da CLÍNICA com a WhatsApp Cloud API (canal clínica ↔ paciente).
 * Tela: Configurações > WhatsApp dos pacientes > Conexão.
 *
 * GET:    configuração atual (segredos só mascarados) + URL do webhook e
 *         verify token para colar no painel da Meta.
 * POST:   salva os campos. Token/App Secret vazios = mantém o que já está
 *         salvo. Qualquer mudança de credencial volta o status para
 *         "rascunho" até um novo "Testar conexão".
 * DELETE: desconecta (apaga as credenciais; mantém conversas e modelos).
 */

function baseUrl(request: Request) {
  const env = process.env.PUBLIC_BASE_URL;
  return (env && env.replace(/\/$/, "")) || new URL(request.url).origin;
}

async function resposta(request: Request, idMedico: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { carregarConexao, mascarar } = await import("@/lib/comunicacao/meta.server");
  const c = await carregarConexao(supabaseAdmin, idMedico);
  if (!c) return Response.json({ configurado: false });
  return Response.json({
    configurado: true,
    meta_app_id: c.meta_app_id,
    meta_business_id: c.meta_business_id,
    waba_id: c.waba_id,
    phone_number_id: c.phone_number_id,
    graph_api_version: c.graph_api_version,
    access_token_mascarado: mascarar(c.accessToken),
    app_secret_mascarado: mascarar(c.appSecret),
    tem_access_token: !!c.accessToken,
    tem_app_secret: !!c.appSecret,
    verify_token: c.verify_token,
    webhook_url: `${baseUrl(request)}/api/public/webhooks/whatsapp-clinica/${c.webhook_chave}`,
    status: c.status,
    ultimo_erro: c.ultimo_erro,
    testado_em: c.testado_em,
    numero_exibicao: c.numero_exibicao,
    nome_verificado: c.nome_verificado,
    nome_waba: c.nome_waba,
    quality_rating: c.quality_rating,
    messaging_limit_tier: c.messaging_limit_tier,
    webhook_assinado_em: c.webhook_assinado_em,
    webhook_verificado_em: c.webhook_verificado_em,
    ultimo_evento_em: c.ultimo_evento_em,
  });
}

const soDigitos = (v: unknown) => (typeof v === "string" ? v.replace(/\D/g, "") : "");

export const Route = createFileRoute("/api/comunicacao/conexao")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        try {
          return await resposta(request, userId);
        } catch (e) {
          const { respostaDeErro } = await import("@/lib/comunicacao/envio.server");
          return respostaDeErro(e);
        }
      },

      POST: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        let body: Record<string, unknown>;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const campos = {
          meta_app_id: soDigitos(body.meta_app_id) || null,
          meta_business_id: soDigitos(body.meta_business_id) || null,
          waba_id: soDigitos(body.waba_id) || null,
          phone_number_id: soDigitos(body.phone_number_id) || null,
          graph_api_version: String(body.graph_api_version || "v23.0").trim(),
        };
        const erros: string[] = [];
        if (!campos.waba_id) erros.push("Informe o ID da conta do WhatsApp Business (WABA ID).");
        if (!campos.phone_number_id)
          erros.push("Informe o ID do número de telefone (Phone Number ID).");
        if (!/^v\d{2}\.\d$/.test(campos.graph_api_version))
          erros.push("Versão da Graph API inválida (ex.: v23.0).");
        const token = typeof body.access_token === "string" ? body.access_token.trim() : "";
        const secret = typeof body.app_secret === "string" ? body.app_secret.trim() : "";
        if (token && (token.length < 20 || /\s/.test(token)))
          erros.push("Token de acesso inválido.");
        if (secret && !/^[a-f0-9]{32}$/i.test(secret))
          erros.push("App Secret inválido (32 caracteres hexadecimais).");
        if (erros.length)
          return Response.json(
            { error: "validacao", message: erros.join(" "), erros },
            { status: 400 },
          );

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { carregarConexao, cifrar } = await import("@/lib/comunicacao/meta.server");
          const db = supabaseAdmin as any;
          const atual = await carregarConexao(db, userId);
          if (!atual?.accessToken && !token) {
            return Response.json(
              { error: "validacao", message: "Informe o token de acesso permanente." },
              { status: 400 },
            );
          }
          if (!atual?.appSecret && !secret) {
            return Response.json(
              {
                error: "validacao",
                message: "Informe o App Secret — ele valida que os webhooks vieram mesmo da Meta.",
              },
              { status: 400 },
            );
          }

          // Mesmo número já ligado a outra conta do app: recusa (o webhook não saberia de quem é).
          const { data: dono } = await db
            .from("comunicacao_whatsapp_conexoes")
            .select("id_medico")
            .eq("phone_number_id", campos.phone_number_id)
            .neq("id_medico", userId)
            .maybeSingle();
          if (dono) {
            return Response.json(
              {
                error: "validacao",
                message: "Este Phone Number ID já está conectado a outra conta do MediCopilot.",
              },
              { status: 409 },
            );
          }

          const mudouCredencial =
            !atual ||
            !!token ||
            !!secret ||
            atual.waba_id !== campos.waba_id ||
            atual.phone_number_id !== campos.phone_number_id ||
            atual.graph_api_version !== campos.graph_api_version;

          const linha: Record<string, unknown> = { id_medico: userId, ...campos };
          if (token) linha.access_token_cifrado = await cifrar(token);
          if (secret) linha.app_secret_cifrado = await cifrar(secret);
          if (body.regenerar_verify_token === true) {
            linha.verify_token = crypto.randomUUID().replace(/-/g, "");
            linha.webhook_verificado_em = null;
          }
          if (mudouCredencial) {
            linha.status = "rascunho";
            linha.ultimo_erro = null;
          }
          const { error } = await db
            .from("comunicacao_whatsapp_conexoes")
            .upsert(linha, { onConflict: "id_medico" });
          if (error) return Response.json({ error: "db", message: error.message }, { status: 500 });
          return await resposta(request, userId);
        } catch (e) {
          const { respostaDeErro } = await import("@/lib/comunicacao/envio.server");
          return respostaDeErro(e);
        }
      },

      DELETE: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await (supabaseAdmin as any)
          .from("comunicacao_whatsapp_conexoes")
          .update({
            access_token_cifrado: null,
            app_secret_cifrado: null,
            status: "desconectado",
            phone_number_id: null,
            numero_exibicao: null,
            nome_verificado: null,
            webhook_assinado_em: null,
            webhook_verificado_em: null,
          })
          .eq("id_medico", userId);
        if (error) return Response.json({ error: "db", message: error.message }, { status: 500 });
        return Response.json({ ok: true });
      },
    },
  },
});
