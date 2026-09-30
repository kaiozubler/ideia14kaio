import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { asaasFetch } from "@/lib/asaas/client.server";
import {
  assinaturaAtiva,
  clienteAdmin,
  respostaErroAsaas,
  salvarTokenCartao,
  usuarioDaRequisicao,
} from "@/lib/assinatura/gestao.server";

// Troca o cartão de crédito da assinatura, sem gerar cobrança nova
// (PUT /v3/subscriptions/{id}/creditCard). Os dados do cartão só passam por
// aqui a caminho do Asaas: nunca são logados nem gravados — localmente fica
// apenas bandeira + 4 últimos dígitos, pra exibir na tela.
//
// Faturas já vencidas NÃO são recobradas automaticamente no cartão novo; a
// tela Meu plano mostra o link de pagamento dessas faturas em aberto.

const somenteDigitos = (v: string) => v.replace(/\D/g, "");

const BodySchema = z.object({
  cartao: z.object({
    nomeTitular: z.string().trim().min(3).max(100),
    numero: z.string().transform(somenteDigitos).pipe(z.string().min(13).max(19)),
    mesValidade: z
      .string()
      .transform(somenteDigitos)
      .pipe(z.string().regex(/^(0?[1-9]|1[0-2])$/)),
    anoValidade: z
      .string()
      .transform(somenteDigitos)
      .pipe(z.string().regex(/^(\d{2}|\d{4})$/)),
    cvv: z.string().transform(somenteDigitos).pipe(z.string().min(3).max(4)),
  }),
  titular: z.object({
    nome: z.string().trim().min(3).max(100),
    email: z.string().trim().email(),
    cpfCnpj: z
      .string()
      .transform(somenteDigitos)
      .pipe(z.string().regex(/^(\d{11}|\d{14})$/)),
    cep: z.string().transform(somenteDigitos).pipe(z.string().length(8)),
    numeroEndereco: z.string().trim().min(1).max(20),
    telefone: z.string().transform(somenteDigitos).pipe(z.string().min(10).max(11)),
  }),
});

type RespostaCartao = {
  creditCard?: { creditCardNumber?: string; creditCardBrand?: string; creditCardToken?: string };
};

export const Route = createFileRoute("/api/assinatura/atualizar-cartao")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await usuarioDaRequisicao(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const body = BodySchema.safeParse(await request.json().catch(() => null));
        if (!body.success) {
          const campo = body.error.issues[0]?.path.join(".") ?? "";
          return Response.json({ error: "dados do cartão inválidos", campo }, { status: 400 });
        }

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
            { error: "assinatura cancelada — não há próximas cobranças" },
            { status: 409 },
          );
        }

        const { cartao, titular } = body.data;
        const remoteIp =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          request.headers.get("x-real-ip") ||
          "0.0.0.0";

        let resposta: RespostaCartao;
        try {
          resposta = await asaasFetch<RespostaCartao>(
            `/subscriptions/${assinatura.asaas_subscription_id}/creditCard`,
            {
              method: "PUT",
              body: JSON.stringify({
                creditCard: {
                  holderName: cartao.nomeTitular,
                  number: cartao.numero,
                  expiryMonth: cartao.mesValidade.padStart(2, "0"),
                  expiryYear:
                    cartao.anoValidade.length === 2
                      ? `20${cartao.anoValidade}`
                      : cartao.anoValidade,
                  ccv: cartao.cvv,
                },
                creditCardHolderInfo: {
                  name: titular.nome,
                  email: titular.email,
                  cpfCnpj: titular.cpfCnpj,
                  postalCode: titular.cep,
                  addressNumber: titular.numeroEndereco,
                  phone: titular.telefone,
                },
                remoteIp,
              }),
            },
          );
        } catch (err) {
          return respostaErroAsaas("atualizar-cartao", err);
        }

        const cartaoSalvo = {
          cartao_bandeira: resposta?.creditCard?.creditCardBrand ?? null,
          cartao_final: (resposta?.creditCard?.creditCardNumber ?? cartao.numero).slice(-4),
        };

        // Token do cartão novo: permite comprar créditos avulsos "com o cartão cadastrado".
        if (resposta?.creditCard?.creditCardToken) {
          await salvarTokenCartao(assinatura.id, resposta.creditCard.creditCardToken);
        }

        const supabaseAdmin = await clienteAdmin();
        const { error } = await supabaseAdmin
          .from("assinaturas")
          .update(cartaoSalvo)
          .eq("id", assinatura.id);
        if (error)
          console.error(
            "[assinatura:atualizar-cartao] erro ao salvar bandeira/final:",
            error.message,
          );

        return Response.json({
          ok: true,
          bandeira: cartaoSalvo.cartao_bandeira,
          final: cartaoSalvo.cartao_final,
        });
      },
    },
  },
});
