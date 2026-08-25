// PAdES embedder: inserts a signature placeholder into the PDF, asks the
// caller to produce a CMS/PKCS#7 for the bytes to be signed, and splices
// the CMS back into the placeholder. Runs server-side only.
//
// The provider (IntegraICP) accepts a base64 SHA-256 digest and returns the
// full CMS wrapping the signature. We compute the digest here from the exact
// bytes covered by the ByteRange and hand off just the digest to the signer.
import { Buffer } from "node:buffer";
import { plainAddPlaceholder } from "@signpdf/placeholder-plain";
import signpdfPkg from "@signpdf/signpdf";
import { convertBuffer, findByteRange, removeTrailingNewLine } from "@signpdf/utils";
import { sha256Base64 } from "./DigestService";
import { SignatureErrors } from "./errors";

const SignPdfClass =
  (signpdfPkg as unknown as { SignPdf?: new () => unknown; default?: new () => unknown }).SignPdf ??
  (signpdfPkg as unknown as { default?: new () => unknown }).default ??
  (signpdfPkg as unknown as new () => unknown);

// Placeholder must be large enough for the CMS. 16 KiB fits typical ICP-Brasil signatures.
const SIGNATURE_LENGTH = 16384;

export interface EmbedParams {
  pdfBuffer: Uint8Array;
  reason: string;
  name: string;
  /**
   * Receives the exact bytes covered by the ByteRange plus their base64
   * SHA-256 digest, and must return a base64 CMS/PKCS#7 signature.
   */
  signer: (input: { bytes: Uint8Array; digestBase64: string }) => Promise<string>;
}

/**
 * Reimplementa a preparação de ByteRange feita internamente por
 * `SignPdf.sign()` (@signpdf/signpdf 3.3.0), parando ANTES de gravar a
 * assinatura — é o ponto exato em que a fase 1 e a fase 2 se separam.
 * Mantido em sincronia deliberada com o algoritmo da lib para produzir
 * bit-a-bit o mesmo buffer/digest que o fluxo de uma fase (local/IntegraICP).
 */
function computeByteRangeSplit(pdfBuffer: Buffer): {
  /** PDF com /ByteRange já preenchido e o placeholder de assinatura ainda zerado. */
  pdfWithByteRange: Buffer;
  /** Exatamente os bytes que devem ser hasheados (placeholder de assinatura removido). */
  bytesToSign: Buffer;
  byteRange: [number, number, number, number];
  placeholderLength: number;
} {
  let pdf = removeTrailingNewLine(convertBuffer(pdfBuffer, "PDF"));
  const { byteRangePlaceholder, byteRangePlaceholderPosition } = findByteRange(pdf);
  if (!byteRangePlaceholder || byteRangePlaceholderPosition === undefined) {
    throw SignatureErrors.ProviderUnavailable("PDF sem placeholder de ByteRange.");
  }

  const byteRangeEnd = byteRangePlaceholderPosition + byteRangePlaceholder.length;
  const contentsTagPos = pdf.indexOf("/Contents ", byteRangeEnd);
  const placeholderPos = pdf.indexOf("<", contentsTagPos);
  const placeholderEnd = pdf.indexOf(">", placeholderPos);
  const placeholderLengthWithBrackets = placeholderEnd + 1 - placeholderPos;
  const placeholderLength = placeholderLengthWithBrackets - 2;
  const byteRange: [number, number, number, number] = [0, 0, 0, 0];
  byteRange[1] = placeholderPos;
  byteRange[2] = byteRange[1] + placeholderLengthWithBrackets;
  byteRange[3] = pdf.length - byteRange[2];

  let actualByteRange = `/ByteRange [${byteRange.join(" ")}]`;
  actualByteRange += " ".repeat(byteRangePlaceholder.length - actualByteRange.length);

  pdf = Buffer.concat([
    pdf.subarray(0, byteRangePlaceholderPosition),
    Buffer.from(actualByteRange),
    pdf.subarray(byteRangeEnd),
  ]);
  const pdfWithByteRange = pdf;

  const bytesToSign = Buffer.concat([
    pdf.subarray(0, byteRange[1]),
    pdf.subarray(byteRange[2], byteRange[2] + byteRange[3]),
  ]);

  return { pdfWithByteRange, bytesToSign, byteRange, placeholderLength };
}

/**
 * Fase 1 do fluxo de duas fases (usado por A3 externo: token/smartcard
 * local, sem acesso do servidor ao hardware). Insere o placeholder de
 * assinatura no PDF e devolve o digest exato (SHA-256, base64) que o
 * cliente deve assinar localmente, junto com o PDF intermediário
 * (ByteRange já resolvido) a ser persistido até a fase 2.
 */
