// Gera PDFs simples e reais (não apenas o registro no banco) para os documentos
// criados pelo assistente de IA (receita, atestado/declaração, solicitação de
// exames). Usa pdf-lib, que é puro JS e roda em qualquer runtime de servidor
// sem precisar de Chrome/Canvas — diferente do fluxo do app principal, que
// monta o PDF no navegador com jsPDF/html2canvas.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

const PAGE_W = 595.28; // A4
const PAGE_H = 841.89;
const MARGIN = 56;
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
const ACCENT = rgb(0.02, 0.41, 0.63);

type Ctx = {
  doc: PDFDocument;
  font: PDFFont;
  bold: PDFFont;
  page: PDFPage;
  y: number;
};

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function ensureSpace(ctx: Ctx, h: number) {
  if (ctx.y - h < MARGIN) {
    ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
    ctx.y = PAGE_H - MARGIN;
  }
}

function writeText(
  ctx: Ctx,
  str: string,
  opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; gap?: number } = {},
) {
  const size = opts.size ?? 11;
  const font = opts.bold ? ctx.bold : ctx.font;
  const color = opts.color ?? INK;
  const gap = opts.gap ?? 4;
  const lines = wrapText(str, font, size, PAGE_W - MARGIN * 2);
  for (const l of lines) {
    ensureSpace(ctx, size + gap);
    ctx.page.drawText(l, { x: MARGIN, y: ctx.y, size, font, color });
    ctx.y -= size + gap;
  }
}

function writeSpacer(ctx: Ctx, h: number) {
  ensureSpace(ctx, h);
  ctx.y -= h;
}

function writeRule(ctx: Ctx) {
  ensureSpace(ctx, 14);
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness: 0.75,
    color: rgb(0.88, 0.91, 0.95),
  });
  ctx.y -= 14;
}

export type DoctorInfo = { name: string; crm?: string | null };

async function newCtx(titulo: string, doctor: DoctorInfo): Promise<Ctx> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: Ctx = { doc, font, bold, page, y: PAGE_H - MARGIN };

  writeText(ctx, titulo, { size: 19, bold: true, color: ACCENT, gap: 6 });
  writeText(ctx, doctor.crm ? `${doctor.name} — CRM ${doctor.crm}` : doctor.name, { size: 11, bold: true });
  writeText(ctx, `Emitido em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`, {
    size: 9,
    color: MUTED,
    gap: 10,
  });
  writeRule(ctx);
  return ctx;
}

function field(ctx: Ctx, label: string, value: string) {
  writeText(ctx, label.toUpperCase(), { size: 8.5, color: MUTED, gap: 2 });
  writeText(ctx, value || "—", { size: 12, gap: 12 });
}

export async function buildReceitaPdf(params: {
  doctor: DoctorInfo;
  pacienteNome?: string | null;
  pacienteCpf?: string | null;
  pacienteIdade?: number | string | null;
  medicamentos: { nome: string; apresentacao?: string; quantidade?: string; posologia?: string }[];
}): Promise<Uint8Array> {
  const ctx = await newCtx("Receita médica", params.doctor);
  field(ctx, "Paciente", params.pacienteNome || "—");
  field(
    ctx,
    "CPF / idade",
    [params.pacienteCpf, params.pacienteIdade != null ? `${params.pacienteIdade} anos` : null].filter(Boolean).join("  ·  "),
  );
  writeText(ctx, "PRESCRIÇÃO", { size: 8.5, color: MUTED, gap: 6 });
  params.medicamentos.forEach((m, i) => {
    writeText(ctx, `${i + 1}. ${m.nome}${m.apresentacao ? " — " + m.apresentacao : ""}`, { size: 12.5, bold: true, gap: 3 });
    writeText(ctx, [m.quantidade, m.posologia].filter(Boolean).join("  —  ") || "—", { size: 10.5, color: MUTED, gap: 10 });
  });
  return ctx.doc.save();
}

export async function buildAtestadoPdf(params: {
  doctor: DoctorInfo;
  pacienteNome?: string | null;
  tipo: "atestado" | "declaracao";
  dias?: number | string | null;
  cid?: string | null;
  observacao?: string | null;
}): Promise<Uint8Array> {
  const titulo = params.tipo === "declaracao" ? "Declaração de comparecimento" : "Atestado médico";
  const ctx = await newCtx(titulo, params.doctor);
  const corpo =
    params.tipo === "declaracao"
      ? `Declaro, para os devidos fins, que o(a) paciente ${params.pacienteNome || "—"} esteve sob meus cuidados profissionais nesta data.`
      : `Atesto que o(a) paciente ${params.pacienteNome || "—"} necessita de afastamento de suas atividades por ${
          params.dias ?? "—"
        } dia(s)${params.cid ? `, CID ${params.cid}` : ""}.`;
  writeSpacer(ctx, 6);
  writeText(ctx, corpo, { size: 12.5, gap: 6 });
  if (params.observacao) {
    writeSpacer(ctx, 10);
    field(ctx, "Observações", params.observacao);
  }
  return ctx.doc.save();
}

export async function buildSolicitacaoExamePdf(params: {
  doctor: DoctorInfo;
  pacienteNome?: string | null;
  pacienteCpf?: string | null;
  pacienteIdade?: number | string | null;
  carater: "eletivo" | "urgente";
  jejum?: boolean;
  indicacaoClinica?: string | null;
  cid?: string | null;
  cidDescricao?: string | null;
  preparo?: string | null;
  observacoes?: string | null;
  exames: { nome: string; codigo_tuss?: string | null; instrucoes?: string }[];
}): Promise<Uint8Array> {
  const ctx = await newCtx("Solicitação de exames", params.doctor);
  field(ctx, "Paciente", params.pacienteNome || "—");
  field(
    ctx,
    "CPF / idade",
    [params.pacienteCpf, params.pacienteIdade != null ? `${params.pacienteIdade} anos` : null].filter(Boolean).join("  ·  "),
  );
  field(ctx, "Caráter", (params.carater === "urgente" ? "Urgente" : "Eletivo") + (params.jejum ? " · Jejum necessário" : ""));
  if (params.indicacaoClinica) field(ctx, "Indicação clínica", params.indicacaoClinica);
  if (params.cid) field(ctx, "CID", `${params.cid} ${params.cidDescricao || ""}`.trim());
  writeText(ctx, "EXAMES SOLICITADOS", { size: 8.5, color: MUTED, gap: 6 });
  params.exames.forEach((e, i) => {
    writeText(ctx, `${i + 1}. ${e.nome}`, { size: 12.5, bold: true, gap: 3 });
    if (e.instrucoes) writeText(ctx, e.instrucoes, { size: 10.5, color: MUTED, gap: 10 });
    else writeSpacer(ctx, 6);
  });
  if (params.preparo) field(ctx, "Preparo", params.preparo);
  if (params.observacoes) field(ctx, "Observações", params.observacoes);
  return ctx.doc.save();
}
