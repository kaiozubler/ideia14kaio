// Types for the ICP-Brasil digital signature integration.
// Provider-agnostic — IntegraICP is the current implementation.

export interface AuthenticateInput {
  doctorId: string;
  cpf: string;
  callbackUrl: string;
}

export interface Clearance {
  provider: string;
  product?: string;
  authorizationUrl: string;
  raw?: unknown;
}

export interface AuthenticateResult {
  requestId: string;
  sessionId: string;
  clearances: Clearance[];
  redirectUrl: string | null;
}

export interface CredentialData {
  credentialId: string;
  providerName: string | null;
  productName: string | null;
  certificateSubject: string | null;
  certificateSerial: string | null;
  certificateFingerprint: string | null;
  certificateValidFrom: string | null;
  certificateValidUntil: string | null;
  credentialExpiresAt: string | null;
  raw: unknown;
}

export interface SignRequest {
  doctorId: string;
  documentId: string;
  documentBuffer: ArrayBuffer;
  contentDescription?: string;
}

export interface SignResult {
  signedContent: string; // base64 CMS
  signatureTimestamp: string | null;
  raw: unknown;
}

export interface SignatureProvider {
  authenticate(params: {
    cpf: string;
    codeChallenge: string;
    callbackUrl: string;
  }): Promise<{ requestId: string; clearances: Clearance[] }>;

  fetchCredential(params: {
    credentialId: string;
    codeVerifier: string;
  }): Promise<CredentialData>;

  sign(params: {
    credentialId: string;
    codeVerifier: string;
    documentId: string;
    contentDigest: string; // base64 SHA-256
    contentDescription: string;
  }): Promise<SignResult>;
}