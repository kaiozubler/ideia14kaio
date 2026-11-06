import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";

// Lado do COMPUTADOR da captação pelo smartphone: só daqui uma chamada é
// aberta (criar) ou retomada; o celular nunca abre nem retoma.
const BodySchema = z.discriminatedUnion("acao", [
  z.object({ acao: z.literal("criar") }),
  z.object({
    acao: z.enum(["pausar", "retomar", "encerrar"]),
    id: z.string().uuid(),
  }),
]);

export const Route = createFileRoute("/api/captacao-movel")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const parsed = BodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
        const body = parsed.data;

        const m = await import("@/lib/captacao-movel/sessao.server");
        const { sha256Hex } = await import("@/lib/documentos/verificacao.server");
        try {
          const db = await m.admin();

          if (body.acao === "criar") {
            await m.limparAntigas(userId);
            const token = m.gerarTokenCaptacao();
            const { data, error } = await db
              .from("captacao_movel_sessoes")
              .insert({
                user_id: userId,
                token_hash: await sha256Hex(token),
                expira_em: new Date(Date.now() + m.ESPERA_LEITURA_MS).toISOString(),
              })
              .select("id,expira_em")
              .single();
            if (error) throw error;
            const { origemPublica } = await import("@/lib/documentos/verificacao.server");
            return Response.json(
              {
                id: data.id,
                expira_em: data.expira_em,
                url: `${origemPublica(request)}/captar#${token}`,
              },
              { headers: m.SEM_CACHE },
            );
          }

          const { data: sessao, error } = await db
            .from("captacao_movel_sessoes")
            .select("id,status,expira_em")
            .eq("id", body.id)
            .eq("user_id", userId)
            .maybeSingle();
          if (error) throw error;
          if (!sessao) return Response.json({ error: "not_found" }, { status: 404 });

          if (body.acao === "encerrar") {
            await m.encerrar(sessao.id, "computador");
            return Response.json({ status: "encerrado" });
          }

          const de = body.acao === "pausar" ? "conectado" : "pausado";
          const para = body.acao === "pausar" ? "pausado" : "conectado";
          if (sessao.status !== de) return Response.json({ status: sessao.status });
          if (Date.parse(sessao.expira_em) <= Date.now()) {
            await m.encerrar(sessao.id, "expirado");
            return Response.json({ status: "encerrado" });
          }
          const { error: upErr } = await db
            .from("captacao_movel_sessoes")
            .update({ status: para, parcial: "" })
            .eq("id", sessao.id)
            .eq("status", de);
          if (upErr) throw upErr;
          return Response.json({ status: para });
        } catch (e) {
          console.error("[captacao-movel]", e);
          return Response.json({ error: "server_error" }, { status: 500 });
        }
      },
    },
  },
});
