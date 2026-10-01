import {
  ConfiguracaoError,
  MetaApiError,
  enviarMensagemMeta,
  exigirConexaoAtiva,
  janelaAberta,
  mesmoTelefone,
  normalizarTelefone,
  payloadEnvioModelo,
  renderizarModelo,
  subirMidia,
  type ConexaoComSegredos,
  type MidiaCabecalho,
  type Modelo,
} from "./meta.server";

/**
 * Orquestra o envio CLÍNICA → PACIENTE: acha/cria a conversa, decide entre
 * mensagem livre e modelo (janela de 24h da Meta), preenche as variáveis do
 * modelo a partir dos dados do app, envia e grava o histórico.
 *
 * Usado por /api/comunicacao/enviar (tela Conversas e "Enviar por WhatsApp"
 * dos documentos) e por /api/public/hooks/comunicacao-lembretes (avisos de
 * consulta).
 */

// deno-lint-ignore no-explicit-any
type Db = any;

/**
 * Campos do app que podem alimentar variáveis de modelo. A mesma lista
 * (chave + rótulo) está copiada em public/comunicacao-whatsapp.js para o
 * construtor de modelos — se mudar aqui, replique lá.
 */
export const FONTES_VARIAVEIS = [
  "paciente.nome",
  "paciente.primeiro_nome",
  "consulta.data",
  "consulta.hora",
  "consulta.dia_semana",
  "consulta.modalidade",
  "consulta.link_video",
  "consulta.profissional",
  "clinica.nome",
  "clinica.telefone",
  "clinica.endereco",
  "medico.nome",
  "documento.tipo",
] as const;

const TIPOS_DOCUMENTO: Record<string, string> = {
  receita: "receita",
  atestado: "atestado",
  declaracao: "declaração",
  laudo: "laudo",
  solicitacao_exame: "solicitação de exame",
  encaminhamento: "encaminhamento",
  lme: "LME",
};

const TZ = "America/Sao_Paulo";

export type Contexto = {
  pacienteId?: string | null;
  agendamentoId?: string | null;
  documentoId?: string | null;
};

async function carregarDadosContexto(db: Db, idMedico: string, ctx: Contexto) {
  const [paciente, agendamento, documento, clinica, medico] = await Promise.all([
    ctx.pacienteId
      ? db
          .from("pacientes")
          .select("paciente_id,name,telefone")
          .eq("paciente_id", ctx.pacienteId)
          .eq("user_id", idMedico)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    ctx.agendamentoId
      ? db
          .from("agendamentos")
          .select(
            "id,data_hora,modalidade,medico_nome,paciente_nome,paciente_id,telefone,video_room_url",
          )
          .eq("id", ctx.agendamentoId)
          .eq("id_medico", idMedico)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    ctx.documentoId
      ? db
          .from("documentos_paciente")
          .select("id,tipo,paciente_nome")
          .eq("id", ctx.documentoId)
          .eq("id_medico", idMedico)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from("medico_clinica_config")
      .select("fantasia,telefone,logradouro,numero,bairro,cidade,uf")
      .eq("id_medico", idMedico)
      .maybeSingle(),
    db.auth.admin.getUserById(idMedico).catch(() => ({ data: null })),
  ]);
  return {
    paciente: paciente?.data ?? null,
    agendamento: agendamento?.data ?? null,
    documento: documento?.data ?? null,
    clinica: clinica?.data ?? null,
    medicoNome: (medico?.data?.user?.user_metadata?.full_name ||
      medico?.data?.user?.user_metadata?.name ||
      "") as string,
  };
}

