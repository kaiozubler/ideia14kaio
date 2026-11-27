import { createFileRoute } from "@tanstack/react-router";
import { SALA_RE } from "@/lib/video/consulta";

// Página pública /consulta/<sala>: devolve a URL da sala do Daily e um token
// de participante (nunca de dono) válido até a sala expirar. Sem sessão: quem
// tem o nome da sala já podia entrar pelo link do Daily (salas públicas).
const SEM_CACHE = { "Cache-Control": "no-store" };

export const Route = createFileRoute("/api/public/consulta/sala")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const sala = new URL(request.url).searchParams.get("sala") || "";
        if (!SALA_RE.test(sala))
          return Response.json({ error: "not_found" }, { status: 404, headers: SEM_CACHE });
        const apiKey = process.env["DAILY_API_KEY"];
        if (!apiKey)
          return Response.json({ error: "indisponivel" }, { status: 503, headers: SEM_CACHE });
        try {
          const r = await fetch(`https://api.daily.co/v1/rooms/${encodeURIComponent(sala)}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          if (r.status === 404)
            return Response.json({ error: "not_found" }, { status: 404, headers: SEM_CACHE });
          if (!r.ok) {
            console.error("[consulta/sala] Daily", r.status, await r.text());
            return Response.json({ error: "server_error" }, { status: 502, headers: SEM_CACHE });
          }
          const room = (await r.json()) as { url?: string; config?: { exp?: number } };
          const exp = room.config?.exp;
          const agora = Math.floor(Date.now() / 1000);
          if (exp && exp <= agora)
            return Response.json({ error: "expirada" }, { status: 410, headers: SEM_CACHE });

          const tr = await fetch("https://api.daily.co/v1/meeting-tokens", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              properties: {
                room_name: sala,
                exp: exp || agora + 60 * 60 * 2,
                is_owner: false,
                lang: "pt-BR",
                enable_prejoin_ui: true,
              },
            }),
          });
          if (!tr.ok) {
            console.error("[consulta/sala] token", tr.status, await tr.text());
            return Response.json({ error: "server_error" }, { status: 502, headers: SEM_CACHE });
          }
          const { token } = (await tr.json()) as { token?: string };
          return Response.json({ url: room.url, token }, { headers: SEM_CACHE });
        } catch (e) {
          console.error("[consulta/sala]", e);
          return Response.json({ error: "server_error" }, { status: 500, headers: SEM_CACHE });
        }
      },
    },
  },
});
