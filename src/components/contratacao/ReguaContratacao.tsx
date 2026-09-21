// Régua de progresso da contratação — versão discreta: rótulo do passo
// atual + uma barra fina de progresso com pontinhos, sem escrever todos os
// 6 nomes lado a lado (isso forçava scroll horizontal e ficava com cara de
// wizard antigo). Só é renderizada a partir de "Confirme seu plano" em
// diante — a escolha do plano acontece em /planos, sem essa barra.

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
  const progresso = ((indiceAtual + 1) / ETAPAS.length) * 100;

  return (
    <div className="sticky top-0 z-30 border-b border-white/60 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto max-w-3xl px-4 py-3 md:px-8 md:py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Passo {indiceAtual + 1} de {ETAPAS.length}
            </p>
            <p className="text-sm font-bold text-slate-800">{ETAPAS[indiceAtual].label}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {ETAPAS.map((etapa, i) => (
              <span
                key={etapa.id}
                className={[
                  "h-1.5 rounded-full transition-all duration-300",
                  i === indiceAtual ? "w-4 bg-emerald-500" : i < indiceAtual ? "w-1.5 bg-emerald-400" : "w-1.5 bg-slate-200",
                ].join(" ")}
              />
            ))}
          </div>
        </div>
        <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-slate-200/70">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500 ease-out"
            style={{ width: `${progresso}%` }}
          />
        </div>
      </div>
    </div>
  );
}
