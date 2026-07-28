// Provider-agnostic contract for digital certificate providers.
// Any new provider (Bry, VIDaaS, SafeID, A3 token, ...) only needs to
// implement this interface and register itself in CertificateProviderFactory.
import type { AuthenticateInput, AuthenticateResult } from "./types";

/** Row shape of public.doctor_certificates (loose on purpose). */
export interface StoredCertificate {
  id?: string;
  doctor_id: string;
  provider?: string | null;
  certificate_type?: string | null;
  credential_id: string;
  storage_path?: string | null;
  issuer?: string | null;
  holder_document?: string | null;
  label?: string | null;
  provider_name?: string | null;
  product_name?: string | null;
  certificate_subject?: string | null;
  certificate_serial?: string | null;
  certificate_fingerprint?: string | null;
  certificate_valid_from?: string | null;
  certificate_valid_until?: string | null;
  credential_expires_at?: string | null;
  [key: string]: unknown;
}

export interface CertificateInformation {
  provider: string;
  certificateType: string;
  label: string | null;
  subject: string | null;
  holderDocument: string | null;
  serial: string | null;
  issuer: string | null;
  fingerprint: string | null;
  validFrom: string | null;
  validUntil: string | null;
  expiresAt: string | null;
  expired: boolean;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  /** Provider-specific hint the API layer can forward to the UI. */
  code?: string;
}

export interface SignDocumentParams {
  certificate: StoredCertificate;
  documentId: string;
  pdfBuffer: Uint8Array;
  contentDescription: string;
  /** Only used by providers that require a per-signature secret (e.g. PFX password). */
  secret?: string | null;
}

export interface SignedDocument {
  signedPdf: Uint8Array;
  signatureTimestamp: string | null;
}

export interface CertificateProvider {
  /** Stable id persisted in doctor_certificates.provider */
  readonly id: string;
  /** Starts an authentication / enrollment flow. */
  authenticate(
    input: AuthenticateInput | Record<string, unknown>,
  ): Promise<AuthenticateResult | Record<string, unknown>>;
  /** Checks whether the stored certificate can still be used. */
  validateCertificate(certificate: StoredCertificate): Promise<ValidationResult>;
  /** Produces a signed PAdES PDF. */
  signDocument(params: SignDocumentParams): Promise<SignedDocument>;
  /** Removes any provider-side / storage-side artifacts. Optional semantics. */
  revokeAuthentication(certificate: StoredCertificate): Promise<void>;
  /** Normalized, UI-safe certificate metadata. */
  getCertificateInformation(certificate: StoredCertificate): CertificateInformation;
}

/** Shared helper so every provider exposes the same normalized shape. */
export function baseCertificateInformation(
  certificate: StoredCertificate,
  providerId: string,
): CertificateInformation {
  const until = certificate.credential_expires_at ?? certificate.certificate_valid_until ?? null;
  return {
    provider: certificate.provider ?? providerId,
    certificateType: certificate.certificate_type ?? "cloud",
    label: certificate.label ?? null,
    subject: certificate.certificate_subject ?? null,
    holderDocument: certificate.holder_document ?? null,
    serial: certificate.certificate_serial ?? null,
    issuer: certificate.issuer ?? certificate.provider_name ?? null,
    fingerprint: certificate.certificate_fingerprint ?? null,
    validFrom: certificate.certificate_valid_from ?? null,
    validUntil: certificate.certificate_valid_until ?? null,
    expiresAt: certificate.credential_expires_at ?? null,
    expired: until ? new Date(until).getTime() < Date.now() : false,
  };
}