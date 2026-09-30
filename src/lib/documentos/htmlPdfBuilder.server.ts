// Gera o PDF da receita usando o MESMO template visual que o app usa
// (public/receita-modelo.html), para que o documento emitido pelo
// assistente (WhatsApp ou chat interno) saia idêntico ao que o médico já
// está acostumado a ver quando gera pela tela do MediCopilot — em vez do
// layout simples e genérico desenhado à mão em pdfBuilder.server.ts.
//
// O app monta esse mesmo template NO NAVEGADOR (html2canvas/html2pdf.js,
// ver _renderDocumentoPdf em public/medicopilot.html). Aqui, sem navegador
// disponível, usamos um Chromium headless (Playwright) para renderizar o
// HTML preenchido e exportar como PDF — o layout final é o mesmo porque é
// literalmente o mesmo arquivo HTML/CSS, só que impresso pelo servidor.
//
// IMPORTANTE — dependência de infraestrutura: isto exige que o ambiente de
// produção consiga rodar um Chromium headless (pacote "playwright" +
// binário do navegador instalado no build). Isso pode não estar disponível
// em todo tipo de hospedagem (ex.: alguns presets serverless/edge do Nitro
// não suportam executar um binário nativo). Por isso TODA chamada aqui é
// best-effort: qualquer falha (import, download de template, launch do
// browser, timeout) é capturada e devolve null — o chamador (gerar_receita)
// cai de volta pro PDF gerado com pdf-lib, para nunca deixar o médico sem
// receita nenhuma só porque essa via mais bonita falhou.
import fs from "node:fs/promises";
import path from "node:path";

type Db = (typeof import("@/integrations/supabase/client.server"))["supabaseAdmin"];

export type ClinicaConfig = {
  fantasia: string | null;
  razao_social: string | null;
  cnpj_cpf: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  pais: string | null;
  telefone: string | null;
  email: string | null;
  cor_primaria: string | null;
  logo_data_url: string | null;
};

export async function getClinicaConfig(db: Db, medicoId: string): Promise<ClinicaConfig | null> {
  try {
    const { data, error } = await db
      .from("medico_clinica_config")
      .select(
        "fantasia,razao_social,cnpj_cpf,cep,logradouro,numero,complemento,bairro,cidade,uf,pais,telefone,email,cor_primaria,logo_data_url",
      )
      .eq("id_medico", medicoId)
      .maybeSingle();
    if (error) {
      console.error("[htmlPdfBuilder] falha ao carregar config da clínica:", error.message);
      return null;
    }
    return (data as ClinicaConfig | null) ?? null;
  } catch (e) {
    console.error("[htmlPdfBuilder] erro inesperado ao carregar config da clínica:", e);
    return null;
  }
}

function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

async function carregarTemplate(nome: string): Promise<string> {
  // Lê o arquivo direto do diretório public/ do próprio deploy — mesmo
  // arquivo que o app serve estaticamente pro navegador.
  const caminho = path.join(process.cwd(), "public", nome);
  return fs.readFile(caminho, "utf-8");
}

export type DoctorInfoTemplate = { name: string; crm?: string | null; especialidade?: string | null };

