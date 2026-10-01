import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  compilarEstudio,
  type GrafoEstudio,
  type Publicacao,
} from "@/lib/protocolos/estudio-compilar.server";

// Publica um rascunho do Studio como protocolo executável: compila o grafo
// (src/lib/protocolos/estudio-compilar.server.ts), grava com
// public.salvar_protocolo e sincroniza os pacientes pelos CIDs.
//
// POST { rascunhoId, simular? } — simular = só compila e devolve pendências,
// sem gravar (usado na pré-visualização antes de publicar).

const BodySchema = z.object({ rascunhoId: z.string().uuid(), simular: z.boolean().optional() });

export const Route = createFileRoute("/api/protocolos/estudio-publicar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        const { getUserIdFromRequest } = await import("@/lib/bry/auth.server");
        const userId = await getUserIdFromRequest(request);
        if (!userId || !token)
          return Response.json(
            { error: "Sessão expirada — faça login novamente." },
            { status: 401 },
          );

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }
        const body = BodySchema.safeParse(raw);
        if (!body.success) return Response.json({ error: "Payload inválido" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: rasc, error: rErr } = await supabaseAdmin
          .from("protocolo_estudio_rascunhos")
          .select("id,user_id,titulo,grafo,protocolo_id,publicacao")
          .eq("id", body.data.rascunhoId)
          .maybeSingle();
        if (rErr) return Response.json({ error: "Falha ao carregar o rascunho" }, { status: 500 });
        if (!rasc || rasc.user_id !== userId)
          return Response.json({ error: "Rascunho não encontrado" }, { status: 404 });

        // Protocolo publicado antes pode ter sido apagado pela tela antiga.
        let protocoloId: string | null = rasc.protocolo_id;
        if (protocoloId) {
          const { data: p } = await supabaseAdmin
            .from("protocolos")
            .select("id")
            .eq("id", protocoloId)
            .maybeSingle();
          if (!p) protocoloId = null;
        }

        const comp = compilarEstudio(rasc.grafo as unknown as GrafoEstudio, {
          titulo: rasc.titulo,
          protocoloId,
          publicacao: protocoloId ? ((rasc.publicacao || {}) as Publicacao) : null,
        });
        const previa = {
          pendencias: comp.pendencias,
          resumo: comp.resumo,
          cids: comp.payload.cids,
        };

        if (body.data.simular) return Response.json(previa);
        if (!comp.payload.cids.length) {
          return Response.json(
            { error: "Informe ao menos um CID antes de publicar.", ...previa },
            { status: 400 },
          );
        }
        if (!comp.payload.acoes.length) {
          return Response.json({ error: "Nada publicável no fluxo.", ...previa }, { status: 400 });
        }

        // salvar_protocolo é SECURITY INVOKER: roda como o médico, sob RLS.
        const userClient = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
          {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${token}` } },
          },
        );
        const { data: salvo, error: sErr } = await userClient.rpc("salvar_protocolo", {
          p_payload: comp.payload,
        });
        if (sErr || !salvo) {
          console.error("[estudio:publicar] salvar_protocolo", sErr);
          return Response.json(
            { error: sErr?.message || "Falha ao gravar o protocolo", ...previa },
            { status: 500 },
          );
        }
        const res = salvo as unknown as {
          id: string;
          acoes: Record<string, string>;
          regras: Record<string, string>;
        };

        // chave estável do grafo -> uuid, para a próxima publicação atualizar as mesmas linhas
        const publicacao: Required<Publicacao> = { acoes: {}, regras: {} };
        Object.entries(res.acoes || {}).forEach(([pid, uuid]) => {
          const k = comp.chaveDaAcao[pid];
          if (k) publicacao.acoes[k] = uuid;
        });
        Object.entries(res.regras || {}).forEach(([pid, uuid]) => {
          const k = comp.chaveDaRegra[pid];
          if (k) publicacao.regras[k] = uuid;
        });

        const { error: uErr } = await supabaseAdmin
          .from("protocolo_estudio_rascunhos")
          .update({ protocolo_id: res.id, publicacao, publicado_em: new Date().toISOString() })
          .eq("id", rasc.id);
        if (uErr) console.error("[estudio:publicar] vínculo rascunho", uErr);

        const { error: syncErr } = await supabaseAdmin.rpc("sincronizar_protocolo", {
          p_protocolo_id: res.id,
        });
        if (syncErr) console.error("[estudio:publicar] sincronizar", syncErr);

        const { count } = await supabaseAdmin
          .from("paciente_protocolos")
          .select("id", { count: "exact", head: true })
          .eq("protocolo_id", res.id)
          .eq("ativo", true);

        return Response.json({
          protocoloId: res.id,
          pacientes: count ?? 0,
          sincronizado: !syncErr,
          ...previa,
        });
      },
    },
  },
});
