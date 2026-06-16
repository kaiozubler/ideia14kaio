import { createFileRoute } from "@tanstack/react-router";

const DG = "https://api.deepgram.com/v1";

async function dg(path: string, apiKey: string, init?: RequestInit) {
  const res = await fetch(DG + path, {
    ...init,
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Response(`Deepgram ${res.status} em ${path}: ${text}`, {
      status: res.status,
    });
  }
  return text ? JSON.parse(text) : {};
}

export const Route = createFileRoute("/api/deepgram-token")({
  server: {
    handlers: {
      GET: async () => {
        const apiKey = process.env.DEEPGRAM_API_KEY;
        if (!apiKey) {
          return new Response("Missing DEEPGRAM_API_KEY", { status: 500 });
        }
        try {
          // 1) tenta o endpoint moderno auth/grant (precisa de Member+)
          try {
            const r = await fetch(DG + "/auth/grant", {
              method: "POST",
              headers: {
                Authorization: `Token ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ ttl_seconds: 60 }),
            });
            if (r.ok) {
              const data = (await r.json()) as {
                access_token?: string;
                expires_in?: number;
              };
              if (data.access_token) {
                return Response.json({
                  access_token: data.access_token,
                  expires_in: data.expires_in ?? 30,
                  mode: "grant",
                });
              }
            }
          } catch {
            /* fall through */
          }

          // 2) Fallback: cria uma chave temporária com escopo usage:write
          const projects = (await dg("/projects", apiKey)) as {
            projects?: { project_id: string }[];
          };
          const projectId = projects.projects?.[0]?.project_id;
          if (!projectId) {
            return new Response("Deepgram: nenhum projeto encontrado", {
              status: 500,
            });
          }
          const key = (await dg(`/projects/${projectId}/keys`, apiKey, {
            method: "POST",
            body: JSON.stringify({
              comment: "ephemeral-medicopilot",
              scopes: ["usage:write"],
              time_to_live_in_seconds: 60,
            }),
          })) as { key?: string };
          if (!key.key) {
            return new Response("Deepgram: falha ao criar chave temporária", {
              status: 500,
            });
          }
          return Response.json({
            access_token: key.key,
            expires_in: 60,
            mode: "ephemeral_key",
          });
        } catch (err) {
          if (err instanceof Response) return err;
          const msg = err instanceof Error ? err.message : "Unknown error";
          return new Response(msg, { status: 500 });
        }
      },
    },
  },
});