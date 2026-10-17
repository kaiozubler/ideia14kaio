import { createFileRoute } from "@tanstack/react-router";
import {
  assinaturaDe,
  carregarBase,
  casaBusca,
  idsDeClinicas,
  membrosComLogin,
  nomeClinicaDe,
} from "@/lib/crm/dados.server";
import { BuscaSchema } from "@/lib/crm/ponte";
import { rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: lista de clínicas (a clínica é a conta do médico dono).
export const Route = createFileRoute("/api/public/crm/clinicas")({
  server: {
    handlers: {
      GET: rotaCrm(async ({ request, db }) => {
        const busca = validar(
          BuscaSchema,
          new URL(request.url).searchParams.get("busca") ?? undefined,
          "busca",
        );
        const base = await carregarBase(db);
        const clinicas = idsDeClinicas(base)
          .map((id) => {
            const dono = base.usuarios.get(id);
            const config = base.configs.get(id);
            const assinatura = assinaturaDe(base, id);
            const vigente = assinatura && assinatura.status !== "cancelada" ? assinatura : null;
            return {
              id,
              nome: nomeClinicaDe(base, id),
              email: config?.email || dono?.email || null,
              cidade: config?.cidade ?? null,
              uf: config?.uf ?? null,
              plano: vigente?.plano ?? "free",
              status_assinatura: assinatura?.status ?? null,
              preco_mensal: vigente ? Number(vigente.preco_mensal) : null,
              proxima_cobranca: vigente?.proxima_cobranca ?? null,
              acesso_bloqueado: base.bloqueios.has(id),
              membros: membrosComLogin(base, id).length,
              _busca: [config?.razao_social, config?.cnpj_cpf, dono?.email],
            };
          })
          .filter((c) => casaBusca(busca, c.nome, c.email, c.cidade, ...c._busca))
          .map(({ _busca, ...c }) => c)
          .sort((a, b) => (a.nome ?? "").localeCompare(b.nome ?? "", "pt-BR"));
        return { clinicas };
      }),
    },
  },
});