export async function valoresDasFontes(
  db: Db,
  idMedico: string,
  ctx: Contexto,
): Promise<Record<string, string>> {
  const d = await carregarDadosContexto(db, idMedico, ctx);
  const nome = d.paciente?.name || d.agendamento?.paciente_nome || d.documento?.paciente_nome || "";
  const dt = d.agendamento?.data_hora ? new Date(d.agendamento.data_hora) : null;
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    dt ? new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, ...o }).format(dt) : "";
  const c = d.clinica || {};
  const endereco = [
    [c.logradouro, c.numero].filter(Boolean).join(", "),
    c.bairro,
    [c.cidade, c.uf].filter(Boolean).join("/"),
  ]
    .filter(Boolean)
    .join(" - ");
  return {
    "paciente.nome": nome,
    "paciente.primeiro_nome": nome.split(/\s+/)[0] || "",
    "consulta.data": fmt({ day: "2-digit", month: "2-digit", year: "numeric" }),
    "consulta.hora": fmt({ hour: "2-digit", minute: "2-digit" }),
    "consulta.dia_semana": fmt({ weekday: "long" }),
    "consulta.modalidade": d.agendamento
      ? d.agendamento.modalidade === "video"
        ? "por vídeo"
        : "presencial"
      : "",
    "consulta.link_video": d.agendamento?.video_room_url || "",
    "consulta.profissional": d.agendamento?.medico_nome || d.medicoNome,
    "clinica.nome": c.fantasia || "",
    "clinica.telefone": c.telefone || "",
    "clinica.endereco": endereco,
    "medico.nome": d.medicoNome,
    "documento.tipo": d.documento ? TIPOS_DOCUMENTO[d.documento.tipo] || d.documento.tipo : "",
  };
}

/**
 * Valores finais das variáveis do modelo: o que veio digitado na tela tem
 * prioridade; o resto é preenchido pelo mapeamento variável → campo do app
 * salvo no modelo (modelo.variaveis).
 */
export async function preencherVariaveis(
  db: Db,
  idMedico: string,
  modelo: Modelo,
  ctx: Contexto,
  informados: Record<string, string> = {},
) {
  const mapa = modelo.variaveis || {};
  const precisaFontes = Object.keys(mapa).some((k) => !String(informados[k] ?? "").trim());
  const fontes = precisaFontes ? await valoresDasFontes(db, idMedico, ctx) : {};
  const out: Record<string, string> = {};
  for (const [variavel, fonte] of Object.entries(mapa)) {
    if (fonte && (fontes as Record<string, string>)[fonte])
      out[variavel] = (fontes as Record<string, string>)[fonte];
  }
  for (const [k, v] of Object.entries(informados)) if (String(v ?? "").trim()) out[k] = String(v);
  return out;
}

// ---------------------------------------------------------------------------
// Conversas
// ---------------------------------------------------------------------------

/** Procura o paciente da clínica com esse telefone (cadastros guardam o telefone formatado). */
export async function encontrarPacientePorTelefone(db: Db, idMedico: string, telefone: string) {
  const { data } = await db
    .from("pacientes")
    .select("paciente_id,name,telefone")
    .eq("user_id", idMedico)
    .not("telefone", "is", null);
  return (
    ((data || []) as { paciente_id: string; name: string; telefone: string }[]).find((p) =>
      mesmoTelefone(p.telefone, telefone),
    ) || null
  );
}

export async function obterOuCriarConversa(
  db: Db,
  idMedico: string,
  telefone: string,
  extra: { pacienteId?: string | null; nomeContato?: string | null } = {},
) {
  const { data: existente } = await db
    .from("comunicacao_whatsapp_conversas")
    .select("*")
    .eq("id_medico", idMedico)
    .eq("telefone", telefone)
    .maybeSingle();
  if (existente) {
    if (extra.pacienteId && !existente.paciente_id) {
      await db
        .from("comunicacao_whatsapp_conversas")
        .update({ paciente_id: extra.pacienteId })
        .eq("id", existente.id);
      existente.paciente_id = extra.pacienteId;
    }
    return existente;
  }
  let pacienteId = extra.pacienteId || null;
  let nome = extra.nomeContato || null;
  if (!pacienteId) {
    const p = await encontrarPacientePorTelefone(db, idMedico, telefone);
    if (p) {
      pacienteId = p.paciente_id;
      nome = nome || p.name;
    }
  }
  const { data: criada, error } = await db
    .from("comunicacao_whatsapp_conversas")
    .upsert(
      { id_medico: idMedico, telefone, paciente_id: pacienteId, nome_contato: nome },
      { onConflict: "id_medico,telefone" },
    )
    .select("*")
    .single();
  if (error) throw new Error(`Falha ao criar conversa: ${error.message}`);
  return criada;
}

