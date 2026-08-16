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
  questionario_perguntas: Pergunta[];
};

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
  const [ident, setIdent] = useState({ nome: "", telefone: "", email: "", cpf: "" });
  const [respostas, setRespostas] = useState<Record<string, string | string[] | number>>({});
  const pacienteId = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("p");
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await sb
        .from("questionarios")
        .select(
          "id,titulo,descricao,anonimo,ativo,questionario_perguntas(id,ordem,tipo,enunciado,opcoes,escala_min,escala_max,escala_label_min,escala_label_max,obrigatoria)",
        )
        .eq("id", formId)
        .maybeSingle();
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

  async function enviar() {
    if (!form) return;
    setErro("");
    if (!form.anonimo) {
      if (ident.nome.trim().length < 3) return setErro("Informe seu nome completo.");
      if (onlyDigits(ident.telefone).length < 10) return setErro("Informe um telefone válido com DDD.");
      if (ident.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ident.email.trim()))
        return setErro("Informe um e-mail válido.");
      if (ident.cpf && onlyDigits(ident.cpf).length !== 11) return setErro("Informe um CPF válido (11 dígitos).");
    }
    for (const p of form.questionario_perguntas) {
      if (!p.obrigatoria) continue;
      const v = respostas[p.id];
      const vazio =
        v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || (p.tipo === "escala" && v === undefined);
      if (vazio) return setErro('Responda a pergunta obrigatória: "' + p.enunciado + '"');
    }

    setEnviando(true);
    const payload = form.anonimo
      ? { questionario_id: form.id }
      : {
          questionario_id: form.id,
          paciente_id: pacienteId || null,
          paciente_nome: ident.nome.trim().slice(0, 120),
          paciente_telefone: onlyDigits(ident.telefone).slice(0, 20),
          paciente_email: ident.email.trim().slice(0, 160) || null,
          paciente_cpf: onlyDigits(ident.cpf).slice(0, 11) || null,
        };
    const { data: resp, error } = await sb.from("questionario_respostas").insert(payload).select("id").single();
    if (error || !resp) {
      setEnviando(false);
      return setErro("Não foi possível enviar suas respostas. Tente novamente.");
    }
    const itens = form.questionario_perguntas
      .filter((p) => respostas[p.id] !== undefined && respostas[p.id] !== "")
      .map((p) => {
        const v = respostas[p.id];
        return {
          resposta_id: resp.id,
          pergunta_id: p.id,
          valor_texto: p.tipo === "texto" ? String(v).slice(0, 4000) : p.tipo === "unica" ? String(v) : null,
          valor_opcoes: p.tipo === "multipla" ? (v as string[]) : null,
          valor_escala: p.tipo === "escala" ? Number(v) : null,
        };
      });
    if (itens.length) {
      const { error: e2 } = await sb.from("questionario_resposta_itens").insert(itens);
      if (e2) {
        setEnviando(false);
        return setErro("Suas respostas não foram gravadas por completo. Tente novamente.");
      }
    }
    setEnviando(false);
    setOk(true);
  }

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
                <label className="pf-lbl">Nome completo *</label>
                <input
                  className="pf-in"
                  value={ident.nome}
                  maxLength={120}
                  onChange={(e) => setIdent({ ...ident, nome: e.target.value })}
                  placeholder="Seu nome"
                />
                <div className="pf-row">
                  <div>
                    <label className="pf-lbl">Telefone (com DDD) *</label>
                    <input
                      className="pf-in"
                      value={ident.telefone}
                      maxLength={20}
                      inputMode="tel"
                      onChange={(e) => setIdent({ ...ident, telefone: e.target.value })}
                      placeholder="(31) 99999-9999"
                    />
                  </div>
                  <div>
                    <label className="pf-lbl">CPF</label>
                    <input
                      className="pf-in"
                      value={ident.cpf}
                      maxLength={14}
                      inputMode="numeric"
                      onChange={(e) => setIdent({ ...ident, cpf: e.target.value })}
                      placeholder="000.000.000-00"
                    />
                  </div>
                </div>
                <label className="pf-lbl">E-mail</label>
                <input
                  className="pf-in"
                  value={ident.email}
                  maxLength={160}
                  type="email"
                  onChange={(e) => setIdent({ ...ident, email: e.target.value })}
                  placeholder="voce@email.com"
                />
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
            <button className="pf-btn" onClick={enviar} disabled={enviando}>
              {enviando ? "Enviando…" : "Enviar respostas"}
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
