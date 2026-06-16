import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/deepgram-token")({
  server: {
    handlers: {
      GET: async () => {
        const apiKey = process.env.DEEPGRAM_API_KEY;
        if (!apiKey) {
          return new Response("Missing DEEPGRAM_API_KEY", { status: 500 });
        }
        try {
          const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
            method: "POST",
            headers: {
              Authorization: `Token ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ ttl_seconds: 60 }),
          });
          if (!res.ok) {
            const text = await res.text();
            return new Response(`Deepgram auth error ${res.status}: ${text}`, {
              status: res.status,
            });
          }
          const data = (await res.json()) as {
            access_token?: string;
            expires_in?: number;
          };
          if (!data.access_token) {
            return new Response("Deepgram returned no token", { status: 502 });
          }
          return Response.json({
            access_token: data.access_token,
            expires_in: data.expires_in ?? 30,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});