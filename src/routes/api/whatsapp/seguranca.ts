import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";
import { encryptVerifier } from "@/lib/signature/PKCEService";
import {
  FREQUENCIAS_VALIDAS,
  validarPalavraChave,
  calcularStatusRotacao,
  type FrequenciaHoras,
} from "@/lib/whatsapp/segurancaDesafio";

/**
 * Configuração da segunda camada de segurança do canal Médico x assistente_ai
 * pelo WhatsApp (tela Minhas IAs > Copiloto > Copiloto pelo WhatsApp).
 *
 * GET: status para exibir na tela (nunca devolve a palavra-chave em si).
 * POST: define/troca a palavra-chave e a frequência de autenticação — zera
 * uso, data de criação, histórico de blocos e qualquer bloqueio anterior.
 */

function requireEncryptionKey(): string {
  const key = process.env.SIGNATURE_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error("SIGNATURE_ENCRYPTION_KEY não configurado (mínimo 16 caracteres).");
  }
  return key;
}

export const Route = createFileRoute("/api/whatsapp/seguranca")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("medico_seguranca_whatsapp")
          .select(
            "palavra_chave_criada_em,palavra_chave_usos,frequencia_horas,ultima_autenticacao_em,desafio_bloqueado",
          )
          .eq("id_medico", userId)
          .maybeSingle();
        if (error) return Response.json({ error: error.message }, { status: 500 });

        if (!data || !data.palavra_chave_criada_em) {
          return Response.json({
            configurado: false,
            frequencia_horas: 24,
            desafio_bloqueado: false,
            status_rotacao: null,
          });
        }

        const statusRotacao = calcularStatusRotacao(data.palavra_chave_criada_em, data.palavra_chave_usos);

        return Response.json({
          configurado: true,
          criada_em: data.palavra_chave_criada_em,
          usos: data.palavra_chave_usos,
          frequencia_horas: data.frequencia_horas,
          ultima_autenticacao_em: data.ultima_autenticacao_em,
          desafio_bloqueado: data.desafio_bloqueado,
          status_rotacao: statusRotacao,
        });
      },

      POST: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        let body: { palavra_chave?: string; frequencia_horas?: number };
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const palavraChave = String(body.palavra_chave || "");
        const validacao = validarPalavraChave(palavraChave);
        if (!validacao.valido) {
          return Response.json({ error: validacao.erro }, { status: 400 });
        }

        const frequencia = Number(body.frequencia_horas);
        if (!FREQUENCIAS_VALIDAS.includes(frequencia as FrequenciaHoras)) {
          return Response.json(
            { error: `frequencia_horas deve ser um dos valores: ${FREQUENCIAS_VALIDAS.join(", ")}.` },
            { status: 400 },
          );
        }

        let palavraChaveCifrada: string;
        try {
          palavraChaveCifrada = await encryptVerifier(palavraChave.trim(), requireEncryptionKey());
        } catch (err) {
          console.error("[whatsapp/seguranca] falha ao cifrar palavra-chave:", err);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("medico_seguranca_whatsapp").upsert(
          {
            id_medico: userId,
            palavra_chave_cifrada: palavraChaveCifrada,
            palavra_chave_criada_em: new Date().toISOString(),
            palavra_chave_usos: 0,
            frequencia_horas: frequencia,
            ultima_autenticacao_em: null,
            blocos_usados: [],
            desafio_ativo: null,
            desafio_bloqueado: false,
            updated_at: new Date().toISOString(),
          } as never,
          { onConflict: "id_medico" },
        );
        if (error) return Response.json({ error: error.message }, { status: 500 });

        return Response.json({ ok: true });
      },
    },
  },
});
