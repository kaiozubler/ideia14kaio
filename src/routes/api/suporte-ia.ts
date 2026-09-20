import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import {
  DESCONTO_ANUAL,
  PLANOS_BASE,
  PRECO_MEDICO_ADICIONAL,
  PRECO_SECRETARIA_ADICIONAL,
  formatarPreco,
} from "@/lib/plans/config";

// Assistente de dúvidas do MediCopilot — hoje plugado no chat público da
// tela de planos (/planos), pensado desde já pra ser reaproveitado como o
// tira-dúvidas dos clientes DENTRO do app (logados), quando chegar a hora:
//
// - Não exige autenticação (funciona pra visitante anônimo), mas aceita um
//   `user_id` opcional só pra log/telemetria futura — nunca usa isso pra
//   acessar dado de conta nenhuma (esse assistente não tem tools, não lê
//   nem escreve nada além de conversar).
// - O prompt já deixa claro que ele NÃO é o Copiloto clínico (esse é outro
//   assistente, autenticado, usado por médico durante o atendimento) — só
//   tira dúvida sobre o produto/sistema em si.
// - A base de conhecimento (src/lib/base-conhecimento/buscar-sistema.server.ts)
//   já está com a busca pronta; só falta popular `base_conhecimento_sistema_itens`
//   (ver a migration) quando a base de conhecimento do produto for
//   estruturada — o assistente passa a citar esse conteúdo automaticamente,
//   sem precisar mexer em nada aqui.
// - Mesmo AI Gateway e mesma variável de ambiente (LOVABLE_API_KEY) que o
//   resto do app já usa (ver src/routes/api/assistente-ia.ts).

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3-flash-preview";

const BodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
  // Opcional, só pra telemetria/rate-limit por cliente logado no futuro — nunca
  // usado para buscar dados de conta (esse assistente não tem acesso a nada disso).
  user_id: z.string().uuid().nullable().optional(),
});

function montarContextoPlanos(): string {
  const linhas = PLANOS_BASE.map((p) => {
    const prefixo = p.personalizavel ? "a partir de " : "";
    return (
      `- ${p.nome}: ${prefixo}${formatarPreco(p.precoMensal)}/mês — ${p.medicos} médico(s), ` +
      `${p.secretarias} usuário(s) de gestão, ${p.copiloto} consultas de Copiloto IA, ` +
      `${p.whatsapp.toLocaleString("pt-BR")} conversas de WhatsApp, ` +
      `${p.video ? `${p.video.toLocaleString("pt-BR")} min de vídeo` : "sem vídeo incluído"}.`
    );
  }).join("\n");

  return (
    `TABELA DE PREÇOS ATUAL (use exatamente estes valores pra responder sobre planos e preços; ` +
    `nunca invente outro número):\n${linhas}\n\n` +
    `Também dá pra montar um plano personalizado na página /planos ("monte seu plano"): médico ` +
    `adicional +${formatarPreco(PRECO_MEDICO_ADICIONAL)}/mês, secretária/gestão adicional ` +
    `+${formatarPreco(PRECO_SECRETARIA_ADICIONAL)}/mês, e franquias extras de Copiloto/WhatsApp/vídeo ` +
    `em degraus, sempre somando em cima do plano escolhido como base. Pagamento anual tem ` +
    `${Math.round(DESCONTO_ANUAL * 100)}% de desconto sobre o mensal. No plano Enterprise, qualquer ` +
    `franquia pode ser marcada como "Personalizado" — nesse caso não há preço fixo, é cotação com o ` +
    `time comercial, e você deve orientar a pessoa a falar com o time (botão "Falar com nosso ` +
    `especialista" na própria página) em vez de estimar um valor.`
  );
}

