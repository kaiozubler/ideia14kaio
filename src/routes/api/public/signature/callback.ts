import { createFileRoute } from "@tanstack/react-router";
import { SignatureService } from "@/lib/signature/SignatureService";
import { SignatureError } from "@/lib/signature/errors";

// Public endpoint — IntegraICP posts here after user completes auth on the provider.
// The provider does not carry our Supabase session; we rely on the PKCE
// session row (looked up by `session` query param or `requestId`) to identify
// the doctor. No PII is returned; a redirect is issued to the app.

function errorResponse(err: unknown) {
  if (err instanceof SignatureError) {
    return Response.json({ error: err.code, message: err.message }, { status: err.status });
  }
  console.error("[signature/callback]", err);
  return Response.json({ error: "internal_error" }, { status: 500 });
}

async function handle(params: { credentialId?: string; sessionId?: string; requestId?: string }) {
  if (!params.credentialId) {
    return Response.json({ error: "credential_id_required" }, { status: 400 });
  }
  await SignatureService.handleCallback({
    credentialId: params.credentialId,
    sessionId: params.sessionId,
    requestId: params.requestId,
  });
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/public/signature/callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const url = new URL(request.url);
          let body: Record<string, unknown> = {};
          const ct = request.headers.get("content-type") ?? "";
          try {
            if (ct.includes("application/json")) body = await request.json();
            else if (ct.includes("form")) {
              const fd = await request.formData();
              body = Object.fromEntries(fd.entries());
            }
          } catch { /* body optional */ }

          return await handle({
            credentialId:
              (body.credentialId as string) ??
              (body.credential_id as string) ??
              url.searchParams.get("credentialId") ??
              url.searchParams.get("credential_id") ??
              undefined,
            sessionId:
              (body.session as string) ??
              url.searchParams.get("session") ??
              undefined,
            requestId:
              (body.requestId as string) ??
              (body.request_id as string) ??
              url.searchParams.get("requestId") ??
              url.searchParams.get("request_id") ??
              undefined,
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
      GET: async ({ request }) => {
        // Some providers redirect the browser back with query params only.
        try {
          const url = new URL(request.url);
          const credentialId =
            url.searchParams.get("credentialId") ??
            url.searchParams.get("credential_id") ??
            undefined;
          const sessionId = url.searchParams.get("session") ?? undefined;
          const requestId =
            url.searchParams.get("requestId") ??
            url.searchParams.get("request_id") ??
            undefined;

          if (credentialId) {
            await SignatureService.handleCallback({ credentialId, sessionId, requestId });
          }
          // Redirect back to the app team screen with a status flag.
          return new Response(null, {
            status: 302,
            headers: {
              Location: `/medicopilot.html#certificado=${credentialId ? "ok" : "erro"}`,
            },
          });
        } catch (err) {
          return errorResponse(err);
        }
      },
    },
  },
});