export type EnvioPedido = {
  idMedico: string;
  usuarioId?: string | null;
  destino: { conversaId?: string | null; pacienteId?: string | null; telefone?: string | null };
  tipo: "texto" | "modelo" | "documento";
  texto?: string;
  modeloId?: string | null;
  valores?: Record<string, string>;
  /** Arquivo a enviar (documento livre ou cabeçalho de mídia do modelo). */
  arquivo?: { bytes: Uint8Array; mime: string; nome: string } | null;
  legenda?: string | null;
  documentoId?: string | null;
  agendamentoId?: string | null;
};

export type EnvioResultado = { mensagem: any; conversa: any; usouModelo: boolean };

async function resolverDestino(db: Db, p: EnvioPedido) {
  if (p.destino.conversaId) {
    const { data } = await db
      .from("comunicacao_whatsapp_conversas")
      .select("*")
      .eq("id", p.destino.conversaId)
      .eq("id_medico", p.idMedico)
      .maybeSingle();
    if (!data) throw new ConfiguracaoError("conversa_inexistente", "Conversa não encontrada.");
    return data;
  }
  let telefone = normalizarTelefone(p.destino.telefone);
  let nome: string | null = null;
  if (!telefone && p.destino.pacienteId) {
    const { data: pac } = await db
      .from("pacientes")
      .select("name,telefone")
      .eq("paciente_id", p.destino.pacienteId)
      .eq("user_id", p.idMedico)
      .maybeSingle();
    if (!pac) throw new ConfiguracaoError("paciente_inexistente", "Paciente não encontrado.");
    telefone = normalizarTelefone(pac.telefone);
    nome = pac.name;
    if (!telefone)
      throw new ConfiguracaoError(
        "sem_telefone",
        "O paciente não tem um celular válido no cadastro.",
      );
  }
  if (!telefone)
    throw new ConfiguracaoError("sem_destino", "Informe o paciente ou o telefone de destino.");
  return obterOuCriarConversa(db, p.idMedico, telefone, {
    pacienteId: p.destino.pacienteId,
    nomeContato: nome,
  });
}

async function carregarModelo(db: Db, idMedico: string, modeloId: string): Promise<Modelo> {
  const { data } = await db
    .from("comunicacao_whatsapp_modelos")
    .select("*")
    .eq("id", modeloId)
    .eq("id_medico", idMedico)
    .maybeSingle();
  if (!data)
    throw new ConfiguracaoError("modelo_inexistente", "Modelo de mensagem não encontrado.");
  if (data.status !== "APPROVED") {
    throw new ConfiguracaoError(
      "modelo_nao_aprovado",
      `O modelo "${data.nome}" ainda não foi aprovado pela Meta (status: ${data.status}).`,
    );
  }
  return data as Modelo;
}

async function modeloDeDocumento(db: Db, idMedico: string): Promise<Modelo | null> {
  const { data: auto } = await db
    .from("comunicacao_whatsapp_automacoes")
    .select("documento_modelo_id")
    .eq("id_medico", idMedico)
    .maybeSingle();
  if (!auto?.documento_modelo_id) return null;
  const { data } = await db
    .from("comunicacao_whatsapp_modelos")
    .select("*")
    .eq("id", auto.documento_modelo_id)
    .eq("status", "APPROVED")
    .maybeSingle();
  return (data as Modelo) || null;
}