const SYSTEM_SUPORTE = `Você é o assistente de dúvidas do MediCopilot — um chat de suporte PÚBLICO, usado tanto por quem ainda não é cliente (visitantes da página de planos) quanto, futuramente, por clientes já usando o sistema.
Fale sempre em português do Brasil, de forma curta, cordial e direta. Não se apresente a cada mensagem, só na primeira.

O QUE VOCÊ FAZ
- Explica como o MediCopilot funciona: planos, preços, franquias (Copiloto IA, WhatsApp, vídeo), como contratar, como trocar de plano, e as funcionalidades do sistema em linhas gerais (agenda, prontuário, receitas, solicitação de exames, telemedicina, WhatsApp com pacientes, etc.).
- Tira dúvidas gerais de uso e de faturamento.
- Quando não tiver certeza da resposta, diga isso claramente e ofereça encaminhar pro time humano pelo WhatsApp — nunca invente preço, funcionalidade ou política de cobrança.

O QUE VOCÊ NÃO FAZ
- Não dá orientação médica, diagnóstico ou conduta clínica de forma alguma — isso é papel do Copiloto clínico dentro do sistema, usado só por médicos autenticados durante o atendimento, não deste chat público. Se alguém trouxer uma dúvida clínica, explique isso e não responda ao mérito.
- Não tem acesso a dados de nenhuma conta, paciente ou clínica específica. Se pedirem algo que dependa disso ("qual meu plano atual", "cancele minha assinatura", "qual o CPF do meu paciente"), explique que este chat não acessa contas e direcione para a área logada do sistema ou para o suporte humano.
- Não executa ações (não agenda, não gera cobrança, não altera cadastro) — só conversa e orienta.

${montarContextoPlanos()}`;

const JANELA_MS = 10 * 60 * 1000;
const LIMITE_POR_JANELA = 20;
// Rate limit simples em memória — reseta a cada deploy/restart e não é
// compartilhado entre instâncias. Suficiente pra evitar abuso trivial por
// enquanto; se o tráfego crescer, migrar pra um contador no Supabase/Redis.
const contagemPorIp = new Map<string, number[]>();

function estaLimitado(ip: string): boolean {
  const agora = Date.now();
  const registros = (contagemPorIp.get(ip) ?? []).filter((t) => agora - t < JANELA_MS);
  registros.push(agora);
  contagemPorIp.set(ip, registros);
  return registros.length > LIMITE_POR_JANELA;
}

export const Route = createFileRoute("/api/suporte-ia")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = await request.json().catch(() => null);
        const body = BodySchema.safeParse(json);
        if (!body.success) return Response.json({ error: "payload inválido" }, { status: 400 });

        const ip =
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          request.headers.get("x-real-ip") ||
          "desconhecido";
        if (estaLimitado(ip)) {
          return Response.json(
            { error: "Muitas mensagens em pouco tempo. Espera um instante e tenta de novo." },
            { status: 429 },
          );
        }

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return Response.json({ error: "LOVABLE_API_KEY não configurada no servidor" }, { status: 500 });

        const history = body.data.messages;
        const ultimaMsgUsuario = [...history].reverse().find((m) => m.role === "user")?.content ?? "";

        const { montarContextoBaseSistema, MARCADOR_BASE_SISTEMA_USADA } = await import(
          "@/lib/base-conhecimento/buscar-sistema.server"
        );
        const contexto = await montarContextoBaseSistema(ultimaMsgUsuario);

        const resp = await fetch(GATEWAY_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Lovable-API-Key": apiKey,
            "X-Lovable-AIG-SDK": "raw",
          },
          body: JSON.stringify({
            model: MODEL,
            messages: [{ role: "system", content: `${SYSTEM_SUPORTE}${contexto.texto}` }, ...history],
          }),
        });

        if (!resp.ok) {
          const text = await resp.text();
          console.error(`[suporte-ia] AI gateway error ${resp.status}:`, text);
          const { mensagemErroGateway } = await import("@/lib/ai/erro-gateway");
          return Response.json({ error: mensagemErroGateway(resp.status) }, { status: resp.status });
        }

        const data = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
        const bruto = (data.choices?.[0]?.message?.content ?? "").trim();
        const baseUsada = bruto.includes(MARCADOR_BASE_SISTEMA_USADA);
        const reply = bruto.replace(MARCADOR_BASE_SISTEMA_USADA, "").trim();

        return Response.json({ reply, baseUsada });
      },
    },
  },
});
