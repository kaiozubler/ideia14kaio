// Central resolution point for certificate providers.
// Adding a new provider = implement CertificateProvider + register it here.
import type { CertificateProvider, StoredCertificate } from "./CertificateProvider";
import { SignatureErrors } from "./errors";

// bry_cloud cobre A1 Bry e A3 Bry (mesmo endpoint BRyKMS; ver
// certificate_subtype em doctor_certificates para distinguir os dois).
// local = A1 externo (.pfx/.p12 do usuário). bry_a3_externo = A3 externo
// (token/smartcard local, fluxo de duas fases). integra_icp = agregador
// terceiro legado (não é Bry).
export type ProviderId = "bry_cloud" | "bry_a3_externo" | "integra_icp" | "local" | (string & {});

type Loader = () => Promise<CertificateProvider>;

const registry: Record<string, Loader> = {
  bry_cloud: async () =>
    (await import("./providers/BryCloudCertificateProvider.server")).BryCloudCertificateProvider,
  bry_a3_externo: async () =>
    (await import("./providers/BryA3ExternoCertificateProvider.server"))
      .BryA3ExternoCertificateProvider,
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

  /** Resolves from the stored certificate row (legacy rows without provider are IntegraICP). */
  async get(certificate: StoredCertificate | null | undefined): Promise<CertificateProvider> {
    return this.getById(certificate?.provider || "integra_icp");
  },
};
