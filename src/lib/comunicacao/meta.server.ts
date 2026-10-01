import { encryptVerifier, decryptVerifier } from "@/lib/signature/PKCEService";

/**
 * Cliente da WhatsApp Cloud API (Meta Graph API) para o canal
 * CLÍNICA ↔ PACIENTE (tela Conversas).
 *
 * Diferente de whatsapp-webhook.ts / assistente-medico-webhook.ts, que usam o
 * token GLOBAL do app (process.env.WHATSAPP_ACCESS_TOKEN), aqui cada clínica
 * usa as PRÓPRIAS credenciais, gravadas cifradas em
 * comunicacao_whatsapp_conexoes. Nada deste arquivo deve ler as variáveis
 * WHATSAPP_* do canal do app.
 *
 * Endpoints usados (Graph API, versão configurável por clínica):
 *   GET    /{phone-number-id}?fields=...          dados do número (teste)
 *   GET    /{waba-id}?fields=name                 dados da conta WABA (teste)
 *   POST   /{waba-id}/subscribed_apps             liga o webhook do app à WABA
 *   POST   /{phone-number-id}/register            registra o número na Cloud API (PIN 2FA)
 *   POST   /{phone-number-id}/messages            envia texto/documento/modelo
 *   POST   /{phone-number-id}/media               sobe mídia para envio
 *   GET    /{media-id}                            URL temporária de mídia recebida
 *   GET    /{waba-id}/message_templates           lista modelos
 *   POST   /{waba-id}/message_templates           cria modelo (vai para análise)
 *   DELETE /{waba-id}/message_templates?name=..   exclui modelo
 *   POST   /{app-id}/uploads + POST /{session}    Resumable Upload: gera o
 *          "header_handle" exigido como exemplo em modelos com cabeçalho de mídia
 */

export const GRAPH_HOST = "https://graph.facebook.com";
export const VERSAO_PADRAO = "v23.0";

// deno-lint-ignore no-explicit-any
type Db = any;

export type Conexao = {
  id_medico: string;
  webhook_chave: string;
  meta_app_id: string | null;
  meta_business_id: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  verify_token: string;
  graph_api_version: string;
  numero_exibicao: string | null;
  nome_verificado: string | null;
  nome_waba: string | null;
  quality_rating: string | null;
  messaging_limit_tier: string | null;
  status: string;
  ultimo_erro: string | null;
  testado_em: string | null;
  webhook_assinado_em: string | null;
  webhook_verificado_em: string | null;
  ultimo_evento_em: string | null;
  access_token_cifrado: string | null;
  app_secret_cifrado: string | null;
};

export type ConexaoComSegredos = Conexao & { accessToken: string | null; appSecret: string | null };

export class MetaApiError extends Error {
  status: number;
  code?: number;
  subcode?: number;
  detalhe?: unknown;
  constructor(message: string, status: number, code?: number, subcode?: number, detalhe?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.subcode = subcode;
    this.detalhe = detalhe;
  }
}

export class ConfiguracaoError extends Error {
  codigo: string;
  constructor(codigo: string, message: string) {
    super(message);
    this.codigo = codigo;
  }
}

function chaveCifragem(): string {
  const key = process.env.SIGNATURE_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error("SIGNATURE_ENCRYPTION_KEY não configurado (mínimo 16 caracteres).");
  }
  return key;
}

export async function cifrar(valor: string): Promise<string> {
  return encryptVerifier(valor, chaveCifragem());
}

