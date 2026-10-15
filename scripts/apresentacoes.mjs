#!/usr/bin/env node
// Fila de apresentações da Anvisa operada pelo Claude (ver docs/APRESENTACOES_MEDICAMENTOS.md).
//
//   node scripts/apresentacoes.mjs exportar [limite] [arquivo]   -> baixa as pendentes
//   node scripts/apresentacoes.mjs importar <arquivo.json>        -> envia as traduções
//
// Lê APP_URL (padrão https://medicopilot.lovable.app) e CATALOGO_ADMIN_TOKEN do
// ambiente ou de .env.local.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const linha of readFileSync(".env.local", "utf8").split("\n")) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const APP_URL = (process.env.APP_URL || "https://medicopilot.lovable.app").replace(/\/$/, "");
const TOKEN = process.env.CATALOGO_ADMIN_TOKEN;
if (!TOKEN) {
  console.error("Defina CATALOGO_ADMIN_TOKEN (em .env.local ou no ambiente).");
  process.exit(1);
}
const ENDPOINT = `${APP_URL}/api/medicamentos/simplificar-apresentacoes`;
const headers = { "x-catalogo-token": TOKEN, "content-type": "application/json" };

async function exportar(limite = 500, arquivo = "apresentacoes-pendentes.json") {
  const res = await fetch(`${ENDPOINT}?limite=${limite}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json();
  writeFileSync(arquivo, JSON.stringify(data.apresentacoes, null, 1));
  console.log(
    `pendentes: ${data.total} · já traduzidas: ${data.ja_traduzidas} · exportadas: ${data.apresentacoes.length} -> ${arquivo}`,
  );
}

async function importar(arquivo) {
  const itens = JSON.parse(readFileSync(arquivo, "utf8"));
  let gravadas = 0;
  const recusados = [];
  for (let i = 0; i < itens.length; i += 500) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ itens: itens.slice(i, i + 500) }),
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = await res.json();
    gravadas += data.gravadas;
    recusados.push(...data.recusados);
  }
  console.log(`gravadas: ${gravadas} · recusadas: ${recusados.length}`);
  for (const r of recusados) console.log(`  ✗ ${r.apresentacao} — ${r.motivo}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "exportar") await exportar(Number(args[0]) || 500, args[1]);
else if (cmd === "importar" && args[0]) await importar(args[0]);
else {
  console.error("uso: exportar [limite] [arquivo] | importar <arquivo.json>");
  process.exit(1);
}
