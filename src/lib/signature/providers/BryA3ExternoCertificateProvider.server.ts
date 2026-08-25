// A3 externo: token USB ou smart card físico do médico, acessado via
// driver PKCS#11 no navegador (Web Crypto / middleware do fabricante).
// A chave privada NUNCA sai do dispositivo do usuário e o servidor nunca
// a acessa — por isso a assinatura acontece em duas chamadas HTTP:
//
//   1) POST /api/signature/a3-externo/prepare
//      -> servidor monta o placeholder PAdES e devolve o digest exato
//         (SHA-256) que precisa ser assinado localmente.
//   2) [no navegador] o driver do token assina o digest (RSA-SHA256) e
//      monta o CMS/PKCS#7 detached usando o certificado do token.
//   3) POST /api/signature/a3-externo/finalize
//      -> servidor recebe o CMS pronto e espeta de volta no PDF.
//
// Este provider expõe signDocument() só para completar a interface
// CertificateProvider (uso via SignatureService.signDocument genérico);
// o caminho recomendado para A3 externo é sempre pelas duas rotas acima,
// que chamam preparePlaceholder/finalizeWithCms diretamente.
import { CredentialRepository } from "../CredentialRepository";
import { SignatureError, SignatureErrors } from "../errors";
import {
  baseCertificateInformation,
  type CertificateInformation,
  type CertificateProvider,
  type SignDocumentParams,
  type SignedDocument,
  type StoredCertificate,
  type ValidationResult,
} from "../CertificateProvider";

export const PROVIDER_ID = "bry_a3_externo";

export const BryA3ExternoCertificateProvider: CertificateProvider = {
  id: PROVIDER_ID,

  /**
   * Registro é só informativo (rótulo + documento do titular): não há
   * segredo nenhum para guardar, o certificado nunca sai do token local.
   * O navegador confirma que o token está acessível antes de chamar isto
   * (ex.: lendo o certificado via WebCrypto/PKCS#11 e mandando o subject).
   */
  async authenticate(input) {
    const { doctorId, holderDocument, holderName, label } = input as unknown as {
      doctorId: string;
      holderDocument?: string;
      holderName?: string | null;
      label?: string | null;
    };
    const digits = (holderDocument ?? "").replace(/\D/g, "");
    if (digits.length !== 11) {
      throw new SignatureError("invalid_cpf", "Informe um CPF válido (11 dígitos).", 400);
    }

    await CredentialRepository.upsertA3ExternoCertificate({
      doctorId,
      credentialId: `bry_a3_externo:${digits}`,
      label: label ?? null,
      holderDocument: digits,
      subject: holderName ?? null,
    });

    return {
      ok: true,
      provider: PROVIDER_ID,
      certificateType: "token",
      certificateSubtype: "a3_token",
      holderDocument: digits,
    };
  },

  async validateCertificate(certificate: StoredCertificate): Promise<ValidationResult> {
    if (!certificate.holder_document) {
      return { valid: false, code: "not_configured", reason: "CPF do titular ausente." };
    }
    // Não há como o servidor checar a validade do certificado do token sem
    // acessá-lo; a checagem real acontece no navegador antes do prepare.
    return { valid: true };
  },

  /**
   * Caminho de conveniência: só funciona se o chamador já executou a fase 1
   * (preparePlaceholder) fora daqui e está passando `externalSignatureCms` +
   * `signSessionId`. Rotas dedicadas (a3-externo/prepare e .../finalize)
   * são o fluxo recomendado — ver cabeçalho do arquivo.
   */
  async signDocument(params: SignDocumentParams): Promise<SignedDocument> {
    if (!params.externalSignatureCms || !params.signSessionId) {
      throw new SignatureError(
        "client_signature_required",
        "A3 externo exige o fluxo de duas fases: chame /api/signature/a3-externo/prepare, " +
          "assine o digest no token local e finalize em /api/signature/a3-externo/finalize.",
        428,
      );
    }
    const session = await CredentialRepository.consumeSignSession({
      sessionId: params.signSessionId,
      doctorId: params.certificate.doctor_id,
    });
    if (!session) {
      throw SignatureErrors.Timeout(
        "Sessão de assinatura A3 externo expirada ou já utilizada. Inicie novamente em /prepare.",
      );
    }
    const { finalizeWithCms } = await import("../PadesEmbedder.server");
    return finalizeWithCms({
      placeholderPdf: session.placeholderPdf,
      cmsBase64: params.externalSignatureCms,
    });
  },

  async revokeAuthentication(certificate: StoredCertificate): Promise<void> {
    await CredentialRepository.deleteCertificate(certificate.doctor_id, certificate.id);
  },

  getCertificateInformation(certificate: StoredCertificate): CertificateInformation {
    return baseCertificateInformation(certificate, PROVIDER_ID);
  },
};
