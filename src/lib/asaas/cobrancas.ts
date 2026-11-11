// Cobrança do Asaas (objeto `payment` da API e dos webhooks) -> linha de
// asaas_cobrancas. Usado pelo webhook e pela sincronização do Zubler CRM.
// Não inclui valor_estornado: esse é mantido pelos estornos
// (pagamentos_estornos), e o upsert só grava as colunas enviadas.

export type PaymentAsaas = {
  id?: string;
  customer?: string | null;
  subscription?: string | null;
  value?: number;
  netValue?: number | null;
  status?: string;
  billingType?: string;
  dueDate?: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  invoiceUrl?: string | null;
  description?: string | null;
  deleted?: boolean;
};

export function linhaDaCobranca(
  payment: PaymentAsaas & { id: string },
  vinculo: { medicoId: string | null; assinaturaId: string | null },
  evento: string,
) {
  return {
    asaas_payment_id: payment.id,
    asaas_subscription_id: payment.subscription ?? null,
    medico_id: vinculo.medicoId,
    assinatura_id: vinculo.assinaturaId,
    valor: payment.value ?? null,
    valor_liquido: payment.netValue ?? null,
    status: payment.deleted ? "DELETED" : (payment.status ?? null),
    metodo: payment.billingType ?? null,
    vencimento: payment.dueDate ?? null,
    pago_em: payment.paymentDate ?? payment.clientPaymentDate ?? null,
    fatura_url: payment.invoiceUrl ?? null,
    descricao: payment.description ?? null,
    ultimo_evento: evento,
    atualizado_em: new Date().toISOString(),
  };
}
