import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FileText } from "lucide-react";

import { BotaoFlutuante } from "@/components/contratacao/BotaoFlutuante";
import { LayoutContratacao } from "@/components/contratacao/LayoutContratacao";
import { atualizarContratacaoRemota } from "@/lib/contratacao/api";
import { atualizarPedido, lerPedido, type Pedido } from "@/lib/contratacao/pedido";

export const Route = createFileRoute("/contratacao/termos")({
  ssr: false,
  head: () => ({ meta: [{ title: "Termo de uso | MediCopilot" }, { name: "robots", content: "noindex" }] }),
  component: PaginaTermos,
});

function PaginaTermos() {
  const navigate = useNavigate();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [aceito, setAceito] = useState(false);

  useEffect(() => {
    const atual = lerPedido();
    if (!atual || !atual.dados) {
      navigate({ to: "/planos" });
      return;
    }
    setPedido(atual);
    setAceito(!!atual.termosAceitos);
  }, [navigate]);

  if (!pedido) return null;

  async function avancar() {
    if (!aceito) return;
    atualizarPedido({ termosAceitos: true });
    if (pedido!.contratacaoId) {
      await atualizarContratacaoRemota(pedido!.contratacaoId, { termosAceitos: true });
    }
    navigate({ to: "/contratacao/pagamento" });
  }

  return (
    <LayoutContratacao etapaAtual="termos">
      <Link to="/contratacao/dados" className="text-sm font-medium text-slate-500 hover:text-slate-700">
        ← Voltar
      </Link>

      <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-800 md:text-3xl">Termo de uso</h1>
      <p className="mt-1 text-sm text-slate-500">Dá uma lida antes de confirmar.</p>

      <div
        style={{ borderRadius: "24px" }}
        className="mt-5 border border-white/80 bg-white/60 p-5 shadow-xl shadow-slate-200/40 backdrop-blur-xl md:p-6"
      >
        <div className="flex items-center gap-2">
          <div
            style={{ borderRadius: "14px" }}
            className="flex h-10 w-10 items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600"
          >
            <FileText className="h-5 w-5 text-white" />
          </div>
          <h3 className="font-bold text-slate-800">Termo de uso e política de cobrança</h3>
        </div>

        <div
          style={{ borderRadius: "16px" }}
          className="mt-4 max-h-40 space-y-2.5 overflow-y-auto border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-600"
        >
          {/* ⚠️ TEXTO PLACEHOLDER — substituir pelo termo de uso real (jurídico) antes de lançar em produção. */}
          <p>
            Ao contratar o MediCopilot, você concorda com a cobrança recorrente do plano escolhido no
            cartão de crédito informado, com a primeira cobrança realizada no momento da confirmação da
            assinatura e as seguintes de acordo com o ciclo e a data escolhidos.
          </p>
          <p>
            Você pode alterar ou cancelar seu plano a qualquer momento pela área da sua conta ou falando
            com nosso time. O cancelamento interrompe as cobranças futuras; valores já cobrados não são
            reembolsados proporcionalmente, salvo acordo diferente com o time comercial.
          </p>
          <p>
            Os dados enviados nesta contratação são usados para emissão de cobrança, suporte e
            comunicação sobre o serviço, e tratados conforme a política de privacidade do MediCopilot.
          </p>
          <p className="text-xs text-slate-400">
            (Texto resumido para fins de demonstração — a versão final e juridicamente revisada do termo
            de uso substituirá este bloco antes do lançamento.)
          </p>
        </div>

        <label className="mt-4 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={aceito}
            onChange={(e) => setAceito(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-600"
          />
          <span className="text-sm text-slate-600">
            Li e aceito o termo de uso e a política de cobrança recorrente descritos acima.
          </span>
        </label>
      </div>

      <BotaoFlutuante onClick={avancar} disabled={!aceito}>
        Avançar
      </BotaoFlutuante>
    </LayoutContratacao>
  );
}
