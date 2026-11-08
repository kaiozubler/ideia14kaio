import { createFileRoute } from "@tanstack/react-router";
import { autenticarPesquisa } from "@/lib/pesquisa/auth.server";
import { chamarIA, provedorDoUsuario } from "@/lib/ia/provedor.server";
import {
  PedidoSchema,
  campoPermitido,
  cpfsNoTexto,
  dadosDoMedico,
  montarMensagens,
  sanearSugestoes,
  variantesCpf,
} from "@/lib/extensao/preenchimento";

// Sugestões de preenchimento dos campos da página aberta na extensão. Só
// devolve valores: quem escreve na página é a extensão, depois que o médico
// revisa. O cadastro do paciente é lido com o token do próprio usuário (RLS),
// então secretárias e enfermeiras não recebem dados clínicos por aqui.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
};

const COLUNAS_CADASTRO =
  "paciente_id,name,cpf,data_nascimento,sexo,telefone,email,mae,pai,sus,convenio,ocupacao,naturalidade,cep,logradouro,numero,complemento,bairro,cidade,uf,endereco";

type Db = NonNullable<Awaited<ReturnType<typeof autenticarPesquisa>>>["client"];

async function pacienteDaTela(db: Db, texto: string) {
  const cpfs = cpfsNoTexto(texto);
  if (cpfs.length === 0) return null;
  const variantes = cpfs.flatMap(variantesCpf);
  // Dono da clínica lê a tabela; equipe só enxerga a view cadastral.
  const { data: medico } = await db
    .from("pacientes")
    .select(`${COLUNAS_CADASTRO},dados_clinicos`)
    .in("cpf", variantes)
    .limit(2);
  let linhas: Record<string, unknown>[] = (medico as Record<string, unknown>[] | null) ?? [];
  if (linhas.length === 0) {
    const { data: equipe } = await db
      .from("pacientes_cadastro")
      .select(COLUNAS_CADASTRO)
      .in("cpf", variantes)
      .limit(2);
    linhas = (equipe as Record<string, unknown>[] | null) ?? [];
  }
  // Dois pacientes diferentes na tela: melhor não escolher um por conta própria.
  if (linhas.length !== 1) return null;
  const { paciente_id: _id, ...dados } = linhas[0];
  return Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== null && v !== ""));
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

export const Route = createFileRoute("/api/public/extensao/preencher")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        const auth = await autenticarPesquisa(request);
        if (!auth) return json({ error: "unauthorized" }, 401);

        let pedido;
        try {
          const parsed = PedidoSchema.safeParse(await request.json());
          if (!parsed.success) return json({ error: "invalid_body" }, 400);
          pedido = parsed.data;
        } catch {
          return json({ error: "invalid_json" }, 400);
        }

        const campos = pedido.campos.filter(campoPermitido);
        if (campos.length === 0) return json({ sugestoes: [], paciente_identificado: false });

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return json({ error: "ia_indisponivel" }, 500);

        try {
          const paciente = await pacienteDaTela(auth.client, pedido.contexto_tela).catch(
            () => null,
          );
          const medico = dadosDoMedico(auth.metadata, auth.user.email);
          const agora = new Date(Date.now() - 180 * 60000).toISOString().slice(0, 16);
          const resposta = await chamarIA(
            provedorDoUsuario(auth.metadata),
            montarMensagens(pedido, campos, medico, paciente, agora),
            apiKey,
            "low",
          );
          return json({
            sugestoes: sanearSugestoes(resposta, campos),
            paciente_identificado: !!paciente,
          });
        } catch (err) {
          if (err instanceof Response) {
            const status = err.status === 422 ? 422 : 502;
            return json({ error: status === 422 ? await err.text() : "ia_falhou" }, status);
          }
          console.error("[extensao/preencher]", err instanceof Error ? err.message : err);
          return json({ error: "internal_error" }, 500);
        }
      },
    },
  },
});
