import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, MicOff, PhoneOff, Smartphone, Type } from "lucide-react";

// Página do SMARTPHONE na captação de áudio da consulta. O computador abre a
// chamada e mostra um QR para /captar#<token>; aqui o celular conecta e começa
// a captar sozinho, transcreve no Deepgram (mesmos parâmetros da gravação
// local) e envia o texto e o nível do áudio para o computador pelo servidor.
// O celular só pode encerrar: abrir ou retomar é sempre pelo computador.
export const Route = createFileRoute("/captar")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Microfone da consulta | MediCopilot" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ],
  }),
  component: CaptarPage,
});

type Fase =
  | "conectando"
  | "permissao" // precisa de um toque para liberar microfone/áudio
  | "captando"
  | "pausado"
  | "encerrado"
  | "invalido"
  | "erro";

const FONTE = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Inter, sans-serif';
const COR = "#10b981";
const INTERVALO_EVENTO_MS = 400;
const TAXA_PCM = 16000;
const DG_PARAMS = {
  model: "nova-2",
  language: "pt-BR",
  smart_format: "true",
  interim_results: "true",
  punctuate: "true",
  endpointing: "300",
  vad_events: "true",
};

// Silêncio não vai para o Deepgram (cobrado por minuto de áudio): depois de
// SILENCIO_MS abaixo de LIMIAR_VOZ_RMS (~ -48 dBFS) o envio pausa e só o
// KeepAlive mantém a conexão; volta no primeiro sinal de voz.
const LIMIAR_VOZ_RMS = 0.004;
const SILENCIO_MS = 2000;

type Reconhecedor = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean } & ArrayLike<{ transcript: string; confidence?: number }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onstart: (() => void) | null;
};

function criarReconhecedor(): Reconhecedor | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => Reconhecedor;
    webkitSpeechRecognition?: new () => Reconhecedor;
  };
  const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
  return SR ? new SR() : null;
}

const MOTIVO_FIM: Record<string, string> = {
  computador: "A chamada foi encerrada no computador.",
  smartphone: "Você encerrou a chamada neste celular.",
  expirado: "Esta chamada expirou.",
};

async function api(body: Record<string, unknown>) {
  const r = await fetch("/api/public/captacao-movel", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: json as Record<string, unknown> };
}

/** 0–100 a partir do RMS em dBFS (-60 dB = silêncio, 0 dB = máximo). */
function nivelDoRms(rms: number) {
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(100, Math.round(((db + 60) / 60) * 100)));
}

function qualidadeDoNivel(nivel: number, ativo: boolean) {
  if (!ativo) return { rotulo: "Sem áudio", cor: "#94a3b8" };
  if (nivel >= 96) return { rotulo: "Saturado — afaste o celular", cor: "#f59e0b" };
  if (nivel < 18) return { rotulo: "Baixo — aproxime o celular", cor: "#ef4444" };
  if (nivel < 35) return { rotulo: "Razoável", cor: "#eab308" };
  return { rotulo: "Boa", cor: COR };
}

