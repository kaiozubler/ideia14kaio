import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/daily-room")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env["DAILY_API_KEY"];
        if (!apiKey) {
          console.error("[daily-room] DAILY_API_KEY não está disponível neste ambiente");
          return Response.json(
            {
              error: "VIDEO_SERVICE_UNAVAILABLE",
              message: "A videochamada não está disponível neste ambiente.",
            },
            { status: 503 },
          );
        }
        let body: { name?: string; exp?: number; createOnly?: boolean } = {};
        try {
          body = (await request.json()) as {
            name?: string;
            exp?: number;
            createOnly?: boolean;
          };
        } catch {
          /* no body */
        }
        // Por padrão a sala expira em 2h (chamada iniciada agora). Quando a
        // sala é pré-criada no momento do agendamento (consulta pode ser
        // dias/semanas no futuro), o chamador informa `exp` calculado a
        // partir da data/hora da consulta (+ duração + margem).
        const exp = body.exp || Math.floor(Date.now() / 1000) + 60 * 60 * 2;
        const dgKey = process.env["DEEPGRAM_API_KEY"];
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

        // Se um nome de sala foi informado, primeiro verifica se ela já existe
        // (ex.: usuário recarregou a página ou entrou na consulta mais de uma vez).
        // Isso evita o erro "a room named X already exists" e reaproveita a sala.
        let data: { url?: string; name?: string } | null = null;
        if (body.name) {
          const existing = await fetch(
            `https://api.daily.co/v1/rooms/${encodeURIComponent(body.name)}`,
            { headers: { Authorization: `Bearer ${apiKey}` } }
          );
          if (existing.ok) {
            data = (await existing.json()) as { url?: string; name?: string };
          }
        }

        if (!data) {
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
            // Condição de corrida: a sala foi criada entre a checagem acima e este POST.
            // Nesse caso, busca a sala existente em vez de retornar erro.
            const alreadyExists =
              r.status === 400 && /already exists/i.test(text) && Boolean(body.name);
            if (alreadyExists) {
              const existingRoomName = body.name;
              if (!existingRoomName) {
                return new Response("Nome da sala ausente", { status: 400 });
              }
              const existing = await fetch(
                `https://api.daily.co/v1/rooms/${encodeURIComponent(existingRoomName)}`,
                { headers: { Authorization: `Bearer ${apiKey}` } }
              );
              if (existing.ok) {
                data = (await existing.json()) as { url?: string; name?: string };
              }
            }
            if (!data) {
              return new Response(`Daily ${r.status}: ${text}`, { status: r.status });
            }
          } else {
            data = JSON.parse(text) as { url?: string; name?: string };
          }
        }
        const roomName = data.name || body.name;
        // Modo "createOnly": usado ao pré-criar a sala no agendamento, antes
        // de haver um médico logado na chamada. Não gera token de host —
        // isso é feito depois, quando a chamada é de fato aberta.
        if (body.createOnly) {
          return Response.json({ url: data.url, name: roomName, expires_at: exp });
        }
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