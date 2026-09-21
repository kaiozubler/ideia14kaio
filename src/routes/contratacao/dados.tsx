import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FormEvent, useEffect, useState } from "react";
import { Building2 } from "lucide-react";

import { LayoutContratacao } from "@/components/contratacao/LayoutContratacao";
import { atualizarPedido, lerPedido, type DadosCliente, type Pedido } from "@/lib/contratacao/pedido";

export const Route = createFileRoute("/contratacao/dados")({
  ssr: false,
  head: () => ({ meta: [{ title: "Meus dados | MediCopilot" }, { name: "robots", content: "noindex" }] }),
  component: PaginaDados,
});

const CAMPO_VAZIO: DadosCliente = { nomeClinica: "", responsavel: "", documento: "", email: "", telefone: "" };

function PaginaDados() {
  const navigate = useNavigate();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [dados, setDados] = useState<DadosCliente>(CAMPO_VAZIO);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const atual = lerPedido();
    if (!atual) {
      navigate({ to: "/planos" });
      return;
    }
    setPedido(atual);
    if (atual.dados) setDados(atual.dados);
  }, [navigate]);

  if (!pedido) return null;

  function campo<K extends keyof DadosCliente>(chave: K) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setDados((d) => ({ ...d, [chave]: e.target.value }));
  }

  function avancar(e: FormEvent) {
    e.preventDefault();
    if (!dados.nomeClinica.trim() || !dados.responsavel.trim() || !dados.email.trim() || !dados.telefone.trim()) {
      setErro("Preenche os campos obrigatórios pra gente conseguir continuar.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email.trim())) {
      setErro("Esse e-mail não parece válido.");
      return;
    }
    setErro(null);
    atualizarPedido({ dados });
    navigate({ to: "/contratacao/termos" });
  }

  return (
    <LayoutContratacao etapaAtual="dados">
      <Link to="/contratacao/confirmar" className="text-sm font-medium text-slate-500 hover:text-slate-700">
        ← Voltar
      </Link>

      <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-800 md:text-3xl">Seus dados</h1>
      <p className="mt-1 text-sm text-slate-500">Pra emitir a cobrança e configurar sua conta certinha.</p>

      <form
        onSubmit={avancar}
        style={{ borderRadius: "24px" }}
        className="mt-5 border border-white/80 bg-white/60 p-5 shadow-xl shadow-slate-200/40 backdrop-blur-xl md:p-6"
      >
        <div className="flex items-center gap-2">
          <div
            style={{ borderRadius: "14px" }}
            className="flex h-10 w-10 items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600"
          >
            <Building2 className="h-5 w-5 text-white" />
          </div>
          <h3 className="font-bold text-slate-800">Dados da clínica</h3>
        </div>

        <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
          <Campo label="Nome da clínica" value={dados.nomeClinica} onChange={campo("nomeClinica")} className="sm:col-span-2" />
          <Campo label="Responsável" value={dados.responsavel} onChange={campo("responsavel")} />
          <Campo label="CPF ou CNPJ" value={dados.documento} onChange={campo("documento")} />
          <Campo label="E-mail" type="email" value={dados.email} onChange={campo("email")} />
          <Campo label="WhatsApp" type="tel" value={dados.telefone} onChange={campo("telefone")} />
        </div>

        {erro && <p className="mt-4 text-sm font-medium text-rose-600">{erro}</p>}

        <button
          type="submit"
          className="mt-5 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:from-emerald-600 hover:to-emerald-700"
        >
          Avançar
        </button>
      </form>
    </LayoutContratacao>
  );
}

function Campo({
  label,
  value,
  onChange,
  type = "text",
  className = "",
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        style={{ borderRadius: "14px" }}
        className="mt-1 w-full border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-emerald-300"
      />
    </label>
  );
}
