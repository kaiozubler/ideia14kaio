import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CreditCard, Lock, ShieldCheck } from "lucide-react";

import { BotaoFlutuante } from "@/components/contratacao/BotaoFlutuante";
import { LayoutContratacao } from "@/components/contratacao/LayoutContratacao";
import { atualizarContratacaoRemota } from "@/lib/contratacao/api";
import { lerPedido, type Pedido } from "@/lib/contratacao/pedido";
import {
  PERSONALIZADO,
  PLANOS_BASE,
  PLANO_PADRAO,
  WHATSAPP_COMERCIAL,
  formatarPreco,
  precoAnualEquivalenteMensal,
  precoDaConfiguracao,
} from "@/lib/plans/config";

export const Route = createFileRoute("/contratacao/pagamento")({
  ssr: false,
  head: () => ({ meta: [{ title: "Pagamento | MediCopilot" }, { name: "robots", content: "noindex" }] }),
  component: PaginaPagamento,
});

function PaginaPagamento() {
  const navigate = useNavigate();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erroAsaas, setErroAsaas] = useState<string | null>(null);
  const [asaasNaoConfigurado, setAsaasNaoConfigurado] = useState(false);

  useEffect(() => {
    const atual = lerPedido();
    if (!atual || !atual.dados || !atual.termosAceitos) {
      navigate({ to: "/planos" });
      return;
    }
    setPedido(atual);

    // O Checkout Asaas redireciona de volta pra cá em caso de cancelamento/expiração
    // (ver callback em /api/asaas/checkout) — mostra um aviso amigável nesse caso.
    const params = new URLSearchParams(window.location.search);
    const asaas = params.get("asaas");
    if (asaas === "cancelado") setErroAsaas("Pagamento cancelado. Pode tentar de novo quando quiser.");
    if (asaas === "expirado") setErroAsaas("O link de pagamento expirou. Gera um novo abaixo.");
  }, [navigate]);

  if (!pedido) return null;

  const ancora = PLANOS_BASE.find((p) => p.id === pedido.plano) ?? PLANO_PADRAO;
  const precoMensal = precoDaConfiguracao(pedido.config, ancora);
  const precoExibido = pedido.ciclo === "anual" ? precoAnualEquivalenteMensal(precoMensal) : precoMensal;

  const linkWhatsApp = (() => {
    const c = pedido.config;
    const d = pedido.dados;
    const endereco = d
      ? `${d.endereco.logradouro}, ${d.endereco.numero}${d.endereco.complemento ? ` - ${d.endereco.complemento}` : ""} - ${d.endereco.bairro}, ${d.endereco.cidade}/${d.endereco.estado} - CEP ${d.endereco.cep}`
      : "";
    const financeiro = d?.financeiroMesmoResponsavel
      ? "mesmo do responsável"
      : d?.financeiro.map((f) => `${f.nome} (${f.email}, ${f.telefone})`).join("; ") || "";
    const juridico = d?.juridicoMesmoResponsavel
      ? "mesmo do responsável"
      : d?.juridico.map((f) => `${f.nome} (${f.email}, ${f.telefone})`).join("; ") || "";
    const texto = [
      `Olá! Quero finalizar a contratação do MediCopilot.`,
      `Plano: ${ancora.nome}`,
      `Clínica: ${d?.nomeClinica ?? ""}`,
      `CPF/CNPJ: ${d?.documento ?? ""}`,
      `Endereço: ${endereco}`,
      `Responsável: ${d?.responsavel.nome ?? ""} (${d?.responsavel.cargo ?? ""}) — ${d?.responsavel.email ?? ""}, ${d?.responsavel.telefone ?? ""}`,
      `Financeiro (recebe NF/cobrança): ${financeiro}`,
      `Jurídico (recebe termo/contrato): ${juridico}`,
      `Especialidade: ${d?.especialidade ?? ""}`,
      `Médicos: ${c.medicos} · Secretárias/Gestão: ${c.secretarias}`,
      `Copiloto: ${c.copiloto === PERSONALIZADO ? "personalizado" : c.copiloto}`,
      `WhatsApp (franquia): ${c.whatsapp === PERSONALIZADO ? "personalizado" : c.whatsapp}`,
      `Vídeo: ${c.video === PERSONALIZADO ? "personalizado" : c.video || "não incluído"}`,
      `Ciclo: ${pedido.ciclo}${pedido.diaCobranca ? ` · cobrança todo dia ${pedido.diaCobranca}` : ""}`,
      `Total: ${formatarPreco(precoExibido)}/mês`,
    ].join("\n");
    return `https://wa.me/${WHATSAPP_COMERCIAL}?text=${encodeURIComponent(texto)}`;
  })();

  async function pagarComCartao() {
    if (!pedido!.contratacaoId) {
      setErroAsaas("Não encontramos sua contratação salva. Volta pra etapa anterior e confirma de novo.");
      return;
    }
    setCarregando(true);
    setErroAsaas(null);
    setAsaasNaoConfigurado(false);
    try {
      const resp = await fetch("/api/asaas/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contratacaoId: pedido!.contratacaoId }),
      });
      const data = (await resp.json()) as { checkoutUrl?: string; error?: string; naoConfigurado?: boolean };
      if (!resp.ok || !data.checkoutUrl) {
        setAsaasNaoConfigurado(!!data.naoConfigurado);
        setErroAsaas(
          data.naoConfigurado
            ? "O pagamento online ainda não foi ativado pra essa conta. Fala com a gente pelo WhatsApp que fechamos agora."
            : data.error || "Não conseguimos abrir o pagamento agora.",
        );
        setCarregando(false);
        return;
      }
      window.location.href = data.checkoutUrl;
    } catch {
      setErroAsaas("Não conseguimos abrir o pagamento agora. Tenta de novo ou fala com a gente pelo WhatsApp.");
      setCarregando(false);
    }
  }

  async function confirmarPeloWhatsApp() {
    window.open(linkWhatsApp, "_blank", "noreferrer");
    if (pedido!.contratacaoId) {
      await atualizarContratacaoRemota(pedido!.contratacaoId, { status: "aguardando_confirmacao" });
    }
    navigate({ to: "/contratacao/conclusao" });
  }

  return (
    <LayoutContratacao etapaAtual="pagamento">
      <Link to="/contratacao/termos" className="text-sm font-medium text-slate-500 hover:text-slate-700">
        ← Voltar
      </Link>

      <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-800 md:text-3xl">Pagamento</h1>
      <p className="mt-1 text-sm text-slate-500">Confira o total e finalize.</p>

      <div
        style={{ borderRadius: "24px" }}
        className="mt-5 border border-white/80 bg-white/60 p-5 shadow-xl shadow-slate-200/40 backdrop-blur-xl md:p-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              style={{ borderRadius: "14px" }}
              className="flex h-10 w-10 items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600"
            >
              <CreditCard className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800">Cartão de crédito</h3>
              <p className="text-xs text-slate-400">Cobrança recorrente {pedido.ciclo === "anual" ? "anual" : "mensal"}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Total</p>
            <p className="text-lg font-bold text-slate-800">{formatarPreco(precoExibido)}/mês</p>
          </div>
        </div>

        <div
          style={{ borderRadius: "16px" }}
          className="mt-5 flex items-start gap-3 border border-slate-200 bg-white/70 p-4"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <p className="text-sm text-slate-600">
            Ao continuar, você vai pra uma página segura do Asaas pra colocar os dados do cartão. A gente
            nunca vê nem guarda esses dados.
          </p>
        </div>

        {erroAsaas && (
          <div
            style={{ borderRadius: "16px" }}
            className="mt-4 border border-amber-200/70 bg-amber-50/70 p-4 text-sm text-amber-800"
          >
            {erroAsaas}
            {asaasNaoConfigurado && (
              <button
                onClick={confirmarPeloWhatsApp}
                className="mt-2 block font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
              >
                Falar no WhatsApp agora →
              </button>
            )}
          </div>
        )}

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          Seus dados de pagamento nunca são armazenados por nós diretamente.
        </p>
        {!asaasNaoConfigurado && (
          <button
            onClick={confirmarPeloWhatsApp}
            className="mt-2 block w-full text-center text-xs font-medium text-slate-400 underline underline-offset-2 hover:text-slate-600"
          >
            Prefiro fechar conversando com alguém pelo WhatsApp
          </button>
        )}
      </div>

      <BotaoFlutuante onClick={pagarComCartao} disabled={carregando}>
        {carregando ? "Abrindo pagamento…" : "Pagar com cartão"}
      </BotaoFlutuante>
    </LayoutContratacao>
  );
}
