// Base de ajuda do Assistente IA (docs/ajuda/*.md).
// Rodar com: npm test (ou node scripts/base-ajuda.mjs validar)
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  lerBaseAjuda,
  lerTemaAjuda,
  linhaDoItem,
  planejarSincronizacao,
  temaCobre,
} from "../src/lib/ajuda/conteudo.ts";

function base() {
  const arquivos: Record<string, string> = {};
  for (const nome of readdirSync("docs/ajuda")) {
    if (nome.endsWith(".md")) arquivos[nome] = readFileSync(`docs/ajuda/${nome}`, "utf8");
  }
  return lerBaseAjuda(arquivos);
}

test("a base publicada não tem erros e as fontes existem", () => {
  const { temas, erros } = base();
  assert.deepEqual(erros, []);
  assert.ok(temas.length > 5);
  for (const t of temas) {
    assert.ok(t.fontes.length, `${t.arquivo} sem fontes`);
    for (const f of t.fontes) assert.ok(existsSync(f), `${t.arquivo}: fonte inexistente ${f}`);
  }
  const chaves = temas.flatMap((t) => t.itens.map((i) => i.chave));
  assert.equal(new Set(chaves).size, chaves.length);
});

test("lê pergunta, palavras e resposta", () => {
  const { tema, erros } = lerTemaAjuda(
    "agenda",
    '---\ntitulo: Agenda\nfontes: public/a.js, src/x/\n---\n\nintro ignorada\n\n## Como marco?\npalavras: agendar, marcar\n\nClique em "Novo".\n\n## Vazia\n',
  );
  assert.deepEqual(tema.fontes, ["public/a.js", "src/x/"]);
  assert.equal(tema.itens.length, 1);
  assert.equal(tema.itens[0].chave, "agenda#como-marco");
  assert.deepEqual(tema.itens[0].palavras, ["agendar", "marcar"]);
  assert.equal(tema.itens[0].resposta, 'Clique em "Novo".');
  assert.equal(erros.length, 1);
  assert.match(erros[0].mensagem, /sem resposta/);
  assert.equal(linhaDoItem(tema.itens[0]).titulo, "Agenda — Como marco?");
});

test("sincronização grava só o que mudou e desativa o que saiu", () => {
  const { tema } = lerTemaAjuda("t", "---\ntitulo: T\n---\n## A\nresp a\n## B\nresp b\n");
  const [a, b] = tema.itens;
  const r = planejarSincronizacao(tema.itens, [
    { chave: a.chave, hash: a.hash, ativo: true },
    { chave: b.chave, hash: "antigo", ativo: true },
    { chave: "t#removida", hash: "x", ativo: true },
    { chave: "t#ja-inativa", hash: "x", ativo: false },
  ]);
  assert.deepEqual(
    r.gravar.map((i) => i.chave),
    [b.chave],
  );
  assert.deepEqual(r.desativar, ["t#removida"]);
});

test("fontes cobrem arquivo exato ou pasta, não prefixo parcial", () => {
  const t = { fontes: ["public/equipe.js", "src/lib/agendamento/", "extension"] };
  assert.ok(temaCobre(t, "public/equipe.js"));
  assert.ok(temaCobre(t, "src/lib/agendamento/publico.server.ts"));
  assert.ok(temaCobre(t, "extension/sidepanel.js"));
  assert.ok(!temaCobre(t, "public/equipe.css"));
  assert.ok(!temaCobre(t, "extensionx/a.js"));
});
