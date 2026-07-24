// Domain-specific errors for the signature integration.
export class SignatureError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const SignatureErrors = {
  CredentialExpired: (m = "Credencial ICP-Brasil expirada. Reautentique.") =>
    new SignatureError("credential_expired", m, 401),
  ProviderUnavailable: (m = "Provedor de assinatura indisponível.", d?: unknown) =>
    new SignatureError("provider_unavailable", m, 502, d),
  UserCancelled: (m = "Autenticação cancelada pelo usuário.") =>
    new SignatureError("user_cancelled", m, 400),
  InvalidPKCE: (m = "PKCE inválido.") =>
    new SignatureError("invalid_pkce", m, 400),
  InvalidDigest: (m = "SHA-256 inválido.") =>
    new SignatureError("invalid_digest", m, 400),
  Timeout: (m = "Tempo limite excedido.") =>
    new SignatureError("timeout", m, 504),
  CallbackMissing: (m = "Callback não recebido do provedor.") =>
    new SignatureError("callback_missing", m, 504),
  NotConfigured: (m = "IntegraICP não configurado (secrets ausentes).") =>
    new SignatureError("not_configured", m, 500),
  Unauthorized: (m = "Não autorizado.") =>
    new SignatureError("unauthorized", m, 401),
};