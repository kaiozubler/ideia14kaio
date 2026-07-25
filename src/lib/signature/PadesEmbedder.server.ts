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
  /** Given a base64 SHA-256 of the bytes to sign, must return a base64 CMS. */
  signer: (digestBase64: string) => Promise<string>;
}

export async function embedCMSIntoPDF(params: EmbedParams): Promise<{
  signedPdf: Uint8Array;
  signatureTimestamp: string | null;
}> {
  const buf = Buffer.from(params.pdfBuffer);
  let withPlaceholder: Buffer;
  try {
    withPlaceholder = plainAddPlaceholder({
      pdfBuffer: buf,
      reason: params.reason,
      name: params.name,
      signatureLength: SIGNATURE_LENGTH,
    }) as Buffer;
  } catch (e) {
    throw SignatureErrors.ProviderUnavailable("Falha ao preparar PDF para assinatura.", String(e));
  }

  // Signer wrapper compatible with @signpdf/signpdf ISigner.
  const externalSigner = {
    async sign(pdfBufferToSign: Buffer): Promise<Buffer> {
      const digest = await sha256Base64(
        pdfBufferToSign.buffer.slice(
          pdfBufferToSign.byteOffset,
          pdfBufferToSign.byteOffset + pdfBufferToSign.byteLength,
        ),
      );
      const cmsBase64 = await params.signer(digest);
      return Buffer.from(cmsBase64, "base64");
    },
  };

  const sp = new (SignPdfClass as new () => {
    sign: (pdf: Buffer, signer: unknown) => Promise<Buffer>;
  })();

  let signedPdf: Buffer;
  try {
    signedPdf = await sp.sign(withPlaceholder, externalSigner);
  } catch (e) {
    throw SignatureErrors.ProviderUnavailable("Falha ao incorporar assinatura no PDF.", String(e));
  }

  return {
    signedPdf: new Uint8Array(signedPdf.buffer, signedPdf.byteOffset, signedPdf.byteLength),
    signatureTimestamp: new Date().toISOString(),
  };
}