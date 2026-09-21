import type { ReactNode } from "react";

// Botão de ação principal (normalmente "Avançar") flutuando fixo no canto
// inferior esquerdo, alinhado à coluna de conteúdo. Assim a pessoa sempre
// vê o próximo passo sem depender de rolar a tela até o fim.

export function BotaoFlutuante({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 px-4 md:px-8">
      <div className="mx-auto flex max-w-3xl justify-start">
        <button
          onClick={onClick}
          disabled={disabled}
          className="pointer-events-auto flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-3.5 text-sm font-semibold text-white shadow-2xl shadow-emerald-500/30 transition-colors hover:from-emerald-600 hover:to-emerald-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:from-emerald-500 disabled:hover:to-emerald-600"
        >
          {children}
        </button>
      </div>
    </div>
  );
}
