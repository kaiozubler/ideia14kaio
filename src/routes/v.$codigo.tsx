import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Download,
  FileText,
  Fingerprint,
  Loader2,
  Lock,
  MessageCircle,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";

// Página PÚBLICA de verificação de documento (QR code impresso na receita).
//  /v/<codigo>?k=<token>  → link autenticado do QR code, abre direto
//  /v/<CODIG-O1234>       → link curto, pede os 4 últimos dígitos do CPF do paciente
// A identidade visual (nome, logo e cor) é a da clínica do médico que emitiu.
export const Route = createFileRoute("/v/$codigo")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Verificar documento | MediCopilot" },
      {
        name: "description",
        content:
          "Confira a autenticidade e a assinatura digital do documento emitido pela sua clínica.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: VerificarDocumento,
});

type Identidade = {
  status: string;
  clinica: { nome: string; cor: string | null; logo: string | null };
};

type Assinatura = {
  assinado: boolean;
  padrao?: string;
  signatario?: string | null;
  signatarioCpf?: string | null;
  emissor?: string | null;
  serie?: string | null;
  certificadoValidoDe?: string | null;
  certificadoValidoAte?: string | null;
  assinadoEm?: string | null;
  integridade?: boolean | null;
  assinaturaConfere?: boolean | null;
  erro?: string;
};

type Documento = {
  documento: {
    codigo: string;
    urlCurta: string;
    tipo: string | null;
    titulo: string | null;
    pacienteNome: string | null;
    medico: { nome: string | null; crm: string | null; especialidade: string | null };
    emitidoEm: string | null;
    sha256: string | null;
    bytes: number | null;
  };
  assinatura: Assinatura;
  clinica: {
    nome?: string | null;
    endereco?: string | null;
    telefone?: string | null;
    email?: string | null;
    cor?: string | null;
    logo?: string | null;
    whatsapp?: string | null;
  };
  pdfUrl: string;
};

const ERROS: Record<string, string> = {
  not_found:
    "Não encontramos um documento com este código. Confira o endereço impresso no documento.",
  nao_emitido: "Este documento não foi concluído pela clínica e não pode ser verificado.",
  revogado: "Este documento foi cancelado pela clínica e não é mais válido.",
  bloqueado: "Muitas tentativas com senha incorreta. Aguarde 15 minutos e tente novamente.",
  senha_invalida: "Senha incorreta. Use os 4 últimos dígitos do CPF do paciente.",
  server_error: "Não foi possível verificar agora. Tente novamente em instantes.",
};

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, sans-serif';
const COR_PADRAO = "#0E6E5D";

const dataHora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
const data = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

