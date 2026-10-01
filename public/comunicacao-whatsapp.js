// WHATSAPP DOS PACIENTES — configuração do canal CLÍNICA ↔ PACIENTE
// (Configurações -> WhatsApp dos pacientes).
//
// NÃO é a conexão do WhatsApp do usuário com o assistente do app (essa usa o
// número único do MediCopilot e fica em Minhas IAs > Copiloto). Aqui cada
// clínica liga a PRÓPRIA conta do WhatsApp Business Platform (Cloud API da
// Meta) para falar com os pacientes pela tela Conversas.
//
// Segue o contrato dos outros módulos (meu-plano.js, equipe.js): IIFE, usa
// window.sb, expõe window.initWhatsappPacientes() e escreve em
// #s-whatsapp-pacientes. Também expõe window.CPWhatsApp com utilitários
// usados por conversas-pacientes.js (prévia de modelo, chamadas de API).
//
// Abas: Conexão (guia + credenciais + webhook) · Modelos de mensagem
// (construtor com prévia, envio para aprovação, sincronização) · Automações
// (confirmação/lembrete de consulta, envio de documentos fora da janela 24h).
(function () {
  // Mesma lista de src/lib/comunicacao/envio.server.ts (FONTES_VARIAVEIS) —
  // se mudar lá, replique aqui.
  var FONTES = [
    { id: "paciente.nome", rotulo: "Nome completo do paciente", exemplo: "Maria da Silva" },
    { id: "paciente.primeiro_nome", rotulo: "Primeiro nome do paciente", exemplo: "Maria" },
    { id: "consulta.data", rotulo: "Data da consulta", exemplo: "15/10/2026" },
    { id: "consulta.hora", rotulo: "Hora da consulta", exemplo: "14:30" },
    { id: "consulta.dia_semana", rotulo: "Dia da semana da consulta", exemplo: "quinta-feira" },
    { id: "consulta.modalidade", rotulo: "Modalidade (presencial/por vídeo)", exemplo: "presencial" },
    { id: "consulta.link_video", rotulo: "Link da teleconsulta", exemplo: "https://meet.exemplo.com/sala" },
    { id: "consulta.profissional", rotulo: "Profissional da consulta", exemplo: "Dra. Ana Souza" },
    { id: "clinica.nome", rotulo: "Nome da clínica", exemplo: "Clínica Bem Viver" },
    { id: "clinica.telefone", rotulo: "Telefone da clínica", exemplo: "(47) 3333-0000" },
    { id: "clinica.endereco", rotulo: "Endereço da clínica", exemplo: "Rua XV, 100 - Centro - Blumenau/SC" },
    { id: "medico.nome", rotulo: "Nome do médico (conta)", exemplo: "Dr. João Lima" },
    { id: "documento.tipo", rotulo: "Tipo do documento enviado", exemplo: "receita" },
  ];

  var FINALIDADES = {
    geral: "Uso geral",
    chamada: "Chamar paciente / retomar conversa",
    confirmacao_agendamento: "Confirmação de agendamento",
    lembrete_consulta: "Lembrete de consulta",
    envio_documento: "Envio de documento (receita, atestado...)",
    retorno: "Lembrete de retorno",
    cobranca: "Cobrança",
  };

  var CATEGORIAS = {
    UTILITY: { rotulo: "Utilidade", desc: "Avisos sobre algo que o paciente já combinou com a clínica: consulta, documento, resultado. Mais barata e aprovada mais rápido." },
    MARKETING: { rotulo: "Marketing", desc: "Promoções, campanhas, convites e novidades. Cobrança maior e o paciente pode bloquear." },
    AUTHENTICATION: { rotulo: "Autenticação", desc: "Códigos de verificação (somente leitura — crie no Gerenciador do WhatsApp)." },
  };

  var IDIOMAS = [
    ["pt_BR", "Português (Brasil)"],
    ["en_US", "Inglês (EUA)"],
    ["es", "Espanhol"],
    ["es_ES", "Espanhol (Espanha)"],
  ];

  var STATUS_MODELO = {
    RASCUNHO: { rotulo: "Rascunho", cor: "cinza", icone: "ti-pencil" },
    PENDING: { rotulo: "Em análise", cor: "amarelo", icone: "ti-clock" },
    APPROVED: { rotulo: "Aprovado", cor: "verde", icone: "ti-circle-check" },
    REJECTED: { rotulo: "Rejeitado", cor: "vermelho", icone: "ti-circle-x" },
    PAUSED: { rotulo: "Pausado", cor: "amarelo", icone: "ti-player-pause" },
    DISABLED: { rotulo: "Desativado", cor: "vermelho", icone: "ti-ban" },
    IN_APPEAL: { rotulo: "Em recurso", cor: "azul", icone: "ti-scale" },
    PENDING_DELETION: { rotulo: "Excluindo", cor: "cinza", icone: "ti-trash" },
    DELETED: { rotulo: "Excluído na Meta", cor: "cinza", icone: "ti-trash" },
    LIMIT_EXCEEDED: { rotulo: "Limite excedido", cor: "vermelho", icone: "ti-alert-triangle" },
    ARCHIVED: { rotulo: "Arquivado", cor: "cinza", icone: "ti-archive" },
  };

  var VERSOES_GRAPH = ["v21.0", "v22.0", "v23.0", "v24.0", "v25.0"];

  // Pontos de partida para os modelos mais comuns de uma clínica.
  var SUGESTOES = [
    {
      icone: "ti-calendar-check", titulo: "Confirmação de agendamento", desc: "Enviado logo após marcar a consulta.",
      modelo: {
        nome: "confirmacao_agendamento", finalidade: "confirmacao_agendamento", categoria: "UTILITY",
        corpo: "Olá, {{1}}! Sua consulta na {{2}} foi agendada para {{3}} às {{4}} ({{5}}).\n\nSe precisar remarcar, é só responder esta mensagem.",
        variaveis: { "1": "paciente.primeiro_nome", "2": "clinica.nome", "3": "consulta.data", "4": "consulta.hora", "5": "consulta.modalidade" },
        rodape: "Mensagem automática", botoes: [{ tipo: "QUICK_REPLY", texto: "Confirmar presença" }, { tipo: "QUICK_REPLY", texto: "Preciso remarcar" }],
      },
    },
    {
      icone: "ti-bell-ringing", titulo: "Lembrete de consulta", desc: "Enviado horas antes da consulta.",
      modelo: {
        nome: "lembrete_consulta", finalidade: "lembrete_consulta", categoria: "UTILITY",
        cabecalho: { tipo: "TEXT", texto: "Lembrete de consulta", exemplo: "" },
        corpo: "Olá, {{1}}! Passando para lembrar da sua consulta com {{2}} em {{3}} às {{4}}.\n\nEndereço: {{5}}\n\nPodemos confirmar sua presença?",
        variaveis: { "1": "paciente.primeiro_nome", "2": "consulta.profissional", "3": "consulta.data", "4": "consulta.hora", "5": "clinica.endereco" },
        botoes: [{ tipo: "QUICK_REPLY", texto: "Confirmo" }, { tipo: "QUICK_REPLY", texto: "Não poderei ir" }],
      },
    },
    {
      icone: "ti-file-certificate", titulo: "Documento disponível", desc: "Leva o PDF da receita/atestado no cabeçalho.",
      modelo: {
        nome: "envio_documento", finalidade: "envio_documento", categoria: "UTILITY",
        cabecalho: { tipo: "DOCUMENT" },
        corpo: "Olá, {{1}}! Segue a sua {{2}} emitida pela {{3}}.\n\nGuarde este arquivo e, em caso de dúvidas, responda esta mensagem.",
        variaveis: { "1": "paciente.primeiro_nome", "2": "documento.tipo", "3": "clinica.nome" },
      },
    },
    {
      icone: "ti-message-circle-share", titulo: "Chamar paciente", desc: "Inicia/retoma a conversa fora da janela de 24h.",
      modelo: {
        nome: "contato_clinica", finalidade: "chamada", categoria: "UTILITY",
        corpo: "Olá, {{1}}! Aqui é da {{2}}. Precisamos falar com você sobre o seu atendimento. Pode nos responder por aqui?",
        variaveis: { "1": "paciente.primeiro_nome", "2": "clinica.nome" },
        botoes: [{ tipo: "QUICK_REPLY", texto: "Pode falar" }],
      },
    },
    {
      icone: "ti-video", titulo: "Link da teleconsulta", desc: "Envia o link da sala de vídeo.",
      modelo: {
        nome: "link_teleconsulta", finalidade: "geral", categoria: "UTILITY",
        corpo: "Olá, {{1}}! Sua teleconsulta de {{2}} às {{3}} será por vídeo. Acesse a sala pelo link: {{4}}\n\nRecomendamos entrar 5 minutos antes.",
        variaveis: { "1": "paciente.primeiro_nome", "2": "consulta.data", "3": "consulta.hora", "4": "consulta.link_video" },
      },
    },
    {
      icone: "ti-repeat", titulo: "Lembrete de retorno", desc: "Convida o paciente a agendar o retorno.",
      modelo: {
        nome: "lembrete_retorno", finalidade: "retorno", categoria: "UTILITY",
        corpo: "Olá, {{1}}! Está chegando a data do seu retorno com {{2}}. Quer que a gente agende um horário para você?",
        variaveis: { "1": "paciente.primeiro_nome", "2": "medico.nome" },
        botoes: [{ tipo: "QUICK_REPLY", texto: "Quero agendar" }],
      },
    },
  ];

  var S = {
    aba: "conexao",
    carregando: true,
    erro: null,
    conexao: null,
    modelos: [],
    automacoes: null,
    aviso: null,
    filtro: "todos",
    guiaAberto: null,
    ocupado: null,
    userId: null,
  };
  var E = null; // estado do editor de modelo

  // ---------------------------------------------------------------------------
  // utilitários
  // ---------------------------------------------------------------------------

  function sbClient() {
    return window.sb || window.__sb;
  }

  async function sessao() {
    var res = await sbClient().auth.getSession();
    return res.data && res.data.session ? res.data.session : null;
  }

  async function api(path, body, metodo) {
    var s = await sessao();
    if (!s) throw new Error("Sessão expirada. Entre novamente.");
    var opts = { method: metodo || "POST", headers: { Authorization: "Bearer " + s.access_token } };
    if (opts.method !== "GET" && opts.method !== "DELETE") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body || {});
    }
    var resp = await fetch(path, opts);
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) {
      var e = new Error(data.message || data.error || "Erro " + resp.status);
      e.codigo = data.error;
      e.erros = data.erros;
      throw e;
    }
    return data;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function toast(msg, tipo) {
    if (typeof window.showToast === "function") window.showToast(msg, tipo);
  }

  function fmtData(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return iso;
    }
  }

  function arquivoParaBase64(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(",")[1] || ""); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function extrairVariaveis(texto, formato) {
    var re = formato === "NAMED" ? /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g : /\{\{\s*(\d+)\s*\}\}/g;
    var vistas = [];
    var m;
    while ((m = re.exec(texto || ""))) if (vistas.indexOf(m[1]) < 0) vistas.push(m[1]);
    return vistas;
  }

  function fonte(id) {
    for (var i = 0; i < FONTES.length; i++) if (FONTES[i].id === id) return FONTES[i];
    return null;
  }

  function slug(v) {
    return String(v || "")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_/, "")
      .slice(0, 512);
  }

  // Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~) já com HTML escapado.
  function formatarWa(html) {
    return html
      .replace(/\*([^*\n]+)\*/g, "<b>$1</b>")
      .replace(/(^|[\s>])_([^_\n]+)_/g, "$1<i>$2</i>")
      .replace(/~([^~\n]+)~/g, "<s>$1</s>");
  }

  /**
   * Bolha de prévia de um modelo. valores: variável -> texto. Variáveis sem
   * valor aparecem como {{x}} destacado.
   */
  function bolhaModelo(m, valores) {
    valores = valores || {};
    var formato = m.parameter_format === "NAMED" ? "NAMED" : "POSITIONAL";
    var re = formato === "NAMED" ? /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g : /\{\{\s*(\d+)\s*\}\}/g;
    function troca(texto, prefixo) {
      return formatarWa(esc(texto || "")).replace(re, function (_x, v) {
        var val = valores[(prefixo || "") + v];
        if (val == null && prefixo && formato === "NAMED") val = valores[v];
        return '<span class="wp-var-prev">' + esc(val != null && String(val).trim() ? val : "{{" + v + "}}") + "</span>";
      });
    }
    var cab = m.cabecalho || null;
    var h = '<div class="wp-bolha">';
    if (cab && cab.tipo === "TEXT" && cab.texto) {
      var ex = {};
      var hv = extrairVariaveis(cab.texto, formato)[0];
      if (hv) ex["header." + hv] = valores["header." + hv] != null ? valores["header." + hv] : cab.exemplo;
      var antes = valores;
      valores = Object.assign({}, antes, ex);
      h += '<div class="wp-bolha-cab">' + troca(cab.texto, "header.") + "</div>";
      valores = antes;
    } else if (cab && cab.tipo === "DOCUMENT") {
      h += '<div class="wp-bolha-midia doc"><i class="ti ti-file-type-pdf"></i><span>' + esc(valores.__arquivo || "documento.pdf") + "</span></div>";
    } else if (cab && cab.tipo === "IMAGE") {
      h += '<div class="wp-bolha-midia"><i class="ti ti-photo"></i></div>';
    } else if (cab && cab.tipo === "VIDEO") {
      h += '<div class="wp-bolha-midia"><i class="ti ti-player-play"></i></div>';
    }
    h += '<div class="wp-bolha-corpo">' + (m.corpo ? troca(m.corpo) : '<span style="color:#9ca3af">Corpo da mensagem…</span>') + "</div>";
    if (m.rodape) h += '<div class="wp-bolha-rodape">' + esc(m.rodape) + "</div>";
    h += '<div class="wp-bolha-hora">' + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + "</div>";
    (m.botoes || []).forEach(function (b) {
      var ic = b.tipo === "URL" ? "ti-external-link" : b.tipo === "PHONE_NUMBER" ? "ti-phone" : "ti-arrow-back-up";
      h += '<div class="wp-bolha-botao"><i class="ti ' + ic + '"></i>' + esc(b.texto || "Botão") + "</div>";
    });
    return h + "</div>";
  }

  function badgeStatusModelo(st) {
    var s = STATUS_MODELO[st] || { rotulo: st, cor: "cinza", icone: "ti-help" };
    return '<span class="wp-badge ' + s.cor + '"><i class="ti ' + s.icone + '"></i>' + esc(s.rotulo) + "</span>";
  }

  // ---------------------------------------------------------------------------
  // carga
  // ---------------------------------------------------------------------------

  async function carregar() {
    S.carregando = true;
    S.erro = null;
    render();
    try {
      var s = await sessao();
      if (!s) throw new Error("Sessão expirada. Entre novamente.");
      S.userId = s.user.id;
      var sb = sbClient();
      var res = await Promise.all([
        api("/api/comunicacao/conexao", null, "GET"),
        sb.from("comunicacao_whatsapp_modelos").select("*").eq("id_medico", S.userId).order("created_at", { ascending: false }),
        sb.from("comunicacao_whatsapp_automacoes").select("*").eq("id_medico", S.userId).maybeSingle(),
      ]);
      S.conexao = res[0];
      if (res[1].error) throw new Error(res[1].error.message);
      S.modelos = res[1].data || [];
      S.automacoes = res[2].data || null;
      if (S.guiaAberto === null) S.guiaAberto = !(S.conexao && S.conexao.status === "conectado");
    } catch (e) {
      S.erro = e.message || String(e);
    }
    S.carregando = false;
    render();
  }

  async function recarregarModelos() {
    var r = await sbClient().from("comunicacao_whatsapp_modelos").select("*").eq("id_medico", S.userId).order("created_at", { ascending: false });
    if (!r.error) S.modelos = r.data || [];
  }

  // ---------------------------------------------------------------------------
  // render principal
  // ---------------------------------------------------------------------------

  var VOLTAR =
    '<div style="margin-bottom:14px"><button class="btn ghost sm" onclick="goScreen(\'configuracoes\')"><i class="ti ti-arrow-left"></i> Voltar</button></div>';

  function cabecalho() {
    return (
      '<div class="wp-head"><div>' +
      '<h1><i class="ti ti-brand-whatsapp"></i> WhatsApp dos pacientes</h1>' +
      "<p>Conecte a conta do WhatsApp Business da sua clínica (API oficial da Meta) para conversar com os pacientes na tela Conversas, " +
      "avisar sobre consultas e enviar receitas e documentos. Esta conexão é diferente do WhatsApp do assistente do MediCopilot.</p>" +
      "</div></div>"
    );
  }

  function abas() {
    var aprov = S.modelos.filter(function (m) { return m.status === "APPROVED"; }).length;
    var lista = [
      { id: "conexao", nome: "Conexão", icone: "ti-plug-connected" },
      { id: "modelos", nome: "Modelos de mensagem", icone: "ti-template", cnt: S.modelos.length ? aprov + "/" + S.modelos.length : "" },
      { id: "automacoes", nome: "Automações", icone: "ti-robot" },
    ];
    return (
      '<div class="wp-tabs">' +
      lista.map(function (a) {
        return (
          '<button class="wp-tab' + (S.aba === a.id ? " ativa" : "") + '" onclick="WPA.aba(\'' + a.id + "')\">" +
          '<i class="ti ' + a.icone + '"></i>' + a.nome + (a.cnt ? ' <span class="cnt">' + a.cnt + "</span>" : "") + "</button>"
        );
      }).join("") +
      "</div>"
    );
  }

  function render() {
    var el = document.getElementById("s-whatsapp-pacientes");
    if (!el) return;
    if (S.carregando) {
      el.innerHTML = VOLTAR + cabecalho() + '<div class="wp-panel">Carregando configuração…</div>';
      return;
    }
    if (S.erro) {
      el.innerHTML =
        VOLTAR + cabecalho() +
        '<div class="wp-aviso erro"><i class="ti ti-alert-circle"></i><div>' + esc(S.erro) +
        '<div style="margin-top:8px"><button class="wp-btn sm" onclick="WPA.recarregar()"><i class="ti ti-refresh"></i> Tentar de novo</button></div></div></div>';
      return;
    }
    var aviso = S.aviso
      ? '<div class="wp-aviso ' + S.aviso.tipo + '"><i class="ti ' + (S.aviso.tipo === "erro" ? "ti-alert-circle" : "ti-circle-check") + '"></i><div>' + esc(S.aviso.texto) + "</div></div>"
      : "";
    var corpo = S.aba === "modelos" ? abaModelos() : S.aba === "automacoes" ? abaAutomacoes() : abaConexao();
    el.innerHTML = VOLTAR + cabecalho() + aviso + abas() + corpo;
  }

  function avisar(texto, tipo) {
    S.aviso = { texto: texto, tipo: tipo || "ok" };
    render();
    var el = document.getElementById("s-whatsapp-pacientes");
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------------------
  // aba Conexão
  // ---------------------------------------------------------------------------

  function statusConexao() {
    var c = S.conexao || {};
    var st = !c.configurado
      ? { rotulo: "Não configurado", cor: "cinza" }
      : c.status === "conectado" ? { rotulo: "Conectado", cor: "verde" }
      : c.status === "erro" ? { rotulo: "Erro na conexão", cor: "vermelho" }
      : c.status === "desconectado" ? { rotulo: "Desconectado", cor: "cinza" }
      : { rotulo: "Salvo — falta testar", cor: "amarelo" };
    var qual = { GREEN: ["Alta", "verde"], YELLOW: ["Média", "amarelo"], RED: ["Baixa", "vermelho"] }[c.quality_rating] || null;
    var ok = c.status === "conectado";
    var h =
      '<div class="wp-panel"><div class="wp-status"><div class="wp-status-id">' +
      '<div class="wp-status-ico' + (ok ? "" : " off") + '"><i class="ti ti-brand-whatsapp"></i></div><div>' +
      '<div class="wp-status-nome">' + esc(c.nome_verificado || c.numero_exibicao || "WhatsApp da clínica") +
      ' <span class="wp-badge ' + st.cor + '">' + st.rotulo + "</span></div>" +
      '<div class="wp-status-sub">' + esc(c.numero_exibicao || "Nenhum número validado ainda") + (c.nome_waba ? " · Conta " + esc(c.nome_waba) : "") + "</div>" +
      "</div></div>" +
      '<div class="wp-acoes">' +
      (c.configurado ? '<button class="wp-btn primary sm" onclick="WPA.testar()" ' + (S.ocupado ? "disabled" : "") + '><i class="ti ti-plug-connected"></i> ' + (S.ocupado === "testar" ? "Testando…" : "Testar conexão") + "</button>" : "") +
      "</div></div>";
    if (c.status === "erro" && c.ultimo_erro) {
      h += '<div class="wp-aviso erro" style="margin:14px 0 0"><i class="ti ti-alert-circle"></i><div>' + esc(c.ultimo_erro) + "</div></div>";
    }
    if (c.configurado) {
      h +=
        '<div class="wp-infos">' +
        '<div class="wp-info"><span>Qualidade do número</span><strong>' + (qual ? '<span class="wp-badge ' + qual[1] + '">' + qual[0] + "</span>" : "—") + "</strong></div>" +
        '<div class="wp-info"><span>Limite de conversas</span><strong>' + esc(c.messaging_limit_tier || "—") + "</strong></div>" +
        '<div class="wp-info"><span>Webhook verificado</span><strong>' + (c.webhook_verificado_em ? '<i class="ti ti-circle-check" style="color:#16a34a"></i>' + fmtData(c.webhook_verificado_em) : '<span class="wp-badge amarelo">Pendente</span>') + "</strong></div>" +
        '<div class="wp-info"><span>Último evento recebido</span><strong>' + fmtData(c.ultimo_evento_em) + "</strong></div>" +
        "</div>";
    }
    return h + "</div>";
  }

  function guia() {
    var passos = [
      ["Tenha um Meta Business (Gerenciador de Negócios)", 'Crie ou use o portfólio empresarial da clínica em <a href="https://business.facebook.com" target="_blank" rel="noopener">business.facebook.com</a>. A verificação da empresa libera limites maiores de envio.'],
      ["Crie um App do tipo “Empresa” e adicione o produto WhatsApp", 'Em <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> → Criar app → Empresa → adicione “WhatsApp”. Vincule ao portfólio da clínica.'],
      ["Adicione e verifique o número da clínica", "Em WhatsApp → Configuração da API, adicione o número (ele não pode estar em uso no app WhatsApp comum ou no WhatsApp Business do celular), confirme por SMS/ligação e defina o PIN de verificação em duas etapas."],
      ["Copie os identificadores", "Em WhatsApp → Configuração da API: <b>ID do número de telefone</b> e <b>ID da conta do WhatsApp Business</b>. Em Configurações do app → Básico: <b>ID do aplicativo</b> e <b>Chave secreta do aplicativo</b>."],
      ["Gere um token permanente", "Em Configurações do negócio → Usuários → <b>Usuários do sistema</b>: crie um usuário Admin, atribua o App e a conta do WhatsApp (controle total) e gere um token <b>sem expiração</b> com as permissões <code>whatsapp_business_messaging</code> e <code>whatsapp_business_management</code>. O token temporário de 24h do painel não serve para produção."],
      ["Preencha e salve os campos abaixo, depois clique em “Testar conexão”", "O MediCopilot valida o número e a conta direto na Meta."],
      ["Configure o webhook no App da Meta", "Em WhatsApp → Configuração → Webhook: cole a <b>URL de callback</b> e o <b>Token de verificação</b> mostrados abaixo, clique em Verificar e salvar e assine os campos <code>messages</code> e <code>message_template_status_update</code>. Depois clique em “Assinar webhook na conta” aqui."],
      ["Adicione uma forma de pagamento e publique o App", "Na conta do WhatsApp (Gerenciador do WhatsApp → Faturamento) cadastre o cartão: a Meta cobra as mensagens de modelo direto da clínica. Mude o App para o modo <b>Ativo/Live</b>."],
      ["Crie seus modelos de mensagem", "Na aba “Modelos de mensagem”, crie e envie para aprovação os modelos de lembrete, confirmação e envio de documentos."],
    ];
    return (
      '<div class="wp-panel"><div class="wp-secao-head"><p class="wp-secao-titulo"><i class="ti ti-list-check"></i> Passo a passo na Meta</p>' +
      '<button class="wp-guia-toggle" onclick="WPA.guia()">' + (S.guiaAberto ? "Recolher" : "Mostrar") + ' <i class="ti ti-chevron-' + (S.guiaAberto ? "up" : "down") + '"></i></button></div>' +
      (S.guiaAberto
        ? '<div class="wp-guia">' + passos.map(function (p) {
            return '<div class="wp-passo"><div class="wp-passo-n"></div><div><b>' + p[0] + "</b><p>" + p[1] + "</p></div></div>";
          }).join("") + "</div>" +
          '<div class="wp-aviso info" style="margin:12px 0 0"><i class="ti ti-info-circle"></i><div><b>Janela de 24 horas:</b> depois que o paciente manda uma mensagem, a clínica pode responder livremente (texto, PDF, fotos) por 24h. ' +
          "Fora dessa janela — inclusive para iniciar uma conversa — a Meta só permite <b>modelos de mensagem aprovados</b>. Por isso os avisos de consulta e o envio de documentos usam modelos.</div></div>"
        : "") +
      "</div>"
    );
  }

  function campo(id, rotulo, valor, opts) {
    opts = opts || {};
    return (
      '<div class="wp-fld' + (opts.full ? " full" : "") + '"><label for="' + id + '">' + rotulo +
      (opts.req ? ' <span class="req">*</span>' : opts.opc ? ' <span class="opc">(opcional)</span>' : "") + "</label>" +
      (opts.textarea
        ? '<textarea id="' + id + '" rows="3" placeholder="' + esc(opts.ph || "") + '" autocomplete="off" spellcheck="false">' + esc(valor || "") + "</textarea>"
        : '<input id="' + id + '" type="' + (opts.tipo || "text") + '" value="' + esc(valor || "") + '" placeholder="' + esc(opts.ph || "") + '" autocomplete="off" spellcheck="false"' +
          (opts.numerico ? ' inputmode="numeric" oninput="this.value=this.value.replace(/\\D/g,\'\')"' : "") + (opts.lista ? ' list="' + opts.lista + '"' : "") + " />") +
      (opts.ajuda ? "<small>" + opts.ajuda + "</small>" : "") +
      "</div>"
    );
  }

  function abaConexao() {
    var c = S.conexao || {};
    var credenciais =
      '<div class="wp-panel"><div class="wp-secao-head"><p class="wp-secao-titulo"><i class="ti ti-key"></i> Credenciais da API da Meta</p></div>' +
      '<div class="wp-grid">' +
      campo("wp-waba", "ID da conta do WhatsApp Business (WABA ID)", c.waba_id, { req: 1, numerico: 1, ph: "Ex.: 102938475610293", ajuda: "WhatsApp → Configuração da API → “ID da conta do WhatsApp Business”." }) +
      campo("wp-phone", "ID do número de telefone (Phone Number ID)", c.phone_number_id, { req: 1, numerico: 1, ph: "Ex.: 1456440990878494", ajuda: "WhatsApp → Configuração da API → “ID do número de telefone”. Não é o número em si." }) +
      campo("wp-token", "Token de acesso permanente (Usuário do Sistema)", "", {
        req: !c.tem_access_token, full: 1, textarea: 1,
        ph: c.tem_access_token ? "Token salvo: " + (c.access_token_mascarado || "") + " — deixe em branco para manter" : "EAAG…",
        ajuda: "Gerado em Configurações do negócio → Usuários do sistema → Gerar token (sem expiração). Fica cifrado no servidor e nunca é exibido de volta.",
      }) +
      campo("wp-app-id", "ID do aplicativo (App ID)", c.meta_app_id, { numerico: 1, ph: "Ex.: 812345678901234", ajuda: "Configurações do app → Básico. Necessário para enviar arquivos de exemplo em modelos com imagem/vídeo/documento." }) +
      campo("wp-secret", "Chave secreta do aplicativo (App Secret)", "", {
        req: !c.tem_app_secret, tipo: "password",
        ph: c.tem_app_secret ? "Salvo: " + (c.app_secret_mascarado || "") + " — em branco mantém" : "32 caracteres",
        ajuda: "Configurações do app → Básico → Chave secreta. Usada para validar a assinatura de cada webhook recebido.",
      }) +
      campo("wp-business", "ID do portfólio empresarial (Business ID)", c.meta_business_id, { opc: 1, numerico: 1, ph: "Ex.: 1234567890", ajuda: "Configurações do negócio → Informações do negócio. Apenas para referência/suporte." }) +
      campo("wp-versao", "Versão da Graph API", c.graph_api_version || "v23.0", { lista: "wp-versoes", ph: "v23.0", ajuda: "Mantenha a versão mais recente suportada pela Meta (formato vNN.N)." }) +
      '<datalist id="wp-versoes">' + VERSOES_GRAPH.map(function (v) { return '<option value="' + v + '">'; }).join("") + "</datalist>" +
      "</div>" +
      '<div class="wp-acoes" style="margin-top:16px">' +
      '<button class="wp-btn primary" onclick="WPA.salvarConexao()" ' + (S.ocupado ? "disabled" : "") + '><i class="ti ti-device-floppy"></i> ' + (S.ocupado === "salvar" ? "Salvando…" : "Salvar credenciais") + "</button>" +
      (c.configurado
        ? '<button class="wp-btn" onclick="WPA.abrirRegistro()" ' + (S.ocupado ? "disabled" : "") + '><i class="ti ti-certificate"></i> Registrar número (PIN)</button>' +
          (c.status !== "desconectado" ? '<button class="wp-btn danger" onclick="WPA.desconectar()" ' + (S.ocupado ? "disabled" : "") + '><i class="ti ti-plug-x"></i> Desconectar</button>' : "")
        : "") +
      "</div></div>";

    var webhook = !c.configurado
      ? '<div class="wp-panel"><p class="wp-secao-titulo"><i class="ti ti-webhook"></i> Webhook</p><p class="wp-nota">Salve as credenciais para gerar a URL de callback e o token de verificação desta clínica.</p></div>'
      : '<div class="wp-panel"><div class="wp-secao-head"><p class="wp-secao-titulo"><i class="ti ti-webhook"></i> Webhook — cole no App da Meta</p>' +
        (c.webhook_assinado_em ? '<span class="wp-badge verde"><i class="ti ti-circle-check"></i> Assinado na conta em ' + fmtData(c.webhook_assinado_em) + "</span>" : "") +
        "</div>" +
        '<div class="wp-grid">' +
        '<div class="wp-fld full"><label>URL de callback</label><div class="wp-copy"><input readonly id="wp-wh-url" value="' + esc(c.webhook_url) + '" />' +
        '<button class="wp-btn sm" onclick="WPA.copiar(\'wp-wh-url\')"><i class="ti ti-copy"></i> Copiar</button></div>' +
        "<small>Exclusiva da sua clínica. Recebe as mensagens dos pacientes, os status de entrega/leitura e a aprovação dos modelos.</small></div>" +
        '<div class="wp-fld full"><label>Token de verificação (Verify token)</label><div class="wp-copy"><input readonly id="wp-wh-token" value="' + esc(c.verify_token) + '" />' +
        '<button class="wp-btn sm" onclick="WPA.copiar(\'wp-wh-token\')"><i class="ti ti-copy"></i> Copiar</button>' +
        '<button class="wp-btn sm ghost" title="Gerar novo token" onclick="WPA.novoVerifyToken()"><i class="ti ti-refresh"></i></button></div></div>' +
        '<div class="wp-fld full"><label>Campos do webhook a assinar</label><div class="wp-campos-webhook">' +
        '<span class="wp-chip">messages</span><span class="wp-chip">message_template_status_update</span>' +
        '<span class="wp-chip opc">phone_number_quality_update (opcional)</span></div></div>' +
        "</div>" +
        '<div class="wp-acoes" style="margin-top:14px"><button class="wp-btn" onclick="WPA.assinarWebhook()" ' + (S.ocupado || c.status !== "conectado" ? "disabled" : "") + '><i class="ti ti-link"></i> ' +
        (S.ocupado === "assinar" ? "Assinando…" : "Assinar webhook na conta (WABA)") + "</button>" +
        (c.status !== "conectado" ? '<span class="wp-nota" style="margin:0">Teste a conexão antes de assinar.</span>' : "") +
        "</div></div>";

    return statusConexao() + guia() + credenciais + webhook;
  }

  function lerCampo(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : "";
  }

  async function salvarConexao(extra) {
    S.ocupado = "salvar";
    render();
    try {
      var body = Object.assign(
        {
          waba_id: lerCampo("wp-waba"),
          phone_number_id: lerCampo("wp-phone"),
          access_token: lerCampo("wp-token"),
          meta_app_id: lerCampo("wp-app-id"),
          app_secret: lerCampo("wp-secret"),
          meta_business_id: lerCampo("wp-business"),
          graph_api_version: lerCampo("wp-versao") || "v23.0",
        },
        extra || {},
      );
      if (extra && extra.regenerar_verify_token) {
        // Só regenera o token — mantém os demais valores salvos.
        var c = S.conexao || {};
        body = Object.assign(body, {
          waba_id: body.waba_id || c.waba_id, phone_number_id: body.phone_number_id || c.phone_number_id,
          meta_app_id: body.meta_app_id || c.meta_app_id, meta_business_id: body.meta_business_id || c.meta_business_id,
          graph_api_version: body.graph_api_version || c.graph_api_version,
        });
      }
      S.conexao = await api("/api/comunicacao/conexao", body);
      S.ocupado = null;
      if (extra && extra.regenerar_verify_token) avisar("Novo token de verificação gerado. Atualize-o no App da Meta e verifique o webhook de novo.");
      else if (S.conexao.status !== "conectado") {
        avisar("Credenciais salvas. Testando a conexão com a Meta…");
        await testar();
      } else avisar("Credenciais salvas.");
    } catch (e) {
      S.ocupado = null;
      avisar(e.message, "erro");
    }
  }

  async function testar() {
    S.ocupado = "testar";
    render();
    try {
      var r = await api("/api/comunicacao/conexao-acao", { acao: "testar" });
      S.conexao = await api("/api/comunicacao/conexao", null, "GET");
      S.ocupado = null;
      S.guiaAberto = false;
      avisar("Conexão validada: " + (r.nome_verificado || "") + " " + (r.numero_exibicao || "") + ".");
    } catch (e) {
      S.conexao = await api("/api/comunicacao/conexao", null, "GET").catch(function () { return S.conexao; });
      S.ocupado = null;
      avisar("Falha ao validar com a Meta: " + e.message, "erro");
    }
  }

  async function assinarWebhook() {
    S.ocupado = "assinar";
    render();
    try {
      await api("/api/comunicacao/conexao-acao", { acao: "assinar_webhook" });
      S.conexao = await api("/api/comunicacao/conexao", null, "GET");
      S.ocupado = null;
      avisar("Webhook assinado na conta do WhatsApp. As mensagens dos pacientes passam a chegar em Conversas.");
    } catch (e) {
      S.ocupado = null;
      avisar(e.message, "erro");
    }
  }

  async function desconectar() {
    if (!confirm("Desconectar o WhatsApp da clínica? As credenciais serão apagadas; conversas e modelos ficam guardados.")) return;
    S.ocupado = "desconectar";
    render();
    try {
      await api("/api/comunicacao/conexao", null, "DELETE");
      S.conexao = await api("/api/comunicacao/conexao", null, "GET");
      S.ocupado = null;
      avisar("WhatsApp da clínica desconectado.");
    } catch (e) {
      S.ocupado = null;
      avisar(e.message, "erro");
    }
  }

  function abrirRegistro() {
    modal(
      '<div class="wp-modal sm"><div class="wp-modal-head"><h3>Registrar número na Cloud API</h3><button class="wp-btn xs ghost" onclick="WPA.fecharModal()"><i class="ti ti-x"></i></button></div>' +
      '<div class="wp-modal-body"><p class="wp-nota" style="margin:0 0 12px">Necessário uma única vez para números novos (erro “número não registrado”). Informe o PIN de 6 dígitos da verificação em duas etapas definido na Meta — se ainda não existir, este PIN passa a ser o PIN do número.</p>' +
      '<div class="wp-fld"><label for="wp-pin">PIN de 6 dígitos</label><input id="wp-pin" inputmode="numeric" maxlength="6" oninput="this.value=this.value.replace(/\\D/g,\'\')" /></div></div>' +
      '<div class="wp-modal-foot"><button class="wp-btn" onclick="WPA.fecharModal()">Cancelar</button><button class="wp-btn primary" onclick="WPA.registrar()"><i class="ti ti-check"></i> Registrar</button></div></div>',
    );
  }

  async function registrar() {
    var pin = lerCampo("wp-pin");
    try {
      await api("/api/comunicacao/conexao-acao", { acao: "registrar_numero", pin: pin });
      fecharModal();
      avisar("Número registrado na Cloud API.");
    } catch (e) {
      toast(e.message, "error");
    }
  }

  function copiar(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var ok = function () { toast("Copiado", "success"); };
    if (navigator.clipboard) navigator.clipboard.writeText(el.value).then(ok, function () { el.select(); document.execCommand("copy"); ok(); });
    else { el.select(); document.execCommand("copy"); ok(); }
  }

  // ---------------------------------------------------------------------------
  // aba Modelos
  // ---------------------------------------------------------------------------

  function abaModelos() {
    var conectado = S.conexao && S.conexao.status === "conectado";
    var filtros = [["todos", "Todos"], ["APPROVED", "Aprovados"], ["PENDING", "Em análise"], ["REJECTED", "Rejeitados"], ["RASCUNHO", "Rascunhos"]];
    var lista = S.modelos.filter(function (m) { return S.filtro === "todos" || m.status === S.filtro; });
    var h = "";
    if (!conectado) {
      h += '<div class="wp-aviso alerta"><i class="ti ti-alert-triangle"></i><div>Conecte e teste o WhatsApp da clínica (aba Conexão) para enviar modelos para aprovação. Você já pode montar rascunhos.</div></div>';
    }
    h +=
      '<div class="wp-panel"><div class="wp-secao-head"><p class="wp-secao-titulo"><i class="ti ti-template"></i> Modelos de mensagem</p><div class="wp-acoes">' +
      '<button class="wp-btn sm" onclick="WPA.sincronizar()" ' + (!conectado || S.ocupado ? "disabled" : "") + '><i class="ti ti-refresh"></i> ' + (S.ocupado === "sincronizar" ? "Sincronizando…" : "Sincronizar com a Meta") + "</button>" +
      '<button class="wp-btn primary sm" onclick="WPA.novoModelo()"><i class="ti ti-plus"></i> Novo modelo</button></div></div>' +
      '<p class="wp-nota" style="margin:-4px 0 12px">Modelos são mensagens pré-aprovadas pela Meta, obrigatórias para chamar o paciente fora da janela de 24h, lembrar consultas e enviar documentos. A análise costuma levar de minutos a algumas horas; o status é atualizado automaticamente pelo webhook.</p>' +
      '<div class="wp-filtros">' + filtros.map(function (f) {
        return '<button class="wp-filtro' + (S.filtro === f[0] ? " ativo" : "") + '" onclick="WPA.filtro(\'' + f[0] + "')\">" + f[1] + "</button>";
      }).join("") + "</div>";
    if (!lista.length) {
      h += '<div class="wp-vazio">' + (S.modelos.length ? "Nenhum modelo neste filtro." : "Nenhum modelo ainda. Comece por uma das sugestões abaixo.") + "</div>";
    } else {
      h += '<div class="wp-modelos">' + lista.map(cardModelo).join("") + "</div>";
    }
    h += "</div>";
    h +=
      '<div class="wp-panel"><p class="wp-secao-titulo" style="margin-bottom:12px"><i class="ti ti-sparkles"></i> Sugestões para clínicas</p><div class="wp-sugestoes">' +
      SUGESTOES.map(function (s, i) {
        return '<button class="wp-sugestao" onclick="WPA.usarSugestao(' + i + ')"><i class="ti ' + s.icone + '"></i><div><b>' + esc(s.titulo) + "</b><span>" + esc(s.desc) + "</span></div></button>";
      }).join("") + "</div></div>";
    return h;
  }

  function cardModelo(m) {
    var editavel = ["RASCUNHO", "REJECTED", "APPROVED", "PAUSED"].indexOf(m.status) >= 0 && m.categoria !== "AUTHENTICATION";
    var cab = m.cabecalho && m.cabecalho.tipo;
    return (
      '<div class="wp-modelo"><div class="wp-modelo-top"><div class="wp-modelo-nome">' + esc(m.nome) + "</div>" + badgeStatusModelo(m.status) + "</div>" +
      '<div class="wp-modelo-meta"><span class="wp-badge ' + (m.categoria === "MARKETING" ? "roxo" : "azul") + '">' + esc((CATEGORIAS[m.categoria] || {}).rotulo || m.categoria) + "</span>" +
      '<span class="wp-badge cinza">' + esc(m.idioma) + "</span>" +
      '<span class="wp-badge cinza">' + esc(FINALIDADES[m.finalidade] || m.finalidade) + "</span>" +
      (cab && cab !== "TEXT" ? '<span class="wp-badge cinza"><i class="ti ti-paperclip"></i>' + esc(cab.toLowerCase()) + "</span>" : "") + "</div>" +
      '<div class="wp-modelo-corpo">' + formatarWa(esc(m.corpo)) + "</div>" +
      (m.motivo_rejeicao ? '<div class="wp-modelo-motivo"><b>Motivo:</b> ' + esc(m.motivo_rejeicao) + "</div>" : "") +
      '<div class="wp-modelo-acoes">' +
      (editavel ? '<button class="wp-btn xs" onclick="WPA.editarModelo(\'' + m.id + '\')"><i class="ti ti-pencil"></i> ' + (m.status === "RASCUNHO" ? "Editar" : m.status === "REJECTED" ? "Corrigir" : "Editar") + "</button>" : "") +
      '<button class="wp-btn xs" onclick="WPA.duplicarModelo(\'' + m.id + '\')"><i class="ti ti-copy"></i> Duplicar</button>' +
      (!editavel ? '<button class="wp-btn xs" onclick="WPA.editarModelo(\'' + m.id + '\', true)"><i class="ti ti-adjustments"></i> Variáveis</button>' : "") +
      '<button class="wp-btn xs danger" onclick="WPA.excluirModelo(\'' + m.id + '\')"><i class="ti ti-trash"></i></button>' +
      "</div></div>"
    );
  }

  async function sincronizar() {
    S.ocupado = "sincronizar";
    render();
    try {
      var r = await api("/api/comunicacao/modelos", { acao: "sincronizar" });
      await recarregarModelos();
      S.ocupado = null;
      avisar("Sincronizado com a Meta: " + r.novos + " novo(s), " + r.atualizados + " atualizado(s)" + (r.removidos ? ", " + r.removidos + " removido(s) na Meta" : "") + ".");
    } catch (e) {
      S.ocupado = null;
      avisar(e.message, "erro");
    }
  }

  async function excluirModelo(id) {
    var m = S.modelos.find(function (x) { return x.id === id; });
    if (!m) return;
    var msg = m.meta_template_id && m.status !== "DELETED"
      ? 'Excluir o modelo "' + m.nome + '" também na Meta? Modelos excluídos não podem ter o mesmo nome recriado por 30 dias.'
      : 'Excluir o rascunho "' + m.nome + '"?';
    if (!confirm(msg)) return;
    try {
      await api("/api/comunicacao/modelos", { acao: "excluir", id: id });
      await recarregarModelos();
      avisar("Modelo excluído.");
    } catch (e) {
      avisar(e.message, "erro");
    }
  }

  // ---------------------------------------------------------------------------
  // editor de modelo
  // ---------------------------------------------------------------------------

  function novoEstado(base) {
    base = base || {};
    var cab = base.cabecalho || null;
    var formato = base.parameter_format === "NAMED" ? "NAMED" : "POSITIONAL";
    var exemplos = {};
    if (Array.isArray(base.corpo_exemplos)) base.corpo_exemplos.forEach(function (v, i) { exemplos[String(i + 1)] = v; });
    else if (base.corpo_exemplos && typeof base.corpo_exemplos === "object") exemplos = Object.assign({}, base.corpo_exemplos);
    var variaveis = Object.assign({}, base.variaveis || {});
    // Exemplos padrão a partir do campo mapeado (a Meta exige exemplo de cada variável).
    extrairVariaveis(base.corpo, formato).forEach(function (v) {
      if (!exemplos[v] && variaveis[v] && fonte(variaveis[v])) exemplos[v] = fonte(variaveis[v]).exemplo;
    });
    var cabExemplo = cab && cab.exemplo ? cab.exemplo : "";
    if (cab && cab.tipo === "TEXT" && !cabExemplo) {
      var hv = extrairVariaveis(cab.texto, formato)[0];
      if (hv && variaveis["header." + hv] && fonte(variaveis["header." + hv])) cabExemplo = fonte(variaveis["header." + hv]).exemplo;
    }
    return {
      id: base.id || null,
      meta_template_id: base.meta_template_id || null,
      status: base.status || "RASCUNHO",
      somenteVariaveis: false,
      nome: base.nome || "",
      idioma: base.idioma || "pt_BR",
      categoria: base.categoria || "UTILITY",
      finalidade: base.finalidade || "geral",
      parameter_format: formato,
      cabTipo: cab ? cab.tipo : "NONE",
      cabTexto: cab && cab.tipo === "TEXT" ? cab.texto || "" : "",
      cabExemplo: cabExemplo,
      cabArquivo: null,
      corpo: base.corpo || "",
      exemplos: exemplos,
      variaveis: variaveis,
      rodape: base.rodape || "",
      botoes: (base.botoes || []).map(function (b) { return Object.assign({}, b); }),
      erros: [],
      salvando: null,
    };
  }

  function modeloDoEstado() {
    var vars = extrairVariaveis(E.corpo, E.parameter_format);
    var exemplos;
    if (E.parameter_format === "NAMED") {
      exemplos = {};
      vars.forEach(function (v) { exemplos[v] = E.exemplos[v] || ""; });
    } else {
      exemplos = vars.slice().sort(function (a, b) { return a - b; }).map(function (v) { return E.exemplos[v] || ""; });
    }
    var cab = null;
    if (E.cabTipo === "TEXT") cab = { tipo: "TEXT", texto: E.cabTexto, exemplo: E.cabExemplo };
    else if (E.cabTipo !== "NONE") cab = { tipo: E.cabTipo };
    // Só guarda mapeamentos de variáveis que ainda existem.
    var variaveis = {};
    vars.forEach(function (v) { if (E.variaveis[v]) variaveis[v] = E.variaveis[v]; });
    var hv = cab && cab.tipo === "TEXT" ? extrairVariaveis(cab.texto, E.parameter_format)[0] : null;
    if (hv && E.variaveis["header." + hv]) variaveis["header." + hv] = E.variaveis["header." + hv];
    return {
      id: E.id,
      nome: E.nome,
      idioma: E.idioma,
      categoria: E.categoria,
      finalidade: E.finalidade,
      parameter_format: E.parameter_format,
      cabecalho: cab,
      corpo: E.corpo,
      corpo_exemplos: exemplos,
      rodape: E.rodape || null,
      botoes: E.botoes,
      variaveis: variaveis,
    };
  }

  function valoresPrevia() {
    var v = Object.assign({}, E.exemplos);
    var hv = E.cabTipo === "TEXT" ? extrairVariaveis(E.cabTexto, E.parameter_format)[0] : null;
    if (hv) v["header." + hv] = E.cabExemplo;
    if (E.cabArquivo) v.__arquivo = E.cabArquivo.nome;
    return v;
  }

  function abrirEditor(base, somenteVariaveis) {
    E = novoEstado(base);
    E.somenteVariaveis = !!somenteVariaveis;
    _varsAntes = extrairVariaveis(E.corpo, E.parameter_format).join(",");
    renderEditor();
  }

  function opcoesFonte(sel) {
    return '<option value="">Preencher manualmente no envio</option>' +
      FONTES.map(function (f) { return '<option value="' + f.id + '"' + (sel === f.id ? " selected" : "") + ">" + esc(f.rotulo) + "</option>"; }).join("");
  }

  function htmlVariaveis() {
    var vars = extrairVariaveis(E.corpo, E.parameter_format);
    if (!vars.length) return '<p class="wp-nota" style="margin:0">Nenhuma variável no corpo. Use “Inserir campo” para personalizar com o nome do paciente, data da consulta etc.</p>';
    return vars.map(function (v) {
      var ro = E.somenteVariaveis ? " disabled" : "";
      return (
        '<div class="wp-var"><code>{{' + esc(v) + "}}</code>" +
        '<input placeholder="Exemplo para a Meta" value="' + esc(E.exemplos[v] || "") + '" oninput="WPA.ed(\'ex\',this.value,\'' + v + '\')"' + ro + " />" +
        '<select onchange="WPA.ed(\'map\',this.value,\'' + v + '\')">' + opcoesFonte(E.variaveis[v]) + "</select></div>"
      );
    }).join("");
  }

  function renderEditor() {
    if (!E) return;
    var bloqueado = E.somenteVariaveis;
    var jaNaMeta = !!E.meta_template_id;
    var dis = bloqueado ? " disabled" : "";
    var corpoLen = (E.corpo || "").length;
    var tiposCab = [["NONE", "Nenhum", "ti-minus"], ["TEXT", "Texto", "ti-letter-t"], ["IMAGE", "Imagem", "ti-photo"], ["VIDEO", "Vídeo", "ti-video"], ["DOCUMENT", "Documento", "ti-file-text"]];
    var hv = E.cabTipo === "TEXT" ? extrairVariaveis(E.cabTexto, E.parameter_format)[0] : null;

    var form =
      '<div class="wp-editor-form">' +
      (E.erros.length ? '<div class="wp-erros"><b>Corrija antes de enviar:</b><ul>' + E.erros.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul></div>" : "") +
      (bloqueado ? '<div class="wp-aviso info" style="margin:0"><i class="ti ti-info-circle"></i><div>Este modelo está ' + esc((STATUS_MODELO[E.status] || {}).rotulo || E.status) + " na Meta: só é possível ajustar a finalidade e de onde vem cada variável.</div></div>" : "") +
      // Identificação
      '<div class="wp-bloco"><div class="wp-bloco-titulo">Identificação</div><div class="wp-grid">' +
      '<div class="wp-fld"><label>Nome do modelo <span class="req">*</span></label><input value="' + esc(E.nome) + '" placeholder="lembrete_consulta" oninput="this.value=WPA.slug(this.value);WPA.ed(\'nome\',this.value)"' + (jaNaMeta || bloqueado ? " disabled" : "") + " />" +
      "<small>Minúsculas, números e _. Não pode ser alterado depois de enviado.</small></div>" +
      '<div class="wp-fld"><label>Idioma</label><select onchange="WPA.ed(\'idioma\',this.value)"' + (jaNaMeta || bloqueado ? " disabled" : "") + ">" +
      IDIOMAS.map(function (i) { return '<option value="' + i[0] + '"' + (E.idioma === i[0] ? " selected" : "") + ">" + i[1] + "</option>"; }).join("") + "</select></div>" +
      '<div class="wp-fld"><label>Categoria</label><select onchange="WPA.ed(\'categoria\',this.value)"' + dis + ">" +
      ["UTILITY", "MARKETING"].map(function (c) { return '<option value="' + c + '"' + (E.categoria === c ? " selected" : "") + ">" + CATEGORIAS[c].rotulo + "</option>"; }).join("") +
      "</select><small>" + esc((CATEGORIAS[E.categoria] || CATEGORIAS.UTILITY).desc) + "</small></div>" +
      '<div class="wp-fld"><label>Finalidade no app</label><select onchange="WPA.ed(\'finalidade\',this.value)">' +
      Object.keys(FINALIDADES).map(function (k) { return '<option value="' + k + '"' + (E.finalidade === k ? " selected" : "") + ">" + FINALIDADES[k] + "</option>"; }).join("") +
      "</select><small>Usada para sugerir o modelo certo nas automações e na tela Conversas.</small></div>" +
      "</div></div>" +
      // Cabeçalho
      '<div class="wp-bloco"><div class="wp-bloco-titulo">Cabeçalho <small>opcional</small></div>' +
      '<div class="wp-seg">' + tiposCab.map(function (t) {
        return '<button class="' + (E.cabTipo === t[0] ? "ativo" : "") + '" onclick="WPA.ed(\'cabTipo\',\'' + t[0] + '\')"' + dis + '><i class="ti ' + t[2] + '"></i>' + t[1] + "</button>";
      }).join("") + "</div>" +
      (E.cabTipo === "TEXT"
        ? '<div class="wp-fld"><input value="' + esc(E.cabTexto) + '" maxlength="60" placeholder="Ex.: Lembrete de consulta" oninput="WPA.ed(\'cabTexto\',this.value)"' + dis + " />" +
          "<small>Até 60 caracteres e no máximo 1 variável.</small></div>" +
          (hv
            ? '<div class="wp-var"><code>{{' + esc(hv) + '}}</code><input placeholder="Exemplo" value="' + esc(E.cabExemplo) + '" oninput="WPA.ed(\'cabExemplo\',this.value)"' + dis + " />" +
              '<select onchange="WPA.ed(\'map\',this.value,\'header.' + hv + '\')">' + opcoesFonte(E.variaveis["header." + hv]) + "</select></div>"
            : "")
        : "") +
      (["IMAGE", "VIDEO", "DOCUMENT"].indexOf(E.cabTipo) >= 0
        ? '<div class="wp-fld"><label>Arquivo de exemplo para a análise da Meta' + (jaNaMeta ? ' <span class="opc">(opcional na edição)</span>' : ' <span class="req">*</span>') + "</label>" +
          '<input type="file" accept="' + (E.cabTipo === "IMAGE" ? "image/jpeg,image/png" : E.cabTipo === "VIDEO" ? "video/mp4" : "application/pdf") + '" onchange="WPA.arquivoExemplo(this)"' + dis + " />" +
          "<small>" + (E.cabArquivo ? "Selecionado: " + esc(E.cabArquivo.nome) + ". " : "") +
          (E.cabTipo === "DOCUMENT" ? "No envio real vai o PDF do paciente (receita, atestado…). Use este formato para o modelo de envio de documentos." : "No envio real, a clínica anexa o arquivo.") +
          " Requer o ID do aplicativo na aba Conexão.</small></div>"
        : "") +
      "</div>" +
      // Corpo
      '<div class="wp-bloco"><div class="wp-bloco-titulo"><span>Corpo da mensagem <span style="color:#e11d48">*</span></span>' +
      '<div class="wp-seg"><button class="' + (E.parameter_format === "POSITIONAL" ? "ativo" : "") + '" onclick="WPA.ed(\'formato\',\'POSITIONAL\')"' + (jaNaMeta || bloqueado ? " disabled" : "") + ">{{1}} números</button>" +
      '<button class="' + (E.parameter_format === "NAMED" ? "ativo" : "") + '" onclick="WPA.ed(\'formato\',\'NAMED\')"' + (jaNaMeta || bloqueado ? " disabled" : "") + ">{{nome}} nomes</button></div></div>" +
      '<div class="wp-fld"><textarea id="wp-ed-corpo" rows="6" maxlength="1024" placeholder="Olá, {{1}}! Sua consulta está marcada para {{2}}…" oninput="WPA.ed(\'corpo\',this.value)"' + dis + ">" + esc(E.corpo) + "</textarea>" +
      '<span class="wp-cont' + (corpoLen > 1024 ? " estouro" : "") + '" id="wp-ed-cont">' + corpoLen + "/1024</span></div>" +
      (bloqueado ? "" :
        '<div class="wp-ferramentas"><select class="wp-btn sm" onchange="WPA.inserirCampo(this.value);this.selectedIndex=0" style="appearance:auto">' +
        '<option value="">+ Inserir campo do paciente/consulta…</option>' + FONTES.map(function (f) { return '<option value="' + f.id + '">' + esc(f.rotulo) + "</option>"; }).join("") + "</select>" +
        '<button class="wp-btn sm" onclick="WPA.inserirCampo(\'\', true)"><i class="ti ti-braces"></i> Variável livre</button>' +
        '<button class="wp-btn sm ghost" title="Negrito" onclick="WPA.envolver(\'*\')"><b>N</b></button>' +
        '<button class="wp-btn sm ghost" title="Itálico" onclick="WPA.envolver(\'_\')"><i>I</i></button>' +
        '<button class="wp-btn sm ghost" title="Riscado" onclick="WPA.envolver(\'~\')"><s>R</s></button></div>') +
      '<div class="wp-bloco-titulo" style="margin-top:4px">Variáveis <small>exemplo exigido pela Meta · preenchimento automático no envio</small></div>' +
      '<div class="wp-vars" id="wp-ed-vars">' + htmlVariaveis() + "</div>" +
      "</div>" +
      // Rodapé
      '<div class="wp-bloco"><div class="wp-bloco-titulo">Rodapé <small>opcional · até 60 caracteres, sem variáveis</small></div>' +
      '<div class="wp-fld"><input value="' + esc(E.rodape) + '" maxlength="60" placeholder="Ex.: Clínica Bem Viver" oninput="WPA.ed(\'rodape\',this.value)"' + dis + " /></div></div>" +
      // Botões
      '<div class="wp-bloco"><div class="wp-bloco-titulo">Botões <small>opcional · até 10 (máx. 2 links e 1 ligação)</small></div>' +
      E.botoes.map(function (b, i) {
        var rot = b.tipo === "URL" ? '<i class="ti ti-external-link"></i>Link' : b.tipo === "PHONE_NUMBER" ? '<i class="ti ti-phone"></i>Ligar' : '<i class="ti ti-arrow-back-up"></i>Resposta';
        return (
          '<div class="wp-botao-linha"><span class="tipo">' + rot + "</span>" +
          '<input maxlength="25" placeholder="Texto do botão" value="' + esc(b.texto) + '" oninput="WPA.ed(\'botao\',this.value,' + i + ',\'texto\')"' + dis + " />" +
          (b.tipo === "URL"
            ? '<input placeholder="https://… (termine com {{1}} p/ link dinâmico)" value="' + esc(b.url || "") + '" oninput="WPA.ed(\'botao\',this.value,' + i + ',\'url\')"' + dis + " />"
            : b.tipo === "PHONE_NUMBER"
              ? '<input placeholder="+5547999990000" value="' + esc(b.telefone || "") + '" oninput="WPA.ed(\'botao\',this.value,' + i + ',\'telefone\')"' + dis + " />"
              : "<span></span>") +
          (bloqueado ? "<span></span>" : '<button class="wp-x" onclick="WPA.ed(\'removerBotao\',null,' + i + ')"><i class="ti ti-x"></i></button>') +
          "</div>" +
          (b.tipo === "URL" && /\{\{1\}\}$/.test(b.url || "")
            ? '<div class="wp-botao-linha"><span></span><span class="wp-nota" style="margin:0">URL de exemplo completa:</span><input placeholder="https://exemplo.com/abc123" value="' + esc(b.exemplo || "") + '" oninput="WPA.ed(\'botao\',this.value,' + i + ',\'exemplo\')"' + dis + " /><span></span></div>"
            : "")
        );
      }).join("") +
      (bloqueado ? "" :
        '<div class="wp-ferramentas"><button class="wp-btn sm" onclick="WPA.ed(\'addBotao\',\'QUICK_REPLY\')"><i class="ti ti-arrow-back-up"></i> Resposta rápida</button>' +
        '<button class="wp-btn sm" onclick="WPA.ed(\'addBotao\',\'URL\')"><i class="ti ti-external-link"></i> Link</button>' +
        '<button class="wp-btn sm" onclick="WPA.ed(\'addBotao\',\'PHONE_NUMBER\')"><i class="ti ti-phone"></i> Ligar</button></div>') +
      "</div>" +
      "</div>";

    var previa =
      '<div class="wp-preview"><div class="wp-phone"><div class="wp-phone-top"><div class="av"><i class="ti ti-brand-whatsapp"></i></div>' +
      esc((S.conexao && (S.conexao.nome_verificado || S.conexao.numero_exibicao)) || "Sua clínica") + "</div>" +
      '<div class="wp-phone-chat" id="wp-ed-previa">' + bolhaModelo(modeloDoEstado(), valoresPrevia()) + "</div></div>" +
      '<p class="wp-nota" style="text-align:center">Prévia com os exemplos. No envio, as variáveis são preenchidas com os dados do paciente.</p></div>';

    var conectado = S.conexao && S.conexao.status === "conectado";
    var foot =
      '<div class="wp-modal-foot"><button class="wp-btn" onclick="WPA.fecharModal()">Cancelar</button>' +
      (bloqueado
        ? '<button class="wp-btn primary" onclick="WPA.salvarMapeamento()"' + (E.salvando ? " disabled" : "") + '><i class="ti ti-device-floppy"></i> Salvar ajustes</button>'
        : (!jaNaMeta ? '<button class="wp-btn" onclick="WPA.salvarModelo(false)"' + (E.salvando ? " disabled" : "") + '><i class="ti ti-device-floppy"></i> ' + (E.salvando === "rascunho" ? "Salvando…" : "Salvar rascunho") + "</button>" : "") +
          '<button class="wp-btn primary" onclick="WPA.salvarModelo(true)"' + (E.salvando || !conectado ? " disabled" : "") + ' title="' + (conectado ? "" : "Conecte o WhatsApp primeiro") + '"><i class="ti ti-send"></i> ' +
          (E.salvando === "enviar" ? "Enviando…" : jaNaMeta ? "Reenviar para análise" : "Enviar para aprovação") + "</button>") +
      "</div>";

    modal(
      '<div class="wp-modal"><div class="wp-modal-head"><h3>' + (E.id ? (bloqueado ? "Variáveis do modelo" : "Editar modelo") : "Novo modelo de mensagem") + " " + (E.id ? badgeStatusModelo(E.status) : "") + "</h3>" +
      '<button class="wp-btn xs ghost" onclick="WPA.fecharModal()"><i class="ti ti-x"></i></button></div>' +
      '<div class="wp-modal-body"><div class="wp-editor">' + form + previa + "</div></div>" + foot + "</div>",
    );
  }

  function atualizarPrevia() {
    var p = document.getElementById("wp-ed-previa");
    if (p) p.innerHTML = bolhaModelo(modeloDoEstado(), valoresPrevia());
    var c = document.getElementById("wp-ed-cont");
    if (c) {
      c.textContent = (E.corpo || "").length + "/1024";
      c.className = "wp-cont" + ((E.corpo || "").length > 1024 ? " estouro" : "");
    }
  }

  var _varsAntes = "";
  function ed(campoNome, valor, chave, sub) {
    if (!E) return;
    switch (campoNome) {
      case "nome": E.nome = valor; break;
      case "idioma": E.idioma = valor; break;
      case "categoria": E.categoria = valor; renderEditor(); return;
      case "finalidade": E.finalidade = valor; break;
      case "cabTipo": E.cabTipo = valor; E.cabArquivo = null; renderEditor(); return;
      case "cabTexto": {
        var antes = extrairVariaveis(E.cabTexto, E.parameter_format).join(",");
        E.cabTexto = valor;
        if (antes !== extrairVariaveis(valor, E.parameter_format).join(",")) { renderEditorMantendoFoco(); return; }
        break;
      }
      case "cabExemplo": E.cabExemplo = valor; break;
      case "formato": E.parameter_format = valor; renderEditor(); return;
      case "corpo": {
        E.corpo = valor;
        var agora = extrairVariaveis(valor, E.parameter_format).join(",");
        if (agora !== _varsAntes) {
          _varsAntes = agora;
          extrairVariaveis(valor, E.parameter_format).forEach(function (v) {
            if (!E.exemplos[v] && E.variaveis[v] && fonte(E.variaveis[v])) E.exemplos[v] = fonte(E.variaveis[v]).exemplo;
          });
          var box = document.getElementById("wp-ed-vars");
          if (box) box.innerHTML = htmlVariaveis();
        }
        break;
      }
      case "ex": E.exemplos[chave] = valor; break;
      case "map":
        if (valor) E.variaveis[chave] = valor; else delete E.variaveis[chave];
        if (valor && fonte(valor)) {
          if (String(chave).indexOf("header.") === 0) { if (!E.cabExemplo) E.cabExemplo = fonte(valor).exemplo; }
          else if (!E.exemplos[chave]) E.exemplos[chave] = fonte(valor).exemplo;
          renderEditorMantendoFoco();
          return;
        }
        break;
      case "rodape": E.rodape = valor; break;
      case "botao": E.botoes[chave][sub] = valor; if (sub === "url") { renderEditorMantendoFoco(); return; } break;
      case "addBotao":
        if (E.botoes.length >= 10) { toast("Máximo de 10 botões", "error"); return; }
        E.botoes.push(valor === "URL" ? { tipo: "URL", texto: "", url: "https://" } : valor === "PHONE_NUMBER" ? { tipo: "PHONE_NUMBER", texto: "Ligar para a clínica", telefone: "" } : { tipo: "QUICK_REPLY", texto: "" });
        renderEditor();
        return;
      case "removerBotao": E.botoes.splice(chave, 1); renderEditor(); return;
    }
    atualizarPrevia();
  }

  // Re-render que tenta devolver o foco ao mesmo campo (para mudanças disparadas pela digitação).
  function renderEditorMantendoFoco() {
    var a = document.activeElement;
    var idx = -1;
    var pos = null;
    var campos = Array.prototype.slice.call(document.querySelectorAll(".wp-modal input, .wp-modal textarea, .wp-modal select"));
    if (a) { idx = campos.indexOf(a); try { pos = a.selectionStart; } catch (e) { pos = null; } }
    renderEditor();
    if (idx >= 0) {
      var novos = document.querySelectorAll(".wp-modal input, .wp-modal textarea, .wp-modal select");
      var el = novos[idx];
      if (el) { el.focus(); try { if (pos != null) el.setSelectionRange(pos, pos); } catch (e) {} }
    }
  }

  function inserirNoCorpo(texto) {
    var ta = document.getElementById("wp-ed-corpo");
    if (!ta) return;
    var ini = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    var fim = ta.selectionEnd != null ? ta.selectionEnd : ini;
    ta.value = ta.value.slice(0, ini) + texto + ta.value.slice(fim);
    E.corpo = ta.value;
    var box = document.getElementById("wp-ed-vars");
    if (box) box.innerHTML = htmlVariaveis();
    _varsAntes = extrairVariaveis(E.corpo, E.parameter_format).join(",");
    atualizarPrevia();
    ta.focus();
    ta.setSelectionRange(ini + texto.length, ini + texto.length);
  }

  function inserirCampo(fonteId, livre) {
    if (!E || (!fonteId && !livre)) return;
    var vars = extrairVariaveis(E.corpo, E.parameter_format);
    var nome;
    if (E.parameter_format === "NAMED") {
      var base = fonteId ? fonteId.replace(".", "_") : "variavel";
      nome = base;
      var n = 2;
      while (vars.indexOf(nome) >= 0 && (!fonteId || E.variaveis[nome] !== fonteId)) nome = base + "_" + n++;
      if (livre && !fonteId) {
        var dig = prompt("Nome da variável (minúsculas e _):", nome);
        if (!dig) return;
        nome = slug(dig).replace(/^[^a-z]+/, "") || nome;
      }
    } else {
      // Reaproveita o número se o mesmo campo já está no texto.
      var existente = fonteId && vars.find(function (v) { return E.variaveis[v] === fonteId; });
      nome = existente || String(vars.reduce(function (mx, v) { return Math.max(mx, Number(v) || 0); }, 0) + 1);
    }
    if (fonteId) {
      E.variaveis[nome] = fonteId;
      if (!E.exemplos[nome] && fonte(fonteId)) E.exemplos[nome] = fonte(fonteId).exemplo;
    }
    inserirNoCorpo("{{" + nome + "}}");
  }

  function envolver(marca) {
    var ta = document.getElementById("wp-ed-corpo");
    if (!ta) return;
    var ini = ta.selectionStart, fim = ta.selectionEnd;
    var sel = ta.value.slice(ini, fim) || "texto";
    ta.setSelectionRange(ini, fim);
    inserirNoCorpo(marca + sel + marca);
  }

  async function arquivoExemplo(input) {
    var f = input.files && input.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast("Arquivo de exemplo acima de 5MB", "error"); input.value = ""; return; }
    E.cabArquivo = { base64: await arquivoParaBase64(f), mime: f.type || "application/octet-stream", nome: f.name };
    atualizarPrevia();
  }

  async function salvarModelo(enviar) {
    if (!E) return;
    E.salvando = enviar ? "enviar" : "rascunho";
    E.erros = [];
    renderEditor();
    try {
      var r = await api("/api/comunicacao/modelos", {
        acao: "salvar",
        enviar: !!enviar,
        modelo: modeloDoEstado(),
        exemplo_midia: E.cabArquivo,
      });
      await recarregarModelos();
      fecharModal();
      S.aba = "modelos";
      avisar(enviar ? 'Modelo "' + r.modelo.nome + '" enviado para análise da Meta. O status muda sozinho quando for aprovado.' : "Rascunho salvo.");
    } catch (e) {
      E.salvando = null;
      E.erros = e.erros && e.erros.length ? e.erros : [e.message];
      renderEditor();
      var b = document.querySelector(".wp-modal-body");
      if (b) b.scrollTop = 0;
    }
  }

  async function salvarMapeamento() {
    if (!E) return;
    E.salvando = "mapear";
    try {
      var m = modeloDoEstado();
      await api("/api/comunicacao/modelos", { acao: "mapear", id: E.id, finalidade: E.finalidade, variaveis: m.variaveis });
      await recarregarModelos();
      fecharModal();
      avisar("Ajustes do modelo salvos.");
    } catch (e) {
      E.salvando = null;
      toast(e.message, "error");
    }
  }

  // ---------------------------------------------------------------------------
  // aba Automações
  // ---------------------------------------------------------------------------

  function opcoesModelos(sel, filtro) {
    var lista = S.modelos.filter(function (m) { return m.status !== "DELETED" && (!filtro || filtro(m)); });
    return '<option value="">— Selecione um modelo —</option>' +
      lista.map(function (m) {
        var st = m.status === "APPROVED" ? "" : " (" + ((STATUS_MODELO[m.status] || {}).rotulo || m.status) + ")";
        return '<option value="' + m.id + '"' + (sel === m.id ? " selected" : "") + ">" + esc(m.nome) + " · " + esc(m.idioma) + st + "</option>";
      }).join("");
  }

  function abaAutomacoes() {
    var a = S.automacoes || {};
    var conectado = S.conexao && S.conexao.status === "conectado";
    var horas = [1, 2, 3, 6, 12, 24, 48, 72];
    var h = "";
    if (!conectado) h += '<div class="wp-aviso alerta"><i class="ti ti-alert-triangle"></i><div>As automações só disparam com o WhatsApp da clínica conectado e com modelos aprovados.</div></div>';
    h +=
      '<div class="wp-panel"><p class="wp-secao-titulo" style="margin-bottom:4px"><i class="ti ti-robot"></i> Avisos automáticos para pacientes</p>' +
      '<p class="wp-nota" style="margin:0 0 6px">Os avisos usam os dados da Agenda (paciente, data, hora, modalidade, link de vídeo) para preencher as variáveis mapeadas em cada modelo.</p>' +

      '<div class="wp-auto"><div class="wp-auto-ico"><i class="ti ti-calendar-check"></i></div><div class="wp-auto-corpo">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><b>Confirmação de agendamento</b>' +
      '<label class="wp-switch"><input type="checkbox" id="wp-a-conf"' + (a.confirmacao_ativo ? " checked" : "") + "><span></span></label></div>" +
      "<p>Enviada logo após uma consulta ser marcada (pela clínica ou pela secretária digital).</p>" +
      '<div class="wp-auto-campos"><div class="wp-fld"><label>Modelo</label><select id="wp-a-conf-modelo">' +
      opcoesModelos(a.confirmacao_modelo_id, function (m) { return !m.cabecalho || m.cabecalho.tipo === "TEXT"; }) + "</select></div></div></div></div>" +

      '<div class="wp-auto"><div class="wp-auto-ico"><i class="ti ti-bell-ringing"></i></div><div class="wp-auto-corpo">' +
      '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><b>Lembrete de consulta</b>' +
      '<label class="wp-switch"><input type="checkbox" id="wp-a-lem"' + (a.lembrete_ativo ? " checked" : "") + "><span></span></label></div>" +
      "<p>Enviado automaticamente antes de cada consulta agendada (canceladas são ignoradas). Cada consulta recebe no máximo um lembrete.</p>" +
      '<div class="wp-auto-campos"><div class="wp-fld"><label>Modelo</label><select id="wp-a-lem-modelo">' +
      opcoesModelos(a.lembrete_modelo_id, function (m) { return !m.cabecalho || m.cabecalho.tipo === "TEXT"; }) + "</select></div>" +
      '<div class="wp-fld" style="max-width:200px;min-width:150px"><label>Antecedência</label><select id="wp-a-lem-horas">' +
      horas.map(function (x) { return '<option value="' + x + '"' + ((a.lembrete_horas_antes || 24) === x ? " selected" : "") + ">" + x + (x === 1 ? " hora" : " horas") + " antes</option>"; }).join("") +
      "</select></div></div></div></div>" +

      '<div class="wp-auto"><div class="wp-auto-ico"><i class="ti ti-file-certificate"></i></div><div class="wp-auto-corpo">' +
      "<b>Envio de receitas e documentos</b>" +
      "<p>Dentro da janela de 24h o PDF vai como documento comum. Fora dela, vai no cabeçalho deste modelo (precisa ter cabeçalho do tipo Documento e estar aprovado).</p>" +
      '<div class="wp-auto-campos"><div class="wp-fld"><label>Modelo para documentos</label><select id="wp-a-doc-modelo">' +
      opcoesModelos(a.documento_modelo_id, function (m) { return m.cabecalho && m.cabecalho.tipo === "DOCUMENT"; }) + "</select>" +
      '<small>Não tem um? Use a sugestão “Documento disponível” na aba Modelos.</small></div></div></div></div>' +

      '<div class="wp-auto"><div class="wp-auto-ico"><i class="ti ti-clock-hour-8"></i></div><div class="wp-auto-corpo">' +
      "<b>Horário permitido para envios automáticos</b><p>Fora deste intervalo (horário de Brasília), confirmações e lembretes aguardam a próxima janela.</p>" +
      '<div class="wp-auto-campos"><div class="wp-fld" style="max-width:160px"><label>De</label><input type="time" id="wp-a-ini" value="' + esc(String(a.horario_inicio || "08:00").slice(0, 5)) + '" /></div>' +
      '<div class="wp-fld" style="max-width:160px"><label>Até</label><input type="time" id="wp-a-fim" value="' + esc(String(a.horario_fim || "20:00").slice(0, 5)) + '" /></div></div></div></div>' +

      '<div class="wp-acoes" style="margin-top:8px"><button class="wp-btn primary" onclick="WPA.salvarAutomacoes()"><i class="ti ti-device-floppy"></i> Salvar automações</button></div>' +
      "</div>";
    return h;
  }

  async function salvarAutomacoes() {
    var v = function (id) { var el = document.getElementById(id); return el ? el.value : ""; };
    var ck = function (id) { var el = document.getElementById(id); return !!(el && el.checked); };
    var linha = {
      id_medico: S.userId,
      confirmacao_ativo: ck("wp-a-conf"),
      confirmacao_modelo_id: v("wp-a-conf-modelo") || null,
      lembrete_ativo: ck("wp-a-lem"),
      lembrete_modelo_id: v("wp-a-lem-modelo") || null,
      lembrete_horas_antes: Number(v("wp-a-lem-horas")) || 24,
      documento_modelo_id: v("wp-a-doc-modelo") || null,
      horario_inicio: v("wp-a-ini") || "08:00",
      horario_fim: v("wp-a-fim") || "20:00",
    };
    if (linha.confirmacao_ativo && !linha.confirmacao_modelo_id) return avisar("Escolha o modelo da confirmação de agendamento.", "erro");
    if (linha.lembrete_ativo && !linha.lembrete_modelo_id) return avisar("Escolha o modelo do lembrete de consulta.", "erro");
    if (linha.horario_inicio >= linha.horario_fim) return avisar("O horário inicial deve ser antes do final.", "erro");
    var naoAprovados = [linha.confirmacao_ativo && linha.confirmacao_modelo_id, linha.lembrete_ativo && linha.lembrete_modelo_id, linha.documento_modelo_id]
      .filter(Boolean)
      .map(function (id) { return S.modelos.find(function (m) { return m.id === id; }); })
      .filter(function (m) { return m && m.status !== "APPROVED"; });
    var r = await sbClient().from("comunicacao_whatsapp_automacoes").upsert(linha, { onConflict: "id_medico" }).select("*").single();
    if (r.error) return avisar("Não foi possível salvar: " + r.error.message, "erro");
    S.automacoes = r.data;
    avisar(
      naoAprovados.length
        ? "Automações salvas. Atenção: " + naoAprovados.map(function (m) { return m.nome; }).join(", ") + " ainda não está aprovado — os envios começam após a aprovação."
        : "Automações salvas.",
    );
  }

  // ---------------------------------------------------------------------------
  // modal genérico
  // ---------------------------------------------------------------------------

  function modal(html) {
    var root = document.getElementById("wp-modal-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "wp-modal-root";
      document.body.appendChild(root);
    }
    root.innerHTML = '<div class="wp-modal-bg" onclick="if(event.target===this)WPA.fecharModal()">' + html + "</div>";
  }

  function fecharModal() {
    var root = document.getElementById("wp-modal-root");
    if (root) root.innerHTML = "";
    E = null;
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  window.WPA = {
    aba: function (a) { S.aba = a; S.aviso = null; render(); },
    recarregar: carregar,
    guia: function () { S.guiaAberto = !S.guiaAberto; render(); },
    salvarConexao: function () { salvarConexao(); },
    novoVerifyToken: function () {
      if (confirm("Gerar um novo token de verificação? Será preciso atualizar o webhook no App da Meta.")) salvarConexao({ regenerar_verify_token: true });
    },
    testar: testar,
    assinarWebhook: assinarWebhook,
    desconectar: desconectar,
    abrirRegistro: abrirRegistro,
    registrar: registrar,
    copiar: copiar,
    filtro: function (f) { S.filtro = f; render(); },
    sincronizar: sincronizar,
    novoModelo: function () { abrirEditor({}); },
    usarSugestao: function (i) {
      var s = SUGESTOES[i];
      var base = JSON.parse(JSON.stringify(s.modelo));
      var nomes = S.modelos.map(function (m) { return m.nome; });
      var n = 2;
      var nome = base.nome;
      while (nomes.indexOf(nome) >= 0) nome = base.nome + "_" + n++;
      base.nome = nome;
      abrirEditor(base);
    },
    editarModelo: function (id, somenteVariaveis) {
      var m = S.modelos.find(function (x) { return x.id === id; });
      if (m) abrirEditor(m, somenteVariaveis || m.categoria === "AUTHENTICATION");
    },
    duplicarModelo: function (id) {
      var m = S.modelos.find(function (x) { return x.id === id; });
      if (!m) return;
      var base = JSON.parse(JSON.stringify(m));
      delete base.id; delete base.meta_template_id; delete base.status;
      base.nome = (m.nome + "_copia").slice(0, 512);
      if (base.categoria === "AUTHENTICATION") base.categoria = "UTILITY";
      abrirEditor(base);
    },
    excluirModelo: excluirModelo,
    ed: ed,
    slug: slug,
    inserirCampo: inserirCampo,
    envolver: envolver,
    arquivoExemplo: arquivoExemplo,
    salvarModelo: salvarModelo,
    salvarMapeamento: salvarMapeamento,
    salvarAutomacoes: salvarAutomacoes,
    fecharModal: fecharModal,
  };

  // Utilitários compartilhados com a tela Conversas (conversas-pacientes.js).
  window.CPWhatsApp = {
    FONTES: FONTES,
    FINALIDADES: FINALIDADES,
    STATUS_MODELO: STATUS_MODELO,
    api: api,
    esc: esc,
    formatarWa: formatarWa,
    extrairVariaveis: extrairVariaveis,
    bolhaModelo: bolhaModelo,
    arquivoParaBase64: arquivoParaBase64,
  };

  window.initWhatsappPacientes = function () {
    S.aviso = null;
    carregar();
  };
})();
