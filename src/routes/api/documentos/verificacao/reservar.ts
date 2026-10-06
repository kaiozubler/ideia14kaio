import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";
import {
  admin,
  gerarCodigo,
  gerarToken,
  hashSenha,
  linksVerificacao,
  montarClinica,
  origemPublica,
  sha256Hex,
  formatarCodigo,
} from "@/lib/documentos/verificacao.server";

// Reserva o registro de verificação ANTES de o PDF ser renderizado: o link
// autenticado devolvido aqui vira o QR code impresso no documento.
const texto = (max: number) => z.string().trim().max(max).optional().nullable();
const BodySchema = z.object({
  tipo: texto(60),
  titulo: texto(160),
  pacienteNome: texto(200),
  pacienteCpf: z.string().refine((v) => v.replace(/\D/g, "").length === 11, "cpf_invalido"),
  medico: z
    .object({ nome: texto(200), crm: texto(40), especialidade: texto(120) })
    .partial()
    .optional(),
  clinica: z
    .object({
      nome: texto(200),
      endereco: texto(300),
      telefone: texto(40),
      email: texto(200),
      cor: texto(20),
      whatsapp: texto(40),
    })
    .partial()
    .optional(),
});

export const Route = createFileRoute("/api/documentos/verificacao/reservar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

        const parsed = BodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });
        const body = parsed.data;

        try {
          const sb = await admin();
          const clinica = await montarClinica(userId, body.clinica ?? {});
          const id = crypto.randomUUID();
          const token = gerarToken();
          const ultimos4 = body.pacienteCpf.replace(/\D/g, "").slice(-4);
          const [tokenHash, senhaHash] = await Promise.all([
            sha256Hex(token),
            hashSenha(id, ultimos4),
          ]);

          // Colisão de código é improvável (32^10); tenta de novo algumas vezes por garantia.
          let codigo = "";
          for (let i = 0; i < 4; i++) {
            codigo = gerarCodigo();
            const { error } = await sb.from("documentos_verificacao").insert({
              id,
              id_medico: userId,
              codigo,
              token_hash: tokenHash,
              senha_hash: senhaHash,
              tipo: body.tipo ?? null,
              titulo: body.titulo ?? null,
              paciente_nome: body.pacienteNome ?? null,
              medico_nome: body.medico?.nome ?? null,
              medico_crm: body.medico?.crm ?? null,
              medico_especialidade: body.medico?.especialidade ?? null,
              clinica,
            });
            if (!error) break;
            if (error.code !== "23505" || i === 3) throw error;
          }

          const links = linksVerificacao(origemPublica(request), codigo, token);
          return Response.json({ id, codigo: formatarCodigo(codigo), ...links });
        } catch (e) {
          console.error("[documentos/verificacao/reservar]", e);
          return Response.json({ error: "server_error" }, { status: 500 });
        }
      },
    },
  },
});
