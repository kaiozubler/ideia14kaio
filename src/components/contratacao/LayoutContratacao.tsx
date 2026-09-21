import type { ReactNode } from "react";

import { ReguaContratacao, type EtapaContratacao } from "./ReguaContratacao";

export function LayoutContratacao({
  etapaAtual,
  children,
}: {
  etapaAtual: EtapaContratacao;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[linear-gradient(135deg,#eef8f1_0%,#f3f1fb_45%,#fdf6ec_100%)]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-emerald-200 opacity-60 blur-3xl" />
        <div className="absolute -right-24 top-40 h-96 w-96 rounded-full bg-violet-200 opacity-60 blur-3xl" />
      </div>

      {/* flex-1 + items-center: conteúdo curto fica centralizado verticalmente
          (sem sobrar scroll minúsculo); conteúdo mais alto que a tela flui
          normal, sem cortar nada — funciona bem em qualquer tamanho de tela. */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-24">
        <div className="w-full max-w-3xl">
          <ReguaContratacao etapaAtual={etapaAtual} />
          {children}
        </div>
      </div>
    </div>
  );
}
