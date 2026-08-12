import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

type ChatMessage = { role: "user" | "assistant"; content: string };

type Body = {
  messages?: ChatMessage[];
  contexto?: {
    foco_id?: string | null;
    nodes?: any[];
    edges?: any[];
    correlacoes?: any[];
  } | null;
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const SYSTEM = `Você é uma IA clínica especializada em ANÁLISE DE HISTÓRICO FAMILIAR, em português do Brasil.

Você recebe o grafo familiar exibido na tela (pessoas com seus IDs internos, sexo, data de nascimento e CIDs
registrados), os vínculos de parentesco entre elas (com indicação de consanguinidade) e, quando disponível,
dados clínicos e o resumo do prontuário de cada paciente vinculado.

SUAS TAREFAS
- Responder dúvidas do médico sobre a família e sobre cada paciente vinculado, usando SOMENTE os dados recebidos.
- Destacar correlações entre parentes (mesmos CIDs ou condições da mesma linha diagnóstica), com atenção especial
  a vínculos consanguíneos, que têm relevância genética.
- Apontar pontos de atenção e sugerir rastreios/investigações possíveis, sempre como possibilidade a ser avaliada
  pelo médico — nunca como conduta obrigatória e nunca como diagnóstico fechado.

REGRAS
- NUNCA invente pacientes, CIDs, datas ou parentescos que não estejam no contexto.
- Se faltar informação, diga claramente o que falta.
- Ao citar uma pessoa, use o nome. Cite o ID apenas se o médico pedir.
- Respostas curtas, objetivas e em texto puro (sem markdown pesado, sem cercas de código).`;

async function contextoClinico(request: Request, ids: string[]) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !ids.length) return null;
  try {
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );
    const [pacientes, resumos] = await Promise.all([
      supabase
        .from("pacientes")
        .select("paciente_id,name,sexo,data_nascimento,cids,dados_clinicos,info_complementar,parentescos")
        .in("paciente_id", ids),
      supabase.from("resumo_prontuario").select("paciente_id,resumo").in("paciente_id", ids),
    ]);
    const mapaResumo = new Map<string, string>();
    (resumos.data ?? []).forEach((r: any) => mapaResumo.set(r.paciente_id, r.resumo || ""));
    return (pacientes.data ?? []).map((p: any) => ({
      id: p.paciente_id,
      nome: p.name,
      sexo: p.sexo,
      data_nascimento: p.data_nascimento,
      cids: p.cids,
      dados_clinicos: p.dados_clinicos,
      info_complementar: p.info_complementar,
      parentescos: p.parentescos,
      resumo_prontuario: mapaResumo.get(p.paciente_id) || "",
    }));
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/mapa-familiar-ia")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return Response.json({ error: "missing_api_key" }, { status: 500 });

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return Response.json({ error: "invalid_json" }, { status: 400 });
        }

        const ctx = body.contexto ?? {};
        const nodes = Array.isArray(ctx.nodes) ? ctx.nodes.slice(0, 60) : [];
        const ids = nodes.map((n: any) => String(n?.id || "")).filter(Boolean);
        const clinico = await contextoClinico(request, ids);

        const contextoJson = JSON.stringify(
          {
            paciente_foco_id: ctx.foco_id ?? null,
            pessoas: nodes,
            vinculos: Array.isArray(ctx.edges) ? ctx.edges.slice(0, 200) : [],
            correlacoes_de_cid_detectadas: Array.isArray(ctx.correlacoes) ? ctx.correlacoes : [],
            dados_clinicos_por_paciente: clinico ?? "indisponível",
          },
          null,
          2,
        );

        const messages = [
          { role: "system", content: SYSTEM + "\n\n=== CONTEXTO DO MAPA FAMILIAR (JSON) ===\n" + contextoJson },
          ...(Array.isArray(body.messages) ? body.messages : [])
            .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .slice(-20),
        ];

        try {
          const res = await fetch(GATEWAY_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Lovable-API-Key": apiKey,
              "X-Lovable-AIG-SDK": "raw",
            },
            body: JSON.stringify({ model: MODEL, messages }),
          });
          if (!res.ok) {
            const t = await res.text();
            console.error("[mapa-familiar-ia] gateway", res.status, t);
            return Response.json({ error: "gateway_error", status: res.status }, { status: 502 });
          }
          const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
          return Response.json({ reply: data.choices?.[0]?.message?.content ?? "" });
        } catch (err) {
          console.error("[mapa-familiar-ia]", err);
          return Response.json({ error: "unexpected" }, { status: 500 });
        }
      },
    },
  },
});
