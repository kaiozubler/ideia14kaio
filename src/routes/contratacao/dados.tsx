import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BarChart3, Building2, Landmark, MapPin, Plus, Scale, Trash2, User } from "lucide-react";

import { BotaoFlutuante } from "@/components/contratacao/BotaoFlutuante";
import { LayoutContratacao } from "@/components/contratacao/LayoutContratacao";
import { buscarEnderecoPorCep, cepValido, formatarCep } from "@/lib/contratacao/cep";
import { atualizarPedido, lerPedido, type Contato, type DadosCliente, type Pedido } from "@/lib/contratacao/pedido";
import {
  apenasDigitos,
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

const CONTATO_VAZIO: Contato = { nome: "", email: "", telefone: "" };

const CAMPO_VAZIO: DadosCliente = {
  nomeClinica: "",
  documento: "",
  endereco: { cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", estado: "" },
  responsavel: { nome: "", email: "", telefone: "", cargo: "" },
  financeiroMesmoResponsavel: true,
  financeiro: [],
  juridicoMesmoResponsavel: true,
  juridico: [],
  especialidade: "",
  pacientesMes: "",
  comoConheceu: "",
};

const ESTADOS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB",
  "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

const ESPECIALIDADES = [
  "Clínica geral", "Cardiologia", "Dermatologia", "Ginecologia e Obstetrícia",
  "Ortopedia", "Pediatria", "Psiquiatria", "Endocrinologia", "Outra",
];

const FAIXAS_PACIENTES = ["Até 50", "51 a 150", "151 a 300", "301 a 600", "Mais de 600"];

const ORIGENS = ["Indicação de outro médico", "Google / pesquisa", "Instagram ou redes sociais", "Evento ou congresso", "Outro"];

type ErrosContato = Partial<Record<keyof Contato, string>>;
type Erros = {
  nomeClinica?: string;
  documento?: string;
  endereco?: Partial<Record<keyof DadosCliente["endereco"], string>>;
  responsavel?: Partial<Record<keyof DadosCliente["responsavel"], string>>;
  financeiro?: ErrosContato[];
  juridico?: ErrosContato[];
  especialidade?: string;
  pacientesMes?: string;
  comoConheceu?: string;
};

function validarContato(c: Contato): ErrosContato {
  const e: ErrosContato = {};
  if (!c.nome.trim()) e.nome = "Obrigatório.";
  if (!emailValido(c.email)) e.email = "E-mail inválido.";
  if (!telefoneValido(c.telefone)) e.telefone = "Telefone inválido.";
  return e;
}

function PaginaDados() {
  const navigate = useNavigate();
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [dados, setDados] = useState<DadosCliente>(CAMPO_VAZIO);
  const [erros, setErros] = useState<Erros>({});
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [erroCep, setErroCep] = useState<string | null>(null);

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

  async function aoMudarCep(e: React.ChangeEvent<HTMLInputElement>) {
    const formatado = formatarCep(e.target.value);
    setDados((d) => ({ ...d, endereco: { ...d.endereco, cep: formatado } }));
    setErroCep(null);
    if (apenasDigitos(formatado).length !== 8) return;

    setBuscandoCep(true);
    const resultado = await buscarEnderecoPorCep(formatado);
    setBuscandoCep(false);
    if (!resultado) {
      setErroCep("CEP não encontrado. Preenche o endereço manualmente.");
      return;
    }
    setDados((d) => ({
      ...d,
      endereco: {
        ...d.endereco,
        logradouro: resultado.logradouro || d.endereco.logradouro,
        bairro: resultado.bairro || d.endereco.bairro,
        cidade: resultado.localidade || d.endereco.cidade,
        estado: resultado.uf || d.endereco.estado,
      },
    }));
  }

  function campoEndereco<K extends keyof DadosCliente["endereco"]>(chave: K) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setDados((d) => ({ ...d, endereco: { ...d.endereco, [chave]: e.target.value } }));
  }

  function campoResponsavel<K extends keyof DadosCliente["responsavel"]>(chave: K) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const valor = chave === "telefone" ? formatarTelefone(e.target.value) : e.target.value;
      setDados((d) => ({ ...d, responsavel: { ...d.responsavel, [chave]: valor } }));
    };
  }

  function documento(e: React.ChangeEvent<HTMLInputElement>) {
    setDados((d) => ({ ...d, documento: formatarDocumento(e.target.value) }));
  }

  function alternarMesmoResponsavel(tipo: "financeiro" | "juridico") {
    setDados((d) => {
      const chaveToggle = tipo === "financeiro" ? "financeiroMesmoResponsavel" : "juridicoMesmoResponsavel";
      const novoValor = !d[chaveToggle];
      const listaAtual = d[tipo];
      return {
        ...d,
        [chaveToggle]: novoValor,
        [tipo]: novoValor ? listaAtual : listaAtual.length ? listaAtual : [{ ...CONTATO_VAZIO }],
      };
    });
  }

  function adicionarContato(tipo: "financeiro" | "juridico") {
    setDados((d) => ({ ...d, [tipo]: [...d[tipo], { ...CONTATO_VAZIO }] }));
  }

  function removerContato(tipo: "financeiro" | "juridico", indice: number) {
    setDados((d) => ({ ...d, [tipo]: d[tipo].filter((_, i) => i !== indice) }));
  }

  function atualizarContato(tipo: "financeiro" | "juridico", indice: number, campo: keyof Contato, valor: string) {
    const valorFormatado = campo === "telefone" ? formatarTelefone(valor) : valor;
    setDados((d) => ({
      ...d,
      [tipo]: d[tipo].map((c, i) => (i === indice ? { ...c, [campo]: valorFormatado } : c)),
    }));
  }

  function validar(): boolean {
    const novosErros: Erros = {};

    if (!dados.nomeClinica.trim()) novosErros.nomeClinica = "Obrigatório.";
    if (!documentoValido(dados.documento)) novosErros.documento = "CPF (11 dígitos) ou CNPJ (14 dígitos) inválido.";

    const erroEndereco: NonNullable<Erros["endereco"]> = {};
    if (!cepValido(dados.endereco.cep)) erroEndereco.cep = "CEP inválido.";
    if (!dados.endereco.logradouro.trim()) erroEndereco.logradouro = "Obrigatório.";
    if (!dados.endereco.numero.trim()) erroEndereco.numero = "Obrigatório.";
    if (!dados.endereco.bairro.trim()) erroEndereco.bairro = "Obrigatório.";
    if (!dados.endereco.cidade.trim()) erroEndereco.cidade = "Obrigatório.";
    if (!dados.endereco.estado) erroEndereco.estado = "Selecione um estado.";
    if (Object.keys(erroEndereco).length) novosErros.endereco = erroEndereco;

    const erroResp: NonNullable<Erros["responsavel"]> = {};
    if (!dados.responsavel.nome.trim()) erroResp.nome = "Obrigatório.";
    if (!emailValido(dados.responsavel.email)) erroResp.email = "E-mail inválido.";
    if (!telefoneValido(dados.responsavel.telefone)) erroResp.telefone = "Informe DDD + número.";
    if (!dados.responsavel.cargo.trim()) erroResp.cargo = "Obrigatório.";
    if (Object.keys(erroResp).length) novosErros.responsavel = erroResp;

    if (!dados.financeiroMesmoResponsavel) {
      const errosFin = dados.financeiro.map(validarContato);
      if (errosFin.some((e) => Object.keys(e).length)) novosErros.financeiro = errosFin;
    }
    if (!dados.juridicoMesmoResponsavel) {
      const errosJur = dados.juridico.map(validarContato);
      if (errosJur.some((e) => Object.keys(e).length)) novosErros.juridico = errosJur;
    }

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
      <p className="mt-1 text-sm text-slate-500">Pra emitir a cobrança, o contrato e configurar sua conta certinha.</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          avancar();
        }}
        className="mt-5 space-y-4"
      >
        <Secao icon={Building2} accent="emerald" titulo="Dados da clínica">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Campo label="Nome da clínica" value={dados.nomeClinica} onChange={(e) => setDados((d) => ({ ...d, nomeClinica: e.target.value }))} erro={erros.nomeClinica} className="sm:col-span-2" />
            <Campo
              label="CPF ou CNPJ"
              value={dados.documento}
              onChange={documento}
              erro={erros.documento}
              inputMode="numeric"
              placeholder="000.000.000-00"
            />
          </div>
        </Secao>

        <Secao icon={MapPin} accent="sky" titulo="Endereço">
          <div className="grid gap-3.5 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <Campo
                label="CEP"
                value={dados.endereco.cep}
                onChange={aoMudarCep}
                erro={erros.endereco?.cep ?? erroCep ?? undefined}
                inputMode="numeric"
                placeholder="00000-000"
              />
              {buscandoCep && <p className="mt-1 text-xs text-slate-400">Buscando endereço…</p>}
            </div>
            <Campo label="Logradouro" value={dados.endereco.logradouro} onChange={campoEndereco("logradouro")} erro={erros.endereco?.logradouro} className="sm:col-span-2" />
            <Campo label="Número" value={dados.endereco.numero} onChange={campoEndereco("numero")} erro={erros.endereco?.numero} />
            <Campo label="Complemento (opcional)" value={dados.endereco.complemento} onChange={campoEndereco("complemento")} />
            <Campo label="Bairro" value={dados.endereco.bairro} onChange={campoEndereco("bairro")} erro={erros.endereco?.bairro} />
            <Campo label="Cidade" value={dados.endereco.cidade} onChange={campoEndereco("cidade")} erro={erros.endereco?.cidade} />
            <Selecao label="Estado" value={dados.endereco.estado} onChange={campoEndereco("estado")} erro={erros.endereco?.estado} opcoes={ESTADOS} />
          </div>
        </Secao>

        <Secao icon={User} accent="violet" titulo="Responsável" subtitulo="Quem vamos procurar pra qualquer assunto geral da conta.">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Campo label="Nome" value={dados.responsavel.nome} onChange={campoResponsavel("nome")} erro={erros.responsavel?.nome} />
            <Campo label="Cargo na clínica" value={dados.responsavel.cargo} onChange={campoResponsavel("cargo")} erro={erros.responsavel?.cargo} placeholder="Ex: sócio, gerente" />
            <Campo label="E-mail" type="email" value={dados.responsavel.email} onChange={campoResponsavel("email")} erro={erros.responsavel?.email} />
            <Campo label="Telefone" type="tel" value={dados.responsavel.telefone} onChange={campoResponsavel("telefone")} erro={erros.responsavel?.telefone} inputMode="numeric" placeholder="(00) 00000-0000" />
          </div>
        </Secao>

        <SecaoResponsavelEspecial
          icon={Landmark}
          accent="amber"
          titulo="Financeiro"
          instrucao="O financeiro recebe as notas fiscais e as cobranças."
          ativoMesmoResponsavel={dados.financeiroMesmoResponsavel}
          contatos={dados.financeiro}
          erros={erros.financeiro}
          onAlternar={() => alternarMesmoResponsavel("financeiro")}
          onAdicionar={() => adicionarContato("financeiro")}
          onRemover={(i) => removerContato("financeiro", i)}
          onAtualizar={(i, campo, valor) => atualizarContato("financeiro", i, campo, valor)}
        />

        <SecaoResponsavelEspecial
          icon={Scale}
          accent="rose"
          titulo="Jurídico"
          instrucao="O jurídico recebe o termo/contrato para assinatura."
          ativoMesmoResponsavel={dados.juridicoMesmoResponsavel}
          contatos={dados.juridico}
          erros={erros.juridico}
          onAlternar={() => alternarMesmoResponsavel("juridico")}
          onAdicionar={() => adicionarContato("juridico")}
          onRemover={(i) => removerContato("juridico", i)}
          onAtualizar={(i, campo, valor) => atualizarContato("juridico", i, campo, valor)}
        />

        <Secao icon={BarChart3} accent="slate" titulo="Sobre a clínica" subtitulo="Nos ajuda a configurar sua conta e a melhorar o produto.">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Selecao label="Especialidade principal" value={dados.especialidade} onChange={(e) => setDados((d) => ({ ...d, especialidade: e.target.value }))} erro={erros.especialidade} opcoes={ESPECIALIDADES} className="sm:col-span-2" />
            <Selecao label="Pacientes atendidos por mês (aprox.)" value={dados.pacientesMes} onChange={(e) => setDados((d) => ({ ...d, pacientesMes: e.target.value }))} erro={erros.pacientesMes} opcoes={FAIXAS_PACIENTES} />
            <Selecao label="Como conheceu o MediCopilot?" value={dados.comoConheceu} onChange={(e) => setDados((d) => ({ ...d, comoConheceu: e.target.value }))} erro={erros.comoConheceu} opcoes={ORIGENS} />
          </div>
        </Secao>

        {erroGeral && <p className="text-sm font-medium text-rose-600">{erroGeral}</p>}
      </form>

      <BotaoFlutuante onClick={avancar}>Avançar</BotaoFlutuante>
    </LayoutContratacao>
  );
}

