import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

// Página PÚBLICA de preenchimento de formulário (link compartilhável /f/{id}).
// Usa um cliente Supabase sem sessão (papel anon) para que o link funcione para
// qualquer pessoa e as políticas públicas de RLS sejam aplicadas.
export const Route = createFileRoute("/f/$formId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Responder formulário | MediCopilot" },
      { name: "description", content: "Preencha o formulário enviado pela sua clínica em poucos minutos." },
      { property: "og:title", content: "Responder formulário | MediCopilot" },
      { property: "og:description", content: "Preencha o formulário enviado pela sua clínica em poucos minutos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PublicForm,
});

type Pergunta = {
  id: string;
  ordem: number;
  tipo: "texto" | "unica" | "multipla" | "escala";
  enunciado: string;
  opcoes: string[] | null;
  escala_min: number | null;
  escala_max: number | null;
  escala_label_min: string | null;
  escala_label_max: string | null;
  obrigatoria: boolean;
};

type Form = {
  id: string;
  titulo: string;
  descricao: string | null;
  anonimo: boolean;
  ativo: boolean;
  exigir_auth_email: boolean;
  campos_cadastro: string[] | null;
  questionario_perguntas: Pergunta[];
};

type CampoKind = "text" | "tel" | "email" | "date" | "number" | "select" | "textarea";
type CampoDef = {
  id: string;
  label: string;
  grupo: "Dados pessoais" | "Endereço" | "Dados clínicos";
  kind: CampoKind;
  placeholder?: string;
  options?: string[];
};

// Espelha o catálogo do construtor (public/questionarios.js) — os únicos
// campos que o próprio paciente pode preencher (sem lookup de tabela).
const CAMPOS_OBRIGATORIOS = ["name", "cpf", "telefone", "email"];
const CAMPO_CATALOG: CampoDef[] = [
  { id: "name", label: "Nome completo", grupo: "Dados pessoais", kind: "text", placeholder: "Seu nome" },
  { id: "cpf", label: "CPF", grupo: "Dados pessoais", kind: "text", placeholder: "000.000.000-00" },
  { id: "telefone", label: "Telefone (com DDD)", grupo: "Dados pessoais", kind: "tel", placeholder: "(31) 99999-9999" },
  { id: "email", label: "E-mail", grupo: "Dados pessoais", kind: "email", placeholder: "voce@email.com" },
  { id: "data_nascimento", label: "Data de nascimento", grupo: "Dados pessoais", kind: "date" },
  { id: "sexo", label: "Sexo", grupo: "Dados pessoais", kind: "select", options: ["Feminino", "Masculino", "Outro"] },
  { id: "sus", label: "Cartão SUS", grupo: "Dados pessoais", kind: "text" },
  { id: "mae", label: "Nome da mãe", grupo: "Dados pessoais", kind: "text" },
  { id: "pai", label: "Nome do pai", grupo: "Dados pessoais", kind: "text" },
  { id: "ocupacao", label: "Ocupação", grupo: "Dados pessoais", kind: "text" },
  { id: "convenio", label: "Convênio", grupo: "Dados pessoais", kind: "select", options: ["Particular", "SUS", "Unimed", "Bradesco", "Amil"] },
  { id: "cep", label: "CEP", grupo: "Endereço", kind: "text", placeholder: "00000-000" },
  { id: "logradouro", label: "Logradouro", grupo: "Endereço", kind: "text", placeholder: "Rua, avenida..." },
  { id: "numero", label: "Número", grupo: "Endereço", kind: "text" },
  { id: "complemento", label: "Complemento", grupo: "Endereço", kind: "text" },
  { id: "bairro", label: "Bairro", grupo: "Endereço", kind: "text" },
  { id: "cidade", label: "Cidade", grupo: "Endereço", kind: "text" },
  { id: "uf", label: "UF", grupo: "Endereço", kind: "text", placeholder: "Ex: SC" },
  { id: "dados_clinicos", label: "Dados clínicos (observações gerais)", grupo: "Dados clínicos", kind: "textarea" },
  { id: "ic_peso", label: "Peso (kg)", grupo: "Dados clínicos", kind: "number", placeholder: "Ex: 72.5" },
  { id: "ic_altura", label: "Altura (cm)", grupo: "Dados clínicos", kind: "number", placeholder: "Ex: 170" },
  { id: "ic_sangue", label: "Tipo sanguíneo", grupo: "Dados clínicos", kind: "select", options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] },
  { id: "ic_sedent", label: "Nível de atividade física", grupo: "Dados clínicos", kind: "select", options: ["Sedentário", "Atividade leve (1-2x/sem)", "Atividade moderada (3-4x/sem)", "Atividade intensa (5+x/sem)"] },
  { id: "ic_tab", label: "Tabagismo", grupo: "Dados clínicos", kind: "select", options: ["Nunca fumou", "Ex-tabagista", "Tabagista ativo"] },
  { id: "ic_eti", label: "Etilismo", grupo: "Dados clínicos", kind: "select", options: ["Não consome", "Social / ocasional", "Frequente", "Etilista crônico"] },
  { id: "ic_sono", label: "Sono", grupo: "Dados clínicos", kind: "select", options: ["Bom / reparador", "Regular", "Insônia ocasional", "Insônia frequente", "Sonolência diurna excessiva", "Suspeita de apneia do sono"] },
  { id: "ic_meds", label: "Medicações em uso", grupo: "Dados clínicos", kind: "textarea" },
  { id: "ic_alerg", label: "Alergias", grupo: "Dados clínicos", kind: "text", placeholder: "Ex: Dipirona, Penicilina, frutos do mar..." },
  { id: "ic_fam", label: "Histórico familiar (doenças)", grupo: "Dados clínicos", kind: "textarea" },
  { id: "ic_outros", label: "Outras informações", grupo: "Dados clínicos", kind: "textarea" },
];
const CAMPO_BY_ID = Object.fromEntries(CAMPO_CATALOG.map((c) => [c.id, c]));

