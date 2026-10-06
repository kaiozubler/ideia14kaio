import { createFileRoute } from "@tanstack/react-router";
import { admin, normalizarCodigo } from "@/lib/documentos/verificacao.server";

// Identidade visual da clínica para a página /v/<codigo> ANTES da
// autenticação — só nome, cor e logo; nenhum dado do paciente ou do documento.
export const Route = createFileRoute("/api/public/documentos/identidade")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const codigo = normalizarCodigo(new URL(request.url).searchParams.get("codigo"));
        if (!codigo) return Response.json({ error: "not_found" }, { status: 404 });
        try {
          const sb = await admin();
          const { data: reg, error } = await sb
            .from("documentos_verificacao")
            .select("id_medico, status, clinica")
            .eq("codigo", codigo)
            .maybeSingle();
          if (error) throw error;
          if (!reg) return Response.json({ error: "not_found" }, { status: 404 });
          const { data: cfg } = await sb
            .from("medico_clinica_config")
            .select("logo_data_url")
            .eq("id_medico", reg.id_medico)
            .maybeSingle();
          return Response.json(
            {
              status: reg.status,
              clinica: {
                nome: reg.clinica?.nome ?? "Clínica",
                cor: reg.clinica?.cor ?? null,
                logo: cfg?.logo_data_url ?? null,
              },
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          console.error("[public/documentos/identidade]", e);
          return Response.json({ error: "server_error" }, { status: 500 });
        }
      },
    },
  },
});
