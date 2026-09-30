import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { asaasFetch, ambienteAsaas } from "@/lib/asaas/client.server";
import {
  assinaturaAtiva,
  clienteAdmin,
  respostaErroAsaas,
  usuarioDaRequisicao,
} from "@/lib/assinatura/gestao.server";
import { pacotesCredito } from "@/lib/plans/config";

// Compra avulsa de créditos extras (Copiloto/WhatsApp/Vídeo) no modelo
// "sacola": a tela Meu plano junta vários pacotes (inclusive o mesmo pacote
// mais de uma vez, e recursos diferentes) e paga tudo num único Checkout do
// Asaas. Os créditos somam ao saldo atual em vez de substituir a franquia
// mensal — ver registrar_consumo() na migration de assinaturas pra entender
// a ordem de consumo (franquia do plano primeiro, depois esse crédito).
//
// Cada unidade de pacote vira uma linha própria em creditos_adicionais, todas
// com o mesmo asaas_checkout_id — o webhook (CHECKOUT_PAID/CANCELED/EXPIRED)
// já atualiza por checkout, então marca a sacola inteira de uma vez.
//
// Preço vem sempre de pacotesCredito() (mesmos degraus já usados em
// /planos), nunca do navegador.

const MAX_UNIDADES_POR_SACOLA = 20;

const BodySchema = z.object({
  itens: z
    .array(
      z.object({
        recurso: z.enum(["copiloto", "whatsapp", "video"]),
        quantidade: z.number().int().positive(),
        vezes: z.number().int().min(1).max(MAX_UNIDADES_POR_SACOLA),
      }),
    )
    .min(1)
    .max(12),
});

const NOMES_RECURSO: Record<string, string> = {
  copiloto: "consultas de Copiloto",
  whatsapp: "conversas de WhatsApp",
  video: "min de vídeo",
};

export const Route = createFileRoute("/api/assinatura/comprar-creditos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await usuarioDaRequisicao(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const body = BodySchema.safeParse(await request.json().catch(() => null));
        if (!body.success) return Response.json({ error: "sacola inválida" }, { status: 400 });

        // Junta linhas repetidas do mesmo pacote e valida cada uma contra a tabela de preços.
        const agrupado = new Map<
          string,
          { recurso: string; quantidade: number; preco: number; vezes: number }
        >();
        for (const item of body.data.itens) {
          const pacote = pacotesCredito(item.recurso).find((p) => p.quantidade === item.quantidade);
          if (!pacote)
            return Response.json({ error: "pacote de créditos inválido" }, { status: 400 });
          const chave = `${item.recurso}:${item.quantidade}`;
          const atual = agrupado.get(chave);
          if (atual) atual.vezes += item.vezes;
          else
            agrupado.set(chave, {
              recurso: item.recurso,
              quantidade: pacote.quantidade,
              preco: pacote.preco,
              vezes: item.vezes,
            });
        }
        const itens = [...agrupado.values()];
        const totalUnidades = itens.reduce((s, i) => s + i.vezes, 0);
        if (totalUnidades > MAX_UNIDADES_POR_SACOLA) {
          return Response.json(
            { error: `máximo de ${MAX_UNIDADES_POR_SACOLA} pacotes por compra` },
            { status: 400 },
          );
        }

        const assinatura = await assinaturaAtiva(userId);
        if (!assinatura) {
          return Response.json({ error: "nenhuma assinatura ativa encontrada" }, { status: 404 });
        }
        if (assinatura.cancelamento_agendado_para) {
          return Response.json(
            { error: "assinatura cancelada — não é possível comprar créditos" },
            { status: 409 },
          );
        }

        const origin = new URL(request.url).origin;
        const supabaseAdmin = await clienteAdmin();

        try {
          const checkout = await asaasFetch<{ id: string }>("/checkouts", {
            method: "POST",
            body: JSON.stringify({
              billingTypes: ["CREDIT_CARD"],
              chargeTypes: ["DETACHED"], // cobrança única, não recorrente
              minutesToExpire: 60,
              callback: {
                successUrl: `${origin}/`,
                cancelUrl: `${origin}/`,
                expiredUrl: `${origin}/`,
              },
              items: itens.map((i) => ({
                name: `MediCopilot — crédito extra: +${i.quantidade} ${NOMES_RECURSO[i.recurso]}`,
                description: "Crédito avulso, não expira ao fim do mês — some ao saldo atual.",
                quantity: i.vezes,
                value: i.preco,
              })),
              customer: assinatura.asaas_customer_id || undefined,
            }),
          });

          const linhas = itens.flatMap((i) =>
            Array.from({ length: i.vezes }, () => ({
              assinatura_id: assinatura.id,
              recurso: i.recurso,
              quantidade: i.quantidade,
              valor_pago: i.preco,
              status: "pendente",
              asaas_checkout_id: checkout.id,
            })),
          );
          const { error: erroInsert } = await supabaseAdmin
            .from("creditos_adicionais")
            .insert(linhas);
          if (erroInsert) {
            console.error(
              "[assinatura:comprar-creditos] erro ao registrar compra pendente:",
              erroInsert.message,
            );
          }

          const dominioCheckout =
            ambienteAsaas() === "production"
              ? "https://www.asaas.com"
              : "https://sandbox.asaas.com";
          return Response.json({
            checkoutUrl: `${dominioCheckout}/checkoutSession/show?id=${checkout.id}`,
          });
        } catch (err) {
          return respostaErroAsaas("comprar-creditos", err);
        }
      },
    },
  },
});