function tipoMidia(mime: string): "image" | "video" | "audio" | "document" {
  if (/^image\/(jpeg|png)$/.test(mime)) return "image";
  if (/^video\/(mp4|3gpp)$/.test(mime)) return "video";
  if (/^audio\//.test(mime)) return "audio";
  return "document";
}

/**
 * Envia e registra. Regras da janela de 24h:
 *  - texto livre: só com a janela aberta;
 *  - documento: com a janela aberta vai como documento comum; fechada, vai
 *    no cabeçalho do modelo de "envio de documento" escolhido nas automações;
 *  - modelo: sempre permitido (é o que "abre" uma conversa com o paciente).
 */
export async function enviarParaPaciente(db: Db, p: EnvioPedido): Promise<EnvioResultado> {
  const conexao: ConexaoComSegredos = await exigirConexaoAtiva(db, p.idMedico);
  const conversa = await resolverDestino(db, p);
  const aberta = janelaAberta(conversa.ultima_entrada_em);
  const ctx: Contexto = {
    pacienteId: conversa.paciente_id || p.destino.pacienteId,
    agendamentoId: p.agendamentoId,
    documentoId: p.documentoId,
  };

  let conteudoMeta: Record<string, unknown>;
  let registro: {
    tipo: string;
    conteudo: string;
    midia?: any;
    modelo_id?: string | null;
    modelo_parametros?: any;
  };
  let usouModelo = false;

  if (p.tipo === "texto") {
    const texto = (p.texto || "").trim();
    if (!texto) throw new ConfiguracaoError("texto_vazio", "Digite a mensagem.");
    if (!aberta) {
      throw new ConfiguracaoError(
        "janela_fechada",
        "Passaram mais de 24h desde a última mensagem do paciente. Envie um modelo aprovado para retomar a conversa.",
      );
    }
    conteudoMeta = { type: "text", text: { body: texto.slice(0, 4096), preview_url: true } };
    registro = { tipo: "text", conteudo: texto };
  } else if (p.tipo === "documento") {
    if (!p.arquivo) throw new ConfiguracaoError("sem_arquivo", "Nenhum arquivo para enviar.");
    const mediaId = await subirMidia(conexao, p.arquivo.bytes, p.arquivo.mime, p.arquivo.nome);
    const midia = {
      id: mediaId,
      mime_type: p.arquivo.mime,
      filename: p.arquivo.nome,
      caption: p.legenda || null,
    };
    if (aberta) {
      const t = tipoMidia(p.arquivo.mime);
      const obj: any = { id: mediaId };
      if (t !== "audio" && p.legenda) obj.caption = p.legenda.slice(0, 1024);
      if (t === "document") obj.filename = p.arquivo.nome;
      conteudoMeta = { type: t, [t]: obj };
      registro = { tipo: t, conteudo: p.legenda || p.arquivo.nome, midia };
    } else {
      const modelo = await modeloDeDocumento(db, p.idMedico);
      if (!modelo || modelo.cabecalho?.tipo !== "DOCUMENT") {
        throw new ConfiguracaoError(
          "janela_fechada",
          "O paciente não conversa há mais de 24h. Para enviar documentos fora da janela, escolha um modelo aprovado com cabeçalho de DOCUMENTO em Configurações > WhatsApp dos pacientes > Automações.",
        );
      }
      const valores = await preencherVariaveis(db, p.idMedico, modelo, ctx, p.valores);
      const cab: MidiaCabecalho = { tipo: "document", id: mediaId, filename: p.arquivo.nome };
      conteudoMeta = { type: "template", template: payloadEnvioModelo(modelo, valores, cab) };
      registro = {
        tipo: "template",
        conteudo: renderizarModelo(modelo, valores),
        midia,
        modelo_id: modelo.id,
        modelo_parametros: valores,
      };
      usouModelo = true;
    }
  } else {
    if (!p.modeloId) throw new ConfiguracaoError("sem_modelo", "Escolha o modelo de mensagem.");
    const modelo = await carregarModelo(db, p.idMedico, p.modeloId);
    const valores = await preencherVariaveis(db, p.idMedico, modelo, ctx, p.valores);
    let cab: MidiaCabecalho | null = null;
    let midia: any = null;
    if (modelo.cabecalho && modelo.cabecalho.tipo !== "TEXT") {
      if (!p.arquivo)
        throw new ConfiguracaoError(
          "modelo_exige_midia",
          "Este modelo tem cabeçalho de mídia: anexe o arquivo.",
        );
      const mediaId = await subirMidia(conexao, p.arquivo.bytes, p.arquivo.mime, p.arquivo.nome);
      cab = {
        tipo: modelo.cabecalho.tipo.toLowerCase() as MidiaCabecalho["tipo"],
        id: mediaId,
        filename: p.arquivo.nome,
      };
      midia = { id: mediaId, mime_type: p.arquivo.mime, filename: p.arquivo.nome };
    }
    conteudoMeta = { type: "template", template: payloadEnvioModelo(modelo, valores, cab) };
    registro = {
      tipo: "template",
      conteudo: renderizarModelo(modelo, valores),
      midia,
      modelo_id: modelo.id,
      modelo_parametros: valores,
    };
    usouModelo = true;
  }

  // Grava antes de enviar (status "enviando") para a mensagem aparecer na
  // tela mesmo se a Meta demorar; atualiza com o wa_message_id ou o erro.
  const agora = new Date().toISOString();
  const { data: msg, error: insErr } = await db
    .from("comunicacao_whatsapp_mensagens")
    .insert({
      conversa_id: conversa.id,
      id_medico: p.idMedico,
      direcao: "saida",
      tipo: registro.tipo,
      conteudo: registro.conteudo,
      midia: registro.midia ?? null,
      modelo_id: registro.modelo_id ?? null,
      modelo_parametros: registro.modelo_parametros ?? null,
      status: "enviando",
      enviado_por: p.usuarioId ?? null,
      documento_id: p.documentoId ?? null,
      agendamento_id: p.agendamentoId ?? null,
    })
    .select("*")
    .single();
  if (insErr) throw new Error(`Falha ao registrar mensagem: ${insErr.message}`);

  try {
    const waId = await enviarMensagemMeta(conexao, conversa.telefone, conteudoMeta);
    const { data: atualizada } = await db
      .from("comunicacao_whatsapp_mensagens")
      .update({ wa_message_id: waId, status: "enviada", status_em: new Date().toISOString() })
      .eq("id", msg.id)
      .select("*")
      .single();
    await db
      .from("comunicacao_whatsapp_conversas")
      .update({
        ultima_mensagem: registro.conteudo.slice(0, 280),
        ultima_mensagem_em: agora,
        status: "aberta",
      })
      .eq("id", conversa.id);
    if (p.documentoId) {
      await db
        .from("documentos_paciente")
        .update({ status: "enviado", canal_envio: "whatsapp", enviado_em: agora })
        .eq("id", p.documentoId)
        .eq("id_medico", p.idMedico);
    }
    return { mensagem: atualizada || msg, conversa, usouModelo };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    await db
      .from("comunicacao_whatsapp_mensagens")
      .update({ status: "falhou", erro, status_em: new Date().toISOString() })
      .eq("id", msg.id);
    throw e;
  }
}

/** Converte erros conhecidos em resposta HTTP padronizada para as rotas. */
export function respostaDeErro(e: unknown): Response {
  if (e instanceof ConfiguracaoError)
    return Response.json({ error: e.codigo, message: e.message }, { status: 400 });
  if (e instanceof MetaApiError) {
    return Response.json(
      { error: "meta", message: e.message, code: e.code ?? null },
      { status: e.status === 401 ? 400 : 502 },
    );
  }
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[comunicacao] erro inesperado:", msg);
  return Response.json({ error: "interno", message: msg }, { status: 500 });
}
