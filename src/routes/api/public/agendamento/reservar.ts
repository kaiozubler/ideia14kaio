import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { cpfValido, nomeValido, telefoneValido } from "@/lib/agendamento/disponibilidade";

// Reserva feita pelo paciente no link /agendar/{token}. O horário enviado pelo
// navegador é conferido contra a grade calculada aqui, e o conflito é decidido
// em agenda_publica_reservar, sob lock.
const BodySchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  medico_id: z.string().uuid(),
  inicio: z.string().datetime(),
  nome: z.string().trim().refine(nomeValido),
  cpf: z.string().trim().max(20).refine(cpfValido),
  telefone: z.string().trim().refine(telefoneValido),
  email: z.union([z.string().trim().email().max(255), z.literal("")]).optional(),
});

const STATUS_ERRO: Record<string, number> = {
  link_indisponivel: 404,
  horario_indisponivel: 409,
  horario_ocupado: 409,
  limite_cpf: 429,
  muitas_tentativas: 429,
};

async function hashIp(ip: string | null) {
  if (!ip) return null;
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/public/agendamento/reservar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }
        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
        const body = parsed.data;
        try {
          const { configDoLink, horariosDoMedico } =
            await import("@/lib/agendamento/publico.server");
          const { ipDaRequisicao } = await import("@/lib/documentos/verificacao.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const cfg = await configDoLink(body.token);
          if (!cfg) return Response.json({ error: "link_indisponivel" }, { status: 404 });

          const dias = await horariosDoMedico(cfg, body.medico_id);
          const instante = new Date(body.inicio).getTime();
          const naGrade = dias?.some((d) =>
            d.horarios.some((h) => new Date(h.inicio).getTime() === instante),
          );
          if (!naGrade) return Response.json({ error: "horario_indisponivel" }, { status: 409 });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabaseAdmin as any).rpc("agenda_publica_reservar", {
            p_token: body.token,
            p_medico_id: body.medico_id,
            p_inicio: new Date(instante).toISOString(),
            p_nome: body.nome,
            p_cpf: body.cpf,
            p_telefone: body.telefone,
            p_email: body.email || null,
            p_ip_hash: await hashIp(ipDaRequisicao(request)),
          });
          if (error) throw error;
          if (data?.erro)
            return Response.json({ error: data.erro }, { status: STATUS_ERRO[data.erro] ?? 400 });
          return Response.json({ ok: true });
        } catch (e) {
          console.error("[agendamento/reservar]", e);
          return Response.json({ error: "server_error" }, { status: 500 });
        }
      },
    },
  },
});
