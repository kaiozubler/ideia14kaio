import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/daily-room")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.DAILY_API_KEY;
        if (!apiKey) {
          return new Response("Missing DAILY_API_KEY", { status: 500 });
        }
        let body: { name?: string } = {};
        try {
          body = (await request.json()) as { name?: string };
        } catch {
          /* no body */
        }
        const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 2; // 2h
        const dgKey = process.env.DEEPGRAM_API_KEY;
        const payload: Record<string, unknown> = {
          privacy: "public",
          properties: {
            exp,
            enable_chat: true,
            enable_screenshare: true,
            enable_prejoin_ui: false,
            start_video_off: false,
            start_audio_off: false,
            ...(dgKey ? { enable_transcription: `deepgram:${dgKey}` } : {}),
          },
        };
        if (body.name) payload.name = body.name;
        const r = await fetch("https://api.daily.co/v1/rooms", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const text = await r.text();
        if (!r.ok) {
          return new Response(`Daily ${r.status}: ${text}`, { status: r.status });
        }
        const data = JSON.parse(text) as { url?: string; name?: string };
        const roomName = data.name || body.name;
        let token: string | undefined;
        if (roomName) {
          const tr = await fetch("https://api.daily.co/v1/meeting-tokens", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              properties: {
                room_name: roomName,
                exp,
                is_owner: true,
                user_name: "Profissional",
                enable_prejoin_ui: false,
                lang: "pt-BR",
                permissions: { hasPresence: true, canSend: true, canReceive: {}, canAdmin: true },
              },
            }),
          });
          const tokenText = await tr.text();
          if (!tr.ok) {
            return new Response(`Daily token ${tr.status}: ${tokenText}`, { status: tr.status });
          }
          token = (JSON.parse(tokenText) as { token?: string }).token;
        }
        return Response.json({ url: data.url, name: roomName, token, expires_at: exp });
      },
    },
  },
});