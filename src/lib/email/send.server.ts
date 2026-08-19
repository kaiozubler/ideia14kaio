// Envio de emails transacionais (códigos de confirmação e cópia das respostas
// de formulário). Server-only: a chave nunca chega ao browser.
type SendArgs = { to: string; subject: string; html: string };

export async function sendEmail({ to, subject, html }: SendArgs): Promise<void> {
  const apiKey = process.env['RESEND_API_KEY'];
  if (!apiKey) throw new Error('email_not_configured');
  const from = process.env['EMAIL_FROM'] || 'MediCopilot <onboarding@resend.dev>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) {
    const detalhe = await res.text().catch(() => '');
    console.error('[email] falha ao enviar', res.status, detalhe.slice(0, 400));
    throw new Error('email_send_failed');
  }
}

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function layout(titulo: string, corpo: string): string {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#eef6f5;padding:26px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:26px;box-shadow:0 10px 30px rgba(15,23,42,.08)">
      <h1 style="font-size:19px;color:#0f172a;margin:0 0 14px">${escapeHtml(titulo)}</h1>
      ${corpo}
      <p style="font-size:11px;color:#94a3b8;margin:22px 0 0">Mensagem automática — não responda a este email.</p>
    </div>
  </div>`;
}

export function codigoEmailHtml(titulo: string, codigo: string): string {
  return layout(
    'Confirme seu email',
    `<p style="font-size:14px;color:#334155;margin:0 0 14px">Use o código abaixo para confirmar o preenchimento do formulário <b>${escapeHtml(titulo)}</b>:</p>
     <div style="font-size:34px;font-weight:700;letter-spacing:.24em;color:#0d9488;text-align:center;margin:18px 0">${escapeHtml(codigo)}</div>
     <p style="font-size:12px;color:#64748b;margin:0">O código expira em 15 minutos.</p>`,
  );
}

export function termoAssinadoEmailHtml(titulo: string, nome: string, textoFinal: string): string {
  return layout(
    titulo,
    `<p style="font-size:14px;color:#334155;margin:0 0 16px">${nome ? escapeHtml(nome) + ', s' : 'S'}ua assinatura foi registrada com sucesso. Segue abaixo a cópia do termo que você assinou:</p>
     <div style="padding:14px 16px;border-left:3px solid #99f6e4;background:#f8fafc;border-radius:10px;font-size:13.5px;color:#0f172a;white-space:pre-wrap">${escapeHtml(textoFinal)}</div>`,
  );
}

export function respostasEmailHtml(titulo: string, nome: string, linhas: { pergunta: string; valor: string }[]): string {
  const itens = linhas
    .map(
      (l) =>
        `<div style="padding:10px 12px;border-left:3px solid #99f6e4;background:#f8fafc;border-radius:10px;margin-bottom:8px">
          <div style="font-size:12px;color:#64748b;margin-bottom:3px">${escapeHtml(l.pergunta)}</div>
          <div style="font-size:14px;color:#0f172a;white-space:pre-wrap">${escapeHtml(l.valor)}</div>
        </div>`,
    )
    .join('');
  return layout(
    titulo,
    `<p style="font-size:14px;color:#334155;margin:0 0 16px">${nome ? escapeHtml(nome) + ', s' : 'S'}uas respostas foram registradas com sucesso. Segue abaixo a cópia do que foi enviado:</p>
     ${itens || '<p style="font-size:13px;color:#64748b">Sem respostas registradas.</p>'}`,
  );
}
