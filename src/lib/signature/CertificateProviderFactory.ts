// Central resolution point for certificate providers.
// Adding a new provider = implement CertificateProvider + register it here.
import type { CertificateProvider, StoredCertificate } from "./CertificateProvider";
import { SignatureErrors } from "./errors";

// bry_cloud cobre A1 Bry e A3 Bry (mesmo endpoint BRyKMS; ver
// certificate_subtype em doctor_certificates para distinguir os dois).
// local = A1 externo (.pfx/.p12 do usuário). integra_icp = agregador
// terceiro legado (não é Bry).
//
// A3 externo (certificado hospedado por outro PSC) NÃO é um CertificateProvider
// aqui: é uma sessão de link de curta duração via Integra Bry, tratada em
// src/lib/bry/integraBry.server.ts + SignatureService.{start,complete}IntegraBryLink
// + SignatureService.signWithIntegraBry — sem credencial persistente como
// os providers abaixo.
export type ProviderId = "bry_cloud" | "integra_icp" | "local" | (string & {});

type Loader = () => Promise<CertificateProvider>;

const registry: Record<string, Loader> = {
  bry_cloud: async () =>
    (await import("./providers/BryCloudCertificateProvider.server")).BryCloudCertificateProvider,
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
