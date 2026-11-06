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
import {
  PERSONALIZADO,
  PLANOS_BASE,
  copilotoAtivoDaConfiguracao,
  precoMensalNoServidor,
  valorDaCobranca,
  type ConfiguracaoPlano,
} from "@/lib/plans/config";

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
//
// Copiloto ativo: incluído no Pro, adicional opcional no Enterprise. Ao ir para
// o Enterprise, quem já tinha o modo ativo continua com ele (a menos que peça
// `copilotoAtivo: false`), com o adicional no preço. Pedir o próprio Enterprise
// com `copilotoAtivo` liga ou desliga só o adicional, na hora.
// O valor enviado ao Asaas respeita o ciclo (anual = 12 meses com desconto).

const BodySchema = z.object({
  novoPlano: z.enum(["basic", "pro", "enterprise"]),
  copilotoAtivo: z.boolean().optional(),
});

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

        const ciclo = assinatura.ciclo === "anual" ? "anual" : "mensal";
        async function atualizarValorAsaas(precoMensal: number, nome: string) {
          await asaasFetch(`/subscriptions/${assinatura.asaas_subscription_id}`, {
            method: "PUT",
            body: JSON.stringify({
              value: valorDaCobranca(precoMensal, ciclo),
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

        // --- ligar/desligar o adicional de Copiloto ativo no próprio Enterprise ---
        if (
          novo.id === assinatura.plano &&
          novo.copilotoAtivo === "opcional" &&
          body.data.copilotoAtivo !== undefined &&
          body.data.copilotoAtivo !== !!assinatura.copiloto_ativo
        ) {
          if (assinatura.plano_agendado) {
            return Response.json(
              { error: "há uma troca de plano agendada — desfaça-a antes de mudar o Copiloto ativo" },
              { status: 409 },
            );
          }
          // Preço da configuração atual da assinatura (franquias à la carte incluídas),
          // com ou sem o adicional. Assinaturas antigas que já tinham o modo ativo sem
          // pagar por ele não ganham desconto ao desligar: o preço base é o mesmo.
          const configAtual: ConfiguracaoPlano = {
            medicos: assinatura.medicos,
            secretarias: assinatura.secretarias,
            copiloto: assinatura.copiloto,
            whatsapp: assinatura.whatsapp,
            video: assinatura.video,
            copilotoAtivo: body.data.copilotoAtivo,
          };
          const precoNovo =
            configAtual.copiloto === PERSONALIZADO ? null : precoMensalNoServidor(novo, configAtual);
          if (precoNovo === null) {
            return Response.json(
              { error: "seu plano tem franquia personalizada — fale com nosso time para mudar o Copiloto ativo" },
              { status: 409 },
            );
          }
          try {
            await atualizarValorAsaas(precoNovo, novo.nome);
          } catch (err) {
            return respostaErroAsaas("trocar-plano", err);
          }
          const { error } = await supabaseAdmin
            .from("assinaturas")
            .update({ copiloto_ativo: body.data.copilotoAtivo, preco_mensal: precoNovo })
            .eq("id", assinatura.id);
          if (error) return erroLocal("alterar Copiloto ativo", error.message);
          return Response.json({
            ok: true,
            efeito: body.data.copilotoAtivo ? "ativo_ligado" : "ativo_desligado",
            preco_mensal: precoNovo,
          });
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

        // Copiloto ativo no destino: Pro inclui, Basic não tem; no Enterprise mantém
        // o que a pessoa já tinha (Pro ou adicional), salvo pedido explícito.
        const tinhaAtivo = assinatura.plano === "pro" || !!assinatura.copiloto_ativo;
        const ativoDestino = copilotoAtivoDaConfiguracao(novo, body.data.copilotoAtivo ?? tinhaAtivo);
        const precoNovo =
          precoMensalNoServidor(novo, {
            medicos: novo.medicos,
            secretarias: novo.secretarias,
            copiloto: novo.copiloto,
            whatsapp: novo.whatsapp,
            video: novo.video,
            copilotoAtivo: ativoDestino,
          }) ?? novo.precoMensal;

        const ehDowngrade = precoNovo < precoAtual;
        const proxima: string | null = assinatura.proxima_cobranca;
        // O agendamento só guarda o plano: o Enterprise (com ou sem adicional) vale na hora.
        const agendar = ehDowngrade && novo.id !== "enterprise" && !!proxima && proxima > hojeISO();

        try {
          await atualizarValorAsaas(precoNovo, novo.nome);
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
            copiloto_ativo: ativoDestino,
            whatsapp: novo.whatsapp,
            video: novo.video,
            preco_mensal: precoNovo,
            plano_agendado: null,
            plano_agendado_para: null,
          })
          .eq("id", assinatura.id);
        if (error) return erroLocal("trocar plano", error.message);

        return Response.json({ ok: true, efeito: "imediato", plano: novo.id, copiloto_ativo: ativoDestino });
      },
    },
  },
});
