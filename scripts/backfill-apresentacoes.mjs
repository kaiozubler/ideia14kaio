// Uso interno (uma vez): completa as apresentações pendentes usando o mesmo
// prompt da rota /api/medicamentos/simplificar-apresentacoes.
// Execute com: bun scripts/backfill-apresentacoes.mjs
import { createClient } from "@supabase/supabase-js";
import { simplificarLote } from "../src/lib/medicamentos/apresentacao.server.ts";

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const apiKey = process.env.LOVABLE_API_KEY;

async function todasColuna(tabela, coluna, filtro = (q) => q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filtro(sb.from(tabela).select(coluna)).range(from, from + 999);
    if (error) throw error;
    out.push(...data.map((r) => r[coluna]).filter(Boolean));
    if (data.length < 1000) break;
  }
  return out;
}

const feitos = new Set(await todasColuna("apresentacao_legivel", "apresentacao"));
const pend = [
  ...new Set(
    (
      await todasColuna("medicamentos", "apresentacao", (q) =>
        q.not("apresentacao", "is", null).neq("apresentacao", ""),
      )
    ).filter((a) => !feitos.has(a)),
  ),
];
console.log("pendentes:", pend.length);

const lotes = [];
for (let i = 0; i < pend.length; i += 8) lotes.push(pend.slice(i, i + 8));
let ok = 0,
  falhas = 0,
  n = 0;
async function worker(fila) {
  for (const lote of fila) {
    try {
      const rows = await simplificarLote({ apiKey, apresentacoes: lote });
      if (rows.length) {
        const { error } = await sb
          .from("apresentacao_legivel")
          .upsert(rows, { onConflict: "apresentacao" });
        if (error) throw error;
        ok += rows.length;
      }
    } catch (e) {
      falhas++;
      if (falhas <= 3) console.error("falha:", e.message);
    }
    if (++n % 25 === 0) console.log(`${n}/${lotes.length} | ok ${ok} | falhas ${falhas}`);
  }
}
const CONC = 8;
await Promise.all(
  Array.from({ length: CONC }, (_, k) => lotes.filter((_, i) => i % CONC === k)).map(worker),
);
const { data: sync, error: syncErr } = await sb.rpc("sincronizar_apresentacao_legivel");
console.log(`FIM: ok ${ok} | falhas ${falhas} | sync ${syncErr ? syncErr.message : sync}`);
