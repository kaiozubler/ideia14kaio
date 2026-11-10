import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";
import { GEMINI_TTS_MODEL } from "@/lib/ia/provedor.server";
import { corpoGeminiFala, normalizarParaFala } from "@/lib/ia/fala";

// Voz das respostas do Assistente IA (botão de microfone e modo ao vivo).
// Cada chamada gasta créditos do gateway Lovable, que são os mesmos do
// copiloto e dos chats: exige login, aceita só um trecho curto por vez e tem
// um limite por usuário. O áudio volta inteiro (WAV 24 kHz mono), sem
// streaming — o gateway não entrega em partes —, por isso o navegador corta a
// resposta em frases e pede várias em paralelo.

const URL_FALA = "https://ai.gateway.lovable.dev/v1/audio/speech";
const LIMITE_POR_MINUTO = 40;
const chamadasPorUsuario = new Map<string, number[]>();

function dentroDoLimite(userId: string): boolean {
  const agora = Date.now();
  const recentes = (chamadasPorUsuario.get(userId) || []).filter((t) => agora - t < 60_000);
  if (recentes.length >= LIMITE_POR_MINUTO) {
    chamadasPorUsuario.set(userId, recentes);
    return false;
  }
  recentes.push(agora);
  chamadasPorUsuario.set(userId, recentes);
  return true;
}

export const Route = createFileRoute("/api/ia/fala")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return new Response("Não autenticado", { status: 401 });

        let body: { texto?: unknown };
        try {
          body = (await request.json()) as { texto?: unknown };
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const texto = normalizarParaFala(typeof body.texto === "string" ? body.texto : "");
        if (!texto) return new Response("Texto vazio", { status: 400 });

        if (!dentroDoLimite(userId)) {
          return Response.json({ error: "limite_fala" }, { status: 429 });
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("LOVABLE_API_KEY ausente", { status: 500 });

        const res = await fetch(URL_FALA, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
          body: JSON.stringify(corpoGeminiFala(GEMINI_TTS_MODEL, texto)),
        });
        if (!res.ok || !res.body) {
          const detalhe = (await res.text().catch(() => "")).slice(0, 300);
          console.warn("[ia/fala] gateway recusou:", res.status, detalhe);
          // 402/429 do gateway = créditos ou limite do workspace; o app só
          // deixa de falar e mantém a resposta em texto.
          return Response.json({ error: "voz_indisponivel", status: res.status }, { status: 502 });
        }
        return new Response(res.body, {
          status: 200,
          headers: {
            "Content-Type": res.headers.get("content-type") || "audio/wav",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
