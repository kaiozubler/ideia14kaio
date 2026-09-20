import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CreditCard, Lock, ShieldCheck } from "lucide-react";

import { LayoutContratacao } from "@/components/contratacao/LayoutContratacao";
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

  useEffect(() => {
    const atual = lerPedido();
    if (!atual || !atual.dados || !atual.termosAceitos) {
      navigate({ to: "/planos" });
      return;
    }
    setPedido(atual);
  }, [navigate]);

  if (!pedido) return null;

  const ancora = PLANOS_BASE.find((p) => p.id === pedido.plano) ?? PLANO_PADRAO;
  const precoMensal = precoDaConfiguracao(pedido.config, ancora);
  const precoExibido = pedido.ciclo === "anual" ? precoAnualEquivalenteMensal(precoMensal) : precoMensal;

  const linkWhatsApp = (() => {
    const c = pedido.config;
    const texto = [
      `Olá! Quero finalizar a contratação do MediCopilot.`,
      `Plano: ${ancora.nome}`,
      `Clínica: ${pedido.dados?.nomeClinica ?? ""}`,
      `Responsável: ${pedido.dados?.responsavel ?? ""}`,
      `E-mail: ${pedido.dados?.email ?? ""}`,
      `WhatsApp: ${pedido.dados?.telefone ?? ""}`,
      `Médicos: ${c.medicos} · Secretárias/Gestão: ${c.secretarias}`,
      `Copiloto: ${c.copiloto === PERSONALIZADO ? "personalizado" : c.copiloto}`,
      `WhatsApp (franquia): ${c.whatsapp === PERSONALIZADO ? "personalizado" : c.whatsapp}`,
      `Vídeo: ${c.video === PERSONALIZADO ? "personalizado" : c.video || "não incluído"}`,
      `Ciclo: ${pedido.ciclo}${pedido.diaCobranca ? ` · cobrança todo dia ${pedido.diaCobranca}` : ""}`,
      `Total: ${formatarPreco(precoExibido)}/mês`,
    ].join("\n");
    return `https://wa.me/${WHATSAPP_COMERCIAL}?text=${encodeURIComponent(texto)}`;
  })();

  function confirmarPedido() {
    window.open(linkWhatsApp, "_blank", "noreferrer");
    navigate({ to: "/contratacao/conclusao" });
  }

  return (
    <LayoutContratacao etapaAtual="pagamento">
      <Link to="/contratacao/termos" className="text-sm font-medium text-slate-500 hover:text-slate-700">
        ← Voltar
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-800 md:text-3xl">Pagamento</h1>
      <p className="mt-1 text-sm text-slate-500">Confira o total e finalize.</p>

      <div
        style={{ borderRadius: "28px" }}
        className="mt-8 border border-white/80 bg-white/60 p-6 shadow-xl shadow-slate-200/40 backdrop-blur-xl md:p-8"
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

        <div className="mt-6 space-y-3 opacity-60">
          <div style={{ borderRadius: "16px" }} className="h-11 border border-slate-200 bg-white/70 px-4 py-2.5 text-sm text-slate-400">
            Número do cartão
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div style={{ borderRadius: "16px" }} className="h-11 border border-slate-200 bg-white/70 px-4 py-2.5 text-sm text-slate-400">
              Validade
            </div>
            <div style={{ borderRadius: "16px" }} className="h-11 border border-slate-200 bg-white/70 px-4 py-2.5 text-sm text-slate-400">
              CVV
            </div>
          </div>
        </div>

        <div
          style={{ borderRadius: "18px" }}
          className="mt-5 flex items-start gap-3 border border-amber-200/70 bg-amber-50/70 p-4"
        >
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            O pagamento online ainda está a caminho. Pra não te travar, a gente confirma seu cadastro e
            processa a primeira cobrança pessoalmente pelo WhatsApp — leva menos de 5 minutos.
          </p>
        </div>

        <button
          onClick={confirmarPedido}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:from-emerald-600 hover:to-emerald-700"
        >
          Confirmar e falar no WhatsApp
        </button>

        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          Seus dados de pagamento nunca são armazenados por nós diretamente.
        </p>
      </div>
    </LayoutContratacao>
  );
}