export async function decifrar(valor: string | null | undefined): Promise<string | null> {
  if (!valor) return null;
  try {
    return await decryptVerifier(valor, chaveCifragem());
  } catch (e) {
    console.error(
      "[comunicacao/meta] Falha ao decifrar segredo da conexão:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/** Mostra só o começo/fim de um segredo, para a tela confirmar qual está salvo. */
export function mascarar(valor: string | null): string | null {
  if (!valor) return null;
  if (valor.length <= 10) return "•".repeat(valor.length);
  return `${valor.slice(0, 4)}••••••${valor.slice(-4)}`;
}

/**
 * Normaliza telefone para o formato da Cloud API (só dígitos, com DDI).
 * Cadastros brasileiros costumam vir sem o 55 ("(47) 99999-0000"): 10 ou 11
 * dígitos sem DDI recebem 55 na frente.
 */
export function normalizarTelefone(valor: string | null | undefined): string | null {
  let d = (valor || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if ((d.length === 10 || d.length === 11) && !d.startsWith("55")) d = "55" + d;
  if (d.length < 8 || d.length > 15) return null;
  return d;
}

/**
 * Compara dois telefones tolerando a diferença do "9" extra de celulares
 * brasileiros (a Meta às vezes entrega o wa_id sem o nono dígito).
 */
export function mesmoTelefone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizarTelefone(a);
  const nb = normalizarTelefone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const semNono = (t: string) =>
    t.startsWith("55") && t.length === 13 ? t.slice(0, 4) + t.slice(5) : t;
  return semNono(na) === semNono(nb);
}

export async function carregarConexao(
  db: Db,
  idMedico: string,
): Promise<ConexaoComSegredos | null> {
  const { data, error } = await db
    .from("comunicacao_whatsapp_conexoes")
    .select("*")
    .eq("id_medico", idMedico)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    ...(data as Conexao),
    accessToken: await decifrar(data.access_token_cifrado),
    appSecret: await decifrar(data.app_secret_cifrado),
  };
}

/** Conexão pronta para enviar mensagens — lança ConfiguracaoError com orientação se faltar algo. */
export async function exigirConexaoAtiva(db: Db, idMedico: string): Promise<ConexaoComSegredos> {
  const c = await carregarConexao(db, idMedico);
  if (!c || !c.phone_number_id || !c.accessToken) {
    throw new ConfiguracaoError(
      "sem_conexao",
      "Meu WhatsApp não configurado. Acesse Configurações > Meu WhatsApp.",
    );
  }
  if (c.status !== "conectado") {
    throw new ConfiguracaoError(
      "conexao_nao_validada",
      'A conexão com a Meta ainda não foi validada. Use "Testar conexão" em Configurações > Meu WhatsApp.',
    );
  }
  return c;
}

function urlGraph(c: { graph_api_version: string }, caminho: string): string {
  const versao = /^v\d{2}\.\d$/.test(c.graph_api_version || "")
    ? c.graph_api_version
    : VERSAO_PADRAO;
  return `${GRAPH_HOST}/${versao}/${caminho.replace(/^\//, "")}`;
}

/** Traduz os erros mais comuns da Cloud API para uma orientação acionável. */
function mensagemErroMeta(code: number | undefined, msg: string, userMsg?: string): string {
  switch (code) {
    case 190:
      return "Token de acesso inválido ou expirado. Gere um token permanente de Usuário do Sistema e salve novamente.";
    case 10:
    case 200:
      return "O token não tem permissão para esta conta. Confirme as permissões whatsapp_business_messaging e whatsapp_business_management.";
    case 100:
      return userMsg || `Parâmetro inválido enviado à Meta: ${msg}`;
    case 131047:
      return "Mais de 24h desde a última mensagem do paciente: só é possível enviar um modelo aprovado.";
    case 131026:
      return "Mensagem não entregue: o número pode não ter WhatsApp ou não aceitou os termos atualizados.";
    case 132000:
      return "A quantidade de variáveis enviadas não corresponde ao modelo.";
    case 132001:
      return "Modelo não encontrado na Meta para este idioma — sincronize os modelos.";
    case 132015:
    case 132016:
      return "Modelo pausado/desativado pela Meta por baixa qualidade.";
    case 133010:
      return 'Número ainda não registrado na Cloud API. Use "Registrar número" com o PIN de duas etapas.';
    case 131056:
      return "Muitas mensagens para o mesmo paciente em pouco tempo. Aguarde alguns instantes.";
    case 130429:
    case 80007:
      return "Limite de envio da Meta atingido. Tente novamente em alguns minutos.";
    default:
      return userMsg || msg || "Erro desconhecido da Meta.";
  }
}

export async function graph<T = any>(
  c: ConexaoComSegredos,
  caminho: string,
  init: { method?: string; body?: unknown; form?: FormData } = {},
): Promise<T> {
  if (!c.accessToken) throw new ConfiguracaoError("sem_token", "Token de acesso não configurado.");
  const headers: Record<string, string> = { Authorization: `Bearer ${c.accessToken}` };
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  let res: Response;
  try {
    res = await fetch(urlGraph(c, caminho), { method: init.method || "GET", headers, body });
  } catch (e) {
    throw new MetaApiError(
      "Falha de rede ao falar com a Meta.",
      502,
      undefined,
      undefined,
      String(e),
    );
  }
  const texto = await res.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : {};
  } catch {
    json = { raw: texto };
  }
  if (!res.ok || json?.error) {
    const err = json?.error || {};
    throw new MetaApiError(
      mensagemErroMeta(err.code, err.message || `HTTP ${res.status}`, err.error_user_msg),
      res.status >= 400 ? res.status : 502,
      err.code,
      err.error_subcode,
      err,
    );
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Conexão: teste, assinatura do webhook, registro do número
// ---------------------------------------------------------------------------

export async function lerDadosNumero(c: ConexaoComSegredos) {
  const campos =
    "display_phone_number,verified_name,quality_rating,code_verification_status,name_status";
  const numero = await graph<any>(c, `${c.phone_number_id}?fields=${campos}`);
  // messaging_limit_tier não existe em todas as versões — lido à parte, sem derrubar o teste.
  let limite: string | null = null;
  try {
    const l = await graph<any>(c, `${c.phone_number_id}?fields=messaging_limit_tier`);
    limite = l?.messaging_limit_tier ?? null;
  } catch {
    limite = null;
  }
  let nomeWaba: string | null = null;
  if (c.waba_id) {
    const waba = await graph<any>(c, `${c.waba_id}?fields=name`);
    nomeWaba = waba?.name ?? null;
  }
  return {
    numero_exibicao: numero?.display_phone_number ?? null,
    nome_verificado: numero?.verified_name ?? null,
    quality_rating: numero?.quality_rating ?? null,
    code_verification_status: numero?.code_verification_status ?? null,
    name_status: numero?.name_status ?? null,
    messaging_limit_tier: limite,
    nome_waba: nomeWaba,
  };
}

export async function assinarWebhookNaWaba(c: ConexaoComSegredos) {
  if (!c.waba_id)
    throw new ConfiguracaoError("sem_waba", "Informe o ID da conta do WhatsApp Business (WABA).");
  return graph<{ success: boolean }>(c, `${c.waba_id}/subscribed_apps`, { method: "POST" });
}

export async function registrarNumero(c: ConexaoComSegredos, pin: string) {
  if (!/^\d{6}$/.test(pin))
    throw new ConfiguracaoError(
      "pin_invalido",
      "O PIN de confirmação em duas etapas tem 6 dígitos.",
    );
  return graph<{ success: boolean }>(c, `${c.phone_number_id}/register`, {
    method: "POST",
    body: { messaging_product: "whatsapp", pin },
  });
}

// ---------------------------------------------------------------------------
// Mídia
// ---------------------------------------------------------------------------

export async function subirMidia(
  c: ConexaoComSegredos,
  bytes: Uint8Array,
  mime: string,
  nome: string,
): Promise<string> {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mime);
  form.append("file", new Blob([bytes as BlobPart], { type: mime }), nome);
  const r = await graph<{ id: string }>(c, `${c.phone_number_id}/media`, { method: "POST", form });
  return r.id;
}

/** Baixa mídia recebida (a URL da Meta exige o mesmo token e expira em minutos). */
export async function baixarMidia(c: ConexaoComSegredos, mediaId: string) {
  const info = await graph<{ url: string; mime_type: string }>(c, mediaId);
  const res = await fetch(info.url, { headers: { Authorization: `Bearer ${c.accessToken}` } });
  if (!res.ok) throw new MetaApiError("Não foi possível baixar a mídia da Meta.", 502);
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    mime: info.mime_type || "application/octet-stream",
  };
}

/**
 * Resumable Upload API — gera o "header_handle" que a Meta exige como
 * exemplo ao criar um modelo com cabeçalho de imagem/vídeo/documento.
 * Precisa do App ID (é por isso que o campo existe na tela de configuração).
 */
export async function gerarHandleExemplo(
  c: ConexaoComSegredos,
  bytes: Uint8Array,
  mime: string,
  nome: string,
) {
  if (!c.meta_app_id) {
    throw new ConfiguracaoError(
      "sem_app_id",
      "Informe o ID do App da Meta para enviar arquivos de exemplo de modelos.",
    );
  }
  const sessao = await graph<{ id: string }>(
    c,
    `${c.meta_app_id}/uploads?file_name=${encodeURIComponent(nome)}&file_length=${bytes.byteLength}&file_type=${encodeURIComponent(mime)}`,
    { method: "POST" },
  );
  const res = await fetch(urlGraph(c, sessao.id), {
    method: "POST",
    headers: { Authorization: `OAuth ${c.accessToken}`, file_offset: "0" },
    body: bytes as BodyInit,
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.h) {
    throw new MetaApiError(
      json?.error?.message || "Falha no upload do arquivo de exemplo.",
      502,
      json?.error?.code,
    );
  }
  return json.h as string;
}

// ---------------------------------------------------------------------------
// Modelos de mensagem
// ---------------------------------------------------------------------------

export type Botao =
  | { tipo: "QUICK_REPLY"; texto: string }
  | { tipo: "URL"; texto: string; url: string; exemplo?: string }
  | { tipo: "PHONE_NUMBER"; texto: string; telefone: string };

export type Cabecalho =
  | null
  | { tipo: "TEXT"; texto: string; exemplo?: string }
  | { tipo: "IMAGE" | "VIDEO" | "DOCUMENT"; handle?: string | null };

export type Modelo = {
  id: string;
  id_medico: string;
  meta_template_id: string | null;
  nome: string;
  idioma: string;
  categoria: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  finalidade: string;
  parameter_format: "POSITIONAL" | "NAMED";
  cabecalho: Cabecalho;
  corpo: string;
  corpo_exemplos: string[] | Record<string, string>;
  rodape: string | null;
  botoes: Botao[];
  variaveis: Record<string, string>;
  status: string;
};

const RE_POS = /\{\{\s*(\d+)\s*\}\}/g;
const RE_NOME = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** Variáveis na ordem em que aparecem (sem repetição). */
export function extrairVariaveis(
  texto: string | null | undefined,
  formato: "POSITIONAL" | "NAMED",
): string[] {
  const re = formato === "NAMED" ? RE_NOME : RE_POS;
  const vistas: string[] = [];
  for (const m of (texto || "").matchAll(re)) if (!vistas.includes(m[1])) vistas.push(m[1]);
  return vistas;
}

/** Valida as regras de formato da Meta antes de submeter (evita rejeição imediata). */
export function validarModelo(
  m: Omit<Modelo, "id" | "id_medico" | "meta_template_id" | "status">,
): string[] {
  const erros: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(m.nome))
    erros.push("Nome: use apenas letras minúsculas, números e _ (sem espaços ou acentos).");
  if (!m.corpo?.trim()) erros.push("O corpo da mensagem é obrigatório.");
  if ((m.corpo || "").length > 1024) erros.push("O corpo pode ter no máximo 1024 caracteres.");
  const vars = extrairVariaveis(m.corpo, m.parameter_format);
  if (m.parameter_format === "POSITIONAL") {
    const nums = vars.map(Number).sort((a, b) => a - b);
    if (nums.some((n, i) => n !== i + 1))
      erros.push("Variáveis do corpo devem ser sequenciais: {{1}}, {{2}}, {{3}}...");
  } else if (/\{\{\s*\d+\s*\}\}/.test(m.corpo)) {
    erros.push(
      "No formato com nomes, use variáveis como {{nome_paciente}} — não misture com {{1}}.",
    );
  }
  const corpoTrim = (m.corpo || "").trim();
  if (/^\{\{[^}]+\}\}/.test(corpoTrim) || /\{\{[^}]+\}\}$/.test(corpoTrim)) {
    erros.push("A Meta não aceita corpo começando ou terminando com uma variável.");
  }
  const exemplos = m.corpo_exemplos || {};
  for (const v of vars) {
    const ex = Array.isArray(exemplos)
      ? exemplos[Number(v) - 1]
      : (exemplos as Record<string, string>)[v];
    if (!ex || !String(ex).trim())
      erros.push(`Informe um exemplo para a variável {{${v}}} (a Meta exige para análise).`);
  }
  if (m.cabecalho?.tipo === "TEXT") {
    if (!m.cabecalho.texto?.trim()) erros.push("Cabeçalho de texto vazio.");
    if ((m.cabecalho.texto || "").length > 60)
      erros.push("Cabeçalho de texto: máximo 60 caracteres.");
    const hv = extrairVariaveis(m.cabecalho.texto, m.parameter_format);
    if (hv.length > 1) erros.push("O cabeçalho aceita no máximo 1 variável.");
    if (hv.length === 1 && !m.cabecalho.exemplo?.trim())
      erros.push("Informe o exemplo da variável do cabeçalho.");
  }
  if (m.rodape && m.rodape.length > 60) erros.push("Rodapé: máximo 60 caracteres.");
  if (m.rodape && /\{\{/.test(m.rodape)) erros.push("O rodapé não aceita variáveis.");
  const botoes = m.botoes || [];
  if (botoes.length > 10) erros.push("Máximo de 10 botões.");
  if (botoes.filter((b) => b.tipo === "URL").length > 2) erros.push("Máximo de 2 botões de link.");
  if (botoes.filter((b) => b.tipo === "PHONE_NUMBER").length > 1)
    erros.push("Máximo de 1 botão de ligação.");
  for (const b of botoes) {
    if (!b.texto?.trim() || b.texto.length > 25)
      erros.push("Texto de botão: obrigatório e com até 25 caracteres.");
    if (b.tipo === "URL" && !/^https:\/\/\S+$/.test(b.url || ""))
      erros.push("Botão de link precisa de uma URL https://.");
    if (b.tipo === "URL" && /\{\{1\}\}$/.test(b.url) && !b.exemplo)
      erros.push("Botão de link com variável precisa de URL de exemplo.");
    if (
      b.tipo === "PHONE_NUMBER" &&
      !/^\+?\d{10,15}$/.test((b.telefone || "").replace(/[\s()-]/g, ""))
    ) {
      erros.push("Botão de ligação precisa de um telefone com DDI (ex.: +5547999990000).");
    }
  }
  return erros;
}

/** Converte o modelo do app para o payload de criação da Meta. */
export function payloadCriacaoModelo(m: Modelo) {
  const named = m.parameter_format === "NAMED";
  const components: any[] = [];
  const cab = m.cabecalho;
  if (cab?.tipo === "TEXT") {
    const comp: any = { type: "HEADER", format: "TEXT", text: cab.texto };
    const hv = extrairVariaveis(cab.texto, m.parameter_format);
    if (hv.length) {
      comp.example = named
        ? { header_text_named_params: [{ param_name: hv[0], example: cab.exemplo }] }
        : { header_text: [cab.exemplo] };
    }
    components.push(comp);
  } else if (cab && ["IMAGE", "VIDEO", "DOCUMENT"].includes(cab.tipo)) {
    const comp: any = { type: "HEADER", format: cab.tipo };
    if ("handle" in cab && cab.handle) comp.example = { header_handle: [cab.handle] };
    components.push(comp);
  }
  const body: any = { type: "BODY", text: m.corpo };
  const vars = extrairVariaveis(m.corpo, m.parameter_format);
  if (vars.length) {
    const ex = m.corpo_exemplos || {};
    body.example = named
      ? {
          body_text_named_params: vars.map((v) => ({
            param_name: v,
            example: Array.isArray(ex) ? "" : (ex as Record<string, string>)[v],
          })),
        }
      : { body_text: [vars.map((v) => (Array.isArray(ex) ? ex[Number(v) - 1] : (ex as any)[v]))] };
  }
  components.push(body);
  if (m.rodape?.trim()) components.push({ type: "FOOTER", text: m.rodape.trim() });
  if (m.botoes?.length) {
    components.push({
      type: "BUTTONS",
      buttons: m.botoes.map((b) => {
        if (b.tipo === "URL") {
          const out: any = { type: "URL", text: b.texto, url: b.url };
          if (/\{\{1\}\}$/.test(b.url) && b.exemplo) out.example = [b.exemplo];
          return out;
        }
        if (b.tipo === "PHONE_NUMBER") {
          return {
            type: "PHONE_NUMBER",
            text: b.texto,
            phone_number: b.telefone.replace(/[^\d+]/g, ""),
          };
        }
        return { type: "QUICK_REPLY", text: b.texto };
      }),
    });
  }
  return {
    name: m.nome,
    language: m.idioma,
    category: m.categoria,
    parameter_format: m.parameter_format,
    components,
  };
}

export async function criarModeloNaMeta(c: ConexaoComSegredos, m: Modelo) {
  if (!c.waba_id)
    throw new ConfiguracaoError("sem_waba", "Informe o ID da conta do WhatsApp Business (WABA).");
  return graph<{ id: string; status: string; category: string }>(
    c,
    `${c.waba_id}/message_templates`,
    {
      method: "POST",
      body: payloadCriacaoModelo(m),
    },
  );
}

export async function listarModelosDaMeta(c: ConexaoComSegredos) {
  if (!c.waba_id)
    throw new ConfiguracaoError("sem_waba", "Informe o ID da conta do WhatsApp Business (WABA).");
  const todos: any[] = [];
  let caminho: string | null =
    `${c.waba_id}/message_templates?fields=id,name,language,status,category,rejected_reason,parameter_format,components&limit=100`;
  for (let pagina = 0; caminho && pagina < 20; pagina++) {
    const r: any = await graph<any>(c, caminho);
    todos.push(...(r?.data || []));
    const after = r?.paging?.cursors?.after;
    caminho =
      r?.paging?.next && after
        ? `${c.waba_id}/message_templates?fields=id,name,language,status,category,rejected_reason,parameter_format,components&limit=100&after=${encodeURIComponent(after)}`
        : null;
  }
  return todos;
}

export async function excluirModeloNaMeta(
  c: ConexaoComSegredos,
  m: Pick<Modelo, "nome" | "meta_template_id">,
) {
  if (!c.waba_id)
    throw new ConfiguracaoError("sem_waba", "Informe o ID da conta do WhatsApp Business (WABA).");
  const qs = new URLSearchParams({ name: m.nome });
  if (m.meta_template_id) qs.set("hsm_id", m.meta_template_id);
  return graph<{ success: boolean }>(c, `${c.waba_id}/message_templates?${qs.toString()}`, {
    method: "DELETE",
  });
}

/** Converte um modelo vindo da Meta (sincronização) para as colunas locais. */
export function modeloDaMeta(t: any): Partial<Modelo> & { motivo_rejeicao: string | null } {
  const comps: any[] = t.components || [];
  const header = comps.find((x) => x.type === "HEADER");
  const body = comps.find((x) => x.type === "BODY");
  const footer = comps.find((x) => x.type === "FOOTER");
  const buttons = comps.find((x) => x.type === "BUTTONS");
  const formato: "POSITIONAL" | "NAMED" = t.parameter_format === "NAMED" ? "NAMED" : "POSITIONAL";
  let cabecalho: Cabecalho = null;
  if (header?.format === "TEXT") {
    cabecalho = {
      tipo: "TEXT",
      texto: header.text || "",
      exemplo:
        header.example?.header_text?.[0] ||
        header.example?.header_text_named_params?.[0]?.example ||
        "",
    };
  } else if (header?.format && ["IMAGE", "VIDEO", "DOCUMENT"].includes(header.format)) {
    cabecalho = { tipo: header.format, handle: null };
  }
  let exemplos: string[] | Record<string, string> = [];
  if (formato === "NAMED") {
    exemplos = Object.fromEntries(
      (body?.example?.body_text_named_params || []).map((p: any) => [p.param_name, p.example]),
    );
  } else {
    exemplos = body?.example?.body_text?.[0] || [];
  }
  const botoes: Botao[] = (buttons?.buttons || []).map((b: any) => {
    if (b.type === "URL")
      return { tipo: "URL", texto: b.text, url: b.url, exemplo: b.example?.[0] };
    if (b.type === "PHONE_NUMBER")
      return { tipo: "PHONE_NUMBER", texto: b.text, telefone: b.phone_number };
    return { tipo: "QUICK_REPLY", texto: b.text };
  });
  return {
    meta_template_id: String(t.id),
    nome: t.name,
    idioma: t.language,
    categoria: t.category,
    parameter_format: formato,
    cabecalho,
    corpo: body?.text || "",
    corpo_exemplos: exemplos,
    rodape: footer?.text || null,
    botoes,
    status: t.status,
    motivo_rejeicao: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
  };
}

// ---------------------------------------------------------------------------
// Envio de mensagens
// ---------------------------------------------------------------------------

export type MidiaCabecalho = {
  tipo: "image" | "video" | "document";
  id?: string;
  link?: string;
  filename?: string;
};

/**
 * Monta o objeto "template" da mensagem a partir dos valores das variáveis.
 * valores: { "1": "Maria", "2": "10/10" } (POSITIONAL) ou { nome: "Maria" } (NAMED);
 * a variável do cabeçalho de texto vem em valores["header.<var>"] (no formato
 * NAMED, se tiver o mesmo nome de uma variável do corpo, reaproveita o valor);
 * a variável do botão de link i vem em valores["botao.<i>"].
 */
export function payloadEnvioModelo(
  m: Modelo,
  valores: Record<string, string>,
  midia?: MidiaCabecalho | null,
) {
  const named = m.parameter_format === "NAMED";
  const parametro = (nome: string, texto: string) =>
    named ? { type: "text", parameter_name: nome, text: texto } : { type: "text", text: texto };
  const components: any[] = [];
  const cab = m.cabecalho;
  if (cab?.tipo === "TEXT") {
    const hv = extrairVariaveis(cab.texto, m.parameter_format);
    if (hv.length) {
      // No formato POSITIONAL o {{1}} do cabeçalho é independente do {{1}} do corpo.
      const v =
        valores[`header.${hv[0]}`] ?? valores.header ?? (named ? valores[hv[0]] : undefined) ?? "";
      if (!String(v).trim()) {
        throw new ConfiguracaoError(
          "variaveis_faltando",
          "Preencha a variável do cabeçalho do modelo.",
        );
      }
      components.push({ type: "header", parameters: [parametro(hv[0], String(v))] });
    }
  } else if (cab && ["IMAGE", "VIDEO", "DOCUMENT"].includes(cab.tipo)) {
    if (!midia || (!midia.id && !midia.link)) {
      throw new ConfiguracaoError(
        "modelo_exige_midia",
        "Este modelo tem cabeçalho de mídia: anexe o arquivo para enviar.",
      );
    }
    const tipo = cab.tipo.toLowerCase();
    const obj: any = midia.id ? { id: midia.id } : { link: midia.link };
    if (tipo === "document" && midia.filename) obj.filename = midia.filename;
    components.push({ type: "header", parameters: [{ type: tipo, [tipo]: obj }] });
  }
  const vars = extrairVariaveis(m.corpo, m.parameter_format);
  if (vars.length) {
    const faltando = vars.filter((v) => !String(valores[v] ?? "").trim());
    if (faltando.length) {
      throw new ConfiguracaoError(
        "variaveis_faltando",
        `Preencha as variáveis do modelo: ${faltando.map((v) => `{{${v}}}`).join(", ")}.`,
      );
    }
    components.push({
      type: "body",
      parameters: vars.map((v) => parametro(v, String(valores[v]))),
    });
  }
  (m.botoes || []).forEach((b, i) => {
    if (b.tipo === "URL" && /\{\{1\}\}$/.test(b.url)) {
      components.push({
        type: "button",
        sub_type: "url",
        index: String(i),
        parameters: [{ type: "text", text: String(valores[`botao.${i}`] ?? "") }],
      });
    }
  });
  return {
    name: m.nome,
    language: { code: m.idioma },
    ...(components.length ? { components } : {}),
  };
}

/** Texto final do modelo, com as variáveis já trocadas — é o que aparece no histórico da conversa. */
export function renderizarModelo(m: Modelo, valores: Record<string, string>): string {
  const troca = (t: string) =>
    t.replace(
      m.parameter_format === "NAMED" ? RE_NOME : RE_POS,
      (_x, v) => valores[v] ?? `{{${v}}}`,
    );
  const partes: string[] = [];
  if (m.cabecalho?.tipo === "TEXT") {
    const hv = extrairVariaveis(m.cabecalho.texto, m.parameter_format)[0];
    const v =
      valores[`header.${hv}`] ??
      valores.header ??
      (m.parameter_format === "NAMED" ? valores[hv] : undefined) ??
      "";
    partes.push(`*${m.cabecalho.texto.replace(/\{\{[^}]+\}\}/, v)}*`);
  }
  partes.push(troca(m.corpo));
  if (m.rodape) partes.push(`_${m.rodape}_`);
  return partes.join("\n\n");
}

export async function enviarMensagemMeta(
  c: ConexaoComSegredos,
  para: string,
  conteudo: Record<string, unknown>,
) {
  const r = await graph<{ messages?: { id: string }[] }>(c, `${c.phone_number_id}/messages`, {
    method: "POST",
    body: { messaging_product: "whatsapp", recipient_type: "individual", to: para, ...conteudo },
  });
  const id = r?.messages?.[0]?.id;
  if (!id) throw new MetaApiError("A Meta não devolveu o ID da mensagem enviada.", 502);
  return id;
}

/** A Meta só aceita mensagem livre (texto, documento) até 24h após a última mensagem do paciente. */
export function janelaAberta(ultimaEntradaEm: string | null | undefined): boolean {
  if (!ultimaEntradaEm) return false;
  return Date.now() - new Date(ultimaEntradaEm).getTime() < 24 * 60 * 60 * 1000;
}
