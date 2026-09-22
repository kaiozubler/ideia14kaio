import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, BarChart3 } from "lucide-react";

import { BotaoFlutuante } from "@/components/contratacao/BotaoFlutuante";
import { LayoutContratacao } from "@/components/contratacao/LayoutContratacao";
import { atualizarPedido, lerPedido, type DadosCliente, type Pedido } from "@/lib/contratacao/pedido";
import {
  documentoValido,
  emailValido,
  formatarDocumento,
  formatarTelefone,
  telefoneValido,
} from "@/lib/contratacao/validacao";

export const Route = createFileRoute("/contratacao/dados")({
  ssr: false,
  head: () => ({ meta: [{ title: "Meus dados | MediCopilot" }, { name: "robots", content: "noindex" }] }),
  component: PaginaDados,
});

const CAMPO_VAZIO: DadosCliente = {
  nomeClinica: "",
  responsavel: "",
  documento: "",
  email: "",
  telefone: "",
  cidade: "",
  estado: "",
  especialidade: "",
  pacientesMes: "",
  comoConheceu: "",
};

const ESTADOS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB",
  "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

const ESPECIALIDADES = [
  "Clínica geral",
  "Cardiologia",
  "Dermatologia",
  "Ginecologia e Obstetrícia",
  "Ortopedia",
  "Pediatria",
  "Psiquiatria",
  "Endocrinologia",
  "Outra",
];

const FAIXAS_PACIENTES = ["Até 50", "51 a 150", "151 a 300", "301 a 600", "Mais de 600"];

const ORIGENS = ["Indicação de outro médico", "Google / pesquisa", "Instagram ou redes sociais", "Evento ou congresso", "Outro"];

