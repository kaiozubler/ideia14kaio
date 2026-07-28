// Central resolution point for certificate providers.
// Adding a new provider = implement CertificateProvider + register it here.
import type { CertificateProvider, StoredCertificate } from "./CertificateProvider";
import { SignatureErrors } from "./errors";

export type ProviderId = "integra_icp" | "local" | (string & {});

type Loader = () => Promise<CertificateProvider>;

const registry: Record<string, Loader> = {
  integra_icp: async () =>
    (await import("./providers/IntegraICPCertificateProvider")).IntegraICPCertificateProvider,
  local: async () =>
    (await import("./providers/LocalCertificateProvider.server")).LocalCertificateProvider,
};

export const CertificateProviderFactory = {
  /** Registers an extra provider at runtime (tests / future plugins). */
  register(id: string, loader: Loader) {
    registry[id] = loader;
  },

  list(): string[] {
    return Object.keys(registry);
  },

  async getById(id: ProviderId): Promise<CertificateProvider> {
    const loader = registry[id];
    if (!loader) throw SignatureErrors.NotConfigured(`Provedor de certificado desconhecido: ${id}`);
    return loader();
  },

  /** Resolves from the stored certificate row (default keeps legacy rows on cloud). */
  async get(certificate: StoredCertificate | null | undefined): Promise<CertificateProvider> {
    return this.getById(certificate?.provider || "integra_icp");
  },
};