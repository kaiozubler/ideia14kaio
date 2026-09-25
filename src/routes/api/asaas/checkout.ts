import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { ambienteAsaas, asaasFetch, AsaasApiError, AsaasNaoConfiguradoError } from "@/lib/asaas/client.server";
import { PERSONALIZADO, PLANOS_BASE, PLANO_PADRAO } from "@/lib/plans/config";

// Cria um Checkout Asaas (assinatura recorrente no cartão) a partir de uma
// linha já existente em `contratacoes` (ver /api/contratacao). Devolve a URL
// hospedada pelo Asaas pra onde o navegador deve redirecionar o pagador.
//
// A confirmação de pagamento de verdade NUNCA vem daqui — vem do Webhook em
// /api/asaas/webhook (evento CHECKOUT_PAID). O retorno desta rota só serve
// pra montar o link; ver https://docs.asaas.com/docs/checkout-asaas.

const BodySchema = z.object({ contratacaoId: z.string().uuid() });

function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

export const Route = createFileRoute("/api/asaas/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = await request.json().catch(() => null);
        const body = BodySchema.safeParse(json);
        if (!body.success) return Response.json({ error: "payload inválido" }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: contratacao, error: erroBusca } = await supabaseAdmin
          .from("contratacoes")
          .select("*")
          .eq("id", body.data.contratacaoId)
          .single();

        if (erroBusca || !contratacao) {
          return Response.json({ error: "contratação não encontrada" }, { status: 404 });
        }

        const camposObrigatorios = [
          "nome_clinica",
          "documento",
          "cep",
          "logradouro",
          "numero",
          "bairro",
          "cidade",
          "estado",
          "responsavel_nome",
          "responsavel_email",
          "responsavel_telefone",
        ] as const;
        const faltando = camposObrigatorios.filter((c) => !contratacao[c]);
        if (faltando.length > 0) {
          return Response.json(
            { error: `faltam dados da contratação antes de gerar o pagamento: ${faltando.join(", ")}` },
            { status: 400 },
          );
        }

        const ancora = PLANOS_BASE.find((p) => p.id === contratacao.plano) ?? PLANO_PADRAO;
        const valorMensal = Number(contratacao.preco_mensal_calculado ?? ancora.precoMensal);

        const hoje = new Date().toISOString().slice(0, 10);
        const origin = new URL(request.url).origin;

        const nomeItens: Record<string, string> = { basic: "Basic", pro: "Pro", enterprise: "Enterprise" };
        const descricaoFranquias = [
          contratacao.copiloto === PERSONALIZADO ? "Copiloto personalizado" : `Copiloto ${contratacao.copiloto} consultas`,
          contratacao.whatsapp === PERSONALIZADO ? "WhatsApp personalizado" : `WhatsApp ${contratacao.whatsapp} conversas`,
          contratacao.video === PERSONALIZADO ? "Vídeo personalizado" : contratacao.video ? `Vídeo ${contratacao.video} min` : "sem vídeo",
        ].join(" · ");

        try {
          const checkout = await asaasFetch<{ id: string }>("/checkouts", {
            method: "POST",
            body: JSON.stringify({
              billingTypes: ["CREDIT_CARD"],
              chargeTypes: ["RECURRENT"],
              minutesToExpire: 60,
              callback: {
                successUrl: `${origin}/contratacao/conclusao`,
                cancelUrl: `${origin}/contratacao/pagamento?asaas=cancelado`,
                expiredUrl: `${origin}/contratacao/pagamento?asaas=expirado`,
              },
              items: [
                {
                  name: `MediCopilot — plano ${nomeItens[contratacao.plano] ?? contratacao.plano}`,
                  description: `${contratacao.medicos} médico(s), ${contratacao.secretarias} usuário(s) de gestão · ${descricaoFranquias}`,
                  quantity: 1,
                  value: valorMensal,
                },
              ],
              subscription: {
                cycle: contratacao.ciclo === "anual" ? "YEARLY" : "MONTHLY",
                // Primeira cobrança agora — como já avisamos no passo "Confirme seu
                // plano". As próximas seguem o `cycle` a partir daqui.
                nextDueDate: hoje,
              },
              customerData: {
                name: contratacao.nome_clinica,
                cpfCnpj: somenteDigitos(contratacao.documento),
                email: contratacao.responsavel_email,
                phone: somenteDigitos(contratacao.responsavel_telefone),
                address: contratacao.logradouro,
                addressNumber: contratacao.numero,
                complement: contratacao.complemento || undefined,
                postalCode: somenteDigitos(contratacao.cep),
                province: contratacao.bairro,
                // Código IBGE do município (não o nome) — ver cidade_ibge, capturado
                // via ViaCEP no passo "Meus dados". Sem ele o Asaas pode rejeitar ou
                // temos que cair para outro identificador de cidade.
                city: contratacao.cidade_ibge ? Number(contratacao.cidade_ibge) : undefined,
              },
            }),
          });

          await supabaseAdmin
            .from("contratacoes")
            .update({ asaas_checkout_id: checkout.id })
            .eq("id", contratacao.id);

          const dominioCheckout = ambienteAsaas() === "production" ? "https://www.asaas.com" : "https://sandbox.asaas.com";
          return Response.json({ checkoutUrl: `${dominioCheckout}/checkoutSession/show?id=${checkout.id}` });
        } catch (err) {
          if (err instanceof AsaasNaoConfiguradoError) {
            return Response.json({ error: err.message, naoConfigurado: true }, { status: 501 });
          }
          if (err instanceof AsaasApiError) {
            console.error("[asaas:checkout] erro da API Asaas:", err.message);
            return Response.json({ error: err.message }, { status: 502 });
          }
          console.error("[asaas:checkout] erro inesperado:", err);
          return Response.json({ error: "erro inesperado ao gerar o pagamento" }, { status: 500 });
        }
      },
    },
  },
});