function VerificarDocumento() {
  const { codigo } = Route.useParams();
  const tokenInicial = useMemo(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("k");
  }, []);

  const [identidade, setIdentidade] = useState<Identidade | null>(null);
  const [doc, setDoc] = useState<Documento | null>(null);
  const [erro, setErro] = useState("");
  const [fatal, setFatal] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [senha, setSenha] = useState("");
  const [enviando, setEnviando] = useState(false);

  const abrir = useCallback(
    async (cred: { k?: string; senha?: string }) => {
      const resp = await fetch("/api/public/documentos/abrir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo, ...cred }),
      });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok) return { ok: true as const, doc: j as Documento };
      return { ok: false as const, error: String(j.error || "server_error") };
    },
    [codigo],
  );

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await fetch(
          `/api/public/documentos/identidade?codigo=${encodeURIComponent(codigo)}`,
        );
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) {
          setFatal(ERROS[j.error] || ERROS.server_error);
          return setCarregando(false);
        }
        setIdentidade(j as Identidade);
        if (tokenInicial) {
          // Tira o token da barra de endereço: um print ou um link copiado
          // daqui não deve dar acesso sem a senha.
          window.history.replaceState(null, "", window.location.pathname);
          const res = await abrir({ k: tokenInicial });
          if (!vivo) return;
          if (res.ok) setDoc(res.doc);
          else if (res.error !== "token_invalido") setFatal(ERROS[res.error] || ERROS.server_error);
        }
      } catch {
        if (vivo) setFatal(ERROS.server_error);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [codigo, tokenInicial, abrir]);

  async function enviarSenha(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}$/.test(senha)) return setErro("Digite os 4 últimos dígitos do CPF do paciente.");
    setErro("");
    setEnviando(true);
    try {
      const res = await abrir({ senha });
      if (res.ok) setDoc(res.doc);
      else if (res.error === "nao_emitido" || res.error === "revogado") setFatal(ERROS[res.error]);
      else setErro(ERROS[res.error] || ERROS.server_error);
    } catch {
      setErro(ERROS.server_error);
    } finally {
      setEnviando(false);
    }
  }

  const cor = doc?.clinica.cor || identidade?.clinica.cor || COR_PADRAO;
  const clinicaNome = doc?.clinica.nome || identidade?.clinica.nome || "";
  const logo = doc?.clinica.logo || identidade?.clinica.logo || null;

  return (
    <div
      className="relative min-h-screen overflow-hidden text-slate-700"
      style={{
        fontFamily: FONT,
        background: "linear-gradient(135deg, #eef8f1 0%, #f3f1fb 45%, #fdf6ec 100%)",
      }}
    >
      <Blob className="-left-24 -top-24 h-80 w-80" style={{ background: cor }} />
      <Blob className="-right-32 top-40 h-96 w-96 bg-violet-300" />
      <Blob className="-bottom-24 left-1/3 h-72 w-72 bg-amber-200" />

      <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 md:py-10">
        <Cabecalho nome={clinicaNome} logo={logo} cor={cor} />

        {carregando ? (
          <Vidro className="flex items-center justify-center gap-3 py-16 text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Verificando documento…
          </Vidro>
        ) : fatal ? (
          <Vidro className="flex flex-col items-center gap-3 py-14 text-center">
            <Badge cor="#f43f5e">
              <ShieldAlert className="h-6 w-6 text-white" />
            </Badge>
            <p className="max-w-md text-base font-semibold text-slate-800">{fatal}</p>
          </Vidro>
        ) : doc ? (
          <DocumentoVerificado doc={doc} cor={cor} />
        ) : (
          <FormSenha
            cor={cor}
            senha={senha}
            setSenha={setSenha}
            erro={erro}
            enviando={enviando}
            onSubmit={enviarSenha}
          />
        )}

        <p className="pb-4 text-center text-xs text-slate-400">
          Verificação de documentos emitidos por {clinicaNome || "clínicas"} · MediCopilot
        </p>
      </div>
    </div>
  );
}

function Cabecalho({ nome, logo, cor }: { nome: string; logo: string | null; cor: string }) {
  return (
    <header className="flex items-center gap-4">
      {logo ? (
        <div className="flex h-14 max-w-[150px] items-center rounded-2xl bg-white/70 px-3 shadow-sm backdrop-blur-xl">
          <img src={logo} alt={nome} className="max-h-10 w-auto object-contain" />
        </div>
      ) : (
        <Badge cor={cor}>
          <Stethoscope className="h-6 w-6 text-white" />
        </Badge>
      )}
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold tracking-tight text-slate-800 md:text-3xl">
          {nome || "Verificação de documento"}
        </h1>
        <p className="text-sm text-slate-500">Verificação de autenticidade de documento médico</p>
      </div>
    </header>
  );
}

