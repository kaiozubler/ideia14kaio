import { createFileRoute } from "@tanstack/react-router";

const GRAPH_BASE = "https://graph.facebook.com/v20.0";

const MENSAGEM_PADRAO = (nome: string) =>
  `Olá${nome ? ", " + nome : ""}! Aqui é o consultório 👋\n` +
  `Se quiser marcar uma consulta ou retorno, é só me responder por aqui que eu já te ajudo a agendar o melhor horário.`;

type Body = {
  id_medico?: string;
  paciente_id?: string;
};

export const Route = createFileRoute("/api/whatsapp-convite")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const medicoId = body.id_medico;
        const pacienteId = body.paciente_id;
        if (!medicoId || !pacienteId) {
          return Response.json({ enviado: false, motivo: "faltam_dados" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: config } = await supabaseAdmin
          .from("medico_whatsapp_config")
          .select("phone_number_id,agendamento_ativo,mensagem_convite")
          .eq("id_medico", medicoId)
          .maybeSingle();
        if (!config?.phone_number_id) {
          return Response.json(
            { enviado: false, motivo: "sem_config", instrucao: "Configure o número de WhatsApp do consultório antes de convidar pacientes." },
            { status: 400 },
          );
        }
        if (!config.agendamento_ativo) {
          return Response.json({ enviado: false, motivo: "desativado" }, { status: 400 });
        }

        const { data: paciente } = await supabaseAdmin
          .from("pacientes")
          .select("name,telefone")
          .eq("paciente_id", pacienteId)
          .eq("user_id", medicoId)
          .maybeSingle();
        if (!paciente?.telefone) {
          return Response.json({ enviado: false, motivo: "sem_telefone" }, { status: 400 });
        }

        const token = process.env.WHATSAPP_ACCESS_TOKEN;
        if (!token) {
          return Response.json({ enviado: false, motivo: "sem_token_configurado" }, { status: 500 });
        }

        const texto = (config.mensagem_convite && config.mensagem_convite.trim()) || MENSAGEM_PADRAO(paciente.name || "");
        try {
          const res = await fetch(`${GRAPH_BASE}/${config.phone_number_id}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: paciente.telefone.replace(/\D/g, ""),
              type: "text",
              text: { body: texto },
            }),
          });
          if (!res.ok) {
            const errText = await res.text();
            return Response.json({ enviado: false, motivo: "falha_envio", detalhe: errText }, { status: 502 });
          }
        } catch (e) {
          return Response.json({ enviado: false, motivo: "erro_rede" }, { status: 502 });
        }

        // Registra a conversa já com o convite, para dar contexto quando o paciente responder.
        const telefoneDigits = paciente.telefone.replace(/\D/g, "");
        const { data: existente } = await supabaseAdmin
          .from("whatsapp_conversas")
          .select("id,mensagens")
          .eq("id_medico", medicoId)
          .eq("telefone", telefoneDigits)
          .maybeSingle();
        const mensagens = [...(Array.isArray(existente?.mensagens) ? existente!.mensagens : []), { role: "assistant", content: texto }];
        if (existente) {
          await supabaseAdmin
            .from("whatsapp_conversas")
            .update({ mensagens, ultima_interacao: new Date().toISOString(), paciente_id: pacienteId })
            .eq("id", existente.id);
        } else {
          await supabaseAdmin
            .from("whatsapp_conversas")
            .insert({ id_medico: medicoId, telefone: telefoneDigits, paciente_id: pacienteId, mensagens });
        }

        return Response.json({ enviado: true });
      },
    },
  },
});
