import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { asaasFetch } from "@/lib/asaas/client.server";
import {
  assinaturaAtiva,
  clienteAdmin,
  hojeISO,
  respostaErroAsaas,
  usuarioDaRequisicao,
} from "@/lib/assinatura/gestao.server";
import { PLANOS_BASE } from "@/lib/plans/config";

// Troca o plano da assinatura ATIVA de quem está logado.
//
// * Upgrade (plano mais caro): vale na hora — franquias novas liberadas já,
//   e o valor novo entra a partir da próxima fatura (sem cobrança
//   proporcional nesta v1).
// * Downgrade (plano mais barato): AGENDADO pra data da próxima cobrança,
//   pra não tirar no meio do ciclo uma franquia que já foi paga. O valor no
//   Asaas já é atualizado agora (a próxima fatura vem com o preço novo); as
//   franquias locais só mudam quando aplicar_agendamentos_assinatura()
//   rodar a partir daquela data.
// * Pedir o plano atual enquanto há downgrade agendado = desfazer o
//   agendamento (volta o valor no Asaas pro preço atual).
//
// Escopo: só troca entre os 3 planos prontos (Basic/Pro/Enterprise), com a
// configuração de fábrica de cada um — config à la carte continua sendo
// refeita pela contratação em /planos.

const BodySchema = z.object({ novoPlano: z.enum(["basic", "pro", "enterprise"]) });

export const Route = createFileRoute("/api/assinatura/trocar-plano")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await usuarioDaRequisicao(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const body = BodySchema.safeParse(await request.json().catch(() => null));
        if (!body.success) return Response.json({ error: "payload inválido" }, { status: 400 });

        const assinatura = await assinaturaAtiva(userId);
        if (!assinatura)
          return Response.json({ error: "nenhuma assinatura ativa encontrada" }, { status: 404 });
        if (!assinatura.asaas_subscription_id) {
          return Response.json(
            { error: "assinatura sem cobrança recorrente vinculada ainda" },
            { status: 409 },
          );
        }
        if (assinatura.cancelamento_agendado_para) {
          return Response.json(
            { error: "sua assinatura tem cancelamento agendado — não é possível trocar de plano" },
            { status: 409 },
          );
        }

        const novo = PLANOS_BASE.find((p) => p.id === body.data.novoPlano);
        if (!novo) return Response.json({ error: "plano inválido" }, { status: 400 });

        const supabaseAdmin = await clienteAdmin();
        const precoAtual = Number(assinatura.preco_mensal);

        async function atualizarValorAsaas(valor: number, nome: string) {
          await asaasFetch(`/subscriptions/${assinatura.asaas_subscription_id}`, {
            method: "PUT",
            body: JSON.stringify({
              value: valor,
              description: `MediCopilot — plano ${nome}`,
              // Reflete o valor novo também na próxima fatura que o Asaas já tiver gerado.
              updatePendingPayments: true,
            }),
          });
        }

        function erroLocal(escopo: string, mensagem: string) {
          console.error(`[assinatura:trocar-plano] erro ao ${escopo}:`, mensagem);
          return Response.json(
            {
              error:
                "alteração feita no Asaas, mas houve erro ao salvar localmente — avise o suporte",
            },
            { status: 500 },
          );
        }

        // --- desfazer downgrade agendado ---
        if (novo.id === assinatura.plano) {
          if (!assinatura.plano_agendado) {
            return Response.json({ error: "você já está nesse plano" }, { status: 400 });
          }
          const nomeAtual =
            PLANOS_BASE.find((p) => p.id === assinatura.plano)?.nome ?? assinatura.plano;
          try {
            await atualizarValorAsaas(precoAtual, nomeAtual);
          } catch (err) {
            return respostaErroAsaas("trocar-plano", err);
          }
          const { error } = await supabaseAdmin
            .from("assinaturas")
            .update({ plano_agendado: null, plano_agendado_para: null })
            .eq("id", assinatura.id);
          if (error) return erroLocal("desfazer agendamento", error.message);
          return Response.json({ ok: true, efeito: "agendamento_desfeito" });
        }

        const ehDowngrade = novo.precoMensal < precoAtual;
        const proxima: string | null = assinatura.proxima_cobranca;
        const agendar = ehDowngrade && !!proxima && proxima > hojeISO();

        try {
          await atualizarValorAsaas(novo.precoMensal, novo.nome);
        } catch (err) {
          return respostaErroAsaas("trocar-plano", err);
        }

        if (agendar) {
          const { error } = await supabaseAdmin
            .from("assinaturas")
            .update({ plano_agendado: novo.id, plano_agendado_para: proxima })
            .eq("id", assinatura.id);
          if (error) return erroLocal("agendar downgrade", error.message);
          return Response.json({
            ok: true,
            efeito: "agendado",
            plano: novo.id,
            vigenciaEm: proxima,
          });
        }

        const { error } = await supabaseAdmin
          .from("assinaturas")
          .update({
            plano: novo.id,
            medicos: novo.medicos,
            secretarias: novo.secretarias,
            copiloto: novo.copiloto,
            whatsapp: novo.whatsapp,
            video: novo.video,
            preco_mensal: novo.precoMensal,
            plano_agendado: null,
            plano_agendado_para: null,
          })
          .eq("id", assinatura.id);
        if (error) return erroLocal("trocar plano", error.message);

        return Response.json({ ok: true, efeito: "imediato", plano: novo.id });
      },
    },
  },
});
