import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CalendarClock, CreditCard } from "lucide-react";
import { addYears, format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { LayoutContratacao } from "@/components/contratacao/LayoutContratacao";
import { atualizarPedido, lerPedido, type Pedido } from "@/lib/contratacao/pedido";
import {
  PERSONALIZADO,
  PLANOS_BASE,
  PLANO_PADRAO,
  formatarPreco,
  precoAnualEquivalenteMensal,
  precoDaConfiguracao,
} from "@/lib/plans/config";

export const Route = createFileRoute("/contratacao/confirmar")({
  ssr: false,
  head: () => ({ meta: [{ title: "Confirme seu plano | MediCopilot" }, { name: "robots", content: "noindex" }] }),
  component: PaginaConfirmar,
});

function diaDeHojeLimitado(): number {
  return Math.min(28, new Date().getDate());
}

function PaginaConfirmar() {
  const navigate = useNavigate();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [diaCobranca, setDiaCobranca] = useState<number>(diaDeHojeLimitado());

  useEffect(() => {
    const atual = lerPedido();
    if (!atual) {
      navigate({ to: "/planos" });
      return;
    }
    setPedido(atual);
    setDiaCobranca(atual.diaCobranca ?? diaDeHojeLimitado());
  }, [navigate]);

  if (!pedido) return null;

  const ancora = PLANOS_BASE.find((p) => p.id === pedido.plano) ?? PLANO_PADRAO;
  const precoMensal = precoDaConfiguracao(pedido.config, ancora);
  const precoExibido = pedido.ciclo === "anual" ? precoAnualEquivalenteMensal(precoMensal) : precoMensal;
  const proximaRenovacao = format(addYears(new Date(), 1), "d 'de' MMMM 'de' yyyy", { locale: ptBR });

  function avancar() {
    atualizarPedido({ diaCobranca: pedido!.ciclo === "mensal" ? diaCobranca : undefined });
    navigate({ to: "/contratacao/dados" });
  }

  return (
    <LayoutContratacao etapaAtual="confirmar">
      <Link to="/planos" className="text-sm font-medium text-slate-500 hover:text-slate-700">
        ← Voltar para planos
      </Link>

      <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-800 md:text-3xl">Confirme seu plano</h1>
      <p className="mt-1 text-sm text-slate-500">Dá uma conferida antes de seguir para os próximos passos.</p>

      <div className="mt-8 grid gap-6 md:grid-cols-5">
        {/* Resumo */}
        <div
          style={{ borderRadius: "28px" }}
          className="border border-white/80 bg-white/70 p-6 shadow-xl shadow-slate-200/40 backdrop-blur-xl md:col-span-2 md:order-2"
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Seu plano</p>
          <h3 className="mt-1 text-lg font-bold text-slate-800">{ancora.nome}</h3>

          <div className="mt-4 space-y-1.5 text-sm text-slate-600">
            <p>{pedido.config.medicos} médico{pedido.config.medicos !== 1 ? "s" : ""}</p>
            <p>{pedido.config.secretarias} secretária{pedido.config.secretarias !== 1 ? "s" : ""} / gestão</p>
            <p>
              Copiloto ·{" "}
              {pedido.config.copiloto === PERSONALIZADO ? "personalizado" : `${pedido.config.copiloto} consultas`}
            </p>
            <p>
              WhatsApp ·{" "}
              {pedido.config.whatsapp === PERSONALIZADO
                ? "personalizado"
                : `${pedido.config.whatsapp.toLocaleString("pt-BR")} conversas`}
            </p>
            <p>
              {pedido.config.video === PERSONALIZADO
                ? "Vídeo · personalizado"
                : pedido.config.video
                  ? `Vídeo · ${pedido.config.video.toLocaleString("pt-BR")} min`
                  : "Vídeo · não incluído"}
            </p>
          </div>

          <div className="my-4 h-px bg-slate-200/70" />

          <p className="text-xs text-slate-400">Total {pedido.ciclo === "anual" ? "mensal (cobrado anual)" : "mensal"}</p>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-slate-800">{formatarPreco(precoExibido)}</span>
            <span className="text-sm text-slate-400">/mês</span>
          </div>
        </div>

        {/* Pagamento e data de cobrança */}
        <div
          style={{ borderRadius: "28px" }}
          className="border border-white/80 bg-white/60 p-6 shadow-xl shadow-slate-200/40 backdrop-blur-xl md:col-span-3 md:order-1"
        >
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

          {pedido.ciclo === "mensal" ? (
            <div className="mt-6">
              <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <CalendarClock className="h-4 w-4 text-slate-400" />
                Melhor dia do mês para a cobrança
              </label>
              <select
                value={diaCobranca}
                onChange={(e) => setDiaCobranca(Number(e.target.value))}
                style={{ borderRadius: "14px" }}
                className="mt-2 w-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-emerald-300"
              >
                {Array.from({ length: 28 }, (_, i) => i + 1).map((dia) => (
                  <option key={dia} value={dia}>
                    Todo dia {dia}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="mt-6 text-sm text-slate-600">
              No plano anual, a próxima renovação acontece em <strong>{proximaRenovacao}</strong>.
            </p>
          )}

          <div
            style={{ borderRadius: "18px" }}
            className="mt-5 border border-amber-200/70 bg-amber-50/70 p-4 text-sm text-amber-800"
          >
            <strong>A primeira cobrança é feita agora</strong>, ao confirmar a assinatura.{" "}
            {pedido.ciclo === "mensal" ? (
              <>A partir do próximo ciclo, as cobranças passam a acontecer sempre no dia escolhido acima.</>
            ) : (
              <>A próxima cobrança só acontece na renovação anual, em {proximaRenovacao}.</>
            )}
          </div>

          <button
            onClick={avancar}
            className="mt-6 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:from-emerald-600 hover:to-emerald-700"
          >
            Avançar
          </button>
        </div>
      </div>
    </LayoutContratacao>
  );
}