// ---------------------------------------------------------------------------
// Subcomponentes
// ---------------------------------------------------------------------------

const ACCENTS = {
  emerald: "from-emerald-400 to-emerald-600",
  sky: "from-sky-400 to-blue-500",
  violet: "from-violet-400 to-violet-600",
  amber: "from-amber-400 to-orange-500",
  rose: "from-rose-400 to-rose-600",
  slate: "from-slate-500 to-slate-700",
} as const;

function Secao({
  icon: Icon,
  accent,
  titulo,
  subtitulo,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent: keyof typeof ACCENTS;
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ borderRadius: "24px" }}
      className="border border-white/80 bg-white/60 p-5 shadow-xl shadow-slate-200/40 backdrop-blur-xl md:p-6"
    >
      <div className="flex items-center gap-2">
        <div
          style={{ borderRadius: "14px" }}
          className={`flex h-10 w-10 shrink-0 items-center justify-center bg-gradient-to-br ${ACCENTS[accent]}`}
        >
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div>
          <h3 className="font-bold text-slate-800">{titulo}</h3>
          {subtitulo && <p className="text-xs text-slate-400">{subtitulo}</p>}
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function SecaoResponsavelEspecial({
  icon,
  accent,
  titulo,
  instrucao,
  ativoMesmoResponsavel,
  contatos,
  erros,
  onAlternar,
  onAdicionar,
  onRemover,
  onAtualizar,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent: keyof typeof ACCENTS;
  titulo: string;
  instrucao: string;
  ativoMesmoResponsavel: boolean;
  contatos: Contato[];
  erros?: ErrosContato[];
  onAlternar: () => void;
  onAdicionar: () => void;
  onRemover: (i: number) => void;
  onAtualizar: (i: number, campo: keyof Contato, valor: string) => void;
}) {
  return (
    <Secao icon={icon} accent={accent} titulo={titulo} subtitulo={instrucao}>
      <button type="button" onClick={onAlternar} className="flex items-center gap-2.5">
        <span
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${ativoMesmoResponsavel ? "bg-emerald-500" : "bg-slate-300"}`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              ativoMesmoResponsavel ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </span>
        <span className="text-sm font-medium text-slate-700">
          {ativoMesmoResponsavel ? "Mesmo do responsável principal" : "Usar outro(s) contato(s)"}
        </span>
      </button>

      {!ativoMesmoResponsavel && (
        <div className="mt-4 space-y-3">
          {contatos.map((contato, i) => (
            <div key={i} style={{ borderRadius: "16px" }} className="border border-slate-200 bg-white/70 p-3.5">
              <div className="grid gap-3 sm:grid-cols-3">
                <Campo
                  label="Nome"
                  value={contato.nome}
                  onChange={(e) => onAtualizar(i, "nome", e.target.value)}
                  erro={erros?.[i]?.nome}
                />
                <Campo
                  label="E-mail"
                  type="email"
                  value={contato.email}
                  onChange={(e) => onAtualizar(i, "email", e.target.value)}
                  erro={erros?.[i]?.email}
                />
                <Campo
                  label="Telefone"
                  type="tel"
                  value={contato.telefone}
                  onChange={(e) => onAtualizar(i, "telefone", e.target.value)}
                  erro={erros?.[i]?.telefone}
                  inputMode="numeric"
                  placeholder="(00) 00000-0000"
                />
              </div>
              {contatos.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemover(i)}
                  className="mt-2.5 flex items-center gap-1 text-xs font-medium text-rose-500 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remover
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={onAdicionar}
            className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700"
          >
            <Plus className="h-4 w-4" />
            Adicionar outro responsável {titulo.toLowerCase()}
          </button>
        </div>
      )}
    </Secao>
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
