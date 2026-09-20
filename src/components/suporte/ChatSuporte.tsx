import { useEffect, useRef, useState } from "react";
import { Bot, MessageCircleQuestion, Send, User, X } from "lucide-react";

import { WHATSAPP_COMERCIAL } from "@/lib/plans/config";

// Widget de chat flutuante do assistente de dúvidas do MediCopilot. Fica
// pronto pra ser reaproveitado em qualquer outra tela (inclusive dentro do
// app, logado) — não depende de nada específico da página de planos, só do
// endpoint público /api/suporte-ia (ver esse arquivo pro contexto de como o
// assistente é alimentado e como a base de conhecimento do produto entra
// nele quando for populada).

type Mensagem = { role: "user" | "assistant"; content: string };

const SAUDACAO_INICIAL: Mensagem = {
  role: "assistant",
  content:
    "Oi! Posso te ajudar com dúvidas sobre o MediCopilot — planos, preços, franquias ou como o sistema funciona. Pergunta à vontade 🙂",
};

export function ChatSuporte() {
  const [aberto, setAberto] = useState(false);
  const [mensagens, setMensagens] = useState<Mensagem[]>([SAUDACAO_INICIAL]);
  const [texto, setTexto] = useState("");
  const [carregando, setCarregando] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (aberto) fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensagens, aberto, carregando]);

  async function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || carregando) return;

    const historico = [...mensagens, { role: "user" as const, content: conteudo }];
    setMensagens(historico);
    setTexto("");
    setCarregando(true);

    try {
      const resp = await fetch("/api/suporte-ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historico }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.reply) {
        throw new Error(data?.error || "Falha ao responder");
      }
      setMensagens((atual) => [...atual, { role: "assistant", content: data.reply }]);
    } catch {
      setMensagens((atual) => [
        ...atual,
        {
          role: "assistant",
          content:
            "Não consegui responder agora. Tenta de novo em instantes ou fala direto com a gente pelo WhatsApp.",
        },
      ]);
    } finally {
      setCarregando(false);
    }
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  }

  return (
    <>
      {/* Painel do chat */}
      <div
        className={[
          "fixed bottom-24 right-4 z-50 flex w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden border border-white/80 bg-white/85 shadow-2xl shadow-slate-300/50 backdrop-blur-xl transition-all duration-300 md:right-6",
          aberto ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
        ].join(" ")}
        style={{ borderRadius: "28px", height: "min(32rem, 70vh)" }}
      >
        <div className="flex items-center justify-between border-b border-slate-200/60 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div
              style={{ borderRadius: "14px" }}
              className="flex h-9 w-9 items-center justify-center bg-gradient-to-br from-emerald-400 to-emerald-600"
            >
              <Bot className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">Assistente MediCopilot</p>
              <p className="text-xs text-slate-400">Dúvidas sobre o sistema</p>
            </div>
          </div>
          <button
            onClick={() => setAberto(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fechar chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {mensagens.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  m.role === "user" ? "bg-slate-700" : "bg-gradient-to-br from-emerald-400 to-emerald-600",
                ].join(" ")}
              >
                {m.role === "user" ? (
                  <User className="h-3.5 w-3.5 text-white" />
                ) : (
                  <Bot className="h-3.5 w-3.5 text-white" />
                )}
              </div>
              <div
                style={{ borderRadius: "16px" }}
                className={[
                  "max-w-[80%] px-3.5 py-2.5 text-sm leading-relaxed",
                  m.role === "user"
                    ? "bg-slate-800 text-white"
                    : "border border-slate-200/70 bg-white text-slate-700",
                ].join(" ")}
              >
                {m.content}
              </div>
            </div>
          ))}

          {carregando && (
            <div className="flex gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600">
                <Bot className="h-3.5 w-3.5 text-white" />
              </div>
              <div
                style={{ borderRadius: "16px" }}
                className="flex items-center gap-1 border border-slate-200/70 bg-white px-4 py-3"
              >
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" />
              </div>
            </div>
          )}
          <div ref={fimRef} />
        </div>

        <div className="border-t border-slate-200/60 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder="Digite sua dúvida..."
              rows={1}
              className="max-h-24 flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 outline-none focus:border-emerald-300"
            />
            <button
              onClick={enviar}
              disabled={!texto.trim() || carregando}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-emerald-500 to-emerald-600 text-white transition-colors hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-40"
              aria-label="Enviar"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            Assistente de IA, pode errar.{" "}
            <a
              href={`https://wa.me/${WHATSAPP_COMERCIAL}`}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-slate-600"
            >
              Falar com uma pessoa
            </a>
          </p>
        </div>
      </div>

      {/* Botão flutuante */}
      <button
        onClick={() => setAberto((v) => !v)}
        className="fixed bottom-6 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-2xl shadow-emerald-500/30 transition-transform hover:scale-105 md:right-6"
        aria-label={aberto ? "Fechar chat de dúvidas" : "Abrir chat de dúvidas"}
      >
        {aberto ? <X className="h-6 w-6" /> : <MessageCircleQuestion className="h-6 w-6" />}
      </button>
    </>
  );
}