function FormSenha(props: {
  cor: string;
  senha: string;
  setSenha: (v: string) => void;
  erro: string;
  enviando: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <Vidro className="mx-auto w-full max-w-md">
      <form onSubmit={props.onSubmit} className="flex flex-col items-center gap-5 text-center">
        <Badge cor={props.cor}>
          <Lock className="h-6 w-6 text-white" />
        </Badge>
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Acesso protegido</h2>
          <p className="mt-1 text-sm text-slate-500">
            Para abrir o documento, digite os <b>4 últimos dígitos do CPF do paciente</b>.
          </p>
        </div>
        <input
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={4}
          value={props.senha}
          onChange={(e) => props.setSenha(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="••••"
          aria-label="4 últimos dígitos do CPF do paciente"
          className="w-44 rounded-2xl border border-white/80 bg-white/80 px-4 py-3 text-center text-2xl font-semibold tracking-[0.5em] text-slate-800 outline-none focus:ring-2 focus:ring-emerald-400"
        />
        {props.erro && <p className="text-sm font-medium text-rose-600">{props.erro}</p>}
        <button
          type="submit"
          disabled={props.enviando}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-60"
          style={{ background: `linear-gradient(135deg, ${props.cor}, ${props.cor}cc)` }}
        >
          {props.enviando ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          Verificar documento
        </button>
      </form>
    </Vidro>
  );
}

function DocumentoVerificado({ doc, cor }: { doc: Documento; cor: string }) {
  const { documento: d, assinatura: a, clinica } = doc;
  const [pdf, setPdf] = useState<Blob | null>(null);
  const [aviso, setAviso] = useState("");
  const nomeArquivo = `${(d.titulo || "documento").toLowerCase().replace(/[^\w]+/g, "_")}_${d.codigo}.pdf`;
  const valida = a.assinado && a.integridade !== false && a.assinaturaConfere !== false && !a.erro;

  const baixar = () => {
    if (!pdf) return;
    const url = URL.createObjectURL(pdf);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeArquivo;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const compartilhar = async () => {
    const texto = `${d.titulo || "Documento"} — ${clinica.nome || ""}\nVerifique em ${d.urlCurta} (senha: 4 últimos dígitos do CPF do paciente)`;
    try {
      const arquivo = pdf ? new File([pdf], nomeArquivo, { type: "application/pdf" }) : null;
      if (arquivo && navigator.canShare?.({ files: [arquivo] })) {
        await navigator.share({ files: [arquivo], title: d.titulo || "Documento", text: texto });
      } else if (navigator.share) {
        await navigator.share({ title: d.titulo || "Documento", text: texto, url: d.urlCurta });
      } else {
        await navigator.clipboard.writeText(texto);
        setAviso("Link de verificação copiado.");
      }
    } catch (e) {
      if ((e as Error)?.name !== "AbortError")
        setAviso("Não foi possível compartilhar neste aparelho.");
    }
  };

  const whatsapp = clinica.whatsapp
    ? `https://wa.me/${clinica.whatsapp}?text=${encodeURIComponent(
        `Olá! Tenho uma dúvida sobre o documento "${d.titulo || "documento"}" emitido por ${
          d.medico.nome || "médico(a)"
        } (código ${d.codigo}).`,
      )}`
    : null;

  const acoes = (classe: string) => (
    <Vidro className={`flex-col gap-3 ${classe}`}>
      <button
        onClick={baixar}
        disabled={!pdf}
        className="inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90 disabled:opacity-50"
        style={{ background: `linear-gradient(135deg, ${cor}, ${cor}cc)` }}
      >
        <Download className="h-4 w-4" /> Baixar PDF
      </button>
      <button
        onClick={compartilhar}
        className="inline-flex items-center justify-center gap-2 rounded-full border border-white/80 bg-white/80 px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-white"
      >
        <Share2 className="h-4 w-4" /> Compartilhar
      </button>
      {whatsapp && (
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:opacity-90"
        >
          <MessageCircle className="h-4 w-4" /> Falar com o médico
        </a>
      )}
      {aviso && <p className="text-center text-xs text-slate-500">{aviso}</p>}
    </Vidro>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Vidro className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <Badge cor={valida ? "#10b981" : a.assinado ? "#f43f5e" : "#f59e0b"}>
            {valida ? (
              <BadgeCheck className="h-6 w-6 text-white" />
            ) : (
              <ShieldAlert className="h-6 w-6 text-white" />
            )}
          </Badge>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-800">
              {valida
                ? "Documento autêntico e assinado digitalmente"
                : a.assinado
                  ? "Assinatura digital não confere"
                  : "Documento autêntico, sem assinatura digital"}
            </h2>
            <p className="text-sm text-slate-500">
              {valida
                ? "Emitido pela clínica e assinado com certificado ICP-Brasil. O arquivo abaixo é o original registrado."
                : a.assinado
                  ? "O arquivo registrado não corresponde à assinatura. Não utilize este documento e fale com a clínica."
                  : "Emitido pela clínica sem certificado digital — vale apenas com a assinatura de próprio punho do médico."}
            </p>
          </div>
        </Vidro>

        {acoes("flex lg:hidden")}

        <VisualizadorPdf url={doc.pdfUrl} onCarregado={setPdf} />
      </div>

      <div className="flex flex-col gap-6">
        {acoes("hidden lg:flex")}

        <Secao icone={<FileText className="h-5 w-5 text-white" />} cor="#0ea5e9" titulo="Documento">
          <Linha rotulo="Tipo" valor={d.titulo} />
          <Linha rotulo="Paciente" valor={d.pacienteNome} />
          <Linha rotulo="Médico" valor={d.medico.nome} />
          <Linha rotulo="CRM" valor={d.medico.crm} />
          {d.medico.especialidade && (
            <Linha rotulo="Especialidade" valor={d.medico.especialidade} />
          )}
          <Linha rotulo="Emitido em" valor={dataHora(d.emitidoEm)} />
          <Linha rotulo="Código" valor={d.codigo} mono />
        </Secao>

        <Secao
          icone={<Fingerprint className="h-5 w-5 text-white" />}
          cor="#8b5cf6"
          titulo="Assinatura digital"
        >
          {a.assinado && !a.erro ? (
            <>
              <Linha rotulo="Padrão" valor={a.padrao} />
              <Linha rotulo="Signatário" valor={a.signatario} />
              {a.signatarioCpf && <Linha rotulo="CPF" valor={a.signatarioCpf} />}
              <Linha rotulo="Assinado em" valor={dataHora(a.assinadoEm)} />
              <Linha rotulo="Autoridade certificadora" valor={a.emissor} />
              <Linha rotulo="Nº de série" valor={a.serie} mono />
              <Linha
                rotulo="Certificado válido"
                valor={`${data(a.certificadoValidoDe)} a ${data(a.certificadoValidoAte)}`}
              />
              <Linha
                rotulo="Integridade"
                valor={
                  a.integridade === false
                    ? "Alterado após a assinatura"
                    : a.integridade
                      ? "Conteúdo íntegro"
                      : "—"
                }
              />
              <Linha
                rotulo="Assinatura"
                valor={
                  a.assinaturaConfere === false
                    ? "Não confere"
                    : a.assinaturaConfere
                      ? "Confere com o certificado"
                      : "—"
                }
              />
            </>
          ) : a.assinado ? (
            <p className="text-sm text-slate-500">
              O documento tem assinatura digital, mas não foi possível ler os dados do certificado.
            </p>
          ) : (
            <p className="text-sm text-slate-500">
              Este documento não possui assinatura digital ICP-Brasil.
            </p>
          )}
          {d.sha256 && <Linha rotulo="SHA-256 do arquivo" valor={d.sha256} mono quebra />}
          {a.assinado && (
            <a
              href="https://validar.iti.gov.br"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 text-xs font-medium text-violet-600 hover:underline"
            >
              Validar também no ITI (validar.iti.gov.br) →
            </a>
          )}
        </Secao>
      </div>
    </div>
  );
}

// ─── Visualizador de PDF (pdf.js) ───────────────────────────────────────────
// Navegadores de celular não exibem PDF em <iframe>: as páginas são
// desenhadas em <canvas> com o pdf.js carregado sob demanda.
const PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (src: { data: ArrayBuffer }) => { promise: Promise<PdfDoc> };
};
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => {
    promise: Promise<void>;
  };
};

let pdfjsPromise: Promise<PdfJs> | null = null;
function carregarPdfJs(): Promise<PdfJs> {
  const w = window as unknown as { pdfjsLib?: PdfJs };
  if (w.pdfjsLib) return Promise.resolve(w.pdfjsLib);
  pdfjsPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${PDFJS}/pdf.min.js`;
    s.onload = () => {
      if (!w.pdfjsLib) return reject(new Error("pdf.js indisponível"));
      w.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.js`;
      resolve(w.pdfjsLib);
    };
    s.onerror = () => {
      pdfjsPromise = null;
      reject(new Error("pdf.js indisponível"));
    };
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

function VisualizadorPdf({ url, onCarregado }: { url: string; onCarregado: (b: Blob) => void }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    let objUrl: string | null = null;
    (async () => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        if (!vivo) return;
        onCarregado(blob);
        objUrl = URL.createObjectURL(blob);
        setBlobUrl(objUrl);
        const pdfjs = await carregarPdfJs();
        const pdf = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
        const alvo = caixa.current;
        if (!vivo || !alvo) return;
        alvo.innerHTML = "";
        const largura = alvo.clientWidth || 600;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (largura / base.width) * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = "100%";
          canvas.className = "block rounded-2xl bg-white shadow-md";
          alvo.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
          if (!vivo) return;
        }
        setEstado("ok");
      } catch (e) {
        console.warn("[verificacao] falha ao exibir PDF:", e);
        if (vivo) setEstado("erro");
      }
    })();
    return () => {
      vivo = false;
      if (objUrl) setTimeout(() => URL.revokeObjectURL(objUrl!), 1000);
    };
  }, [url, onCarregado]);

  return (
    <Vidro className="p-3 md:p-4">
      {estado === "carregando" && (
        <div className="flex items-center justify-center gap-3 py-20 text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" /> Carregando documento…
        </div>
      )}
      {estado === "erro" &&
        (blobUrl ? (
          <iframe
            title="Documento"
            src={blobUrl}
            className="h-[80vh] w-full rounded-2xl bg-white"
          />
        ) : (
          <p className="py-16 text-center text-sm text-slate-500">
            Não foi possível carregar o documento. Tente novamente.
          </p>
        ))}
      <div ref={caixa} className="flex flex-col gap-3" />
    </Vidro>
  );
}

