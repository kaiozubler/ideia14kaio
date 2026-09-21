// Indicador de progresso da contratação — discreto e no mesmo plano do
// resto do conteúdo (nada de barra fixa/flutuante com fundo e borda
// próprios, cara de topbar). Renderizado inline, no topo da coluna
// centralizada de cada página, por LayoutContratacao. Só existe a partir
// de "Confirme seu plano" em diante — a escolha do plano em si acontece em
// /planos, sem esse indicador.

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
    <div className="mb-5">
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
      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-200/70">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500 ease-out"
          style={{ width: `${progresso}%` }}
        />
      </div>
    </div>
  );
}
