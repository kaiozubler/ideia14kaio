// Verificação pública de documentos emitidos (receitas e demais PDFs gerados
// por _renderDocumentoPdf em medicopilot.html).
//
// Fluxo:
//  1. Antes de renderizar o PDF, o navegador reserva um registro
//     (POST /api/documentos/verificacao). Recebe o código curto e o link
//     autenticado, que vira o QR code impresso no documento.
//  2. Depois de assinar (ou do fallback sem assinatura), o navegador envia o
//     PDF final (POST /api/documentos/verificacao/emitir). O servidor guarda a
//     própria cópia, calcula o SHA-256 e extrai do PDF o registro da
//     assinatura ICP-Brasil — nada disso vem do navegador.
//  3. A página pública /v/<codigo> libera o documento com o token do QR
//     (?k=) ou, pelo link curto, com os 4 últimos dígitos do CPF do paciente.
//
// Só os hashes do token e da senha ficam no banco. Como a senha tem apenas
// 10 mil combinações, as tentativas são limitadas por código (ver
// conferirSenha): cada tentativa é gravada ANTES de ser conferida, então
// requisições paralelas não conseguem furar o limite.
import forge from "node-forge";

export const BUCKET_VERIFICACAO = "documentos-verificacao";

// Sem 0/O/1/I para o código poder ser digitado a partir do papel.
const ALFABETO = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export const LIMITE_TENTATIVAS = [
  { janelaMin: 15, max: 5 },
  { janelaMin: 24 * 60, max: 20 },
];

export function admin() {
  return import("@/integrations/supabase/client.server").then(
    // A tabela é nova e ainda não está nos tipos gerados.
    (m) => m.supabaseAdmin as unknown as any, // eslint-disable-line @typescript-eslint/no-explicit-any
  );
}

export function gerarCodigo(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ALFABETO[b % 32]).join("");
}

