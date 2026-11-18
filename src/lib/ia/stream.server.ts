// Respostas das IAs em streaming (texto aparecendo enquanto o modelo escreve).
//
// Contrato com as telas: quem manda `stream: true` no corpo recebe
// `application/x-ndjson`, uma linha JSON por evento:
//   {"t":"delta","v":"trecho"}   — mais texto da resposta
//   {"t":"reset"}                — descarta o texto mostrado até aqui (o
//                                  assistente decidiu chamar uma ferramenta)
//   {"t":"done", ...}            — mesmo JSON que a rota devolveria sem stream
//   {"t":"error","status":n,"message":"..."}
// Sem `stream: true` as rotas continuam respondendo JSON como antes (WhatsApp,
// extensão, comandos de voz).

export type EventoStream =
  | { t: "delta"; v: string }
  | { t: "reset" }
  | ({ t: "done" } & Record<string, unknown>)
  | { t: "error"; status: number; message: string };

/**
 * Abre a resposta NDJSON na hora e roda `executar` escrevendo os eventos. Um
 * `Response` lançado (padrão das rotas para erro de gateway) vira evento de erro.
 */
export function respostaNdjson(
  executar: (enviar: (e: EventoStream) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let aberto = true;
      const enviar = (e: EventoStream) => {
        if (!aberto) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          aberto = false; // a tela fechou a conexão
        }
      };
      try {
        await executar(enviar);
      } catch (err) {
        if (err instanceof Response) {
          enviar({ t: "error", status: err.status, message: await err.text().catch(() => "") });
        } else {
          console.error("[ia-stream]", err);
          enviar({ t: "error", status: 500, message: err instanceof Error ? err.message : "Erro desconhecido" });
        }
      } finally {
        if (aberto) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Tira um marcador interno (ex.: [[BASE_LOCAL_USADA]]) do texto em streaming,
 * mesmo quando ele chega partido entre dois pedaços: segura no buffer só o
 * final que ainda pode ser o começo do marcador.
 */
export function filtroMarcador(marcador: string | null, emitir: (texto: string) => void) {
  let pendente = "";
  return {
    push(delta: string) {
      if (!marcador) {
        if (delta) emitir(delta);
        return;
      }
      pendente = (pendente + delta).replaceAll(marcador, "");
      let manter = 0;
      for (let n = Math.min(marcador.length - 1, pendente.length); n > 0; n--) {
        if (pendente.endsWith(marcador.slice(0, n))) {
          manter = n;
          break;
        }
      }
      const sai = pendente.slice(0, pendente.length - manter);
      pendente = pendente.slice(pendente.length - manter);
      if (sai) emitir(sai);
    },
    flush() {
      if (pendente) emitir(pendente);
      pendente = "";
    },
  };
}

/**
 * Junta um delta do formato OpenAI (chat.completion.chunk) na mensagem
 * acumulada. Genérico de propósito: textos são concatenados e campos extras
 * (ex.: assinatura de raciocínio do Gemini nas tool_calls) são preservados,
 * porque precisam voltar intactos na próxima chamada do loop de ferramentas.
 */
export function juntarDelta(alvo: Record<string, any>, delta: Record<string, any>) {
  for (const [chave, valor] of Object.entries(delta)) {
    if (valor === null || valor === undefined) continue;
    if (chave === "tool_calls" && Array.isArray(valor)) {
      const lista: Record<string, any>[] = (alvo.tool_calls ??= []);
      for (const parte of valor) {
        const i = typeof parte?.index === "number" ? parte.index : lista.length;
        const { index: _ignorado, ...resto } = parte ?? {};
        juntarDelta((lista[i] ??= {}), resto);
      }
    } else if (typeof valor === "string") {
      // Identificadores chegam uma vez só; texto chega em pedaços.
      if (["role", "id", "type", "name"].includes(chave) || typeof alvo[chave] !== "string") alvo[chave] = valor;
      else alvo[chave] += valor;
    } else if (Array.isArray(valor)) {
      alvo[chave] = Array.isArray(alvo[chave]) ? [...alvo[chave], ...valor] : [...valor];
    } else if (typeof valor === "object") {
      juntarDelta((alvo[chave] ??= {}), valor);
    } else {
      alvo[chave] = valor;
    }
  }
  return alvo;
}

/**
 * Lê o corpo SSE de uma chamada `stream: true` ao gateway (formato OpenAI),
 * chamando `aoTexto` a cada pedaço de conteúdo, e devolve a mensagem completa.
 */
export async function lerStreamGateway(
  res: Response,
  aoTexto: (delta: string) => void,
): Promise<Record<string, any>> {
  const mensagem: Record<string, any> = { role: "assistant", content: "" };
  if (!res.body) return mensagem;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const processarLinha = (linha: string) => {
    const l = linha.trim();
    if (!l.startsWith("data:")) return;
    const dado = l.slice(5).trim();
    if (!dado || dado === "[DONE]") return;
    let chunk: any;
    try {
      chunk = JSON.parse(dado);
    } catch {
      return;
    }
    if (chunk?.error) {
      throw new Response(`AI gateway error: ${JSON.stringify(chunk.error)}`, { status: 502 });
    }
    const delta = chunk?.choices?.[0]?.delta;
    if (!delta) return;
    juntarDelta(mensagem, delta);
    if (typeof delta.content === "string" && delta.content) aoTexto(delta.content);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let quebra: number;
    while ((quebra = buffer.indexOf("\n")) >= 0) {
      processarLinha(buffer.slice(0, quebra));
      buffer = buffer.slice(quebra + 1);
    }
  }
  buffer += decoder.decode();
  if (buffer) processarLinha(buffer);
  if (Array.isArray(mensagem.tool_calls)) mensagem.tool_calls = mensagem.tool_calls.filter(Boolean);
  return mensagem;
}
