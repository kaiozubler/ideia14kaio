import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Usuário suspenso pelo Zubler CRM recebe 403 em qualquer /api/*. A ponte do
// CRM fica de fora: ela se autentica pelo CRM_BRIDGE_TOKEN, não por usuário.
const bloqueioMiddleware = createMiddleware().server(async ({ next, request }) => {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/public/crm/")) {
    const { respostaSeBloqueado } = await import("@/lib/auth/bloqueio.server");
    const bloqueado = await respostaSeBloqueado(request);
    if (bloqueado) return bloqueado;
  }
  return next();
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, bloqueioMiddleware],
}));
