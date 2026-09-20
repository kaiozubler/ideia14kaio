import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { LayoutContratacao } from "@/components/contratacao/LayoutContratacao";
import { lerPedido, limparPedido, type Pedido } from "@/lib/contratacao/pedido";
import { PLANOS_BASE, PLANO_PADRAO, WHATSAPP_COMERCIAL, formatarPreco, precoAnualEquivalenteMensal, precoDaConfiguracao } from "@/lib/plans/config";

export const Route = createFileRoute("/contratacao/conclusao")({
  ssr: false,
  head: () => ({ meta: [{ title: "Pedido recebido | MediCopilot" }, { name: "robots", content: "noindex" }] }),
  component: PaginaConclusao,
});

function PaginaConclusao() {
  const navigate = useNavigate();
  const [pedido, setPedido] = useState<Pedido | null>(null);

  useEffect(() => {
    const atual = lerPedido();
    if (!atual) {
      navigate({ to: "/planos" });
      return;
    }
    setPedido(atual);
    // O pedido "termina" aqui — limpa pra não sobrar um pedido velho no
    // sessionStorage se a pessoa voltar pro fluxo depois.
    limparPedido();
  }, [navigate]);

  if (!pedido) return null;

  const ancora = PLANOS_BASE.find((p) => p.id === pedido.plano) ?? PLANO_PADRAO;
  const precoMensal = precoDaConfiguracao(pedido.config, ancora);
  const precoExibido = pedido.ciclo === "anual" ? precoAnualEquivalenteMensal(precoMensal) : precoMensal;

  return (
    <LayoutContratacao etapaAtual="conclusao">
      <div className="flex flex-col items-center text-center">
        <div
          style={{ borderRadius: "24px" }}
          className="flex h-16 w-16 items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-lg shadow-emerald-500/30"
        >
          <CheckCircle2 className="h-8 w-8 text-white" />
        </div>

        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-800 md:text-3xl">Pedido recebido!</h1>
        <p className="mt-2 max-w-md text-sm text-slate-500">
          Recebemos os dados da sua contratação do plano <strong>{ancora.nome}</strong> ({formatarPreco(precoExibido)}/mês).
          Nosso time confirma o pagamento com você pelo WhatsApp e ativa sua conta assim que possível.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href={`https://wa.me/${WHATSAPP_COMERCIAL}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:from-emerald-600 hover:to-emerald-700"
          >
            Falar no WhatsApp agora
          </a>
          <Link
            to="/"
            className="rounded-2xl border border-slate-200 bg-white/70 px-6 py-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-white"
          >
            Voltar para o início
          </Link>
        </div>
      </div>
    </LayoutContratacao>
  );
}
