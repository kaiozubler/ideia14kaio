// O zip baixado em Minha equipe precisa ser a extensão atual da pasta extension/.
// Rodar com: npm test (se falhar: node scripts/empacotar-extensao.mjs)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { ARQUIVO_ZIP, arquivosDaExtensao, empacotar } from "../scripts/empacotar-extensao.mjs";

/** Lê um zip pelo diretório central: nome → conteúdo descomprimido. */
function lerZip(buf: Buffer) {
  const fim = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < total; i++) {
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const nomeLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + nomeLen).toString("utf8");
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(ini, ini + tamComp);
    out.set(nome, metodo === 8 ? inflateRawSync(dados) : Buffer.from(dados));
    p += 46 + nomeLen + extraLen + comLen;
  }
  return out;
}

test("o zip publicado é igual à pasta extension/", () => {
  const publicado = lerZip(readFileSync(ARQUIVO_ZIP));
  const atual = arquivosDaExtensao();
  assert.deepEqual(
    [...publicado.keys()].sort(),
    atual.map((a) => a.nome),
  );
  for (const { nome, dados } of atual) {
    assert.ok(publicado.get(nome)?.equals(dados), `${nome} desatualizado no zip`);
  }
});

test("o empacotador é determinístico e o zip abre de volta", () => {
  const a = empacotar();
  assert.ok(a.equals(empacotar()));
  const lido = lerZip(a);
  for (const { nome, dados } of arquivosDaExtensao()) assert.ok(lido.get(nome)?.equals(dados));
});
