import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

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
            ciclo: d.ciclo,
            dia_cobranca: d.diaCobranca ?? null,
            preco_mensal_calculado: d.precoMensalCalculado ?? null,
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

        const updates: Record<string, unknown> = {};
        if (d.plano !== undefined) updates.plano = d.plano;
        if (d.medicos !== undefined) updates.medicos = d.medicos;
        if (d.secretarias !== undefined) updates.secretarias = d.secretarias;
        if (d.copiloto !== undefined) updates.copiloto = d.copiloto;
        if (d.whatsapp !== undefined) updates.whatsapp = d.whatsapp;
        if (d.video !== undefined) updates.video = d.video;
        if (d.ciclo !== undefined) updates.ciclo = d.ciclo;
        if (d.diaCobranca !== undefined) updates.dia_cobranca = d.diaCobranca;
        if (d.precoMensalCalculado !== undefined) updates.preco_mensal_calculado = d.precoMensalCalculado;
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { error } = await supabaseAdmin.from("contratacoes").update(updates).eq("id", d.id);
        if (error) {
          console.error("[contratacao:atualizar]", error.message);
          return Response.json({ error: "não foi possível atualizar" }, { status: 500 });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
