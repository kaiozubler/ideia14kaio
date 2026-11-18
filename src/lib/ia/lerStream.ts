// Lado da tela do streaming das IAs (contrato em src/lib/ia/stream.server.ts).
// Chama `aoTexto(textoAcumulado)` a cada pedaço e devolve o JSON final, o mesmo
// que a rota devolveria sem stream. Se a resposta vier como JSON comum, devolve ele.
export async function lerStreamIA<T = Record<string, unknown>>(
  res: Response,
  aoTexto?: (texto: string) => void,
): Promise<T> {
  const tipo = res.headers.get("content-type") || "";
  if (!tipo.includes("ndjson") || !res.body) return (await res.json()) as T;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let texto = "";
  let fim: Record<string, unknown> | null = null;

  const linha = (l: string) => {
    const bruta = l.trim();
    if (!bruta) return;
    let e: { t?: string; v?: string; message?: string; status?: number } & Record<string, unknown>;
    try {
      e = JSON.parse(bruta);
    } catch {
      return;
    }
    if (e.t === "delta") {
      texto += e.v ?? "";
      aoTexto?.(texto);
    } else if (e.t === "reset") {
      texto = "";
      aoTexto?.("");
    } else if (e.t === "done") {
      const { t: _t, ...resto } = e;
      fim = resto;
    } else if (e.t === "error") {
      throw new Error(e.message || `Erro ${e.status ?? ""}`.trim());
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf("\n")) >= 0) {
      linha(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
    }
  }
  buffer += decoder.decode();
  linha(buffer);
  if (!fim) throw new Error("A resposta da IA foi interrompida. Tente de novo.");
  return fim as T;
}
