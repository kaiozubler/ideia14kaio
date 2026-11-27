import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, PhoneOff, Video } from "lucide-react";

// Página PÚBLICA da teleconsulta: /consulta/<sala>. O paciente só vê o endereço
// do app; a chamada é a tela pronta do Daily (Prebuilt) embutida num iframe,
// com URL e token entregues por /api/public/consulta/sala.
export const Route = createFileRoute("/consulta/$sala")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Teleconsulta | MediCopilot" },
      { name: "description", content: "Entre na sua consulta por vídeo." },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: Teleconsulta,
});

// Versão fixa do SDK (a mesma família usada pelo médico em medicopilot.html).
const DAILY_SDK = "https://unpkg.com/@daily-co/daily-js@0.95.0/dist/daily.js";

type DailyFrame = {
  join: (o: { url: string; token?: string }) => Promise<unknown>;
  on: (ev: string, cb: (e?: unknown) => void) => DailyFrame;
  destroy: () => Promise<void>;
};
type DailyGlobal = {
  createFrame: (el: HTMLElement, o: Record<string, unknown>) => DailyFrame;
};

let sdkPromise: Promise<DailyGlobal> | null = null;
function carregarSdk(): Promise<DailyGlobal> {
  const w = window as unknown as { DailyIframe?: DailyGlobal };
  if (w.DailyIframe) return Promise.resolve(w.DailyIframe);
  sdkPromise ??= new Promise<DailyGlobal>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = DAILY_SDK;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.onload = () => (w.DailyIframe ? resolve(w.DailyIframe) : reject(new Error("sdk")));
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("sdk"));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

type Estado = "carregando" | "chamada" | "encerrada" | "nao_encontrada" | "expirada" | "erro";

function Teleconsulta() {
  const { sala } = Route.useParams();
  const alvo = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<Estado>("carregando");
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let cancelado = false;
    let frame: DailyFrame | null = null;
    setEstado("carregando");
    (async () => {
      try {
        const r = await fetch(`/api/public/consulta/sala?sala=${encodeURIComponent(sala)}`);
        if (r.status === 404) return !cancelado && setEstado("nao_encontrada");
        if (r.status === 410) return !cancelado && setEstado("expirada");
        if (!r.ok) throw new Error(String(r.status));
        const { url, token } = (await r.json()) as { url: string; token?: string };
        const Daily = await carregarSdk();
        if (cancelado || !alvo.current) return;
        frame = Daily.createFrame(alvo.current, {
          iframeStyle: { width: "100%", height: "100%", border: "0" },
          showLeaveButton: true,
          showFullscreenButton: true,
          lang: "pt-BR",
        });
        frame.on("left-meeting", () => !cancelado && setEstado("encerrada"));
        setEstado("chamada");
        await frame.join({ url, token });
      } catch (e) {
        console.error("[teleconsulta]", e);
        if (!cancelado) setEstado("erro");
      }
    })();
    return () => {
      cancelado = true;
      frame?.destroy().catch(() => {});
    };
  }, [sala, tentativa]);

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-slate-950 text-slate-100">
      <div ref={alvo} className={estado === "chamada" ? "min-h-0 flex-1" : "hidden"} />
      {estado !== "chamada" && (
        <div className="flex flex-1 items-center justify-center px-4">
          <div className="max-w-sm rounded-3xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur">
            {estado === "carregando" ? (
              <>
                <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-emerald-300" />
                <p>Preparando sua consulta…</p>
              </>
            ) : estado === "encerrada" ? (
              <>
                <PhoneOff className="mx-auto mb-4 h-8 w-8 text-slate-300" />
                <h1 className="mb-2 text-lg font-semibold">Você saiu da consulta</h1>
                <Botao onClick={() => setTentativa((n) => n + 1)}>Entrar de novo</Botao>
              </>
            ) : (
              <>
                <Video className="mx-auto mb-4 h-8 w-8 text-slate-300" />
                <h1 className="mb-2 text-lg font-semibold">
                  {estado === "nao_encontrada"
                    ? "Consulta não encontrada"
                    : estado === "expirada"
                      ? "Este link de consulta expirou"
                      : "Não foi possível abrir a consulta"}
                </h1>
                <p className="text-sm text-slate-300">
                  {estado === "erro"
                    ? "Verifique sua conexão e tente de novo."
                    : "Confira o link com a clínica que enviou a mensagem."}
                </p>
                {estado === "erro" && (
                  <Botao onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</Botao>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Botao({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-4 rounded-full bg-emerald-500 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-400"
    >
      {children}
    </button>
  );
}
