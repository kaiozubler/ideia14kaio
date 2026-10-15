import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_appointments",
  title: "Consultar agenda",
  description: "Consulta até 50 agendamentos de um intervalo, respeitando as permissões da clínica do usuário.",
  inputSchema: {
    start: z.string().datetime({ offset: true }).describe("Início inclusivo em ISO 8601 com fuso horário."),
    end: z.string().datetime({ offset: true }).describe("Fim exclusivo em ISO 8601 com fuso horário."),
    limit: z.number().int().min(1).max(50).default(20).describe("Máximo de agendamentos retornados."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ start, end, limit }, ctx) => {
    if (Date.parse(end) <= Date.parse(start)) throw new ToolError("O fim deve ser posterior ao início.");
    const { data, error } = await supabaseForUser(ctx).from("agendamentos")
      .select("id,paciente_nome,data_hora,duracao_min,status,modalidade")
      .gte("data_hora", start).lt("data_hora", end).order("data_hora").limit(limit);
    if (error) throw new ToolError("Não foi possível consultar a agenda.");
    const appointments = (data ?? []).map(row => ({ ...row }));
    return { content: [{ type: "text", text: JSON.stringify(appointments) }], structuredContent: { appointments } };
  },
});