function anonClient() {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

const onlyDigits = (v: string) => v.replace(/\D/g, "");

function PublicForm() {
  const { formId } = Route.useParams();
  const sb = useMemo(anonClient, []);
  const [form, setForm] = useState<Form | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);
  const [ident, setIdent] = useState<Record<string, string>>({});
  const [respostas, setRespostas] = useState<Record<string, string | string[] | number>>({});
  // Autenticação por email (código de 4 dígitos)
  const [codigoEnviado, setCodigoEnviado] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [emailAutenticado, setEmailAutenticado] = useState("");
  const [enviandoCodigo, setEnviandoCodigo] = useState(false);
  const [aviso, setAviso] = useState("");
  const pacienteId = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("p");
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await (sb as any).rpc("formulario_publico", { p_id: formId });
      if (!vivo) return;
      setCarregando(false);
      if (error || !data) return setErro("Formulário não encontrado ou indisponível.");
      const f = data as unknown as Form;
      if (!f.ativo) return setErro("Este formulário não está mais aceitando respostas.");
      f.questionario_perguntas = (f.questionario_perguntas || []).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      setForm(f);
    })();
    return () => {
      vivo = false;
    };
  }, [formId, sb]);

  function setResp(id: string, v: string | string[] | number) {
    setRespostas((r) => ({ ...r, [id]: v }));
  }

  function toggleMulti(id: string, opt: string) {
    const atual = (respostas[id] as string[]) || [];
    setResp(id, atual.includes(opt) ? atual.filter((o) => o !== opt) : [...atual, opt]);
  }

  const camposAtivos = useMemo(() => {
    const ids = form?.campos_cadastro && form.campos_cadastro.length ? form.campos_cadastro : CAMPOS_OBRIGATORIOS;
    return ids.map((id) => CAMPO_BY_ID[id]).filter(Boolean) as CampoDef[];
  }, [form]);

  async function enviar() {
    if (!form) return;
    setErro("");
    setAviso("");
    if (!form.anonimo) {
      const nome = (ident.name || "").trim();
      const tel = onlyDigits(ident.telefone || "");
      const email = (ident.email || "").trim();
      const cpf = onlyDigits(ident.cpf || "");
      if (nome.length < 3) return setErro("Informe seu nome completo.");
      if (tel.length < 10) return setErro("Informe um telefone válido com DDD.");
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErro("Informe um e-mail válido.");
      if (cpf.length !== 11) return setErro("Informe um CPF válido (11 dígitos).");
    }
    for (const p of form.questionario_perguntas) {
      if (!p.obrigatoria) continue;
      const v = respostas[p.id];
      const vazio =
        v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (p.tipo === "escala" && v === undefined);
      if (vazio) return setErro('Responda a pergunta obrigatória: "' + p.enunciado + '"');
    }

    const exigeCodigo = !!form.exigir_auth_email && !form.anonimo;
    const emailInformado = (ident.email || "").trim().toLowerCase();
    if (exigeCodigo && (!codigoEnviado || emailAutenticado !== emailInformado)) {
      return pedirCodigo(emailInformado);
    }
    if (exigeCodigo && codigo.trim().length !== 4) {
      return setErro("Informe o código de 4 dígitos enviado para o seu email.");
    }

    setEnviando(true);
    const itens = form.questionario_perguntas
      .filter((p) => respostas[p.id] !== undefined && respostas[p.id] !== "")
      .map((p) => {
        const v = respostas[p.id];
        return {
          pergunta_id: p.id,
          valor_texto: p.tipo === "texto" ? String(v).slice(0, 4000) : null,
          valor_opcoes: p.tipo === "unica" ? [String(v)] : p.tipo === "multipla" ? (v as string[]) : null,
          valor_escala: p.tipo === "escala" ? Number(v) : null,
        };
      });

    const campos: Record<string, string> = {};
    if (!form.anonimo) {
      for (const c of camposAtivos) {
        const raw = (ident[c.id] || "").trim();
        if (!raw) continue;
        campos[c.id] = c.id === "telefone" ? onlyDigits(raw) : c.id === "cpf" ? onlyDigits(raw) : raw;
      }
    }
    // A gravação passa pelo servidor: o link público não escreve direto no banco.
    const body = {
      questionario_id: form.id,
      itens,
      ...(exigeCodigo ? { codigo: codigo.trim() } : {}),
      ...(form.anonimo ? {} : { paciente_id: pacienteId || null, campos }),
    };
    try {
      const res = await fetch("/api/public/formularios/responder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setEnviando(false);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (j.error === "form_unavailable") return setErro("Este formulário não está mais aceitando respostas.");
        if (j.error === "code_invalid") return setErro("Código incorreto. Confira o email e tente novamente.");
        if (j.error === "code_expired") return setErro("O código expirou. Solicite um novo código.");
        if (j.error === "code_required") return setErro("Confirme seu email com o código de 4 dígitos.");
        if (j.error === "code_blocked") return setErro("Muitas tentativas. Solicite um novo código.");
        return setErro("Não foi possível enviar suas respostas. Tente novamente.");
      }
      setOk(true);
    } catch {
      setEnviando(false);
      setErro("Não foi possível enviar suas respostas. Verifique sua conexão e tente novamente.");
    }
  }

  async function pedirCodigo(emailInformado: string) {
    if (!form) return;
    setErro("");
    setAviso("");
    setEnviandoCodigo(true);
    try {
      const res = await fetch("/api/public/formularios/codigo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionario_id: form.id, email: emailInformado }),
      });
      setEnviandoCodigo(false);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (j.error === "rate_limited") return setErro("Muitas solicitações. Aguarde alguns minutos e tente novamente.");
        if (j.error === "email_not_configured")
          return setErro("O envio de emails ainda não está configurado nesta clínica. Avise a equipe.");
        return setErro("Não foi possível enviar o código para o seu email. Tente novamente.");
      }
      setCodigo("");
      setCodigoEnviado(true);
      setEmailAutenticado(emailInformado);
      setAviso("Enviamos um código de 4 dígitos para " + emailInformado + ". Digite-o abaixo para confirmar o envio.");
    } catch {
      setEnviandoCodigo(false);
      setErro("Não foi possível enviar o código. Verifique sua conexão e tente novamente.");
    }
  }

  const exigeCodigo = !!form?.exigir_auth_email && !form?.anonimo;

  return (
    <div className="pf-bg">
      <style>{CSS}</style>
      <div className="pf-blob a" />
      <div className="pf-blob b" />
      <main className="pf-card">
        {carregando && <p className="pf-muted">Carregando formulário…</p>}

        {!carregando && !form && <p className="pf-err">{erro || "Formulário indisponível."}</p>}

        {form && ok && (
          <div className="pf-done">
            <div className="pf-check">✓</div>
            <h1>Respostas enviadas</h1>
            <p className="pf-muted">Obrigado! Suas respostas foram registradas com segurança na sua clínica.</p>
          </div>
        )}

        {form && !ok && (
          <>
            <header className="pf-head">
              <span className="pf-badge">{form.anonimo ? "Formulário anônimo" : "Formulário nominal"}</span>
              <h1>{form.titulo}</h1>
              {form.descricao && <p className="pf-muted">{form.descricao}</p>}
            </header>

            {!form.anonimo && (
              <section className="pf-sec">
                <h2>Seus dados</h2>
                {["Dados pessoais", "Endereço", "Dados clínicos"].map((grupo) => {
                  const campos = camposAtivos.filter((c) => c.grupo === grupo);
                  if (!campos.length) return null;
                  return (
                    <div key={grupo}>
                      {grupo !== "Dados pessoais" && <div className="pf-subhd">{grupo}</div>}
                      <div className="pf-row">
                        {campos.map((c) => (
                          <div key={c.id} className={c.kind === "textarea" ? "pf-full" : undefined}>
                            <label className="pf-lbl">
                              {c.label} {CAMPOS_OBRIGATORIOS.includes(c.id) && <span className="pf-req">*</span>}
                            </label>
                            {c.kind === "select" ? (
                              <select
                                className="pf-in"
                                value={ident[c.id] || ""}
                                onChange={(e) => setIdent({ ...ident, [c.id]: e.target.value })}
                              >
                                <option value="">—</option>
                                {(c.options || []).map((o) => (
                                  <option key={o} value={o}>
                                    {o}
                                  </option>
                                ))}
                              </select>
                            ) : c.kind === "textarea" ? (
                              <textarea
                                className="pf-in"
                                rows={2}
                                value={ident[c.id] || ""}
                                onChange={(e) => setIdent({ ...ident, [c.id]: e.target.value })}
                                placeholder={c.placeholder}
                              />
                            ) : (
                              <input
                                className="pf-in"
                                type={c.kind === "number" ? "number" : c.kind === "date" ? "date" : c.kind === "email" ? "email" : "text"}
                                inputMode={c.kind === "tel" ? "tel" : c.id === "cpf" ? "numeric" : undefined}
                                value={ident[c.id] || ""}
                                maxLength={c.id === "cpf" ? 14 : c.id === "telefone" ? 20 : undefined}
                                onChange={(e) => setIdent({ ...ident, [c.id]: e.target.value })}
                                placeholder={c.placeholder}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}

            <section className="pf-sec">
              <h2>Perguntas</h2>
              {form.questionario_perguntas.map((p, i) => (
                <div className="pf-q" key={p.id}>
                  <div className="pf-qh">
                    <span className="pf-num">{i + 1}</span>
                    <b>
                      {p.enunciado} {p.obrigatoria && <span className="pf-req">*</span>}
                    </b>
                  </div>

                  {p.tipo === "texto" && (
                    <textarea
                      className="pf-in"
                      rows={3}
                      value={(respostas[p.id] as string) || ""}
                      maxLength={4000}
                      onChange={(e) => setResp(p.id, e.target.value)}
                      placeholder="Sua resposta"
                    />
                  )}

                  {p.tipo === "unica" &&
                    (p.opcoes || []).map((o) => (
                      <label className="pf-opt" key={o}>
                        <input
                          type="radio"
                          name={p.id}
                          checked={respostas[p.id] === o}
                          onChange={() => setResp(p.id, o)}
                        />
                        <span>{o}</span>
                      </label>
                    ))}

                  {p.tipo === "multipla" &&
                    (p.opcoes || []).map((o) => (
                      <label className="pf-opt" key={o}>
                        <input
                          type="checkbox"
                          checked={((respostas[p.id] as string[]) || []).includes(o)}
                          onChange={() => toggleMulti(p.id, o)}
                        />
                        <span>{o}</span>
                      </label>
                    ))}

                  {p.tipo === "escala" && (
                    <div className="pf-scale">
                      {escalaValores(p).map((n) => (
                        <button
                          type="button"
                          key={n}
                          className={"pf-dot" + (respostas[p.id] === n ? " sel" : "")}
                          onClick={() => setResp(p.id, n)}
                        >
                          {n}
                        </button>
                      ))}
                      <div className="pf-scale-lbl">
                        <span>{p.escala_label_min || ""}</span>
                        <span>{p.escala_label_max || ""}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </section>

            {erro && <p className="pf-err">{erro}</p>}
            {exigeCodigo && aviso && <p className="pf-ok">{aviso}</p>}
            {exigeCodigo && codigoEnviado && (
              <div className="pf-code">
                <label className="pf-lbl">Código de confirmação</label>
                <input
                  className="pf-in pf-code-in"
                  inputMode="numeric"
                  maxLength={4}
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="0000"
                />
                <button
                  type="button"
                  className="pf-link"
                  onClick={() => pedirCodigo((ident.email || "").trim().toLowerCase())}
                  disabled={enviandoCodigo}
                >
                  {enviandoCodigo ? "Enviando…" : "Reenviar código"}
                </button>
              </div>
            )}
            <button className="pf-btn" onClick={enviar} disabled={enviando || enviandoCodigo}>
              {enviando
                ? "Enviando…"
                : enviandoCodigo
                  ? "Enviando código…"
                  : exigeCodigo && !codigoEnviado
                    ? "Confirmar email e continuar"
                    : exigeCodigo
                      ? "Confirmar código e enviar"
                      : "Enviar respostas"}
            </button>
            <p className="pf-foot">Suas informações são enviadas com segurança para a sua clínica.</p>
          </>
        )}
      </main>
    </div>
  );
}

function escalaValores(p: Pergunta) {
  const min = p.escala_min ?? 1;
  const max = p.escala_max ?? 5;
  const out: number[] = [];
  for (let n = min; n <= max; n++) out.push(n);
  return out;
}

const CSS = `
.pf-bg{min-height:100vh;padding:28px 14px 44px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:linear-gradient(140deg,#eaf7f4 0%,#e8f1fd 45%,#f3ecfd 100%);position:relative;overflow-x:hidden;color:#334155}
.pf-blob{position:fixed;width:340px;height:340px;border-radius:50%;filter:blur(70px);opacity:.5;pointer-events:none}
.pf-blob.a{background:#6ee7b7;top:-90px;left:-70px}
.pf-blob.b{background:#93c5fd;bottom:-110px;right:-80px}
.pf-card{position:relative;max-width:680px;margin:0 auto;background:rgba(255,255,255,.7);backdrop-filter:blur(22px);border:1px solid rgba(255,255,255,.8);box-shadow:0 20px 60px rgba(15,23,42,.12);border-radius:24px;padding:26px 24px}
.pf-head{margin-bottom:20px}
.pf-head h1{font-size:22px;font-weight:700;color:#0f172a;margin:8px 0 4px}
.pf-badge{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f766e;background:rgba(209,250,229,.75);border:1px solid rgba(153,246,228,.8);padding:3px 10px;border-radius:99px}
.pf-muted{font-size:13px;color:#64748b;margin:0}
.pf-sec{margin-bottom:22px}
.pf-sec h2{font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:#94a3b8;margin:0 0 10px}
.pf-lbl{display:block;font-size:11.5px;color:#64748b;font-weight:600;margin:10px 0 4px}
.pf-in{width:100%;padding:10px 12px;border-radius:12px;font-size:14px;background:rgba(255,255,255,.85);border:1px solid rgba(203,213,225,.9);outline:none;color:#0f172a;font-family:inherit;resize:vertical}
.pf-in:focus{border-color:#0d9488;box-shadow:0 0 0 3px rgba(153,246,228,.55)}
.pf-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pf-subhd{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin:14px 0 6px}
.pf-full{grid-column:1 / -1}
@media(max-width:520px){.pf-row{grid-template-columns:1fr}.pf-card{padding:20px 16px}}
.pf-q{padding:14px 16px;border-radius:16px;background:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.85);border-left:3px solid #99f6e4;margin-bottom:12px}
.pf-qh{display:flex;gap:9px;align-items:flex-start;margin-bottom:9px;font-size:14px;color:#0f172a}
.pf-num{flex:0 0 auto;width:22px;height:22px;border-radius:8px;background:linear-gradient(135deg,#34d399,#0d9488);color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center}
.pf-req{color:#e11d48}
.pf-opt{display:flex;align-items:center;gap:9px;padding:7px 2px;font-size:14px;cursor:pointer}
.pf-opt input{accent-color:#0d9488;width:16px;height:16px}
.pf-scale{display:flex;flex-wrap:wrap;gap:7px}
.pf-dot{width:36px;height:36px;border-radius:50%;border:1.5px solid #99f6e4;background:rgba(255,255,255,.8);color:#0f766e;font-size:13px;font-weight:600;cursor:pointer}
.pf-dot.sel{background:linear-gradient(135deg,#34d399,#0d9488);color:#fff;border-color:transparent}
.pf-scale-lbl{flex:1 0 100%;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:2px}
.pf-btn{width:100%;padding:13px;border:none;border-radius:16px;font-size:15px;font-weight:700;color:#fff;background:linear-gradient(135deg,#34d399,#0d9488);box-shadow:0 10px 26px rgba(13,148,136,.35);cursor:pointer}
.pf-btn:disabled{opacity:.65;cursor:default}
.pf-err{margin:0 0 12px;padding:10px 12px;border-radius:12px;font-size:13px;color:#b91c1c;background:rgba(254,226,226,.8);border:1px solid rgba(252,165,165,.8)}
.pf-foot{font-size:11px;color:#94a3b8;text-align:center;margin:12px 0 0}
.pf-done{text-align:center;padding:26px 6px}
.pf-done h1{font-size:20px;color:#0f172a;margin:14px 0 6px}
.pf-check{width:58px;height:58px;margin:0 auto;border-radius:50%;background:linear-gradient(135deg,#34d399,#0d9488);color:#fff;font-size:28px;display:flex;align-items:center;justify-content:center}
`;