export function gerarToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function normalizarCodigo(v: string | null | undefined): string | null {
  const c = String(v ?? "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
  if (c.length !== 10 || /[^2-9A-HJ-NP-Z]/.test(c)) return null;
  return c;
}

export function formatarCodigo(codigo: string): string {
  return `${codigo.slice(0, 5)}-${codigo.slice(5)}`;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hashSenha(verificacaoId: string, ultimos4: string) {
  return sha256Hex(`${verificacaoId}:${ultimos4}`);
}

export function iguaisTempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function origemPublica(request: Request): string {
  const env = (process.env.PUBLIC_APP_URL || "").trim().replace(/\/+$/, "");
  return env || new URL(request.url).origin;
}

export function linksVerificacao(origem: string, codigo: string, token?: string) {
  return {
    url: token ? `${origem}/v/${codigo}?k=${encodeURIComponent(token)}` : null,
    urlCurta: `${origem}/v/${formatarCodigo(codigo)}`,
  };
}

export function ipDaRequisicao(request: Request): string | null {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

/**
 * Confere os 4 últimos dígitos do CPF respeitando LIMITE_TENTATIVAS.
 * A tentativa é inserida antes da contagem: com N requisições simultâneas,
 * a k-ésima a gravar enxerga pelo menos k tentativas, então no máximo `max`
 * delas chegam a comparar a senha dentro da janela.
 */
export async function conferirSenha(
  registro: { id: string; senha_hash: string },
  ultimos4: string,
  ip: string | null,
): Promise<"ok" | "invalida" | "bloqueado"> {
  const sb = await admin();
  const { data: tentativa, error } = await sb
    .from("documentos_verificacao_tentativas")
    .insert({ verificacao_id: registro.id, sucesso: false, ip })
    .select("id, created_at")
    .single();
  if (error) throw error;

  for (const limite of LIMITE_TENTATIVAS) {
    const desde = new Date(Date.now() - limite.janelaMin * 60_000).toISOString();
    const { count, error: cErr } = await sb
      .from("documentos_verificacao_tentativas")
      .select("id", { count: "exact", head: true })
      .eq("verificacao_id", registro.id)
      .eq("sucesso", false)
      .gte("created_at", desde);
    if (cErr) throw cErr;
    if ((count ?? 0) > limite.max) return "bloqueado";
  }

  const ok = iguaisTempoConstante(await hashSenha(registro.id, ultimos4), registro.senha_hash);
  if (ok) {
    await sb
      .from("documentos_verificacao_tentativas")
      .update({ sucesso: true })
      .eq("id", tentativa.id);
    return "ok";
  }
  return "invalida";
}

/** Dados da clínica usados no cabeçalho da página pública. */
export interface ClinicaSnapshot {
  nome?: string | null;
  endereco?: string | null;
  telefone?: string | null;
  email?: string | null;
  cor?: string | null;
  whatsapp?: string | null;
}

/**
 * Monta a identidade da clínica a partir do que está no banco
 * (medico_clinica_config e o número conectado em comunicacao_whatsapp_conexoes),
 * completando com o que o navegador enviou quando o banco ainda não tem.
 */
export async function montarClinica(
  idMedico: string,
  doNavegador: ClinicaSnapshot,
): Promise<ClinicaSnapshot> {
  const sb = await admin();
  const [{ data: cfg }, { data: wa }] = await Promise.all([
    sb
      .from("medico_clinica_config")
      .select(
        "fantasia, razao_social, logradouro, numero, complemento, bairro, cidade, uf, cep, telefone, email, cor_primaria",
      )
      .eq("id_medico", idMedico)
      .maybeSingle(),
    sb
      .from("comunicacao_whatsapp_conexoes")
      .select("numero_exibicao, status")
      .eq("id_medico", idMedico)
      .maybeSingle(),
  ]);
  const limpa = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);
  const endereco = cfg
    ? [
        [cfg.logradouro, cfg.numero].filter(Boolean).join(", "),
        cfg.complemento,
        cfg.bairro,
        [cfg.cidade, cfg.uf].filter(Boolean).join("/"),
        cfg.cep ? `CEP ${cfg.cep}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const telefone = limpa(cfg?.telefone) ?? limpa(doNavegador.telefone);
  const cor = limpa(cfg?.cor_primaria) ?? limpa(doNavegador.cor);
  return {
    nome: limpa(cfg?.fantasia) ?? limpa(cfg?.razao_social) ?? limpa(doNavegador.nome) ?? "Clínica",
    endereco: limpa(endereco) ?? limpa(doNavegador.endereco),
    telefone,
    email: limpa(cfg?.email) ?? limpa(doNavegador.email),
    cor: cor && /^#[0-9a-fA-F]{3,8}$/.test(cor) ? cor : null,
    whatsapp:
      (wa?.status === "conectado" && limpa(wa?.numero_exibicao)) ||
      limpa(doNavegador.whatsapp) ||
      telefone,
  };
}

/** Telefone em formato wa.me (só dígitos, com DDI 55 quando faltar). */
export function numeroWhatsapp(v: string | null | undefined): string | null {
  let d = String(v ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 12 ? d : null;
}

// ─── Registro da assinatura ICP-Brasil extraído do próprio PDF ──────────────

export interface RegistroAssinatura {
  assinado: boolean;
  padrao?: string;
  signatario?: string | null;
  signatarioCpf?: string | null;
  emissor?: string | null;
  serie?: string | null;
  certificadoValidoDe?: string | null;
  certificadoValidoAte?: string | null;
  assinadoEm?: string | null;
  /** O hash do conteúdo coberto pela assinatura confere com o messageDigest assinado. */
  integridade?: boolean | null;
  /** A assinatura criptográfica confere com a chave pública do certificado. */
  assinaturaConfere?: boolean | null;
  erro?: string;
}

const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";

function latin1(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return s;
}

function cpfMascarado(cpf: string): string {
  const d = cpf.replace(/\D/g, "");
  if (d.length !== 11) return "";
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

function nomeDoCertificado(cert: forge.pki.Certificate | undefined, campo: "subject" | "issuer") {
  const attr = cert?.[campo].getField("CN");
  return attr ? String(attr.value) : null;
}

function utcParaIso(node: forge.asn1.Asn1 | undefined): string | null {
  if (!node || typeof node.value !== "string") return null;
  try {
    const d =
      node.type === forge.asn1.Type.UTCTIME
        ? forge.asn1.utcTimeToDate(node.value)
        : forge.asn1.generalizedTimeToDate(node.value);
    return d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Lê a última assinatura do PDF (/ByteRange + /Contents), decodifica o CMS e
 * devolve signatário, AC emissora, série e data. Também confere se o hash do
 * conteúdo coberto bate com o messageDigest assinado e se a assinatura
 * confere com a chave pública do certificado. A validação da cadeia até a
 * raiz ICP-Brasil fica com o validador oficial (validar.iti.gov.br).
 */
export async function extrairAssinatura(pdf: Uint8Array): Promise<RegistroAssinatura> {
  const texto = latin1(pdf);
  const re = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  let m: RegExpExecArray | null;
  let ultimo: number[] | null = null;
  while ((m = re.exec(texto))) ultimo = m.slice(1, 5).map(Number);
  if (!ultimo) return { assinado: false };

  const [a, b, c, d] = ultimo;
  try {
    const hex = texto.slice(a + b, c).replace(/[<>\s]/g, "");
    const der = forge.util.hexToBytes(hex);
    // O placeholder de /Contents é completado com zeros depois do CMS.
    const asn1 = forge.asn1.fromDer(der, { strict: false, parseAllBytes: false } as never);
    const msg = forge.pkcs7.messageFromAsn1(asn1) as unknown as {
      certificates: forge.pki.Certificate[];
      rawCapture: { signerInfos?: forge.asn1.Asn1[] };
    };

    const coberto = new Uint8Array(b + d);
    coberto.set(pdf.subarray(a, a + b), 0);
    coberto.set(pdf.subarray(c, c + d), b);

    const signerInfo = msg.rawCapture.signerInfos?.[0];
    const campos = (signerInfo?.value as forge.asn1.Asn1[]) ?? [];
    // SignerInfo: version, sid(issuerAndSerial), digestAlg, [0] signedAttrs, sigAlg, signature
    const sid = campos[1];
    const serieSid =
      sid && Array.isArray(sid.value)
        ? forge.util.bytesToHex((sid.value[1] as forge.asn1.Asn1).value as string)
        : null;
    const cert =
      msg.certificates.find(
        (ct) => serieSid && ct.serialNumber.replace(/^0+/, "") === serieSid.replace(/^0+/, ""),
      ) ??
      msg.certificates.find((ct) => {
        const bc = ct.getExtension("basicConstraints") as { cA?: boolean } | null;
        return !bc?.cA;
      }) ??
      msg.certificates[0];

    const attrsNode = campos.find(
      (n) => n.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && n.type === 0,
    );
    let messageDigest: string | null = null;
    let signingTime: string | null = null;
    for (const attr of (attrsNode?.value as forge.asn1.Asn1[]) ?? []) {
      const [oidNode, valores] = attr.value as forge.asn1.Asn1[];
      const oid = forge.asn1.derToOid(oidNode.value as string);
      const valor = (valores?.value as forge.asn1.Asn1[])?.[0];
      if (oid === OID_MESSAGE_DIGEST && valor)
        messageDigest = forge.util.bytesToHex(valor.value as string);
      if (oid === OID_SIGNING_TIME) signingTime = utcParaIso(valor);
    }

    const conteudoHex = await sha256Hex(coberto);
    const integridade = messageDigest
      ? iguaisTempoConstante(messageDigest.toLowerCase(), conteudoHex)
      : null;

    let assinaturaConfere: boolean | null = null;
    try {
      const assinaturaNode = campos[campos.length - 1];
      if (attrsNode && cert) {
        const set = forge.asn1.create(
          forge.asn1.Class.UNIVERSAL,
          forge.asn1.Type.SET,
          true,
          attrsNode.value as forge.asn1.Asn1[],
        );
        const md = forge.md.sha256.create();
        md.update(forge.asn1.toDer(set).getBytes());
        assinaturaConfere = (cert.publicKey as forge.pki.rsa.PublicKey).verify(
          md.digest().getBytes(),
          assinaturaNode.value as string,
        );
      }
    } catch {
      assinaturaConfere = null;
    }

    // Certificados ICP-Brasil de pessoa física: CN = "NOME DO TITULAR:CPF".
    const cn = nomeDoCertificado(cert, "subject") ?? "";
    const [nome, cpf] = cn.split(":");
    const mData = texto.slice(Math.max(0, a + b - 4000), a + b).match(/\/M\s*\(D:(\d{14})/);
    const dataPdf = mData
      ? `${mData[1].slice(0, 4)}-${mData[1].slice(4, 6)}-${mData[1].slice(6, 8)}T${mData[1].slice(8, 10)}:${mData[1].slice(10, 12)}:${mData[1].slice(12, 14)}Z`
      : null;

    return {
      assinado: true,
      padrao: "PAdES · ICP-Brasil",
      signatario: nome?.trim() || cn || null,
      signatarioCpf: cpf ? cpfMascarado(cpf) : null,
      emissor: nomeDoCertificado(cert, "issuer"),
      serie: cert?.serialNumber ?? serieSid,
      certificadoValidoDe: cert?.validity.notBefore.toISOString() ?? null,
      certificadoValidoAte: cert?.validity.notAfter.toISOString() ?? null,
      assinadoEm: signingTime ?? dataPdf,
      integridade,
      assinaturaConfere,
    };
  } catch (e) {
    console.warn(
      "[verificacao] não foi possível ler a assinatura do PDF:",
      e instanceof Error ? e.message : e,
    );
    return { assinado: true, padrao: "PAdES · ICP-Brasil", erro: "assinatura_ilegivel" };
  }
}
