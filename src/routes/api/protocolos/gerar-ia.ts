import { createFileRoute } from "@tanstack/react-router";

type Body = {
  pdf_base64?: string | null;
  filename?: string | null;
  observacao?: string | null;
};

const SYSTEM = `Você é um assistente clínico que estrutura protocolos assistenciais de acompanhamento contínuo, incluindo eventuais ramificações por resultado de exame (ex: "se o exame X vier alterado, ajustar medicação e repetir em 30 dias; se normal, monitorar e repetir em 60 dias").
A partir do documento e/ou das instruções recebidas, devolva APENAS um JSON válido no formato:
{
  "titulo": string,
  "cids": string[],
  "acoes": [
    {
      "temp_id": string,                 // identificador único dentro deste JSON, ex "a1"
      "tipo": "Consulta" | "Exame" | "Receita",
      "nome": string,
      "especialidade": string,
      "start_day": number,
      "frequency": number,
      "recurrent": boolean,
      "auto_restart": boolean,
      "descricao": string,
      "regra_pai_temp_id": string | null // preenchido quando esta ação só existe dentro de um ramo (ver "regras")
    }
  ],
  "regras": [
    {
      "temp_id": string,
      "acao_gatilho_temp_id": string,    // temp_id da ação de Exame cujo resultado é avaliado
      "descricao": string,
      "condicao": {
        "campo": "numero" | "texto",
        "operador": "maior_que" | "menor_que" | "entre" | "igual" | "contem",
        "numero"?: number,
        "numero_min"?: number,
        "numero_max"?: number,
        "texto"?: string
      } | null,                          // null apenas quando is_default = true
      "ordem": number,
      "is_default": boolean,             // true = caso padrão, quando nenhuma outra condição bate
      "repete_gatilho_apos_dias": number | null // preencha para "repetir o mesmo exame a cada N dias" dentro deste ramo
    }
  ]
}
Regras de preenchimento:
- start_day é relativo ao início do protocolo para ações sem regra_pai_temp_id, e relativo à data do resultado que disparou a regra para ações COM regra_pai_temp_id (que geralmente devem ter start_day = 0).
- Toda ação com regra_pai_temp_id preenchido deve corresponder a uma "regras[].temp_id" existente.
- Toda ação de Exame que tem ramificação deve ter, entre suas regras associadas, pelo menos uma com is_default = true.
- Para modelar "repetir o mesmo exame a cada N dias" dentro de um ramo, NÃO crie uma ação nova duplicando o exame — em vez disso preencha "repete_gatilho_apos_dias" na regra do ramo.
- Ações sem nenhuma ramificação continuam simplesmente sem "regra_pai_temp_id" (ou null) e sem nenhuma regra associada — comportamento idêntico ao formato anterior.
- Nunca inclua texto fora do JSON.`;

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