export async function buildReceitaPdfFromTemplate(params: {
  doctor: DoctorInfoTemplate;
  clinica: ClinicaConfig | null;
  pacienteNome?: string | null;
  pacienteCpf?: string | null;
  pacienteIdade?: number | string | null;
  medicamentos: {
    nome: string;
    apresentacao?: string;
    quantidade?: string;
    posologia?: string;
  }[];
}): Promise<Uint8Array | null> {
  try {
    let html = await carregarTemplate("receita-modelo.html");

    const clinic = params.clinica;
    const clinicName = clinic?.fantasia || clinic?.razao_social || "Clínica";
    const cidadeUf = [clinic?.cidade, clinic?.uf].filter(Boolean).join("/");
    const addr = [
      [clinic?.logradouro, clinic?.numero].filter(Boolean).join(", "),
      clinic?.complemento,
      clinic?.bairro,
      cidadeUf,
      clinic?.cep ? `CEP ${clinic.cep}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const itemsHtml = params.medicamentos
      .map((m, i) => {
        const dose = m.apresentacao ? ` <span class="dose">${esc(m.apresentacao)}</span>` : "";
        const instrucoes = [m.quantidade, m.posologia].filter(Boolean).join(" — ");
        return (
          `<div class="rx-item"><div class="rx-index">${i + 1}</div><div>` +
          `<div class="med-name">${esc(m.nome)}${dose}</div>` +
          `<div class="med-instructions">${esc(instrucoes) || "&nbsp;"}</div>` +
          `</div></div>`
        );
      })
      .join("");

    const repl: Record<string, string> = {
      "{{PRIMARY_COLOR}}": clinic?.cor_primaria || "#0E6E5D",
      "{{CLINIC_NAME}}": esc(clinicName),
      "{{CLINIC_ADDRESS}}": esc(addr || "—"),
      "{{CLINIC_PHONE}}": esc(clinic?.telefone || ""),
      "{{CLINIC_EMAIL}}": esc(clinic?.email || ""),
      "{{LOGO_URL}}": clinic?.logo_data_url || "",
      "{{DOCTOR_NAME}}": esc(params.doctor.name),
      "{{DOCTOR_SPECIALTY}}": esc(params.doctor.especialidade || ""),
      "{{DOCTOR_CRM}}": esc(params.doctor.crm || "—"),
      "{{PATIENT_NAME}}": esc(params.pacienteNome || "—"),
      "{{PATIENT_AGE}}": esc(params.pacienteIdade != null ? `${params.pacienteIdade} anos` : "—"),
      "{{PATIENT_CPF}}": esc(params.pacienteCpf || "—"),
      "{{ISSUE_DATE}}": esc(new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })),
      "{{DOC_TITLE}}": "Receituário Médico",
      "{{DOC_MARK}}": "℞",
      "{{PRESCRIPTION_HTML}}": itemsHtml,
      "{{SIGNATURE_DATETIME}}": "",
      "{{SIGNATURE_CERT_ID}}": "",
      "{{VERIFICATION_URL}}": "",
      "{{SIGNATURE_IMAGE_URL}}": "",
      "{{QR_CODE_URL}}": "",
    };
    for (const [k, v] of Object.entries(repl)) html = html.split(k).join(v);

    // Remove o aviso de montagem (existe só pra quem edita o template
    // manualmente — o próprio arquivo diz "removido pelo JS antes de gerar
    // o PDF").
    const inicioAviso = html.indexOf('<div class="builder-note">');
    const inicioSheet = html.indexOf('<div class="sheet">');
    if (inicioAviso !== -1 && inicioSheet !== -1 && inicioAviso < inicioSheet) {
      html = html.slice(0, inicioAviso) + html.slice(inicioSheet);
    }

    // A assinatura digital de verdade (ICP-Brasil) é aplicada depois, por
    // cima do PDF já gerado (ver SignatureService em assistente-ia.ts) — o
    // cartão decorativo de assinatura do template não tem dados reais aqui
    // (QR/cert id fictícios), então o bloco inteiro é removido em vez de
    // exibir algo que pareceria uma assinatura mas não é. Corta por marcador
    // de comentário (mais robusto que tentar casar divs aninhados com regex).
    const inicioAssinatura = html.indexOf("<!-- ASSINATURA DIGITAL");
    const inicioRodape = html.indexOf("<!-- RODAPÉ -->");
    if (inicioAssinatura !== -1 && inicioRodape !== -1 && inicioAssinatura < inicioRodape) {
      html = html.slice(0, inicioAssinatura) + html.slice(inicioRodape);
    }

    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      const pdfBuffer = await page.pdf({
        width: "210mm",
        height: "297mm",
        printBackground: true,
        margin: { top: "0mm", right: "0mm", bottom: "0mm", left: "0mm" },
      });
      return new Uint8Array(pdfBuffer);
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.error("[htmlPdfBuilder] falha ao renderizar receita a partir do template — caindo para o PDF simples:", e);
    return null;
  }
}
