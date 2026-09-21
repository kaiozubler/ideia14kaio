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

      <ReguaContratacao etapaAtual={etapaAtual} />

      {/* flex-1 + items-center: conteúdo curto fica centralizado verticalmente
          (sem sobrar um scroll minúsculo e inútil); conteúdo mais alto que a
          tela simplesmente cresce e flui normal, sem cortar nada — funciona
          bem tanto em telas grandes quanto no mobile. */}
      <div className="relative flex flex-1 items-center justify-center px-4 py-8 md:px-8 md:py-12">
        <div className="w-full max-w-3xl">{children}</div>
      </div>
    </div>
  );
}
