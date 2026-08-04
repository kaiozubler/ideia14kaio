import { createFileRoute } from "@tanstack/react-router";

type Body = {
  pdf_base64?: string | null;
  filename?: string | null;
  observacao?: string | null;
};

const SYSTEM = `Você é um assistente clínico que estrutura protocolos assistenciais de acompanhamento contínuo.
A partir do documento e/ou das instruções recebidas, devolva APENAS um JSON válido no formato:
{
  "titulo": string,
  "cids": string[],
  "acoes": [
    {
      "tipo": "Consulta" | "Exame" | "Receita",
      "nome": string,
      "especialidade": string,
      "start_day": number,
      "frequency": number,
      "recurrent": boolean,
      "auto_restart": boolean,
      "descricao": string
    }
  ]
}
Regras: start_day é o número de dias após o início do protocolo; frequency é o intervalo em dias entre repetições.
Nunca inclua texto fora do JSON.`;

export const Route = createFileRoute("/api/protocolos/gerar-ia")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const key = process.env["LOVABLE_API_KEY"];
        if (!key) return new Response("LOVABLE_API_KEY não configurado", { status: 500 });

        const obs = (body.observacao || "").trim();
        if (!obs && !body.pdf_base64) {
          return new Response("Envie um PDF ou uma observação.", { status: 400 });
        }

        const content: Array<Record<string, unknown>> = [
          {
            type: "text",
            text: obs
              ? `Instruções do médico:\n${obs}`
              : "Estruture o protocolo assistencial descrito no documento anexo.",
          },
        ];
        if (body.pdf_base64) {
          content.push({
            type: "file",
            file: {
              filename: body.filename || "protocolo.pdf",
              file_data: `data:application/pdf;base64,${body.pdf_base64}`,
            },
          });
        }

        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
          body: JSON.stringify({
            model: "google/gemini-3.6-flash",
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content },
            ],
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          return new Response(`IA indisponível [${res.status}]: ${text}`, { status: res.status });
        }

        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = json.choices?.[0]?.message?.content || "";
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return new Response("Resposta da IA em formato inesperado.", { status: 502 });

        try {
          const parsed = JSON.parse(match[0]);
          return Response.json(parsed);
        } catch {
          return new Response("Não foi possível interpretar a resposta da IA.", { status: 502 });
        }
      },
    },
  },
});