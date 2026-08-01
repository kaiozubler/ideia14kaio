// Shared request auth helper for the BRY routes.
export async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.auth.getUser(auth.slice(7));
  return data.user?.id ?? null;
}

export function bryErrorResponse(scope: string, err: unknown) {
  const anyErr = err as { name?: string; status?: number; message?: string };
  if (anyErr?.name === "BryError") {
    console.error(`[bry:${scope}]`, anyErr.message, (err as { details?: unknown }).details);
    return Response.json(
      { error: "bry_error", message: anyErr.message },
      { status: anyErr.status ?? 502 },
    );
  }
  console.error(`[bry:${scope}]`, err);
  return Response.json({ error: "internal_error", message: String(err) }, { status: 500 });
}