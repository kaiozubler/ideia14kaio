import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  admin,
  BUCKET_VERIFICACAO,
  conferirSenha,
  formatarCodigo,
  iguaisTempoConstante,
  ipDaRequisicao,
  linksVerificacao,
  normalizarCodigo,
  numeroWhatsapp,
  origemPublica,
  sha256Hex,
} from "@/lib/documentos/verificacao.server";

// Libera o documento para a página /v/<codigo>: pelo token do QR code (k) ou
// pelos 4 últimos dígitos do CPF do paciente (senha), com tentativas limitadas.
const BodySchema = z.object({
  codigo: z.string().max(20),
  k: z.string().max(100).optional(),
  senha: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
});

export const Route = createFileRoute("/api/public/documentos/abrir")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = BodySchema.safeParse(await request.json().catch(() => null));
        const codigo = parsed.success ? normalizarCodigo(parsed.data.codigo) : null;
        if (!parsed.success || !codigo || (!parsed.data.k && !parsed.data.senha)) {
          return Response.json({ error: "invalid_body" }, { status: 400 });
        }
        const { k, senha } = parsed.data;

        try {
          const sb = await admin();
          const { data: reg, error } = await sb
            .from("documentos_verificacao")
            .select("*")
            .eq("codigo", codigo)
            .maybeSingle();
          if (error) throw error;
          if (!reg) return Response.json({ error: "not_found" }, { status: 404 });

          if (k) {
            if (!iguaisTempoConstante(await sha256Hex(k), reg.token_hash)) {
              return Response.json({ error: "token_invalido" }, { status: 401 });
            }
          } else {
            const r = await conferirSenha(reg, senha!, ipDaRequisicao(request));
            if (r === "bloqueado") return Response.json({ error: "bloqueado" }, { status: 429 });
            if (r === "invalida")
              return Response.json({ error: "senha_invalida" }, { status: 401 });
          }

          if (reg.status === "revogado")
            return Response.json({ error: "revogado" }, { status: 410 });
          if (reg.status !== "emitido" || !reg.arquivo_path) {
            return Response.json({ error: "nao_emitido" }, { status: 409 });
          }

          const [{ data: url, error: urlErr }, { data: cfg }] = await Promise.all([
            sb.storage.from(BUCKET_VERIFICACAO).createSignedUrl(reg.arquivo_path, 60 * 30),
            sb
              .from("medico_clinica_config")
              .select("logo_data_url")
              .eq("id_medico", reg.id_medico)
              .maybeSingle(),
          ]);
          if (urlErr) throw urlErr;

          return Response.json(
            {
              documento: {
                codigo: formatarCodigo(reg.codigo),
                urlCurta: linksVerificacao(origemPublica(request), reg.codigo).urlCurta,
                tipo: reg.tipo,
                titulo: reg.titulo,
                pacienteNome: reg.paciente_nome,
                medico: {
                  nome: reg.medico_nome,
                  crm: reg.medico_crm,
                  especialidade: reg.medico_especialidade,
                },
                emitidoEm: reg.emitido_em,
                sha256: reg.arquivo_sha256,
                bytes: reg.arquivo_bytes,
              },
              assinatura: reg.assinatura ?? { assinado: false },
              clinica: {
                ...reg.clinica,
                logo: cfg?.logo_data_url ?? null,
                whatsapp: numeroWhatsapp(reg.clinica?.whatsapp),
              },
              pdfUrl: url.signedUrl,
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (e) {
          console.error("[public/documentos/abrir]", e);
          return Response.json({ error: "server_error" }, { status: 500 });
        }
      },
    },
  },
});
