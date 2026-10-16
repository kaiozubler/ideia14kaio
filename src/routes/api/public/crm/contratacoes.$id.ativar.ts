import { createFileRoute } from "@tanstack/react-router";
import { listarUsuariosAuth, repoAcessos } from "@/lib/crm/dados.server";
import { AtivarContratacaoSchema, ErroCrm, IdSchema, definirAcessoClinica } from "@/lib/crm/ponte";
import { corpo, rotaCrm, validar } from "@/lib/crm/rota.server";

// Zubler CRM: ativa à mão uma contratação paga que o webhook do Asaas não
// conseguiu ativar (ex.: contratação antiga sem conta vinculada).
export const Route = createFileRoute("/api/public/crm/contratacoes/$id/ativar")({
  server: {
    handlers: {
      POST: rotaCrm(async ({ request, params, db, ator, auditar }) => {
        const id = validar(IdSchema, params.id, "id");
        const { medico_email } = await corpo(request, AtivarContratacaoSchema);

        const { data: c, error } = await db
          .from("contratacoes")
          .select(
            "id, user_id, plano, medicos, secretarias, copiloto, whatsapp, video, ciclo, dia_cobranca, preco_mensal_calculado, asaas_customer_id, asaas_subscription_id",
          )
          .eq("id", id)
          .maybeSingle();
        if (error) throw new Error(`contratacoes: ${error.message}`);
        if (!c) throw new ErroCrm(404, "contratação não encontrada");

        const medico = (await listarUsuariosAuth(db)).find(
          (u) => u.email?.toLowerCase() === medico_email,
        );
        if (!medico) throw new ErroCrm(404, "nenhum usuário com este e-mail");

        const { data: existente } = await db
          .from("assinaturas")
          .select("id")
          .or(`contratacao_id.eq.${id},and(medico_id.eq.${medico.id},status.neq.cancelada)`)
          .limit(1)
          .maybeSingle();
        if (existente)
          throw new ErroCrm(409, "já existe uma assinatura para esta contratação ou este médico");

        const { PLANOS_BASE, PLANO_PADRAO } = await import("@/lib/plans/config");
        const ancora = PLANOS_BASE.find((p) => p.id === c.plano) ?? PLANO_PADRAO;
        const { data: assinatura, error: insErr } = await db
          .from("assinaturas")
          .insert({
            medico_id: medico.id,
            contratacao_id: c.id,
            plano: c.plano,
            medicos: c.medicos,
            secretarias: c.secretarias,
            copiloto: c.copiloto,
            whatsapp: c.whatsapp,
            video: c.video,
            ciclo: c.ciclo,
            dia_cobranca: c.dia_cobranca,
            preco_mensal: c.preco_mensal_calculado ?? ancora.precoMensal,
            status: "ativa",
            asaas_customer_id: c.asaas_customer_id,
            asaas_subscription_id: c.asaas_subscription_id,
          })
          .select("id")
          .single();
        if (insErr) {
          if (insErr.code === "23505") throw new ErroCrm(409, "este médico já tem uma assinatura");
          throw new Error(`assinaturas: ${insErr.message}`);
        }

        if (!c.user_id) await db.from("contratacoes").update({ user_id: medico.id }).eq("id", c.id);
        // Assinatura paga reabre o acesso da clínica toda, se o CRM a tinha suspendido.
        await definirAcessoClinica(repoAcessos(db), medico.id, false, null, ator);

        await auditar("contratacao.ativar", id, {
          medico_id: medico.id,
          medico_email,
          assinatura_id: assinatura.id,
        });
        return { ok: true, assinatura_id: assinatura.id };
      }),
    },
  },
});
