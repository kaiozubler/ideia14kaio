// Gera public/medicopilot-extension.zip a partir da pasta extension/.
//
// O app distribui a extensão por esse zip (Minha equipe › Instalar extensão).
// Ele é regerado no build (plugin em vite.config.ts) e conferido por
// tests/extensao-pacote.test.ts, porque um zip esquecido fez médicos
// instalarem uma versão antiga sem o "Preencher tela".
//
// Zip escrito à mão (deflate do node:zlib) e determinístico — data fixa e
// arquivos em ordem alfabética — para o mesmo conteúdo dar sempre os mesmos bytes.
// Uso: node scripts/empacotar-extensao.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PASTA_EXTENSAO = join(RAIZ, "extension");
export const ARQUIVO_ZIP = join(RAIZ, "public", "medicopilot-extension.zip");

const TABELA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 01/01/2026 00:00 no formato DOS.
const DOS_HORA = 0;
const DOS_DATA = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function arquivosDaExtensao() {
  return readdirSync(PASTA_EXTENSAO, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort()
    .map((nome) => ({ nome, dados: readFileSync(join(PASTA_EXTENSAO, nome)) }));
}

export function empacotar(arquivos = arquivosDaExtensao()) {
  const locais = [];
  const central = [];
  let offset = 0;
  for (const { nome, dados } of arquivos) {
    const nomeBuf = Buffer.from(nome, "utf8");
    const comprimido = deflateRawSync(dados, { level: 9 });
    const crc = crc32(dados);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão necessária
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_HORA, 10);
    local.writeUInt16LE(DOS_DATA, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locais.push(local, nomeBuf, comprimido);

    const cab = Buffer.alloc(46);
    cab.writeUInt32LE(0x02014b50, 0);
    cab.writeUInt16LE(20, 4);
    cab.writeUInt16LE(20, 6);
    cab.writeUInt16LE(0x0800, 8);
    cab.writeUInt16LE(8, 10);
    cab.writeUInt16LE(DOS_HORA, 12);
    cab.writeUInt16LE(DOS_DATA, 14);
    cab.writeUInt32LE(crc, 16);
    cab.writeUInt32LE(comprimido.length, 20);
    cab.writeUInt32LE(dados.length, 24);
    cab.writeUInt16LE(nomeBuf.length, 28);
    cab.writeUInt32LE(0, 30); // extra + comentário
    cab.writeUInt32LE(0, 34); // disco + atributos internos
    cab.writeUInt32LE(0, 38); // atributos externos
    cab.writeUInt32LE(offset, 42);
    central.push(cab, nomeBuf);

    offset += local.length + nomeBuf.length + comprimido.length;
  }
  const centralBuf = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(centralBuf.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, centralBuf, fim]);
}

/** Regrava o zip só quando o conteúdo mudou. Devolve true se gravou. */
export function atualizarZip() {
  const novo = empacotar();
  let atual = null;
  try {
    atual = readFileSync(ARQUIVO_ZIP);
  } catch {}
  if (atual && atual.equals(novo)) return false;
  writeFileSync(ARQUIVO_ZIP, novo);
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const gravou = atualizarZip();
  console.log(gravou ? `Pacote atualizado: ${ARQUIVO_ZIP}` : "Pacote já estava atualizado.");
}
