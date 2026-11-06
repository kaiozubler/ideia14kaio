import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Lado do SMARTPHONE da captação de áudio (página /captar). Sem sessão de
// login: o único segredo é o token do QR, que só o computador do dono exibe.
// O celular pode conectar (uma chamada que o computador abriu), pedir o token
// efêmero do Deepgram, enviar o texto/nível e encerrar — nunca abrir nem
// retomar uma chamada.
const token = z.string().regex(/^[0-9a-f]{64}$/);
const BodySchema = z.discriminatedUnion("acao", [
  z.object({
    acao: z.literal("conectar"),
    token,
    dispositivo: z.string().max(200).optional(),
  }),
  z.object({ acao: z.literal("deepgram"), token }),
  z.object({
    acao: z.literal("evento"),
    token,
    nivel: z.number().int().min(0).max(100),
    confianca: z.number().int().min(0).max(100).nullable().optional(),
    parcial: z.string().max(2000).optional(),
    finais: z.array(z.string().trim().min(1).max(4000)).max(40).optional(),
  }),
  z.object({ acao: z.literal("encerrar"), token }),
]);

const SEM_CACHE = { "Cache-Control": "no-store" };
const responder = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: SEM_CACHE });

export const Route = createFileRoute("/api/public/captacao-movel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = BodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return responder({ error: "invalid_body" }, 400);
        const body = parsed.data;

        try {
          const m = await import("@/lib/captacao-movel/sessao.server");
          const sessao = await m.sessaoDoToken(body.token);
          if (!sessao) return responder({ error: "not_found" }, 404);
          if (sessao.status === "encerrado") {
            return responder({ status: "encerrado", encerrado_por: sessao.encerrado_por });
          }
          const db = await m.admin();

          if (body.acao === "encerrar") {
            await m.encerrar(sessao.id, "smartphone");
            return responder({ status: "encerrado", encerrado_por: "smartphone" });
          }

          if (body.acao === "conectar") {
            const agora = new Date();
            if (sessao.status === "aguardando") {
              const { data, error } = await db
                .from("captacao_movel_sessoes")
                .update({
                  status: "conectado",
                  conectado_em: agora.toISOString(),
                  visto_em: agora.toISOString(),
                  dispositivo: body.dispositivo ?? null,
                  expira_em: new Date(agora.getTime() + m.DURACAO_MAXIMA_MS).toISOString(),
                })
                .eq("id", sessao.id)
                .eq("status", "aguardando")
                .select("status")
                .maybeSingle();
              if (error) throw error;
              return responder({ status: data?.status ?? "conectado" });
            }
            // Recarregar a página no celular volta para a mesma chamada.
            return responder({ status: sessao.status });
          }

          if (sessao.status === "aguardando") return responder({ error: "nao_conectado" }, 409);

          if (body.acao === "deepgram") {
            const { issueDeepgramToken } = await import("@/routes/api/deepgram-token");
            const res = await issueDeepgramToken();
            return new Response(res.body, { status: res.status, headers: SEM_CACHE });
          }

          // evento: nível/parcial sempre; falas finais só enquanto a chamada está ativa
          // (pausada no computador = o que chegar na transição é descartado).
          const ativo = sessao.status === "conectado";
          const finais = ativo ? (body.finais ?? []) : [];
          if (finais.length) {
            const { error } = await db
              .from("captacao_movel_trechos")
              .insert(
                finais.map((texto) => ({ sessao_id: sessao.id, user_id: sessao.user_id, texto })),
              );
            if (error) throw error;
          }
          const { error } = await db
            .from("captacao_movel_sessoes")
            .update({
              nivel: ativo ? body.nivel : 0,
              confianca: body.confianca ?? null,
              parcial: ativo ? (body.parcial ?? "") : "",
              visto_em: new Date().toISOString(),
            })
            .eq("id", sessao.id)
            .neq("status", "encerrado");
          if (error) throw error;
          return responder({ status: sessao.status });
        } catch (e) {
          console.error("[public/captacao-movel]", e);
          return responder({ error: "server_error" }, 500);
        }
      },
    },
  },
});