// ─── Peças visuais (liquid glass) ───────────────────────────────────────────

function Vidro({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`relative border border-white/80 bg-white/60 p-6 shadow-xl shadow-slate-200/40 backdrop-blur-xl ${className}`}
      style={{ borderRadius: 28 }}
    >
      {children}
    </section>
  );
}

function Badge({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center shadow-md"
      style={{ borderRadius: 18, background: `linear-gradient(135deg, ${cor}b3, ${cor})` }}
    >
      {children}
    </div>
  );
}

function Blob({ className, style }: { className: string; style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute rounded-full opacity-50 blur-3xl ${className}`}
      style={style}
    />
  );
}

function Secao({
  icone,
  cor,
  titulo,
  children,
}: {
  icone: ReactNode;
  cor: string;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <Vidro className="flex flex-col gap-3">
      <div className="mb-1 flex items-center gap-3">
        <Badge cor={cor}>{icone}</Badge>
        <h3 className="text-base font-semibold text-slate-800">{titulo}</h3>
      </div>
      {children}
    </Vidro>
  );
}

function Linha({
  rotulo,
  valor,
  mono,
  quebra,
}: {
  rotulo: string;
  valor?: string | null;
  mono?: boolean;
  quebra?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {rotulo}
      </span>
      <span
        className={`text-sm text-slate-700 ${mono ? "font-mono text-xs" : ""} ${quebra ? "break-all" : "break-words"}`}
      >
        {valor || "—"}
      </span>
    </div>
  );
}