function PaginaDados() {
  const navigate = useNavigate();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [dados, setDados] = useState<DadosCliente>(CAMPO_VAZIO);
  const [erros, setErros] = useState<Partial<Record<keyof DadosCliente, string>>>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  useEffect(() => {
    const atual = lerPedido();
    if (!atual) {
      navigate({ to: "/planos" });
      return;
    }
    setPedido(atual);
    if (atual.dados) setDados({ ...CAMPO_VAZIO, ...atual.dados });
  }, [navigate]);

  if (!pedido) return null;

  function campo<K extends keyof DadosCliente>(chave: K) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setDados((d) => ({ ...d, [chave]: e.target.value }));
  }

  function selecao<K extends keyof DadosCliente>(chave: K) {
    return (e: React.ChangeEvent<HTMLSelectElement>) => setDados((d) => ({ ...d, [chave]: e.target.value }));
  }

  function documento(e: React.ChangeEvent<HTMLInputElement>) {
    setDados((d) => ({ ...d, documento: formatarDocumento(e.target.value) }));
  }

  function telefone(e: React.ChangeEvent<HTMLInputElement>) {
    setDados((d) => ({ ...d, telefone: formatarTelefone(e.target.value) }));
  }

  function validar(): boolean {
    const novosErros: Partial<Record<keyof DadosCliente, string>> = {};

    if (!dados.nomeClinica.trim()) novosErros.nomeClinica = "Obrigatório.";
    if (!dados.responsavel.trim()) novosErros.responsavel = "Obrigatório.";
    if (!documentoValido(dados.documento)) novosErros.documento = "CPF (11 dígitos) ou CNPJ (14 dígitos) inválido.";
    if (!emailValido(dados.email)) novosErros.email = "E-mail inválido.";
    if (!telefoneValido(dados.telefone)) novosErros.telefone = "Informe DDD + número (10 ou 11 dígitos).";
    if (!dados.cidade.trim()) novosErros.cidade = "Obrigatório.";
    if (!dados.estado) novosErros.estado = "Selecione um estado.";
    if (!dados.especialidade) novosErros.especialidade = "Selecione uma opção.";
    if (!dados.pacientesMes) novosErros.pacientesMes = "Selecione uma opção.";
    if (!dados.comoConheceu) novosErros.comoConheceu = "Selecione uma opção.";

    setErros(novosErros);
    return Object.keys(novosErros).length === 0;
  }

  function avancar() {
    if (!validar()) {
      setErroGeral("Confere os campos destacados abaixo antes de continuar.");
      return;
    }
    setErroGeral(null);
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
        onSubmit={(e) => {
          e.preventDefault();
          avancar();
        }}
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
          <Campo label="Nome da clínica" value={dados.nomeClinica} onChange={campo("nomeClinica")} erro={erros.nomeClinica} className="sm:col-span-2" />
          <Campo label="Responsável" value={dados.responsavel} onChange={campo("responsavel")} erro={erros.responsavel} />
          <Campo
            label="CPF ou CNPJ"
            value={dados.documento}
            onChange={documento}
            erro={erros.documento}
            inputMode="numeric"
            placeholder="000.000.000-00"
          />
          <Campo label="E-mail" type="email" value={dados.email} onChange={campo("email")} erro={erros.email} />
          <Campo
            label="WhatsApp"
            type="tel"
            value={dados.telefone}
            onChange={telefone}
            erro={erros.telefone}
            inputMode="numeric"
            placeholder="(00) 00000-0000"
          />
          <Campo label="Cidade" value={dados.cidade} onChange={campo("cidade")} erro={erros.cidade} />
          <Selecao label="Estado" value={dados.estado} onChange={selecao("estado")} erro={erros.estado} opcoes={ESTADOS} />
        </div>

        <div className="mt-6 flex items-center gap-2 border-t border-slate-200/60 pt-5">
          <div
            style={{ borderRadius: "14px" }}
            className="flex h-10 w-10 items-center justify-center bg-gradient-to-br from-violet-400 to-violet-600"
          >
            <BarChart3 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="font-bold text-slate-800">Sobre a clínica</h3>
            <p className="text-xs text-slate-400">Nos ajuda a configurar sua conta e a melhorar o produto.</p>
          </div>
        </div>

        <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
          <Selecao
            label="Especialidade principal"
            value={dados.especialidade}
            onChange={selecao("especialidade")}
            erro={erros.especialidade}
            opcoes={ESPECIALIDADES}
            className="sm:col-span-2"
          />
          <Selecao
            label="Pacientes atendidos por mês (aprox.)"
            value={dados.pacientesMes}
            onChange={selecao("pacientesMes")}
            erro={erros.pacientesMes}
            opcoes={FAIXAS_PACIENTES}
          />
          <Selecao
            label="Como conheceu o MediCopilot?"
            value={dados.comoConheceu}
            onChange={selecao("comoConheceu")}
            erro={erros.comoConheceu}
            opcoes={ORIGENS}
          />
        </div>

        {erroGeral && <p className="mt-4 text-sm font-medium text-rose-600">{erroGeral}</p>}
      </form>

      <BotaoFlutuante onClick={avancar}>Avançar</BotaoFlutuante>
    </LayoutContratacao>
  );
}

function Campo({
  label,
  value,
  onChange,
  type = "text",
  className = "",
  erro,
  inputMode,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string;
  className?: string;
  erro?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        inputMode={inputMode}
        placeholder={placeholder}
        style={{ borderRadius: "14px" }}
        className={`mt-1 w-full border bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-emerald-300 ${
          erro ? "border-rose-300" : "border-slate-200"
        }`}
      />
      {erro && <span className="mt-1 block text-xs text-rose-600">{erro}</span>}
    </label>
  );
}

function Selecao({
  label,
  value,
  onChange,
  opcoes,
  className = "",
  erro,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  opcoes: string[];
  className?: string;
  erro?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <select
        value={value}
        onChange={onChange}
        style={{ borderRadius: "14px" }}
        className={`mt-1 w-full border bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-emerald-300 ${
          erro ? "border-rose-300" : "border-slate-200"
        }`}
      >
        <option value="">Selecione</option>
        {opcoes.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      {erro && <span className="mt-1 block text-xs text-rose-600">{erro}</span>}
    </label>
  );
}
