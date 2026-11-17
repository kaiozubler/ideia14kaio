import { createFileRoute } from "@tanstack/react-router";

import { getUserIdFromRequest } from "@/lib/signature/requestAuth.server";

/**
 * Consulta um estabelecimento no CNES (API de dados abertos do Ministério da
 * Saúde) para o cadastro de estabelecimentos do LME. Passa pelo servidor porque
 * a API não libera CORS para o navegador; exige login para não virar proxy aberto.
 * Devolve só o que o cadastro usa — nome, UF, esfera e se atende SUS.
 */
const UF_POR_CODIGO_IBGE: Record<number, string> = {
  11: "RO",
  12: "AC",
  13: "AM",
  14: "RR",
  15: "PA",
  16: "AP",
  17: "TO",
  21: "MA",
  22: "PI",
  23: "CE",
  24: "RN",
  25: "PB",
  26: "PE",
  27: "AL",
  28: "SE",
  29: "BA",
  31: "MG",
  32: "ES",
  33: "RJ",
  35: "SP",
  41: "PR",
  42: "SC",
  43: "RS",
  50: "MS",
  51: "MT",
  52: "GO",
  53: "DF",
};

type CnesApi = {
  codigo_cnes?: number;
  nome_fantasia?: string | null;
  nome_razao_social?: string | null;
  codigo_uf?: number | null;
  codigo_municipio?: number | null;
  descricao_esfera_administrativa?: string | null;
  estabelecimento_faz_atendimento_ambulatorial_sus?: string | null;
};

export const Route = createFileRoute("/api/cnes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await getUserIdFromRequest(request))) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const codigo = (new URL(request.url).searchParams.get("codigo") || "").replace(/\D/g, "");
        if (!/^\d{7}$/.test(codigo)) {
          return Response.json({ error: "cnes_invalido" }, { status: 400 });
        }
        try {
          const r = await fetch(
            `https://apidadosabertos.saude.gov.br/cnes/estabelecimentos/${codigo}`,
            { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) },
          );
          if (r.status === 404) return Response.json({ error: "nao_encontrado" }, { status: 404 });
          if (!r.ok) return Response.json({ error: "cnes_indisponivel" }, { status: 502 });
          const d = (await r.json()) as CnesApi;
          if (!d || !d.codigo_cnes)
            return Response.json({ error: "nao_encontrado" }, { status: 404 });
          const esfera = String(d.descricao_esfera_administrativa || "").toUpperCase();
          return Response.json({
            cnes: String(d.codigo_cnes).padStart(7, "0"),
            nome: (d.nome_fantasia || d.nome_razao_social || "").trim(),
            razao_social: (d.nome_razao_social || "").trim(),
            uf: d.codigo_uf ? UF_POR_CODIGO_IBGE[d.codigo_uf] || "" : "",
            codigo_municipio: d.codigo_municipio ? String(d.codigo_municipio) : "",
            esfera,
            publico: ["MUNICIPAL", "ESTADUAL", "FEDERAL"].includes(esfera),
            atende_sus:
              String(d.estabelecimento_faz_atendimento_ambulatorial_sus || "").toUpperCase() ===
              "SIM",
          });
        } catch {
          return Response.json({ error: "cnes_indisponivel" }, { status: 502 });
        }
      },
    },
  },
});
