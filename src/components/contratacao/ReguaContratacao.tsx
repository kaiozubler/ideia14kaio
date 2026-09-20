import { Check } from "lucide-react";

// Régua de progresso da contratação. Só é renderizada a partir de "Confirme
// seu plano" em diante — a escolha do plano acontece em /planos, sem essa
// barra (ver a conversa de produto: a régua só aparece depois do clique em
// "avançar"). Por isso "Escolha seu plano" está na lista mas nunca é o
// `etapaAtual` — ela sempre aparece como concluída.

export type EtapaContratacao = "escolher" | "confirmar" | "dados" | "termos" | "pagamento" | "conclusao";

const ETAPAS: { id: EtapaContratacao; label: string }[] = [
  { id: "escolher", label: "Escolha seu plano" },
  { id: "confirmar", label: "Confirme seu plano" },
  { id: "dados", label: "Meus dados" },
  { id: "termos", label: "Termo de uso" },
  { id: "pagamento", label: "Pagamento" },
  { id: "conclusao", label: "Conclusão" },
];

export function ReguaContratacao({ etapaAtual }: { etapaAtual: EtapaContratacao }) {
  const indiceAtual = ETAPAS.findIndex((e) => e.id === etapaAtual);

  return (
    <div className="sticky top-0 z-30 border-b border-white/60 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-4xl items-center gap-1 overflow-x-auto px-4 py-3.5 md:justify-center md:gap-2 md:px-8">
        {ETAPAS.map((etapa, i) => {
          const concluida = i < indiceAtual;
          const atual = i === indiceAtual;
          return (
            <div key={etapa.id} className="flex shrink-0 items-center gap-1.5 md:gap-2">
              <div className="flex items-center gap-1.5">
                <span
                  className={[
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors",
                    concluida
                      ? "bg-emerald-500 text-white"
                      : atual
                        ? "bg-slate-800 text-white"
                        : "bg-slate-200 text-slate-500",
                  ].join(" ")}
                >
                  {concluida ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span
                  className={[
                    "whitespace-nowrap text-xs font-medium md:text-sm",
                    atual ? "font-bold text-slate-800" : concluida ? "text-slate-600" : "text-slate-400",
                  ].join(" ")}
                >
                  {etapa.label}
                </span>
              </div>
              {i < ETAPAS.length - 1 && <span className="mx-0.5 h-px w-4 shrink-0 bg-slate-300 md:w-8" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
