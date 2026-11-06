import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Phone,
  Stethoscope,
  UserRound,
} from "lucide-react";

// Página PÚBLICA de agendamento (link gerado em Configurações › Agendamento
// online). A lista de médicos e os horários vêm de /api/public/agendamento/*,
// que só devolvem o que pertence à clínica dona do link. A identidade visual
// (nome, logo e cor) é a da clínica.
export const Route = createFileRoute("/agendar/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Agendar consulta | MediCopilot" },
      { name: "description", content: "Escolha o médico e o melhor horário para a sua consulta." },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: AgendarPage,
});

type Medico = { id: string; nome: string; especialidade: string | null; duracao_min: number };
type Clinica = {
  nome: string;
  endereco: string | null;
  telefone: string | null;
  cor: string | null;
  logo: string | null;
};
type Horario = { inicio: string; hora: string };
type Dia = { data: string; horarios: Horario[] };

const FONTE = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, sans-serif';
const COR_PADRAO = "#10b981";
const SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];
const inputCls =
  "w-full rounded-2xl border border-white/80 bg-white/70 px-4 py-3 text-base text-slate-800 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-emerald-300";

const ERROS: Record<string, string> = {
  horario_ocupado: "Esse horário acabou de ser ocupado. Escolha outro.",
  horario_indisponivel: "Esse horário não está mais disponível. Escolha outro.",
  limite_cpf:
    "Este CPF já tem consultas marcadas por este link. Fale com a clínica para agendar outra.",
  muitas_tentativas: "Muitas tentativas em pouco tempo. Aguarde um pouco ou fale com a clínica.",
  link_indisponivel: "Este link de agendamento não está mais ativo.",
};

const inicialMaiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function dataLonga(data: string) {
  return inicialMaiuscula(
    new Date(`${data}T12:00:00Z`).toLocaleDateString("pt-BR", {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
  );
}

function mascaraCpf(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

function mascaraTelefone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : "";
  const meio = d.length > 10 ? 7 : 6;
  if (d.length <= meio) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, meio)}-${d.slice(meio)}`;
}

function Painel({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return (
    <section
      className="border border-white/80 bg-white/60 p-5 shadow-xl shadow-slate-200/40 backdrop-blur-xl md:p-7"
      style={{ borderRadius: 28, ...style }}
    >
      {children}
    </section>
  );
}

function Titulo({
  numero,
  cor,
  children,
}: {
  numero: number;
  cor: string;
  children: React.ReactNode;
}) {
  return (
    <h2 className="mb-4 flex items-center gap-3 text-lg font-semibold text-slate-800">
      <span
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-sm font-bold text-white"
        style={{ background: `linear-gradient(135deg, ${cor}b3, ${cor})` }}
      >
        {numero}
      </span>
      {children}
    </h2>
  );
}

function Calendario({
  dias,
  selecionado,
  onSelecionar,
  cor,
}: {
  dias: Dia[];
  selecionado: string | null;
  onSelecionar: (data: string) => void;
  cor: string;
}) {
  const disponiveis = useMemo(() => new Set(dias.map((d) => d.data)), [dias]);
  const meses = useMemo(
    () => Array.from(new Set(dias.map((d) => d.data.slice(0, 7)))).sort(),
    [dias],
  );
  const [mes, setMes] = useState(meses[0]);
  const atual = meses.includes(mes) ? mes : meses[0];
  const indice = meses.indexOf(atual);
  const [ano, numeroMes] = atual.split("-").map(Number);
  const primeiroDia = new Date(Date.UTC(ano, numeroMes - 1, 1)).getUTCDay();
  const totalDias = new Date(Date.UTC(ano, numeroMes, 0)).getUTCDate();
  const nomeMes = inicialMaiuscula(
    new Date(Date.UTC(ano, numeroMes - 1, 1)).toLocaleDateString("pt-BR", {
      timeZone: "UTC",
      month: "long",
      year: "numeric",
    }),
  );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          aria-label="Mês anterior"
          disabled={indice <= 0}
          onClick={() => setMes(meses[indice - 1])}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/70 text-slate-600 disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="font-semibold text-slate-700">{nomeMes}</div>
        <button
          type="button"
          aria-label="Próximo mês"
          disabled={indice >= meses.length - 1}
          onClick={() => setMes(meses[indice + 1])}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/70 text-slate-600 disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {SEMANA.map((s, i) => (
          <div key={i} className="py-1 text-xs font-semibold text-slate-400">
            {s}
          </div>
        ))}
        {Array.from({ length: primeiroDia }, (_, i) => (
          <div key={`vazio-${i}`} />
        ))}
        {Array.from({ length: totalDias }, (_, i) => {
          const dia = i + 1;
          const data = `${atual}-${String(dia).padStart(2, "0")}`;
          const livre = disponiveis.has(data);
          const ativo = selecionado === data;
          return (
            <button
              type="button"
              key={data}
              disabled={!livre}
              aria-label={dataLonga(data)}
              aria-pressed={ativo}
              onClick={() => onSelecionar(data)}
              className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full text-sm transition ${
                livre ? "font-semibold text-slate-800 hover:bg-white" : "text-slate-300"
              }`}
              style={
                ativo
                  ? { background: cor, color: "#fff" }
                  : livre
                    ? { background: `${cor}1f` }
                    : undefined
              }
            >
              {dia}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgendarPage() {
  const { token } = Route.useParams();
  const [estado, setEstado] = useState<"carregando" | "pronto" | "indisponivel" | "erro">(
    "carregando",
  );
  const [clinica, setClinica] = useState<Clinica | null>(null);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [medicoId, setMedicoId] = useState<string | null>(null);
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [erroDias, setErroDias] = useState(false);
  const [recarregar, setRecarregar] = useState(0);
  const [data, setData] = useState<string | null>(null);
  const [horario, setHorario] = useState<Horario | null>(null);
  const [form, setForm] = useState({ nome: "", cpf: "", telefone: "", email: "" });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [confirmado, setConfirmado] = useState(false);

  useEffect(() => {
    fetch(`/api/public/agendamento/clinica?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        if (r.status === 404) return setEstado("indisponivel");
        if (!r.ok) return setEstado("erro");
        const json = await r.json();
        setClinica(json.clinica);
        setMedicos(json.medicos);
        if (json.medicos.length === 1) setMedicoId(json.medicos[0].id);
        setEstado("pronto");
      })
      .catch(() => setEstado("erro"));
  }, [token]);

  useEffect(() => {
    if (!medicoId) return;
    let cancelado = false;
    setDias(null);
    setErroDias(false);
    fetch(`/api/public/agendamento/horarios?token=${encodeURIComponent(token)}&medico=${medicoId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const json = await r.json();
        if (!cancelado) setDias(json.dias);
      })
      .catch(() => {
        if (!cancelado) setErroDias(true);
      });
    return () => {
      cancelado = true;
    };
  }, [medicoId, token, recarregar]);

  const cor = /^#[0-9a-f]{6}$/i.test(clinica?.cor || "") ? (clinica?.cor as string) : COR_PADRAO;
  const medico = medicos.find((m) => m.id === medicoId) ?? null;
  const horariosDoDia = dias?.find((d) => d.data === data)?.horarios ?? [];

  function escolherMedico(id: string) {
    setMedicoId(id);
    setData(null);
    setHorario(null);
    setErro("");
  }

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!medicoId || !horario || enviando) return;
    setEnviando(true);
    setErro("");
    try {
      const r = await fetch("/api/public/agendamento/reservar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, medico_id: medicoId, inicio: horario.inicio, ...form }),
      });
      if (r.ok) return setConfirmado(true);
      const json = await r.json().catch(() => ({}));
      if (json.error === "invalid_body") {
        setErro("Confira o nome, o CPF e o telefone informados.");
      } else {
        setErro(ERROS[json.error] || "Não foi possível agendar agora. Tente de novo em instantes.");
      }
      if (r.status === 409) {
        setHorario(null);
        setRecarregar((n) => n + 1);
      }
    } catch {
      setErro("Sem conexão. Tente de novo em instantes.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main
      className="relative min-h-screen overflow-hidden px-4 py-8 md:py-12"
      style={{
        fontFamily: FONTE,
        background: "linear-gradient(135deg, #eef8f1 0%, #f3f1fb 45%, #fdf6ec 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute -left-24 -top-24 h-80 w-80 rounded-full opacity-40 blur-3xl"
        style={{ background: cor }}
      />
      <div className="pointer-events-none absolute -right-24 top-1/3 h-96 w-96 rounded-full bg-violet-300 opacity-40 blur-3xl" />

      <div className="relative mx-auto flex max-w-2xl flex-col gap-5">
        {estado === "carregando" && (
          <Painel style={{ textAlign: "center" }}>
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-slate-400" />
            <p className="mt-3 text-sm text-slate-500">Carregando…</p>
          </Painel>
        )}

        {(estado === "indisponivel" || estado === "erro") && (
          <Painel style={{ textAlign: "center" }}>
            <CalendarDays className="mx-auto h-8 w-8 text-slate-400" />
            <h1 className="mt-3 text-xl font-bold text-slate-800">
              {estado === "erro" ? "Não foi possível abrir a agenda" : "Agendamento indisponível"}
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              {estado === "erro"
                ? "Tente de novo em instantes."
                : "Este link não está ativo. Fale com a clínica para receber um link atualizado."}
            </p>
          </Painel>
        )}

        {estado === "pronto" && clinica && (
          <>
            <header className="flex items-center gap-4">
              {clinica.logo ? (
                <img
                  src={clinica.logo}
                  alt=""
                  className="h-14 w-14 rounded-2xl bg-white object-contain p-1"
                />
              ) : (
                <div
                  className="flex h-14 w-14 flex-none items-center justify-center"
                  style={{
                    borderRadius: 18,
                    background: `linear-gradient(135deg, ${cor}b3, ${cor})`,
                  }}
                >
                  <CalendarDays className="h-6 w-6 text-white" />
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm text-slate-500">Agendar consulta</p>
                <h1 className="truncate text-2xl font-bold tracking-tight text-slate-800">
                  {clinica.nome}
                </h1>
              </div>
            </header>

            {confirmado && medico && horario && data ? (
              <Painel style={{ textAlign: "center" }}>
                <div
                  className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
                  style={{ background: `linear-gradient(135deg, ${cor}b3, ${cor})` }}
                >
                  <CalendarCheck className="h-7 w-7 text-white" />
                </div>
                <h2 className="mt-4 text-xl font-bold text-slate-800">Consulta agendada</h2>
                <p className="mt-2 text-base text-slate-700">
                  {dataLonga(data)}, às {horario.hora}
                </p>
                <p className="text-sm text-slate-500">com {medico.nome}</p>
                {clinica.endereco && (
                  <p className="mt-3 flex items-start justify-center gap-1.5 text-sm text-slate-500">
                    <MapPin className="mt-0.5 h-4 w-4 flex-none" />
                    {clinica.endereco}
                  </p>
                )}
                {clinica.telefone && (
                  <p className="mt-3 text-sm text-slate-500">
                    Para cancelar ou remarcar, fale com a clínica: {clinica.telefone}
                  </p>
                )}
              </Painel>
            ) : medicos.length === 0 ? (
              <Painel style={{ textAlign: "center" }}>
                <Stethoscope className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 text-slate-600">
                  Nenhum médico disponível para agendamento online no momento.
                </p>
              </Painel>
            ) : (
              <>
                <Painel>
                  <Titulo numero={1} cor={cor}>
                    Escolha o médico
                  </Titulo>
                  <div className="flex flex-col gap-2">
                    {medicos.map((m) => {
                      const ativo = m.id === medicoId;
                      return (
                        <button
                          type="button"
                          key={m.id}
                          aria-pressed={ativo}
                          onClick={() => escolherMedico(m.id)}
                          className="flex items-center gap-3 rounded-2xl border bg-white/70 p-3 text-left transition hover:bg-white"
                          style={{ borderColor: ativo ? cor : "rgba(255,255,255,.8)" }}
                        >
                          <span
                            className="flex h-10 w-10 flex-none items-center justify-center rounded-full"
                            style={{ background: `${cor}1f`, color: cor }}
                          >
                            <UserRound className="h-5 w-5" />
                          </span>
                          <span className="min-w-0">
                            <span className="block font-semibold text-slate-800">{m.nome}</span>
                            {m.especialidade && (
                              <span className="block text-sm text-slate-500">
                                {m.especialidade}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </Painel>

                {medicoId && (
                  <Painel>
                    <Titulo numero={2} cor={cor}>
                      Escolha o dia e o horário
                    </Titulo>
                    {erroDias ? (
                      <p className="text-sm text-slate-600">
                        Não foi possível carregar os horários.{" "}
                        <button
                          type="button"
                          className="font-semibold underline"
                          onClick={() => setRecarregar((n) => n + 1)}
                        >
                          Tentar de novo
                        </button>
                      </p>
                    ) : dias === null ? (
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" />
                    ) : dias.length === 0 ? (
                      <p className="text-sm text-slate-600">
                        Este médico não tem horários livres no momento.
                        {clinica.telefone ? ` Fale com a clínica: ${clinica.telefone}.` : ""}
                      </p>
                    ) : (
                      <>
                        <Calendario
                          dias={dias}
                          selecionado={data}
                          cor={cor}
                          onSelecionar={(d) => {
                            setData(d);
                            setHorario(null);
                          }}
                        />
                        {data && (
                          <div className="mt-5">
                            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-600">
                              <Clock className="h-4 w-4" />
                              {dataLonga(data)}
                            </p>
                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                              {horariosDoDia.map((h) => {
                                const ativo = horario?.inicio === h.inicio;
                                return (
                                  <button
                                    type="button"
                                    key={h.inicio}
                                    aria-pressed={ativo}
                                    onClick={() => setHorario(h)}
                                    className="rounded-full bg-white/80 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-white"
                                    style={ativo ? { background: cor, color: "#fff" } : undefined}
                                  >
                                    {h.hora}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                    {erro && !horario && (
                      <p className="mt-3 text-sm font-medium text-rose-600">{erro}</p>
                    )}
                  </Painel>
                )}

                {horario && (
                  <Painel>
                    <Titulo numero={3} cor={cor}>
                      Seus dados
                    </Titulo>
                    <form onSubmit={confirmar} className="flex flex-col gap-3">
                      <label className="text-sm font-medium text-slate-600">
                        Nome completo
                        <input
                          required
                          minLength={3}
                          autoComplete="name"
                          className={`${inputCls} mt-1`}
                          value={form.nome}
                          onChange={(e) => setForm({ ...form, nome: e.target.value })}
                        />
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-sm font-medium text-slate-600">
                          CPF
                          <input
                            required
                            inputMode="numeric"
                            placeholder="000.000.000-00"
                            className={`${inputCls} mt-1`}
                            value={form.cpf}
                            onChange={(e) => setForm({ ...form, cpf: mascaraCpf(e.target.value) })}
                          />
                        </label>
                        <label className="text-sm font-medium text-slate-600">
                          WhatsApp ou telefone
                          <input
                            required
                            type="tel"
                            autoComplete="tel-national"
                            placeholder="(31) 99999-9999"
                            className={`${inputCls} mt-1`}
                            value={form.telefone}
                            onChange={(e) =>
                              setForm({ ...form, telefone: mascaraTelefone(e.target.value) })
                            }
                          />
                        </label>
                      </div>
                      <label className="text-sm font-medium text-slate-600">
                        E-mail (opcional)
                        <input
                          type="email"
                          autoComplete="email"
                          className={`${inputCls} mt-1`}
                          value={form.email}
                          onChange={(e) => setForm({ ...form, email: e.target.value })}
                        />
                      </label>
                      <p className="text-xs text-slate-500">
                        Seus dados serão usados por {clinica.nome} para registrar e confirmar esta
                        consulta.
                      </p>
                      {erro && <p className="text-sm font-medium text-rose-600">{erro}</p>}
                      <button
                        type="submit"
                        disabled={enviando}
                        className="mt-1 flex items-center justify-center gap-2 rounded-full py-3.5 font-semibold text-white shadow-lg transition disabled:opacity-60"
                        style={{ background: `linear-gradient(135deg, ${cor}cc, ${cor})` }}
                      >
                        {enviando ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <CalendarCheck className="h-5 w-5" />
                        )}
                        Confirmar às {horario.hora}
                      </button>
                    </form>
                  </Painel>
                )}

                {(clinica.endereco || clinica.telefone) && (
                  <footer className="flex flex-col gap-1 px-2 text-sm text-slate-500">
                    {clinica.endereco && (
                      <span className="flex items-start gap-1.5">
                        <MapPin className="mt-0.5 h-4 w-4 flex-none" />
                        {clinica.endereco}
                      </span>
                    )}
                    {clinica.telefone && (
                      <span className="flex items-center gap-1.5">
                        <Phone className="h-4 w-4 flex-none" />
                        {clinica.telefone}
                      </span>
                    )}
                  </footer>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
