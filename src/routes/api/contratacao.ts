import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  PLANOS_BASE,
  copilotoAtivoDaConfiguracao,
  erroDaConfiguracao,
  precoMensalNoServidor,
  type ConfiguracaoPlano,
} from "@/lib/plans/config";

// Persiste o fluxo de compra (/planos → /contratacao/*) na tabela
// `contratacoes` (ver supabase/migrations/20260922150000_contratacoes.sql).
// Essa tabela não tem NENHUMA policy de RLS pra anon/authenticated de
// propósito (guarda CPF/CNPJ, endereço, contatos) — por isso tudo passa
// por aqui, usando supabaseAdmin (service role), nunca direto do
// navegador com a anon key.
//
// POST cria a linha assim que a pessoa chega em "Confirme seu plano"
// (mesmo que abandone logo depois — é o que permite medir abandono por
// etapa). PATCH atualiza campos conforme ela avança; o id sempre vai no
// corpo da requisição (mais simples que rota dinâmica, e como cada linha
// só é editável por quem tem o id — que só existe no sessionStorage de
// quem criou — não precisa de mais controle de acesso que isso aqui).
//
// O preço NUNCA vem do navegador: preco_mensal_calculado é recalculado aqui a
// partir do plano e da configuração (que também é validada), e a configuração
// não muda mais depois que o pagamento foi gerado.

const ContatoSchema = z.object({
  nome: z.string(),
  email: z.string(),
  telefone: z.string(),
});

const EnderecoSchema = z.object({
  cep: z.string(),
  logradouro: z.string(),
  numero: z.string(),
  complemento: z.string(),
  bairro: z.string(),
  cidade: z.string(),
  estado: z.string(),
  cidadeIbge: z.string().optional(),
});

const CriarSchema = z.object({
  plano: z.enum(["basic", "pro", "enterprise"]),
  medicos: z.number().int().min(0),
  secretarias: z.number().int().min(0),
  copiloto: z.number().int(),
  whatsapp: z.number().int(),
  video: z.number().int(),
  copilotoAtivo: z.boolean().optional(),
  ciclo: z.enum(["mensal", "anual"]),
  diaCobranca: z.number().int().min(1).max(28).nullable().optional(),
  precoMensalCalculado: z.number().nullable().optional(),
});

const AtualizarSchema = z.object({
  id: z.string().uuid(),
  plano: z.enum(["basic", "pro", "enterprise"]).optional(),
  medicos: z.number().int().min(0).optional(),
  secretarias: z.number().int().min(0).optional(),
  copiloto: z.number().int().optional(),
  whatsapp: z.number().int().optional(),
  video: z.number().int().optional(),
  copilotoAtivo: z.boolean().optional(),
  ciclo: z.enum(["mensal", "anual"]).optional(),
  diaCobranca: z.number().int().min(1).max(28).nullable().optional(),
  precoMensalCalculado: z.number().nullable().optional(),
  nomeClinica: z.string().optional(),
  documento: z.string().optional(),
  endereco: EnderecoSchema.optional(),
  responsavel: ContatoSchema.extend({ cargo: z.string() }).optional(),
  financeiroMesmoResponsavel: z.boolean().optional(),
  financeiro: z.array(ContatoSchema).optional(),
  juridicoMesmoResponsavel: z.boolean().optional(),
  juridico: z.array(ContatoSchema).optional(),
  especialidade: z.string().optional(),
  pacientesMes: z.string().optional(),
  comoConheceu: z.string().optional(),
  termosAceitos: z.boolean().optional(),
  status: z.enum(["em_andamento", "aguardando_confirmacao", "confirmada", "cancelada"]).optional(),
});