export async function preparePlaceholder(params: {
  pdfBuffer: Uint8Array;
  reason: string;
  name: string;
}): Promise<{ placeholderPdf: Uint8Array; bytesToSign: Uint8Array; digestBase64: string }> {
  let withPlaceholder: Buffer;
  try {
    withPlaceholder = plainAddPlaceholder({
      pdfBuffer: Buffer.from(params.pdfBuffer),
      reason: params.reason,
      name: params.name,
      contactInfo: "",
      location: "",
      signatureLength: SIGNATURE_LENGTH,
    }) as Buffer;
  } catch (e) {
    throw SignatureErrors.ProviderUnavailable("Falha ao preparar PDF para assinatura.", String(e));
  }

  const { pdfWithByteRange, bytesToSign } = computeByteRangeSplit(withPlaceholder);
  const digestBase64 = await sha256Base64(
    bytesToSign.buffer.slice(
      bytesToSign.byteOffset,
      bytesToSign.byteOffset + bytesToSign.byteLength,
    ) as ArrayBuffer,
  );

  return {
    placeholderPdf: new Uint8Array(
      pdfWithByteRange.buffer,
      pdfWithByteRange.byteOffset,
      pdfWithByteRange.byteLength,
    ),
    bytesToSign: new Uint8Array(bytesToSign.buffer, bytesToSign.byteOffset, bytesToSign.byteLength),
    digestBase64,
  };
}

/**
 * Fase 2 do fluxo de duas fases: recebe o PDF intermediário salvo na
 * fase 1 (ByteRange já resolvido) e o CMS/PKCS#7 já produzido pelo
 * token/smartcard local, e espeta a assinatura de volta no PDF —
 * exatamente como `SignPdf.sign()` faz ao final, sem recalcular nada.
 */
export async function finalizeWithCms(params: {
  placeholderPdf: Uint8Array;
  cmsBase64: string;
}): Promise<{ signedPdf: Uint8Array; signatureTimestamp: string | null }> {
  const { byteRange, placeholderLength } = computeByteRangeSplitFromResolved(
    Buffer.from(params.placeholderPdf),
  );

  const raw = Buffer.from(params.cmsBase64, "base64");
  if (raw.length * 2 > placeholderLength) {
    throw SignatureErrors.ProviderUnavailable(
      `Assinatura maior que o espaço reservado no PDF: ${raw.length * 2} > ${placeholderLength}.`,
    );
  }
  let signatureHex = raw.toString("hex");
  signatureHex += Buffer.from(
    String.fromCharCode(0).repeat(placeholderLength / 2 - raw.length),
  ).toString("hex");

  const pdf = Buffer.from(params.placeholderPdf);
  const signedPdf = Buffer.concat([
    pdf.subarray(0, byteRange[1]),
    Buffer.from(`<${signatureHex}>`),
    pdf.subarray(byteRange[1]),
  ]);

  return {
    signedPdf: new Uint8Array(signedPdf.buffer, signedPdf.byteOffset, signedPdf.byteLength),
    signatureTimestamp: new Date().toISOString(),
  };
}

/**
 * O PDF salvo ao fim da fase 1 já tem o /ByteRange resolvido (não é mais
 * placeholder), então aqui só recalculamos a posição/tamanho do
 * placeholder de assinatura a partir do /ByteRange real gravado — sem
 * tocar em texto de placeholder, que não existe mais neste buffer.
 */
function computeByteRangeSplitFromResolved(pdf: Buffer): {
  byteRange: [number, number, number, number];
  placeholderLength: number;
} {
  const rangePos = pdf.indexOf("/ByteRange");
  if (rangePos === -1) {
    throw SignatureErrors.ProviderUnavailable("PDF intermediário sem /ByteRange resolvido.");
  }
  const rangeStart = pdf.indexOf("[", rangePos);
  const rangeEnd = pdf.indexOf("]", rangeStart);
  const parts = pdf
    .subarray(rangeStart + 1, rangeEnd)
    .toString()
    .split(" ")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const byteRange = [parts[0], parts[1], parts[2], parts[3]] as [number, number, number, number];
  const placeholderLengthWithBrackets = byteRange[2] - byteRange[1];
  return { byteRange, placeholderLength: placeholderLengthWithBrackets - 2 };
}

/** Fluxo síncrono de uma fase (local .pfx e IntegraICP) — usa as duas funções acima por baixo. */
export async function embedCMSIntoPDF(params: EmbedParams): Promise<{
  signedPdf: Uint8Array;
  signatureTimestamp: string | null;
}> {
  const { placeholderPdf, bytesToSign, digestBase64 } = await preparePlaceholder(params);
  const cmsBase64 = await params.signer({ bytes: bytesToSign, digestBase64 });
  return finalizeWithCms({ placeholderPdf, cmsBase64 });
}
