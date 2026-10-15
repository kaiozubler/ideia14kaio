import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";

export default defineTool({
  name: "list_protocols",
  title: "Consultar protocolos",
  description: "Lista os títulos e a situação de até 50 protocolos acessíveis ao usuário, sem publicar ou alterar protocolos.",
  inputSchema: { limit: z.number().int().min(1).max(50).default(20).describe("Máximo de protocolos retornados.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    const { data, error } = await supabaseForUser(ctx).from("protocolos").select("id,titulo,ativo").order("titulo").limit(limit);
    if (error) throw new ToolError("Não foi possível consultar os protocolos.");
    const protocols = (data ?? []).map(row => ({ ...row }));
    return { content: [{ type: "text", text: JSON.stringify(protocols) }], structuredContent: { protocols } };
  },
});