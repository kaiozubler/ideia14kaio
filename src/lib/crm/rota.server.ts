// Envelope comum das rotas /api/public/crm/*: valida o CRM_BRIDGE_TOKEN
// antes de tocar em qualquer dado, carrega o supabaseAdmin só depois disso,
// traduz erros para { error } com o status certo e grava a auditoria.

import { z } from "zod";
import { ErroCrm, tokenCrmValido } from "./ponte.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

export type ContextoCrm = {
  request: Request;
  params: Record<string, string>;
  db: Db;
  ator: string;
  /** Grava a escrita em crm_auditoria (falha aqui derruba a resposta: escrita sem trilha não passa calada). */
  auditar(acao: string, alvo: string | null, payload: unknown): Promise<void>;
};

export function erroCrm(status: number, mensagem: string): Response {
  return Response.json({ error: mensagem }, { status });
}

/** Lê e valida o JSON do corpo; erro vira 400. */
export async function corpo<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ErroCrm(400, "JSON inválido");
  }
  return validar(schema, raw);
}

export function validar<T extends z.ZodTypeAny>(
  schema: T,
  valor: unknown,
  rotulo = "corpo",
): z.infer<T> {
  const r = schema.safeParse(valor);
  if (!r.success) {
    const p = r.error.issues[0];
    throw new ErroCrm(400, p ? `${p.path.join(".") || rotulo}: ${p.message}` : "entrada inválida");
  }
  return r.data;
}

export function rotaCrm(handler: (ctx: ContextoCrm) => Promise<unknown>) {
  return async ({ request, params }: { request: Request; params?: Record<string, string> }) => {
    const esperado = process.env["CRM_BRIDGE_TOKEN"];
    if (!esperado) console.error("[crm] CRM_BRIDGE_TOKEN não configurado — ponte fechada");
    if (!(await tokenCrmValido(request.headers.get("authorization"), esperado))) {
      return erroCrm(401, "unauthorized");
    }

    const ator = (request.headers.get("x-crm-actor") || "crm").trim().slice(0, 200) || "crm";
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      // Tabelas novas (crm_auditoria, acessos_bloqueados, pagamentos_manuais...) ainda não estão no types.ts gerado.
      const db = supabaseAdmin as Db;
      const resultado = await handler({
        request,
        params: params ?? {},
        db,
        ator,
        async auditar(acao, alvo, payload) {
          const { error } = await db
            .from("crm_auditoria")
            .insert({ acao, alvo, payload: payload ?? {}, ator });
          if (error) throw new Error(`crm_auditoria: ${error.message}`);
        },
      });
      return resultado instanceof Response ? resultado : Response.json(resultado);
    } catch (err) {
      if (err instanceof ErroCrm) return erroCrm(err.status, err.message);
      console.error("[crm]", err);
      return erroCrm(500, "erro interno");
    }
  };
}
