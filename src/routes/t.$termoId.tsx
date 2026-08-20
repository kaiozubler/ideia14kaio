import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";

// Página PÚBLICA de assinatura de termo de ciência (link compartilhável /t/{id}).
// Espelha src/routes/f.$formId.tsx, mas com corpo de texto + checkbox no lugar
// de perguntas, e autenticação por email sempre obrigatória (sem toggle).
export const Route = createFileRoute("/t/$termoId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Assinar termo | MediCopilot" },
      { name: "description", content: "Leia e assine o termo de ciência enviado pela sua clínica." },
      { property: "og:title", content: "Assinar termo | MediCopilot" },
      { property: "og:description", content: "Leia e assine o termo de ciência enviado pela sua clínica." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PublicTermo,
});

type Termo = {
  id: string;
  titulo: string;
  corpo: string;
  checkbox_label: string;
  ativo: boolean;
  medico_nome: string | null;
};

function anonClient() {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

const onlyDigits = (v: string) => v.replace(/\D/g, "");
const hojeBr = () => new Date().toLocaleDateString("pt-BR");

function renderCorpo(corpo: string, vars: Record<string, string>): string {
  return corpo.replace(/\{(paciente_nome|paciente_cpf|paciente_email|medico_nome|data_assinatura)\}/g, (_, k) => vars[k] || `{${k}}`);
}

function PublicTermo() {
  const { termoId } = Route.useParams();
  const sb = useMemo(anonClient, []);
  const [termo, setTermo] = useState<Termo | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [email, setEmail] = useState("");
  const [aceito, setAceito] = useState(false);
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
      let data: unknown = null;
      try {
        const resp = await fetch(`/api/public/termos/publico?id=${encodeURIComponent(termoId)}`);
        if (resp.ok) data = (await resp.json())?.termo ?? null;
      } catch {
        data = null;
      }
      if (!vivo) return;
      setCarregando(false);
      if (!data) return setErro("Termo não encontrado ou indisponível.");
      const t = data as unknown as Termo;
      if (!t.ativo) return setErro("Este termo não está mais disponível para assinatura.");
      setTermo(t);
    })();
    return () => {
      vivo = false;
    };
  }, [termoId, sb]);

  const textoRenderizado = useMemo(() => {
    if (!termo) return "";
    return renderCorpo(termo.corpo, {
      paciente_nome: nome.trim() || "________________",
      paciente_cpf: cpf.trim() ? onlyDigits(cpf) : "________________",
      paciente_email: email.trim() || "________________",
      medico_nome: termo.medico_nome || "",
      data_assinatura: hojeBr(),
    });
  }, [termo, nome, cpf, email]);

  async function pedirCodigo(emailInformado: string) {
    if (!termo) return;
    setErro("");
    setAviso("");
    setEnviandoCodigo(true);
    try {
      const res = await fetch("/api/public/termos/codigo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termo_id: termo.id, email: emailInformado }),
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
      setAviso("Enviamos um código de 4 dígitos para " + emailInformado + ". Digite-o abaixo para confirmar a assinatura.");
    } catch {
      setEnviandoCodigo(false);
      setErro("Não foi possível enviar o código. Verifique sua conexão e tente novamente.");
    }
  }

  async function enviar() {
    if (!termo) return;
    setErro("");
    setAviso("");
    const nomeTrim = nome.trim();
    const cpfDigits = onlyDigits(cpf);
    const emailTrim = email.trim().toLowerCase();
    if (nomeTrim.length < 3) return setErro("Informe seu nome completo.");
    if (cpfDigits.length !== 11) return setErro("Informe um CPF válido (11 dígitos).");
    if (!emailTrim || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrim)) return setErro("Informe um e-mail válido.");
    if (!aceito) return setErro("Você precisa marcar a caixa de aceite para continuar.");

    if (!codigoEnviado || emailAutenticado !== emailTrim) {
      return pedirCodigo(emailTrim);
    }
    if (codigo.trim().length !== 4) {
      return setErro("Informe o código de 4 dígitos enviado para o seu email.");
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/public/termos/assinar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          termo_id: termo.id,
          paciente_id: pacienteId || null,
          nome: nomeTrim,
          cpf: cpfDigits,
          email: emailTrim,
          checkbox_aceito: true,
          codigo: codigo.trim(),
        }),
      });
      setEnviando(false);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (j.error === "termo_unavailable") return setErro("Este termo não está mais disponível para assinatura.");
        if (j.error === "code_invalid") return setErro("Código incorreto. Confira o email e tente novamente.");
        if (j.error === "code_expired") return setErro("O código expirou. Solicite um novo código.");
        if (j.error === "code_required") return setErro("Confirme seu email com o código de 4 dígitos.");
        if (j.error === "code_blocked") return setErro("Muitas tentativas. Solicite um novo código.");
        return setErro("Não foi possível registrar sua assinatura. Tente novamente.");
      }
      setOk(true);
    } catch {
      setEnviando(false);
      setErro("Não foi possível registrar sua assinatura. Verifique sua conexão e tente novamente.");
    }
  }

  return (
    <div className="pf-bg">
      <style>{CSS}</style>
      <div className="pf-blob a" />
      <div className="pf-blob b" />
      <main className="pf-card">
        {carregando && <p className="pf-muted">Carregando termo…</p>}

        {!carregando && !termo && <p className="pf-err">{erro || "Termo indisponível."}</p>}

        {termo && ok && (
          <div className="pf-done">
            <div className="pf-check">✓</div>
            <h1>Termo assinado</h1>
            <p className="pf-muted">Obrigado! Sua assinatura foi registrada com segurança. Você também recebeu uma cópia por email.</p>
          </div>
        )}

        {termo && !ok && (
          <>
            <header className="pf-head">
              <span className="pf-badge">Termo de ciência</span>
              <h1>{termo.titulo}</h1>
            </header>

            <section className="pf-sec">
              <h2>Seus dados</h2>
              <div className="pf-row">
                <div className="pf-full">
                  <label className="pf-lbl">Nome completo <span className="pf-req">*</span></label>
                  <input className="pf-in" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" />
                </div>
                <div>
                  <label className="pf-lbl">CPF <span className="pf-req">*</span></label>
                  <input className="pf-in" inputMode="numeric" maxLength={14} value={cpf} onChange={(e) => setCpf(e.target.value)} placeholder="000.000.000-00" />
                </div>
                <div>
                  <label className="pf-lbl">E-mail <span className="pf-req">*</span></label>
                  <input className="pf-in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@email.com" />
                </div>
              </div>
            </section>

            <section className="pf-sec">
              <h2>Termo</h2>
              <div className="pf-termo-body">{textoRenderizado}</div>
            </section>

            <label className="pf-opt pf-check-aceite">
              <input type="checkbox" checked={aceito} onChange={(e) => setAceito(e.target.checked)} />
              <span>{termo.checkbox_label}</span>
            </label>

            {erro && <p className="pf-err">{erro}</p>}
            {aviso && <p className="pf-ok">{aviso}</p>}
            {codigoEnviado && (
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
                <button type="button" className="pf-link" onClick={() => pedirCodigo(emailAutenticado)} disabled={enviandoCodigo}>
                  {enviandoCodigo ? "Enviando…" : "Reenviar código"}
                </button>
              </div>
            )}
            <button className="pf-btn" onClick={enviar} disabled={enviando || enviandoCodigo}>
              {enviando
                ? "Enviando…"
                : enviandoCodigo
                  ? "Enviando código…"
                  : !codigoEnviado
                    ? "Confirmar email e continuar"
                    : "Confirmar código e assinar"}
            </button>
            <p className="pf-foot">Sua assinatura é enviada com segurança para a sua clínica.</p>
          </>
        )}
      </main>
    </div>
  );
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
.pf-full{grid-column:1 / -1}
@media(max-width:520px){.pf-row{grid-template-columns:1fr}.pf-card{padding:20px 16px}}
.pf-req{color:#e11d48}
.pf-termo-body{padding:16px 18px;border-radius:16px;background:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.85);border-left:3px solid #99f6e4;font-size:13.5px;line-height:1.65;color:#1e293b;white-space:pre-wrap;max-height:340px;overflow-y:auto}
.pf-opt{display:flex;align-items:flex-start;gap:9px;padding:7px 2px;font-size:13.5px;cursor:pointer}
.pf-opt input{accent-color:#0d9488;width:16px;height:16px;margin-top:2px;flex:0 0 auto}
.pf-check-aceite{margin-bottom:14px;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.85)}
.pf-btn{width:100%;padding:13px;border:none;border-radius:16px;font-size:15px;font-weight:700;color:#fff;background:linear-gradient(135deg,#34d399,#0d9488);box-shadow:0 10px 26px rgba(13,148,136,.35);cursor:pointer}
.pf-btn:disabled{opacity:.65;cursor:default}
.pf-err{margin:0 0 12px;padding:10px 12px;border-radius:12px;font-size:13px;color:#b91c1c;background:rgba(254,226,226,.8);border:1px solid rgba(252,165,165,.8)}
.pf-ok{margin:0 0 12px;padding:10px 12px;border-radius:12px;font-size:13px;color:#0f766e;background:rgba(209,250,229,.8);border:1px solid rgba(153,246,228,.9)}
.pf-code{margin:0 0 12px;padding:12px 14px;border-radius:16px;background:rgba(255,255,255,.65);border:1px solid rgba(255,255,255,.9);border-left:3px solid #99f6e4}
.pf-code-in{max-width:150px;text-align:center;font-size:22px;letter-spacing:.28em;font-weight:700}
.pf-link{display:block;margin-top:8px;background:none;border:none;padding:0;font-size:12px;font-weight:600;color:#0d9488;cursor:pointer;text-decoration:underline}
.pf-link:disabled{opacity:.6;cursor:default}
.pf-foot{font-size:11px;color:#94a3b8;text-align:center;margin:12px 0 0}
.pf-done{text-align:center;padding:26px 6px}
.pf-done h1{font-size:20px;color:#0f172a;margin:14px 0 6px}
.pf-check{width:58px;height:58px;margin:0 auto;border-radius:50%;background:linear-gradient(135deg,#34d399,#0d9488);color:#fff;font-size:28px;display:flex;align-items:center;justify-content:center}
`;