function CaptarPage() {
  const [fase, setFase] = useState<Fase>("conectando");
  const [motivo, setMotivo] = useState<string>("");
  const [finais, setFinais] = useState<string[]>([]);
  const [parcial, setParcial] = useState("");
  const [nivel, setNivel] = useState(0);
  const [fonte, setFonte] = useState(26);

  const tokenRef = useRef<string>("");
  const faseRef = useRef<Fase>("conectando");
  const midia = useRef<{
    stream?: MediaStream;
    ctx?: AudioContext;
    analyser?: AnalyserNode;
    processor?: ScriptProcessorNode;
    recorder?: MediaRecorder;
    ws?: WebSocket;
    keepAlive?: ReturnType<typeof setInterval>;
    wakeLock?: { release: () => Promise<void> } | null;
    raf?: number;
    /** Transcrição básica: reconhecimento de voz do navegador do celular. */
    reconhecedor?: Reconhecedor;
    /** Envio ao Deepgram pausado por silêncio (não pela pausa do computador). */
    silencio?: boolean;
    ultimaVoz?: number;
  }>({});
  const modoRef = useRef<"avancada" | "basica">("avancada");
  const fila = useRef<string[]>([]);
  const parcialRef = useRef("");
  const picoRef = useRef(0);
  const confiancaRef = useRef<number | null>(null);
  const textoRef = useRef<HTMLDivElement>(null);

  const mudarFase = useCallback((f: Fase) => {
    faseRef.current = f;
    setFase(f);
  }, []);

  const pararMidia = useCallback(() => {
    const m = midia.current;
    if (m.keepAlive) clearInterval(m.keepAlive);
    if (m.raf) cancelAnimationFrame(m.raf);
    if (m.reconhecedor) {
      const r = m.reconhecedor;
      m.reconhecedor = undefined;
      try {
        r.abort();
      } catch {
        /* já parado */
      }
    }
    try {
      if (m.recorder && m.recorder.state !== "inactive") m.recorder.stop();
    } catch {
      /* já parado */
    }
    try {
      if (m.ws && m.ws.readyState === WebSocket.OPEN) {
        m.ws.send(JSON.stringify({ type: "CloseStream" }));
        m.ws.close();
      }
    } catch {
      /* já fechado */
    }
    m.processor?.disconnect();
    m.stream?.getTracks().forEach((t) => t.stop());
    m.ctx?.close().catch(() => {});
    m.wakeLock?.release().catch(() => {});
    midia.current = {};
    setNivel(0);
  }, []);

  const finalizar = useCallback(
    (por?: string) => {
      pararMidia();
      setMotivo(MOTIVO_FIM[por ?? ""] ?? "A chamada foi encerrada.");
      setParcial("");
      mudarFase("encerrado");
    },
    [mudarFase, pararMidia],
  );

  // Conexão com o Deepgram, refeita se cair enquanto a chamada estiver aberta.
  const abrirDeepgram = useCallback(async (pcm: boolean) => {
    const r = await api({ acao: "deepgram", token: tokenRef.current });
    if (!r.ok) throw new Error("Não foi possível iniciar a transcrição.");
    const tk = r.json as { access_token: string; mode?: string };
    const params = new URLSearchParams(DG_PARAMS);
    if (pcm) {
      params.set("encoding", "linear16");
      params.set("sample_rate", String(TAXA_PCM));
      params.set("channels", "1");
    }
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, [
      tk.mode === "grant" ? "bearer" : "token",
      tk.access_token,
    ]);
    ws.binaryType = "arraybuffer";
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("Tempo esgotado ao conectar.")), 8000);
      ws.onopen = () => {
        clearTimeout(t);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(t);
        reject(new Error("Falha na conexão de transcrição."));
      };
    });
    ws.onmessage = (ev) => {
      let msg: {
        type?: string;
        is_final?: boolean;
        channel?: { alternatives?: { transcript?: string; confidence?: number }[] };
      };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type !== "Results") return;
      const alt = msg.channel?.alternatives?.[0];
      const texto = (alt?.transcript ?? "").trim();
      if (!texto) return;
      if (msg.is_final) {
        fila.current.push(texto);
        if (typeof alt?.confidence === "number")
          confiancaRef.current = Math.round(alt.confidence * 100);
        parcialRef.current = "";
        setParcial("");
        setFinais((f) => [...f.slice(-200), texto]);
      } else {
        parcialRef.current = texto;
        setParcial(texto);
      }
    };
    ws.onclose = () => {
      const f = faseRef.current;
      if (f !== "captando" && f !== "pausado") return;
      if (midia.current.ws !== ws) return;
      setTimeout(() => {
        if (faseRef.current === "captando" || faseRef.current === "pausado") {
          abrirDeepgram(pcm)
            .then((novo) => {
              midia.current.ws = novo;
            })
            .catch(() => {});
        }
      }, 1500);
    };
    return ws;
  }, []);

  // Transcrição básica: o reconhecimento do navegador usa o microfone sozinho
  // (abrir o microfone em paralelo atrapalha no Android), então não há medidor
  // de nível real: o nível sobe quando chega texto.
  const iniciarNavegador = useCallback(async () => {
    const r = criarReconhecedor();
    if (!r) {
      throw new Error(
        "Este navegador não tem reconhecimento de voz. Abra o link no Chrome (Android) ou no Safari (iPhone).",
      );
    }
    r.lang = "pt-BR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const texto = (res[0]?.transcript ?? "").trim();
        if (!texto) continue;
        picoRef.current = Math.max(picoRef.current, 60);
        setNivel(60);
        if (res.isFinal) {
          fila.current.push(texto);
          if (typeof res[0]?.confidence === "number" && res[0].confidence > 0)
            confiancaRef.current = Math.round(res[0].confidence * 100);
          parcialRef.current = "";
          setParcial("");
          setFinais((f) => [...f.slice(-200), texto]);
        } else {
          parcialRef.current = texto;
          setParcial(texto);
        }
      }
    };
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 4000);
      r.onstart = () => {
        clearTimeout(t);
        resolve();
      };
      r.onerror = (e) => {
        clearTimeout(t);
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          reject(Object.assign(new Error("negado"), { name: "NotAllowedError" }));
        } else resolve();
      };
      try {
        r.start();
      } catch (err) {
        clearTimeout(t);
        reject(Object.assign(new Error("gesto"), { gesto: true, causa: err }));
      }
    });
    r.onerror = null;
    // O navegador encerra o reconhecimento de tempos em tempos: reinicia
    // enquanto a chamada estiver captando.
    r.onend = () => {
      setNivel(0);
      if (midia.current.reconhecedor !== r || faseRef.current !== "captando") return;
      setTimeout(() => {
        if (midia.current.reconhecedor === r && faseRef.current === "captando") {
          try {
            r.start();
          } catch {
            /* já rodando */
          }
        }
      }, 250);
    };
    midia.current.reconhecedor = r;
    try {
      const wl = (
        navigator as unknown as {
          wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
        }
      ).wakeLock;
      if (wl) midia.current.wakeLock = await wl.request("screen");
    } catch {
      /* sem wake lock */
    }
  }, []);

  const iniciarCaptura = useCallback(async () => {
    if (modoRef.current === "basica") return iniciarNavegador();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    });
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    if (ctx.state !== "running") {
      // Navegador exige um toque antes de liberar o áudio (iOS principalmente).
      stream.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      throw Object.assign(new Error("gesto"), { gesto: true });
    }
    const fonteAudio = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    fonteAudio.connect(analyser);
    midia.current = { ...midia.current, stream, ctx, analyser };

    const usaRecorder =
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus");
    const ws = await abrirDeepgram(!usaRecorder);
    midia.current.ws = ws;

    if (usaRecorder) {
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      rec.ondataavailable = (e) => {
        const w = midia.current.ws;
        if (e.data.size > 0 && w?.readyState === WebSocket.OPEN) w.send(e.data);
      };
      rec.start(250);
      midia.current.recorder = rec;
    } else {
      // Safari sem webm/opus: PCM 16 kHz direto do microfone.
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const passo = ctx.sampleRate / TAXA_PCM;
      // Último bloco calado: enviado junto quando a voz volta, para não cortar o início da fala.
      let anterior: ArrayBuffer | null = null;
      proc.onaudioprocess = (e) => {
        const w = midia.current.ws;
        if (w?.readyState !== WebSocket.OPEN || faseRef.current !== "captando") return;
        const entrada = e.inputBuffer.getChannelData(0);
        const n = Math.floor(entrada.length / passo);
        const saida = new Int16Array(n);
        for (let i = 0; i < n; i++) {
          const ini = Math.floor(i * passo);
          const fim = Math.min(entrada.length, Math.floor((i + 1) * passo));
          let soma = 0;
          for (let j = ini; j < fim; j++) soma += entrada[j];
          const v = Math.max(-1, Math.min(1, soma / Math.max(1, fim - ini)));
          saida[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
        if (midia.current.silencio) {
          anterior = saida.buffer;
          return;
        }
        if (anterior) {
          w.send(anterior);
          anterior = null;
        }
        w.send(saida.buffer);
      };
      fonteAudio.connect(proc);
      proc.connect(ctx.destination);
      midia.current.processor = proc;
    }

    midia.current.keepAlive = setInterval(() => {
      const w = midia.current.ws;
      if (w?.readyState === WebSocket.OPEN) w.send(JSON.stringify({ type: "KeepAlive" }));
    }, 4000);

    // Porteiro de silêncio: só age enquanto capta (a pausa do computador é outra).
    const atualizarPorteiro = (rms: number) => {
      const m = midia.current;
      if (faseRef.current !== "captando") return;
      const agora = Date.now();
      if (rms >= LIMIAR_VOZ_RMS) {
        m.ultimaVoz = agora;
        if (m.silencio) {
          m.silencio = false;
          try {
            if (m.recorder?.state === "paused") m.recorder.resume();
          } catch {
            /* sem gravador */
          }
        }
      } else if (!m.silencio && agora - (m.ultimaVoz ?? agora) > SILENCIO_MS) {
        m.silencio = true;
        try {
          if (m.recorder?.state === "recording") m.recorder.pause();
        } catch {
          /* sem gravador */
        }
      }
    };

    // Medidor de nível
    const buf = new Float32Array(analyser.fftSize);
    const medir = () => {
      analyser.getFloatTimeDomainData(buf);
      let s = 0;
      for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
      const rms = Math.sqrt(s / buf.length);
      const n = faseRef.current === "captando" ? nivelDoRms(rms) : 0;
      atualizarPorteiro(rms);
      picoRef.current = Math.max(picoRef.current, n);
      setNivel((anterior) => Math.round(anterior * 0.6 + n * 0.4));
      midia.current.raf = requestAnimationFrame(medir);
    };
    midia.current.ultimaVoz = Date.now();
    midia.current.silencio = false;
    medir();

    // Mantém a tela ligada: com ela apagada o navegador corta o microfone.
    try {
      const wl = (
        navigator as unknown as {
          wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
        }
      ).wakeLock;
      if (wl) midia.current.wakeLock = await wl.request("screen");
    } catch {
      /* sem wake lock */
    }
  }, [abrirDeepgram, iniciarNavegador]);

  const comecar = useCallback(async () => {
    mudarFase("conectando");
    try {
      await iniciarCaptura();
      mudarFase("captando");
    } catch (e) {
      pararMidia();
      if ((e as { gesto?: boolean }).gesto) {
        mudarFase("permissao");
      } else if ((e as Error).name === "NotAllowedError") {
        setMotivo(
          "O acesso ao microfone foi negado. Libere nas configurações do navegador e toque em tentar de novo.",
        );
        mudarFase("permissao");
      } else {
        setMotivo((e as Error).message || "Não foi possível acessar o microfone.");
        mudarFase("erro");
      }
    }
  }, [iniciarCaptura, mudarFase, pararMidia]);

  // 1) Conecta à chamada aberta pelo computador e começa a captar sozinho.
  useEffect(() => {
    const token = location.hash.replace(/^#/, "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(token)) {
      mudarFase("invalido");
      return;
    }
    tokenRef.current = token;
    api({ acao: "conectar", token, dispositivo: navigator.userAgent.slice(0, 200) }).then((r) => {
      const st = r.json.status as string | undefined;
      if (r.status === 404 || r.status === 400) return mudarFase("invalido");
      if (!r.ok || !st) {
        setMotivo(
          "Não foi possível conectar ao computador. Recarregue a página para tentar de novo.",
        );
        return mudarFase("erro");
      }
      if (st === "encerrado") return finalizar(r.json.encerrado_por as string);
      if (r.json.transcricao === "basica") modoRef.current = "basica";
      void comecar();
    });
    return () => pararMidia();
  }, [comecar, finalizar, mudarFase, pararMidia]);

  // 2) Envia nível, parcial e falas finais; a resposta traz o estado da chamada.
  useEffect(() => {
    let vivo = true;
    let enviando = false;
    const tick = async () => {
      const f = faseRef.current;
      if (!vivo || enviando || !tokenRef.current) return;
      if (f !== "captando" && f !== "pausado" && f !== "permissao") return;
      enviando = true;
      const lote = fila.current.splice(0, 40);
      const pico = picoRef.current;
      picoRef.current = 0;
      try {
        const r = await api({
          acao: "evento",
          token: tokenRef.current,
          nivel: f === "captando" ? pico : 0,
          confianca: confiancaRef.current,
          parcial: f === "captando" ? parcialRef.current.slice(0, 2000) : "",
          finais: lote.length ? lote : undefined,
        });
        const st = r.json.status as string | undefined;
        if (!r.ok && r.status !== 404) {
          fila.current.unshift(...lote);
        } else if (r.status === 404 || st === "encerrado") {
          finalizar(r.json.encerrado_por as string);
        } else if (st === "pausado" && faseRef.current === "captando") {
          mudarFase("pausado");
          // Pausa o gravador (cortar pedaços do webm corromperia o fluxo).
          try {
            midia.current.recorder?.pause();
            midia.current.reconhecedor?.stop();
          } catch {
            /* sem gravador */
          }
          setParcial("");
          parcialRef.current = "";
        } else if (st === "conectado" && faseRef.current === "pausado") {
          midia.current.silencio = false;
          midia.current.ultimaVoz = Date.now();
          try {
            if (midia.current.recorder?.state === "paused") midia.current.recorder.resume();
          } catch {
            /* sem gravador */
          }
          mudarFase("captando");
          try {
            midia.current.reconhecedor?.start();
          } catch {
            /* já rodando */
          }
        }
      } catch {
        fila.current.unshift(...lote);
      } finally {
        enviando = false;
      }
    };
    const id = setInterval(tick, INTERVALO_EVENTO_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [finalizar, mudarFase]);

  // Tela ligada de novo: refaz o wake lock (ele cai quando a aba sai de foco).
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState !== "visible" || !midia.current.stream) return;
      try {
        const wl = (
          navigator as unknown as {
            wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
          }
        ).wakeLock;
        if (wl) midia.current.wakeLock = await wl.request("screen");
      } catch {
        /* sem wake lock */
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    const el = textoRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [finais, parcial]);

  const encerrar = async () => {
    if (!window.confirm("Encerrar a captação pelo smartphone?")) return;
    // Envia o que ainda está na fila antes de encerrar.
    const lote = fila.current.splice(0);
    if (lote.length)
      await api({ acao: "evento", token: tokenRef.current, nivel: 0, finais: lote }).catch(
        () => {},
      );
    await api({ acao: "encerrar", token: tokenRef.current }).catch(() => {});
    finalizar("smartphone");
  };

  const ativo = fase === "captando";
  const q = qualidadeDoNivel(nivel, ativo);
  const aoVivo = fase === "captando" || fase === "pausado";

  return (
    <main
      className="flex min-h-[100dvh] flex-col text-slate-800"
      style={{
        fontFamily: FONTE,
        background: "linear-gradient(135deg, #eef8f1 0%, #f3f1fb 45%, #fdf6ec 100%)",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <header className="flex items-center gap-3 px-4 pt-4">
        <span
          className="flex h-10 w-10 flex-none items-center justify-center rounded-2xl text-white"
          style={{ background: `linear-gradient(135deg, ${COR}b3, ${COR})` }}
        >
          <Smartphone size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">Microfone da consulta</p>
          <p className="text-xs text-slate-500">
            {fase === "captando" && "Captando e transcrevendo"}
            {fase === "pausado" && "Pausado pelo computador"}
            {fase === "conectando" && "Conectando…"}
            {fase === "permissao" && "Aguardando liberação do microfone"}
            {fase === "encerrado" && "Chamada encerrada"}
            {(fase === "invalido" || fase === "erro") && "Indisponível"}
          </p>
        </div>
        {aoVivo && (
          <span
            className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
            style={{
              background: ativo ? "#fee2e2" : "#f1f5f9",
              color: ativo ? "#b91c1c" : "#475569",
            }}
          >
            <span
              className={`h-2 w-2 rounded-full ${ativo ? "animate-pulse" : ""}`}
              style={{ background: ativo ? "#ef4444" : "#94a3b8" }}
            />
            {ativo ? "AO VIVO" : "PAUSADO"}
          </span>
        )}
      </header>

      {aoVivo && (
        <section className="mx-4 mt-4 rounded-3xl border border-white/80 bg-white/60 p-4 shadow-lg shadow-slate-200/40 backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600">Qualidade do áudio</span>
            <span className="font-semibold" style={{ color: q.cor }}>
              {q.rotulo}
            </span>
          </div>
          <div
            className="h-3 overflow-hidden rounded-full bg-slate-200/70"
            role="meter"
            aria-label="Nível do áudio"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={nivel}
          >
            <div
              className="h-full rounded-full transition-[width] duration-100"
              style={{ width: `${nivel}%`, background: q.cor }}
            />
          </div>
        </section>
      )}

      {aoVivo ? (
        <section className="mx-4 mb-3 mt-3 flex min-h-0 flex-1 flex-col rounded-3xl border border-white/80 bg-white/70 shadow-lg shadow-slate-200/40 backdrop-blur-xl">
          <div className="flex items-center justify-between px-4 pt-3 text-xs text-slate-500">
            <span>Transcrição em tempo real</span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Diminuir texto"
                className="rounded-lg px-2 py-1 hover:bg-slate-100"
                onClick={() => setFonte((f) => Math.max(16, f - 4))}
              >
                <Type size={14} />
              </button>
              <button
                type="button"
                aria-label="Aumentar texto"
                className="rounded-lg px-2 py-1 hover:bg-slate-100"
                onClick={() => setFonte((f) => Math.min(48, f + 4))}
              >
                <Type size={20} />
              </button>
            </span>
          </div>
          <div
            ref={textoRef}
            className="flex-1 overflow-y-auto px-4 pb-4 pt-2"
            style={{ fontSize: fonte, lineHeight: 1.35, maxHeight: "60dvh" }}
            aria-live="polite"
          >
            {finais.length === 0 && !parcial && (
              <p className="text-slate-400" style={{ fontSize: 16 }}>
                {ativo ? "Fale normalmente — o texto aparece aqui." : "A captação está pausada."}
              </p>
            )}
            {finais.map((t, i) => (
              <p key={i} className="mb-2 font-medium text-slate-800">
                {t}
              </p>
            ))}
            {parcial && <p className="italic text-slate-400">{parcial}</p>}
          </div>
        </section>
      ) : (
        <section className="mx-4 mt-10 flex flex-1 flex-col items-center text-center">
          {fase === "conectando" && <Loader2 className="animate-spin text-emerald-500" size={40} />}
          {fase === "permissao" && (
            <>
              <Mic size={44} className="text-emerald-500" />
              <p className="mt-4 max-w-xs text-base text-slate-600">
                {motivo || "Toque abaixo para liberar o microfone deste celular."}
              </p>
              <button
                type="button"
                onClick={() => {
                  setMotivo("");
                  void comecar();
                }}
                className="mt-6 rounded-2xl px-6 py-4 text-base font-semibold text-white shadow-lg"
                style={{ background: `linear-gradient(135deg, ${COR}cc, ${COR})` }}
              >
                Ativar microfone
              </button>
            </>
          )}
          {(fase === "encerrado" || fase === "invalido" || fase === "erro") && (
            <>
              <MicOff size={44} className="text-slate-400" />
              <p className="mt-4 max-w-xs text-base text-slate-600">
                {fase === "invalido"
                  ? "Este QR code não é válido ou já expirou."
                  : motivo || "A chamada foi encerrada."}
              </p>
              <p className="mt-2 max-w-xs text-sm text-slate-500">
                Para captar de novo, gere um novo QR code no computador.
              </p>
            </>
          )}
        </section>
      )}

      {(aoVivo || fase === "permissao") && (
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={encerrar}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-red-500 py-4 text-base font-semibold text-white shadow-lg shadow-red-200 active:bg-red-600"
          >
            <PhoneOff size={20} /> Encerrar captação
          </button>
        </div>
      )}
    </main>
  );
}
