#!/usr/bin/env node
// Rotina de atualização da base de ajuda (docs/ajuda/*.md). Ver docs/ajuda/README.md.
//
//   node scripts/base-ajuda.mjs pendencias [--prompt] [--desde <commit>] [--ate <ref>] [--sem-gh]
//   node scripts/base-ajuda.mjs validar
//   node scripts/base-ajuda.mjs marcar [--ate <ref>]
//
// "pendencias" lê só os commits posteriores ao último revisado (docs/ajuda/_revisao.json),
// em vez de reprocessar o app inteiro: agrupa por tema (campo `fontes` de cada tema),
// traz o texto dos PRs do GitHub quando o `gh` está disponível e aponta arquivos
// alterados que nenhum tema cobre (possível funcionalidade nova sem ajuda).

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lerBaseAjuda, temaCobre } from "../src/lib/ajuda/conteudo.ts";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const PASTA = join(RAIZ, "docs/ajuda");
const REVISAO = join(PASTA, "_revisao.json");

// Mudanças que nunca afetam o que o usuário vê/faz no app.
const IGNORAR = [
  /^docs\//,
  /^tests\//,
  /^scripts\//,
  /^\.claude\//,
  /^\.lovable\//,
  /^src\/integrations\/supabase\/types\.ts$/,
  /^src\/routeTree\.gen\.ts$/,
  /^public\/medicopilot-extension\.zip$/,
  /(^|\/)(package(-lock)?\.json|bun\.lock|bunfig\.toml|tsconfig\.json|eslint\.config\.js|vite\.config\.ts)$/,
  /\.(test|spec)\.[jt]sx?$/,
  /(^|\/)(AGENTS|README|roadmap)\.md$/,
];