export const Route = createFileRoute("/api/contratacao")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = await request.json().catch(() => null);
        const body = CriarSchema.safeParse(json);
        if (!body.success) return Response.json({ error: "payload inválido" }, { status: 400 });
        const d = body.data;

        const calculo = calcularPlano(d.plano, d);
        if ("erro" in calculo) return Response.json({ error: calculo.erro }, { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("contratacoes")
          .insert({
            plano: d.plano,
            medicos: d.medicos,
            secretarias: d.secretarias,
            copiloto: d.copiloto,
            whatsapp: d.whatsapp,
            video: d.video,
            copiloto_ativo: calculo.copilotoAtivo,
            ciclo: d.ciclo,
            dia_cobranca: d.diaCobranca ?? null,
            preco_mensal_calculado: calculo.preco,
          })
          .select("id")
          .single();

        if (error || !data) {
          console.error("[contratacao:criar]", error?.message);
          return Response.json({ error: "não foi possível salvar" }, { status: 500 });
        }
        return Response.json({ id: data.id });
      },

      PATCH: async ({ request }) => {
        const json = await request.json().catch(() => null);
        const body = AtualizarSchema.safeParse(json);
        if (!body.success) return Response.json({ error: "payload inválido" }, { status: 400 });
        const d = body.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const updates: Record<string, unknown> = {};

        const mudaPlano = [d.plano, d.medicos, d.secretarias, d.copiloto, d.whatsapp, d.video, d.copilotoAtivo].some(
          (v) => v !== undefined,
        );
        if (mudaPlano) {
          const { data: atual, error: errAtual } = await supabaseAdmin
            .from("contratacoes")
            .select("plano, medicos, secretarias, copiloto, whatsapp, video, copiloto_ativo, status, asaas_checkout_id")
            .eq("id", d.id)
            .maybeSingle();
          if (errAtual) {
            console.error("[contratacao:atualizar]", errAtual.message);
            return Response.json({ error: "não foi possível atualizar" }, { status: 500 });
          }
          if (!atual) return Response.json({ error: "contratação não encontrada" }, { status: 404 });
          // Depois de gerado o pagamento, a configuração é a que foi cobrada.
          if (atual.asaas_checkout_id || atual.status === "confirmada") {
            return Response.json({ error: "o plano desta contratação já foi para pagamento" }, { status: 409 });
          }
          const plano = (d.plano ?? atual.plano) as "basic" | "pro" | "enterprise";
          const calculo = calcularPlano(plano, {
            medicos: d.medicos ?? atual.medicos,
            secretarias: d.secretarias ?? atual.secretarias,
            copiloto: d.copiloto ?? atual.copiloto,
            whatsapp: d.whatsapp ?? atual.whatsapp,
            video: d.video ?? atual.video,
            copilotoAtivo: d.copilotoAtivo ?? atual.copiloto_ativo,
          });
          if ("erro" in calculo) return Response.json({ error: calculo.erro }, { status: 400 });
          Object.assign(updates, {
            plano,
            medicos: calculo.config.medicos,
            secretarias: calculo.config.secretarias,
            copiloto: calculo.config.copiloto,
            whatsapp: calculo.config.whatsapp,
            video: calculo.config.video,
            copiloto_ativo: calculo.copilotoAtivo,
            preco_mensal_calculado: calculo.preco,
          });
        }
        if (d.ciclo !== undefined) updates.ciclo = d.ciclo;
        if (d.diaCobranca !== undefined) updates.dia_cobranca = d.diaCobranca;
        if (d.nomeClinica !== undefined) updates.nome_clinica = d.nomeClinica;
        if (d.documento !== undefined) updates.documento = d.documento;
        if (d.endereco) {
          updates.cep = d.endereco.cep;
          updates.logradouro = d.endereco.logradouro;
          updates.numero = d.endereco.numero;
          updates.complemento = d.endereco.complemento;
          updates.bairro = d.endereco.bairro;
          updates.cidade = d.endereco.cidade;
          updates.estado = d.endereco.estado;
          if (d.endereco.cidadeIbge) updates.cidade_ibge = d.endereco.cidadeIbge;
        }
        if (d.responsavel) {
          updates.responsavel_nome = d.responsavel.nome;
          updates.responsavel_email = d.responsavel.email;
          updates.responsavel_telefone = d.responsavel.telefone;
          updates.responsavel_cargo = d.responsavel.cargo;
        }
        if (d.financeiroMesmoResponsavel !== undefined) updates.financeiro_mesmo_responsavel = d.financeiroMesmoResponsavel;
        if (d.financeiro !== undefined) updates.financeiro = d.financeiro;
        if (d.juridicoMesmoResponsavel !== undefined) updates.juridico_mesmo_responsavel = d.juridicoMesmoResponsavel;
        if (d.juridico !== undefined) updates.juridico = d.juridico;
        if (d.especialidade !== undefined) updates.especialidade = d.especialidade;
        if (d.pacientesMes !== undefined) updates.pacientes_mes = d.pacientesMes;
        if (d.comoConheceu !== undefined) updates.como_conheceu = d.comoConheceu;
        if (d.termosAceitos !== undefined) {
          updates.termos_aceitos = d.termosAceitos;
          if (d.termosAceitos) updates.termos_aceitos_em = new Date().toISOString();
        }
        if (d.status !== undefined) updates.status = d.status;

        if (Object.keys(updates).length === 0) return Response.json({ ok: true });

        const { error } = await supabaseAdmin.from("contratacoes").update(updates as any).eq("id", d.id);
        if (error) {
          console.error("[contratacao:atualizar]", error.message);
          return Response.json({ error: "não foi possível atualizar" }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});

/** Valida a configuração do plano e calcula no servidor o preço e o adicional. */
function calcularPlano(
  planoId: "basic" | "pro" | "enterprise",
  config: ConfiguracaoPlano,
): { erro: string } | { config: ConfiguracaoPlano; copilotoAtivo: boolean; preco: number | null } {
  const plano = PLANOS_BASE.find((p) => p.id === planoId);
  if (!plano) return { erro: "plano inválido" };
  const erro = erroDaConfiguracao(plano, config);
  if (erro) return { erro };
  return {
    config,
    copilotoAtivo: copilotoAtivoDaConfiguracao(plano, config.copilotoAtivo),
    preco: precoMensalNoServidor(plano, config),
  };
}
