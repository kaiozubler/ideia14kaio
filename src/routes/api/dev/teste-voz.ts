// TEMPORÁRIO — diagnóstico da voz pelo gateway Lovable. A chave gerenciada só
// existe no servidor publicado, então a rota roda lá, exige login e usa a
// chave apenas de process.env, sem gravá-la. Remover depois do teste.
import { createFileRoute } from "@tanstack/react-router";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";

const URL_FALA = "https://ai.gateway.lovable.dev/v1/audio/speech";

async function medir(corpo: Record<string, unknown>, apiKey: string) {
  const t0 = performance.now();
  const res = await fetch(URL_FALA, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify(corpo),
  });
  const tCabecalho = performance.now() - t0;
  const tipo = res.headers.get("content-type");
  if (!res.ok || !res.body) {
    return { corpo, status: res.status, tipo, erro: (await res.text()).slice(0, 600) };
  }
  const reader = res.body.getReader();
  const pedacos: Uint8Array[] = [];
  const marcas: number[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pedacos.push(value);
    marcas.push(Math.round(performance.now() - t0));
  }
  const total = pedacos.reduce((n, p) => n + p.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const p of pedacos) {
    bytes.set(p, o);
    o += p.length;
  }
  return {
    corpo,
    status: res.status,
    tipo,
    cabecalhos: Object.fromEntries([...res.headers].filter(([k]) => !/cookie|auth|key/i.test(k))),
    ms_cabecalho: Math.round(tCabecalho),
    ms_primeiro_pedaco: marcas[0] ?? null,
    ms_total: marcas.at(-1) ?? null,
    pedacos: pedacos.length,
    bytes: total,
    inicio_hex: Buffer.from(bytes.slice(0, 16)).toString("hex"),
    inicio_texto: Buffer.from(bytes.slice(0, 200)).toString("utf8").replace(/[^\x20-\x7e]/g, "."),
    audio_base64: Buffer.from(bytes).toString("base64"),
  };
}

export const Route = createFileRoute("/api/dev/teste-voz")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Gasta créditos do gateway: só para usuário logado, poucos casos e texto curto.
        const userId = await getUserIdFromRequest(request);
        if (!userId) return new Response("Não autenticado", { status: 401 });
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return Response.json({ tem_chave: false }, { status: 500 });
        const casos = ((await request.json()) as Record<string, unknown>[]).slice(0, 4);
        const resultados = [];
        for (const c of casos) {
          const input = String(c.input ?? "").slice(0, 400);
          resultados.push(await medir({ ...c, input }, apiKey));
        }
        return Response.json({ tem_chave: true, resultados });
      },
    },
  },
});