function git(...args) {
  return execFileSync("git", args, { cwd: RAIZ, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function opcao(nome) {
  const i = process.argv.indexOf(nome);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (nome) => process.argv.includes(nome);

function carregarBase() {
  const arquivos = {};
  for (const nome of readdirSync(PASTA)) {
    if (nome.endsWith(".md")) arquivos[nome] = readFileSync(join(PASTA, nome), "utf8");
  }
  return lerBaseAjuda(arquivos);
}

function lerRevisao() {
  if (!existsSync(REVISAO)) return null;
  return JSON.parse(readFileSync(REVISAO, "utf8"));
}

function resolver(ref) {
  return git("rev-parse", "--verify", `${ref}^{commit}`).trim();
}

/** Commits (sem merges) entre base e ate, com os arquivos alterados. */
function commitsEntre(base, ate) {
  const saida = git(
    "log",
    "--no-merges",
    "--reverse",
    "--date=short",
    "--name-only",
    "--format=%x1e%H%x1f%h%x1f%ad%x1f%s%x1f%b%x1d",
    `${base}..${ate}`,
  );
  return saida
    .split("\x1e")
    .filter((b) => b.trim())
    .map((bloco) => {
      const [cab, arquivos = ""] = bloco.split("\x1d");
      const [sha, curto, data, assunto, corpo] = cab.split("\x1f");
      return {
        sha,
        curto,
        data,
        assunto: assunto.trim(),
        corpo: (corpo || "").replace(/\n?Co-Authored-By:.*$/gim, "").trim(),
        arquivos: arquivos
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    });
}

/** PRs do GitHub mesclados no intervalo (pelos commits de merge), se o `gh` estiver logado. */
function prsEntre(base, ate) {
  if (flag("--sem-gh")) return [];
  const numeros = [
    ...new Set(
      git("log", "--merges", "--format=%s", `${base}..${ate}`)
        .split("\n")
        .map((s) => /pull request #(\d+)/i.exec(s)?.[1])
        .filter(Boolean),
    ),
  ];
  const prs = [];
  for (const n of numeros) {
    try {
      const json = execFileSync(
        "gh",
        ["pr", "view", n, "--json", "number,title,body,mergedAt,files"],
        {
          cwd: RAIZ,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      const pr = JSON.parse(json);
      prs.push({
        numero: pr.number,
        titulo: pr.title,
        corpo: String(pr.body || "")
          .replace(/🤖 Generated with.*$/s, "")
          .trim(),
        data: String(pr.mergedAt || "").slice(0, 10),
        arquivos: (pr.files || []).map((f) => f.path),
      });
    } catch {
      // gh ausente, sem login ou sem rede: segue só com o git local.
      if (!prs.length) console.error("(gh indisponível — usando só o histórico do git local)");
      return prs;
    }
  }
  return prs;
}

const resumo = (txt, max = 600) => (txt.length > max ? txt.slice(0, max).trimEnd() + "…" : txt);

function pendencias() {
  const revisao = lerRevisao();
  const base = opcao("--desde") || revisao?.commit;
  if (!base) {
    console.error("Sem commit de referência. Use --desde <commit> ou rode `marcar` uma vez.");
    process.exit(1);
  }
  const ate = resolver(opcao("--ate") || "HEAD");
  let baseSha;
  try {
    baseSha = resolver(base);
  } catch {
    console.error(
      `Commit ${base} não existe neste clone (rebase ou fetch faltando?). Use --desde <commit>.`,
    );
    process.exit(1);
  }

  const { temas } = carregarBase();
  const commits = commitsEntre(baseSha, ate);
  const prs = prsEntre(baseSha, ate);

  const porTema = new Map(
    temas.map((t) => [t.arquivo, { tema: t, commits: [], arquivos: new Set() }]),
  );
  const naoCobertos = new Map(); // arquivo → commits
  for (const c of commits) {
    for (const arq of c.arquivos) {
      if (IGNORAR.some((r) => r.test(arq))) continue;
      const donos = temas.filter((t) => temaCobre(t, arq));
      if (!donos.length) {
        if (!naoCobertos.has(arq)) naoCobertos.set(arq, new Set());
        naoCobertos.get(arq).add(c.curto);
      }
      for (const t of donos) {
        const g = porTema.get(t.arquivo);
        g.arquivos.add(arq);
        if (!g.commits.includes(c)) g.commits.push(c);
      }
    }
  }
  const afetados = [...porTema.values()].filter((g) => g.commits.length);

  const linhas = [];
  linhas.push(`Base de ajuda — mudanças de ${baseSha.slice(0, 7)} até ${ate.slice(0, 7)}`);
  linhas.push(
    `${commits.length} commit(s), ${prs.length} PR(s) do GitHub, ${afetados.length} tema(s) possivelmente afetado(s).`,
  );
  if (!commits.length) {
    console.log(linhas.join("\n") + "\nNada novo desde a última revisão.");
    return;
  }

  if (prs.length) {
    linhas.push("", "## PRs mesclados");
    for (const pr of prs) {
      linhas.push(`- #${pr.numero} (${pr.data}) ${pr.titulo}`);
      if (pr.corpo) linhas.push("  " + resumo(pr.corpo).replace(/\n+/g, "\n  "));
    }
  }

  for (const g of afetados) {
    linhas.push("", `## Tema: ${g.tema.titulo} (docs/ajuda/${g.tema.arquivo}.md)`);
    linhas.push(`Arquivos: ${[...g.arquivos].join(", ")}`);
    for (const c of g.commits) {
      linhas.push(`- ${c.curto} ${c.data} ${c.assunto}`);
      if (c.corpo) linhas.push("  " + resumo(c.corpo, 400).replace(/\n+/g, "\n  "));
    }
  }

  if (naoCobertos.size) {
    linhas.push("", "## Arquivos alterados que nenhum tema cobre");
    linhas.push(
      "(Funcionalidade nova? Inclua o caminho em `fontes` de um tema ou crie um tema novo.)",
    );
    for (const [arq, shas] of naoCobertos) linhas.push(`- ${arq} (${[...shas].join(", ")})`);
  }

  if (flag("--prompt")) {
    linhas.unshift(
      "Atualize a base de ajuda do MediCopilot (docs/ajuda/*.md, formato em docs/ajuda/README.md) " +
        "considerando SOMENTE as mudanças listadas abaixo. Para cada tema listado, leia o diff " +
        `(git diff ${baseSha.slice(0, 7)}..${ate.slice(0, 7)} -- <arquivos do tema>) e o tema atual; ` +
        "ajuste as respostas que ficaram erradas, acrescente perguntas para o que o usuário passou a poder " +
        "fazer e remova o que deixou de existir. Mudanças internas (sem efeito na tela ou no uso) não entram. " +
        "Linguagem simples, nomes de botões exatamente como aparecem na tela, sem preços. Ao terminar, rode " +
        "`node scripts/base-ajuda.mjs validar` e, se passar, `node scripts/base-ajuda.mjs marcar`.",
      "",
    );
  }
  console.log(linhas.join("\n"));
}

function validar() {
  const { temas, erros } = carregarBase();
  for (const t of temas) {
    for (const f of t.fontes) {
      if (!existsSync(join(RAIZ, f)))
        erros.push({ arquivo: t.arquivo, mensagem: `fonte não existe: ${f}` });
    }
  }
  const total = temas.reduce((n, t) => n + t.itens.length, 0);
  if (erros.length) {
    for (const e of erros) console.error(`✗ ${e.arquivo}: ${e.mensagem}`);
    process.exit(1);
  }
  console.log(`✓ ${temas.length} temas, ${total} perguntas.`);
}

function marcar() {
  const ate = resolver(opcao("--ate") || "HEAD");
  const dados = { commit: ate, data: git("show", "-s", "--format=%cs", ate).trim() };
  writeFileSync(REVISAO, JSON.stringify(dados, null, 2) + "\n");
  console.log(
    `Revisão registrada em ${ate.slice(0, 7)} (${dados.data}). Inclua docs/ajuda/_revisao.json no commit.`,
  );
}

const comando = process.argv[2];
if (comando === "pendencias") pendencias();
else if (comando === "validar") validar();
else if (comando === "marcar") marcar();
else {
  console.log(
    "Uso: node scripts/base-ajuda.mjs <pendencias [--prompt] [--desde X] [--ate Y] [--sem-gh] | validar | marcar>",
  );
  process.exit(comando ? 1 : 0);
}
