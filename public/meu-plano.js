// MEU PLANO — gestão da assinatura ativa (Configurações -> Meu plano).
// Segue o mesmo contrato dos outros módulos (equipe.js, faturamento.js):
// IIFE, usa window.sb (já autenticado pelo app principal), expõe
// window.initMeuPlano() como ponto de entrada, escreve em #s-meu-plano.
//
// Abas: Visão geral · Planos (upgrade/downgrade) · Consumo (histórico) ·
// Carteira de créditos · Pagamentos (faturas + cartão). Leituras de
// assinatura/consumo/créditos vão direto no Supabase (RLS de dono); tudo
// que mexe em cobrança passa pelas rotas /api/assinatura/* (Asaas).
//
// Os números de planos/pacotes de crédito abaixo são uma cópia manual dos
// mesmos valores em src/lib/plans/config.ts -- os dois arquivos não
// compartilham módulo (esse aqui é servido cru em /public, o outro passa
// pelo build do Vite). Se mexer no preço de um lado, replique no outro
// (e na função aplicar_agendamentos_assinatura, que também tem uma cópia).
(function () {
  var PLANOS = [
    { id: "basic", nome: "Basic", precoMensal: 149.9, medicos: 1, secretarias: 1, copiloto: 60, whatsapp: 500, video: 0 },
    { id: "pro", nome: "Pro", precoMensal: 249.9, medicos: 1, secretarias: 1, copiloto: 200, whatsapp: 2000, video: 3000 },
    { id: "enterprise", nome: "Enterprise", precoMensal: 649.9, medicos: 2, secretarias: 2, copiloto: 500, whatsapp: 5000, video: 10000 },
  ];

  var PACOTES_CREDITO = {
    copiloto: [
      { quantidade: 140, preco: 79.9 },
      { quantidade: 300, preco: 90.0 },
      { quantidade: 500, preco: 120.0 },
    ],
    whatsapp: [
      { quantidade: 1500, preco: 49.9 },
      { quantidade: 3000, preco: 50.0 },
      { quantidade: 5000, preco: 80.0 },
    ],
    video: [
      { quantidade: 3000, preco: 59.9 },
      { quantidade: 7000, preco: 70.0 },
      { quantidade: 5000, preco: 50.0 },
    ],
  };

  var RECURSOS = ["copiloto", "whatsapp", "video"];
  var NOME_RECURSO = { copiloto: "Copiloto IA", whatsapp: "WhatsApp", video: "Vídeo" };
  var UNIDADE_RECURSO = { copiloto: "consultas", whatsapp: "conversas", video: "min" };
  var ICONE_RECURSO = { copiloto: "ti-sparkles", whatsapp: "ti-brand-whatsapp", video: "ti-video" };

  var ABAS = [
    { id: "geral", nome: "Visão geral", icone: "ti-layout-dashboard" },
    { id: "planos", nome: "Planos", icone: "ti-arrows-exchange" },
    { id: "consumo", nome: "Consumo", icone: "ti-chart-bar" },
    { id: "creditos", nome: "Carteira de créditos", icone: "ti-wallet" },
    { id: "pagamentos", nome: "Pagamentos", icone: "ti-receipt" },
  ];

  var MOTIVOS_CANCELAMENTO = [
    "O preço está alto para mim",
    "Não estou usando o suficiente",
    "Faltam recursos de que preciso",
    "Tive problemas técnicos",
    "Vou usar outra solução",
    "Outro motivo",
  ];

  var MESES_HISTORICO = 6;
  var MAX_PACOTES_SACOLA = 20; // mesmo limite de /api/assinatura/comprar-creditos
  var CHAVE_SACOLA = "mp-sacola-creditos";

  var STATUS_PAGAMENTO = {
    PENDING: { rotulo: "Aguardando", classe: "pendente" },
    AWAITING_RISK_ANALYSIS: { rotulo: "Em análise", classe: "pendente" },
    CONFIRMED: { rotulo: "Pago", classe: "pago" },
    RECEIVED: { rotulo: "Pago", classe: "pago" },
    RECEIVED_IN_CASH: { rotulo: "Pago", classe: "pago" },
    OVERDUE: { rotulo: "Vencida", classe: "vencida" },
    REFUNDED: { rotulo: "Estornada", classe: "neutro" },
    REFUND_REQUESTED: { rotulo: "Estorno solicitado", classe: "neutro" },
    REFUND_IN_PROGRESS: { rotulo: "Estornando", classe: "neutro" },
    CHARGEBACK_REQUESTED: { rotulo: "Contestada", classe: "vencida" },
    CHARGEBACK_DISPUTE: { rotulo: "Em disputa", classe: "vencida" },
  };

  var FORMA_PAGAMENTO = { CREDIT_CARD: "Cartão de crédito", PIX: "Pix", BOLETO: "Boleto", DEBIT_CARD: "Cartão de débito", UNDEFINED: "—" };

  var STATUS_CREDITO = { pago: "Disponível", pendente: "Aguardando pagamento", cancelado: "Cancelado" };

  // ---------------------------------------------------------------------------
  // util
  // ---------------------------------------------------------------------------

  function fmtPreco(v) {
    return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function fmtNum(v) {
    return Number(v || 0).toLocaleString("pt-BR");
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // "2026-10-05" -> "05/10/2026" sem passar por Date (evita virar o dia por fuso).
  function fmtData(iso) {
    if (!iso) return "—";
    var p = String(iso).slice(0, 10).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso;
  }

  function mesISO(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
  }

  function nomeMes(iso) {
    var p = iso.split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, 1);
    var txt = d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" }).replace(".", "");
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }

  function ultimosMeses(n) {
    var lista = [];
    var hoje = new Date();
    for (var i = 0; i < n; i++) lista.push(mesISO(new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)));
    return lista; // mais recente primeiro
  }

  function planoPorId(id) {
    return PLANOS.filter(function (p) { return p.id === id; })[0] || null;
  }

  // ---------------------------------------------------------------------------
  // estado + dados
  // ---------------------------------------------------------------------------

  var S = {
    aba: "geral",
    assinatura: null,
    consumoPorMes: {}, // { "2026-09-01": { copiloto: {usado_plano, usado_adicional}, ... } }
    creditos: [],
    email: "",
    carregando: true,
    erro: null,
    fin: { carregando: false, erro: null, dados: null },
    modal: null,
    aviso: null,
    sacola: lerSacola(), // { "whatsapp:1500": 2, ... } — chave recurso:quantidade do pacote, valor = quantas vezes
  };

  function sbClient() {
    return window.sb || window.__sb;
  }

  async function tokenAtual() {
    var sb = sbClient();
    var res = await sb.auth.getSession();
    return res.data && res.data.session ? res.data.session.access_token : null;
  }

  async function chamarApi(path, body, metodo) {
    var token = await tokenAtual();
    var opts = { method: metodo || "POST", headers: { Authorization: "Bearer " + token } };
    if (opts.method !== "GET") {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body || {});
    }
    var resp = await fetch(path, opts);
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(data.error || "Erro " + resp.status);
    return data;
  }

  function avisar(texto, tipo) {
    S.aviso = { texto: texto, tipo: tipo || "ok" };
    render();
    clearTimeout(avisar._t);
    avisar._t = setTimeout(function () {
      S.aviso = null;
      render();
    }, 6000);
  }

  async function carregar() {
    S.carregando = true;
    S.erro = null;
    render();
    try {
      var sb = sbClient();
      var userRes = await sb.auth.getUser();
      var user = userRes.data ? userRes.data.user : null;
      if (!user) throw new Error("Não autenticado.");
      S.email = user.email || "";

      // Aplica downgrade/cancelamento agendados que já venceram. Se a função
      // ainda não existir no banco, só segue com o que estiver gravado.
      try { await sb.rpc("aplicar_agendamentos_assinatura"); } catch (e) {}

      var assinaturaRes = await sb
        .from("assinaturas")
        .select("*")
        .eq("medico_id", user.id)
        .neq("status", "cancelada")
        .maybeSingle();
      // Qualquer problema aqui (tabela ainda não migrada, nenhuma linha, etc.)
      // é tratado como "sem assinatura paga" = Free, não como erro bloqueante.
      S.assinatura = assinaturaRes.error ? null : assinaturaRes.data;

      S.consumoPorMes = {};
      S.creditos = [];
      if (S.assinatura) {
        var meses = ultimosMeses(MESES_HISTORICO);
        var resultados = await Promise.all([
          sb.from("consumo_mensal").select("*").eq("assinatura_id", S.assinatura.id).gte("mes", meses[meses.length - 1]),
          sb.from("creditos_adicionais").select("*").eq("assinatura_id", S.assinatura.id).order("created_at", { ascending: false }),
        ]);
        (resultados[0].data || []).forEach(function (c) {
          var mes = String(c.mes).slice(0, 10);
          S.consumoPorMes[mes] = S.consumoPorMes[mes] || {};
          S.consumoPorMes[mes][c.recurso] = c;
        });
        S.creditos = resultados[1].data || [];
      }
    } catch (err) {
      S.erro = (err && err.message) || "Não foi possível carregar sua assinatura.";
    } finally {
      S.carregando = false;
      render();
    }
    if (S.assinatura) carregarFinanceiro();
  }

  async function carregarFinanceiro() {
    S.fin = { carregando: true, erro: null, dados: S.fin.dados };
    render();
    try {
      S.fin.dados = await chamarApi("/api/assinatura/financeiro", null, "GET");
    } catch (err) {
      S.fin.erro = (err && err.message) || "Não foi possível carregar os pagamentos.";
    } finally {
      S.fin.carregando = false;
      render();
    }
  }

  // ---------------------------------------------------------------------------
  // derivados
  // ---------------------------------------------------------------------------

  function saldoAdicional(recurso) {
    return S.creditos
      .filter(function (c) { return c.recurso === recurso && c.status === "pago"; })
      .reduce(function (soma, c) { return soma + (c.quantidade - c.consumido); }, 0);
  }

  function consumoDoMes(mes, recurso) {
    var c = S.consumoPorMes[mes] && S.consumoPorMes[mes][recurso];
    return { plano: c ? c.usado_plano : 0, adicional: c ? c.usado_adicional : 0 };
  }

  function proximaCobranca() {
    var d = S.fin.dados;
    return (d && d.proximaCobranca) || (S.assinatura && S.assinatura.proxima_cobranca) || null;
  }

  function cartaoAtual() {
    var d = S.fin.dados;
    if (d && d.cartao) return d.cartao;
    var a = S.assinatura;
    return a && a.cartao_final ? { bandeira: a.cartao_bandeira, final: a.cartao_final } : null;
  }

  function faturaEmAberto() {
    var d = S.fin.dados;
    if (!d) return null;
    return d.pagamentos.filter(function (p) { return p.status === "OVERDUE" && p.faturaUrl; })[0] || null;
  }

  function cancelamentoAgendado() {
    return S.assinatura && S.assinatura.cancelamento_agendado_para;
  }

  // ---------------------------------------------------------------------------
  // blocos de UI
  // ---------------------------------------------------------------------------

  var VOLTAR =
    '<div style="margin-bottom:14px"><button class="btn ghost sm" onclick="goScreen(\'configuracoes\')"><i class="ti ti-arrow-left"></i> Voltar</button></div>';
  var CABECALHO = '<div class="mp-head"><div><h1>Meu plano</h1><p>Gerencie sua assinatura, consumo, créditos e pagamentos</p></div></div>';

  function barraConsumo(usadoPlano, usadoAdicional, franquia, saldoExtra) {
    var total = franquia + saldoExtra + usadoAdicional;
    var pctPlano = total > 0 ? Math.min(100, (usadoPlano / total) * 100) : 0;
    var pctAdicional = total > 0 ? Math.min(100 - pctPlano, (usadoAdicional / total) * 100) : 0;
    var alerta = franquia > 0 && usadoPlano >= franquia * 0.8;
    return '<div class="mp-barra' + (alerta ? " alerta" : "") + '"><div class="plano" style="width:' + pctPlano + '%"></div><div class="adicional" style="width:' + pctAdicional + '%"></div></div>';
  }

  function linhaConsumo(recurso) {
    var a = S.assinatura;
    var franquia = a[recurso];
    var c = consumoDoMes(mesISO(new Date()), recurso);
    var saldoExtra = saldoAdicional(recurso);
    var restante = Math.max(franquia - c.plano, 0);
    return (
      '<div class="mp-consumo-item">' +
      '<div class="mp-consumo-top"><span><i class="ti ' + ICONE_RECURSO[recurso] + '"></i> ' + NOME_RECURSO[recurso] + "</span><small>" +
      fmtNum(c.plano + c.adicional) + " / " + fmtNum(franquia) + " " + UNIDADE_RECURSO[recurso] + "</small></div>" +
      barraConsumo(c.plano, c.adicional, franquia, saldoExtra) +
      '<div class="mp-consumo-legenda"><span><i class="mp-dot" style="background:#059669"></i>Franquia: restam ' + fmtNum(restante) + "</span>" +
      (saldoExtra || c.adicional ? '<span><i class="mp-dot" style="background:#7c3aed"></i>Créditos: ' + fmtNum(saldoExtra) + "</span>" : "") +
      "</div></div>"
    );
  }

  function resumoAssinatura() {
    var a = S.assinatura;
    var plano = planoPorId(a.plano);
    var cancelEm = cancelamentoAgendado();
    var statusLabel = cancelEm ? "Cancelamento agendado" : a.status === "ativa" ? "Ativa" : a.status === "inadimplente" ? "Pagamento pendente" : "Cancelada";
    var statusClasse = cancelEm ? "cancelada" : a.status;
    var proxima = proximaCobranca();
    var cartao = cartaoAtual();
    var agendado = a.plano_agendado ? planoPorId(a.plano_agendado) : null;
    var aberta = faturaEmAberto();

    var infos =
      '<div class="mp-infos">' +
      '<div class="mp-info"><span>Ciclo</span><strong>' + (a.ciclo === "anual" ? "Anual" : "Mensal") + (a.dia_cobranca ? " · dia " + a.dia_cobranca : "") + "</strong></div>" +
      '<div class="mp-info"><span>' + (cancelEm ? "Acesso até" : "Próxima cobrança") + "</span><strong>" +
      (cancelEm ? fmtData(cancelEm) : proxima ? fmtData(proxima) + " · " + fmtPreco(agendado ? agendado.precoMensal : a.preco_mensal) : S.fin.carregando ? "carregando…" : "—") +
      "</strong></div>" +
      '<div class="mp-info"><span>Forma de pagamento</span><strong>' +
      (cartao ? '<i class="ti ti-credit-card"></i> ' + esc(cartao.bandeira || "Cartão") + " •••• " + esc(cartao.final) : "Cartão de crédito") +
      "</strong>" +
      (cancelEm ? "" : '<button class="mp-link" data-abrir-cartao>Alterar cartão</button>') +
      "</div></div>";

    var alertas = "";
    if (a.status === "inadimplente" && !cancelEm) {
      alertas +=
        '<div class="mp-alerta"><i class="ti ti-alert-triangle"></i><div><strong>Tivemos um problema na última cobrança.</strong><br>' +
        esc((a.ultimo_erro_cobranca && a.ultimo_erro_cobranca.mensagem) || "Verifique a forma de pagamento pra não perder acesso.") +
        '<div class="mp-alerta-acoes">' +
        (aberta ? '<a class="mp-btn primary sm" href="' + esc(aberta.faturaUrl) + '" target="_blank" rel="noopener">Pagar fatura de ' + fmtPreco(aberta.valor) + "</a>" : "") +
        '<button class="mp-btn sm" data-abrir-cartao>Alterar cartão</button></div></div></div>';
    }
    if (agendado) {
      alertas +=
        '<div class="mp-alerta info"><i class="ti ti-calendar-event"></i><div><strong>Mudança para o plano ' + agendado.nome + " agendada para " + fmtData(a.plano_agendado_para) + ".</strong><br>" +
        "Até lá você continua com as franquias do plano atual. A próxima fatura já vem com o novo valor (" + fmtPreco(agendado.precoMensal) + "/mês)." +
        '<div class="mp-alerta-acoes"><button class="mp-btn sm" data-desfazer-agendamento>Manter plano atual</button></div></div></div>';
    }
    if (cancelEm) {
      alertas +=
        '<div class="mp-alerta neutro"><i class="ti ti-calendar-off"></i><div><strong>Assinatura cancelada.</strong><br>' +
        "Nenhuma nova cobrança será feita. Você mantém o acesso até " + fmtData(cancelEm) + ". Para voltar depois dessa data, é só assinar de novo." +
        '<div class="mp-alerta-acoes"><a class="mp-btn sm" href="/planos">Ver planos</a></div></div></div>';
    }

    return (
      '<div class="mp-panel"><div class="mp-plano-row"><div>' +
      '<div class="mp-plano-nome">' + (plano ? plano.nome : esc(a.plano)) +
      ' <span class="mp-badge ' + statusClasse + '">' + statusLabel + "</span></div>" +
      '<div style="color:#9ca3af;font-size:12px;margin-top:4px">' +
      a.medicos + " médico(s) · " + a.secretarias + " usuário(s) de gestão</div></div>" +
      '<div class="mp-plano-preco">' + fmtPreco(a.preco_mensal) + "<span> /mês</span></div></div>" +
      infos + alertas + "</div>"
    );
  }

  function abas() {
    return (
      '<div class="mp-tabs">' +
      ABAS.map(function (t) {
        return '<button class="mp-tab' + (S.aba === t.id ? " ativa" : "") + '" data-aba="' + t.id + '"><i class="ti ' + t.icone + '"></i> ' + t.nome + "</button>";
      }).join("") +
      "</div>"
    );
  }

  // --- Visão geral ---

  function abaGeral() {
    var a = S.assinatura;
    var saldoTotal = RECURSOS.map(function (r) {
      var s = saldoAdicional(r);
      return s ? fmtNum(s) + " " + UNIDADE_RECURSO[r] : null;
    }).filter(Boolean);
    var ultimoPago = S.fin.dados
      ? S.fin.dados.pagamentos.filter(function (p) { return STATUS_PAGAMENTO[p.status] && STATUS_PAGAMENTO[p.status].classe === "pago"; })[0]
      : null;

    return (
      '<div class="mp-panel"><div class="mp-secao-head"><p class="mp-secao-titulo">Consumo deste mês</p>' +
      '<button class="mp-link" data-aba="consumo">Ver histórico <i class="ti ti-chevron-right"></i></button></div>' +
      '<div class="mp-consumo">' + RECURSOS.map(linhaConsumo).join("") + "</div>" +
      '<p class="mp-nota">As franquias do plano renovam todo mês e não acumulam. Créditos extras só são usados depois que a franquia acaba.</p></div>' +

      '<div class="mp-atalhos">' +
      '<div class="mp-atalho" data-aba="creditos"><i class="ti ti-wallet"></i><div><span>Carteira de créditos</span><strong>' +
      (saldoTotal.length ? saldoTotal.join(" · ") : "Sem saldo extra") + "</strong></div></div>" +
      '<div class="mp-atalho" data-aba="pagamentos"><i class="ti ti-receipt"></i><div><span>Último pagamento</span><strong>' +
      (ultimoPago ? fmtPreco(ultimoPago.valor) + " em " + fmtData(ultimoPago.pagoEm || ultimoPago.vencimento) : S.fin.carregando ? "carregando…" : "—") +
      "</strong></div></div>" +
      '<div class="mp-atalho" data-aba="planos"><i class="ti ti-arrows-exchange"></i><div><span>Mudar de plano</span><strong>' +
      (a.plano === "enterprise" ? "Você está no maior plano" : "Upgrade ou downgrade") + "</strong></div></div>" +
      "</div>" +

      (cancelamentoAgendado()
        ? ""
        : '<div class="mp-panel mp-zona"><div><p class="mp-secao-titulo" style="margin:0">Cancelar assinatura</p>' +
          '<p class="mp-nota" style="margin:4px 0 0">As cobranças param imediatamente e você mantém o acesso até o fim do período já pago.</p></div>' +
          '<button class="mp-btn danger" data-abrir-cancelar>Cancelar assinatura</button></div>')
    );
  }

  // --- Planos ---

  function cardPlano(p) {
    var a = S.assinatura;
    var atual = a.plano === p.id;
    var agendado = a.plano_agendado === p.id;
    var bloqueado = !!cancelamentoAgendado();
    var botao;
    if (atual && a.plano_agendado) botao = '<button class="mp-btn" data-desfazer-agendamento' + (bloqueado ? " disabled" : "") + ">Manter este plano</button>";
    else if (atual) botao = '<button class="mp-btn" disabled>Plano atual</button>';
    else if (agendado) botao = '<button class="mp-btn" disabled>Agendado para ' + fmtData(a.plano_agendado_para) + "</button>";
    else {
      var upgrade = p.precoMensal > Number(a.preco_mensal);
      botao = '<button class="mp-btn ' + (upgrade ? "primary" : "") + '" data-trocar-plano="' + p.id + '"' + (bloqueado ? " disabled" : "") + ">" +
        (upgrade ? '<i class="ti ti-arrow-up"></i> Fazer upgrade' : '<i class="ti ti-arrow-down"></i> Fazer downgrade') + "</button>";
    }
    return (
      '<div class="mp-plano-card ' + (atual ? "atual" : "") + '">' +
      (atual ? '<span class="mp-selo">Seu plano</span>' : "") +
      "<h4>" + p.nome + "</h4>" +
      '<div class="preco">' + fmtPreco(p.precoMensal) + '<span style="font-size:11px;color:#9ca3af;font-weight:400"> /mês</span></div>' +
      itensPlano(p) + botao + "</div>"
    );
  }

  function itensPlano(p) {
    return (
      "<ul><li>" + p.medicos + " médico(s) · " + p.secretarias + " usuário(s) de gestão</li>" +
      "<li>" + fmtNum(p.copiloto) + " consultas de Copiloto</li>" +
      "<li>" + fmtNum(p.whatsapp) + " conversas de WhatsApp</li>" +
      "<li>" + (p.video ? fmtNum(p.video) + " min de vídeo" : "Vídeo não incluído") + "</li></ul>"
    );
  }

  function abaPlanos() {
    return (
      '<div class="mp-panel"><p class="mp-secao-titulo">Mudar de plano</p>' +
      '<p class="mp-nota" style="margin:-6px 0 14px"><strong>Upgrade</strong> libera as franquias novas na hora. ' +
      "<strong>Downgrade</strong> entra na próxima cobrança — até lá você usa o que já pagou.</p>" +
      (cancelamentoAgendado() ? '<p class="mp-nota">Sua assinatura tem cancelamento agendado, por isso não é possível trocar de plano.</p>' : "") +
      '<div class="mp-planos-grid">' + PLANOS.map(cardPlano).join("") + "</div>" +
      '<p class="mp-nota" style="margin-top:14px">Precisa de mais médicos, usuários ou franquias sob medida? <a href="/planos">Monte um plano personalizado</a>.</p></div>'
    );
  }

  // --- Consumo ---

  function abaConsumo() {
    var a = S.assinatura;
    var meses = ultimosMeses(MESES_HISTORICO);
    var maxPorRecurso = {};
    RECURSOS.forEach(function (r) {
      maxPorRecurso[r] = Math.max(a[r], 1);
      meses.forEach(function (m) {
        var c = consumoDoMes(m, r);
        maxPorRecurso[r] = Math.max(maxPorRecurso[r], c.plano + c.adicional);
      });
    });

    var linhas = meses.map(function (m, i) {
      return (
        "<tr><td><strong>" + nomeMes(m) + "</strong>" + (i === 0 ? ' <span class="mp-tag">atual</span>' : "") + "</td>" +
        RECURSOS.map(function (r) {
          var c = consumoDoMes(m, r);
          var total = c.plano + c.adicional;
          var pctPlano = (c.plano / maxPorRecurso[r]) * 100;
          var pctAdic = (c.adicional / maxPorRecurso[r]) * 100;
          return (
            '<td><div class="mp-hist-valor">' + fmtNum(total) +
            (c.adicional ? ' <small>(' + fmtNum(c.adicional) + " extra)</small>" : "") + "</div>" +
            '<div class="mp-barra fina"><div class="plano" style="width:' + pctPlano + '%"></div><div class="adicional" style="width:' + pctAdic + '%"></div></div></td>'
          );
        }).join("") +
        "</tr>"
      );
    }).join("");

    return (
      '<div class="mp-panel"><div class="mp-secao-head"><p class="mp-secao-titulo">Histórico de consumo — últimos ' + MESES_HISTORICO + " meses</p>" +
      '<button class="mp-btn sm" data-exportar-consumo><i class="ti ti-download"></i> Exportar CSV</button></div>' +
      '<div class="mp-tabela-wrap"><table class="mp-tabela"><thead><tr><th>Mês</th>' +
      RECURSOS.map(function (r) { return "<th>" + NOME_RECURSO[r] + " <small>(" + UNIDADE_RECURSO[r] + ")</small></th>"; }).join("") +
      "</tr></thead><tbody>" + linhas + "</tbody></table></div>" +
      '<div class="mp-consumo-legenda" style="margin-top:12px"><span><i class="mp-dot" style="background:#059669"></i>Franquia do plano</span>' +
      '<span><i class="mp-dot" style="background:#7c3aed"></i>Créditos extras</span></div>' +
      '<p class="mp-nota">Franquia atual: ' + RECURSOS.map(function (r) { return fmtNum(a[r]) + " " + UNIDADE_RECURSO[r] + " de " + NOME_RECURSO[r]; }).join(" · ") + ".</p></div>"
    );
  }

  function exportarConsumoCsv() {
    var linhas = [["mes", "recurso", "usado_franquia", "usado_creditos", "total"]];
    ultimosMeses(MESES_HISTORICO).forEach(function (m) {
      RECURSOS.forEach(function (r) {
        var c = consumoDoMes(m, r);
        linhas.push([m.slice(0, 7), r, c.plano, c.adicional, c.plano + c.adicional]);
      });
    });
    var csv = linhas.map(function (l) { return l.join(";"); }).join("\n");
    var blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "medicopilot-consumo.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // --- Sacola de créditos ---
  // O usuário junta pacotes (o mesmo mais de uma vez e/ou recursos diferentes)
  // e paga tudo num único checkout. Guardada em sessionStorage só pra
  // sobreviver a um recarregar da página; o preço é sempre recalculado no
  // servidor a partir de pacotesCredito().

  function lerSacola() {
    try {
      var bruto = JSON.parse(sessionStorage.getItem(CHAVE_SACOLA) || "{}");
      var limpa = {};
      Object.keys(bruto).forEach(function (k) {
        if (pacotePorChave(k) && bruto[k] > 0) limpa[k] = Math.min(Number(bruto[k]) || 0, MAX_PACOTES_SACOLA);
      });
      return limpa;
    } catch (e) {
      return {};
    }
  }

  function salvarSacola() {
    try { sessionStorage.setItem(CHAVE_SACOLA, JSON.stringify(S.sacola)); } catch (e) {}
  }

  function pacotePorChave(chave) {
    var partes = String(chave).split(":");
    var lista = PACOTES_CREDITO[partes[0]];
    if (!lista) return null;
    var pac = lista.filter(function (p) { return p.quantidade === Number(partes[1]); })[0];
    return pac ? { recurso: partes[0], quantidade: pac.quantidade, preco: pac.preco } : null;
  }

  function itensSacola() {
    // Ordem estável: pela ordem dos recursos e dos pacotes na tabela.
    var itens = [];
    RECURSOS.forEach(function (r) {
      PACOTES_CREDITO[r].forEach(function (pac) {
        var vezes = S.sacola[r + ":" + pac.quantidade] || 0;
        if (vezes) itens.push({ chave: r + ":" + pac.quantidade, recurso: r, quantidade: pac.quantidade, preco: pac.preco, vezes: vezes });
      });
    });
    return itens;
  }

  function resumoSacola() {
    return itensSacola().reduce(
      function (acc, i) { acc.pacotes += i.vezes; acc.total += i.preco * i.vezes; return acc; },
      { pacotes: 0, total: 0 }
    );
  }

  function alterarSacola(chave, delta) {
    if (!pacotePorChave(chave)) return;
    var atual = S.sacola[chave] || 0;
    var novo = Math.max(0, atual + delta);
    if (delta > 0 && resumoSacola().pacotes >= MAX_PACOTES_SACOLA) {
      avisar("Limite de " + MAX_PACOTES_SACOLA + " pacotes por compra.", "erro");
      return;
    }
    if (novo) S.sacola[chave] = novo;
    else delete S.sacola[chave];
    salvarSacola();
    if (S.modal && S.modal.tipo === "sacola" && !resumoSacola().pacotes) S.modal = null;
    render();
  }

  function stepper(chave, vezes) {
    return (
      '<div class="mp-stepper"><button type="button" data-sacola-menos="' + chave + '" aria-label="Remover um">−</button>' +
      "<span>" + vezes + "</span>" +
      '<button type="button" data-sacola-mais="' + chave + '" aria-label="Adicionar mais um">+</button></div>'
    );
  }

  var sacolaFlutuanteVisivel = false; // anima só na primeira aparição, não a cada +/-

  function botaoSacolaFlutuante() {
    var r = resumoSacola();
    if (!r.pacotes || cancelamentoAgendado() || (S.modal && S.modal.tipo === "sacola")) {
      sacolaFlutuanteVisivel = false;
      return "";
    }
    var entra = !sacolaFlutuanteVisivel;
    sacolaFlutuanteVisivel = true;
    return (
      '<div class="mp-sacola-espaco"></div><div class="mp-sacola-float' + (entra ? " entra" : "") + '"><button class="mp-sacola-btn" data-abrir-sacola>' +
      '<span class="mp-sacola-ico"><i class="ti ti-shopping-bag"></i><b>' + r.pacotes + "</b></span>" +
      '<span class="mp-sacola-txt">' + r.pacotes + (r.pacotes === 1 ? " pacote" : " pacotes") + " · <strong>" + fmtPreco(r.total) + "</strong></span>" +
      '<span class="mp-sacola-cta">Ir para pagamento <i class="ti ti-arrow-right"></i></span></button></div>'
    );
  }

  function modalSacola() {
    var itens = itensSacola();
    var r = resumoSacola();
    return (
      '<h3><i class="ti ti-shopping-bag"></i> Sua sacola de créditos</h3>' +
      '<div class="mp-sacola-lista">' +
      itens.map(function (i) {
        return (
          '<div class="mp-sacola-item"><div class="info"><i class="ti ' + ICONE_RECURSO[i.recurso] + '"></i><div>' +
          "<strong>+" + fmtNum(i.quantidade) + " " + UNIDADE_RECURSO[i.recurso] + "</strong>" +
          "<span>" + NOME_RECURSO[i.recurso] + " · " + fmtPreco(i.preco) + " cada</span></div></div>" +
          stepper(i.chave, i.vezes) +
          '<div class="subtotal">' + fmtPreco(i.preco * i.vezes) + "</div></div>"
        );
      }).join("") +
      "</div>" +
      '<div class="mp-sacola-totais">' +
      RECURSOS.map(function (rec) {
        var soma = itens.filter(function (i) { return i.recurso === rec; }).reduce(function (s, i) { return s + i.quantidade * i.vezes; }, 0);
        return soma ? "<span>+" + fmtNum(soma) + " " + UNIDADE_RECURSO[rec] + " de " + NOME_RECURSO[rec] + "</span>" : "";
      }).join("") +
      "</div>" +
      '<div class="mp-sacola-total"><span>Total</span><strong>' + fmtPreco(r.total) + "</strong></div>" +
      '<p class="mp-nota" style="margin:0 0 14px">Pagamento único no cartão de crédito. Os créditos entram no saldo assim que o pagamento é confirmado e não expiram.</p>' +
      '<div class="mp-modal-actions"><button class="mp-btn primary" data-pagar-sacola><i class="ti ti-lock"></i> Pagar ' + fmtPreco(r.total) + "</button>" +
      '<button class="mp-btn" data-fechar-modal>Continuar escolhendo</button>' +
      '<button class="mp-link" style="align-self:center;color:#be123c" data-esvaziar-sacola>Esvaziar sacola</button></div>'
    );
  }

  // --- Carteira de créditos ---

  function pacotesRecurso(recurso) {
    var bloqueado = !!cancelamentoAgendado();
    return PACOTES_CREDITO[recurso]
      .map(function (pac) {
        var chave = recurso + ":" + pac.quantidade;
        var vezes = S.sacola[chave] || 0;
        return (
          '<div class="mp-pacote' + (vezes ? " na-sacola" : "") + '"><span class="qtd">+' + fmtNum(pac.quantidade) + " " + UNIDADE_RECURSO[recurso] + "</span>" +
          '<span class="preco">' + fmtPreco(pac.preco) + " · não expira</span>" +
          (vezes && !bloqueado
            ? stepper(chave, vezes)
            : '<button class="mp-btn primary xs" data-sacola-mais="' + chave + '"' + (bloqueado ? " disabled" : "") + '><i class="ti ti-shopping-bag-plus"></i> Adicionar</button>') +
          "</div>"
        );
      })
      .join("");
  }

  function abaCreditos() {
    var saldos = RECURSOS.map(function (r) {
      return (
        '<div class="mp-saldo"><i class="ti ' + ICONE_RECURSO[r] + '"></i><div><span>' + NOME_RECURSO[r] + "</span>" +
        "<strong>" + fmtNum(saldoAdicional(r)) + " <small>" + UNIDADE_RECURSO[r] + "</small></strong></div></div>"
      );
    }).join("");

    var compras = S.creditos.length
      ? '<div class="mp-tabela-wrap"><table class="mp-tabela"><thead><tr><th>Data</th><th>Recurso</th><th>Pacote</th><th>Usado</th><th>Valor</th><th>Situação</th></tr></thead><tbody>' +
        S.creditos.map(function (c) {
          var pct = c.quantidade ? Math.round((c.consumido / c.quantidade) * 100) : 0;
          return (
            "<tr><td>" + fmtData(c.created_at) + "</td><td>" + NOME_RECURSO[c.recurso] + "</td>" +
            "<td>+" + fmtNum(c.quantidade) + " " + UNIDADE_RECURSO[c.recurso] + "</td>" +
            "<td>" + (c.status === "pago" ? fmtNum(c.consumido) + " (" + pct + "%)" : "—") + "</td>" +
            "<td>" + (c.valor_pago != null ? fmtPreco(c.valor_pago) : "—") + "</td>" +
            '<td><span class="mp-status ' + (c.status === "pago" ? (c.consumido >= c.quantidade ? "neutro" : "pago") : c.status === "pendente" ? "pendente" : "neutro") + '">' +
            (c.status === "pago" && c.consumido >= c.quantidade ? "Esgotado" : STATUS_CREDITO[c.status] || c.status) + "</span></td></tr>"
          );
        }).join("") +
        "</tbody></table></div>"
      : '<p class="mp-vazio">Você ainda não comprou créditos extras.</p>';

    return (
      '<div class="mp-panel"><p class="mp-secao-titulo">Saldo disponível</p>' +
      '<div class="mp-saldos">' + saldos + "</div>" +
      '<p class="mp-nota">Créditos extras não expiram e só são consumidos depois que a franquia mensal do plano acaba.</p></div>' +

      '<div class="mp-panel"><p class="mp-secao-titulo">Comprar créditos extras</p>' +
      '<p class="mp-nota" style="margin:-6px 0 14px">Adicione à sacola quantos pacotes quiser — inclusive o mesmo pacote mais de uma vez — e pague tudo de uma vez.</p>' +
      '<div style="display:flex;flex-direction:column;gap:16px">' +
      RECURSOS.map(function (r) {
        return '<div><strong style="font-size:12.5px">' + NOME_RECURSO[r] + '</strong><div class="mp-creditos-grid" style="margin-top:8px">' + pacotesRecurso(r) + "</div></div>";
      }).join("") +
      "</div></div>" +

      '<div class="mp-panel"><div class="mp-secao-head"><p class="mp-secao-titulo">Extrato de créditos</p>' +
      '<button class="mp-link" data-recarregar><i class="ti ti-refresh"></i> Atualizar</button></div>' + compras + "</div>"
    );
  }

  // --- Pagamentos ---

  function abaPagamentos() {
    var cartao = cartaoAtual();
    var f = S.fin;
    var corpo;
    if (f.carregando && !f.dados) corpo = '<p class="mp-vazio">Carregando pagamentos…</p>';
    else if (f.erro && !f.dados) corpo = '<p class="mp-vazio">Não foi possível carregar o histórico: ' + esc(f.erro) + ' <button class="mp-link" data-recarregar-fin>Tentar de novo</button></p>';
    else if (!f.dados || !f.dados.pagamentos.length) corpo = '<p class="mp-vazio">Nenhuma cobrança registrada ainda.</p>';
    else {
      corpo =
        '<div class="mp-tabela-wrap"><table class="mp-tabela"><thead><tr><th>Vencimento</th><th>Descrição</th><th>Forma</th><th>Valor</th><th>Situação</th><th></th></tr></thead><tbody>' +
        f.dados.pagamentos.map(function (p) {
          var st = STATUS_PAGAMENTO[p.status] || { rotulo: p.status, classe: "neutro" };
          var desc = p.descricao || (p.tipo === "mensalidade" ? "Mensalidade MediCopilot" : "Compra avulsa");
          var link = st.classe === "pago" && p.reciboUrl
            ? '<a class="mp-link" href="' + esc(p.reciboUrl) + '" target="_blank" rel="noopener">Recibo</a>'
            : p.faturaUrl
              ? '<a class="mp-link" href="' + esc(p.faturaUrl) + '" target="_blank" rel="noopener">' + (st.classe === "pago" ? "Fatura" : "Pagar") + "</a>"
              : "";
          return (
            "<tr><td>" + fmtData(p.vencimento) + (p.pagoEm && st.classe === "pago" ? "<br><small>pago em " + fmtData(p.pagoEm) + "</small>" : "") + "</td>" +
            "<td>" + esc(desc) + "</td><td>" + (FORMA_PAGAMENTO[p.forma] || esc(p.forma || "—")) + "</td>" +
            "<td><strong>" + fmtPreco(p.valor) + "</strong></td>" +
            '<td><span class="mp-status ' + st.classe + '">' + st.rotulo + "</span></td><td>" + link + "</td></tr>"
          );
        }).join("") +
        "</tbody></table></div>";
    }

    var totalPago = f.dados
      ? f.dados.pagamentos
          .filter(function (p) { return STATUS_PAGAMENTO[p.status] && STATUS_PAGAMENTO[p.status].classe === "pago"; })
          .reduce(function (s, p) { return s + p.valor; }, 0)
      : 0;

    return (
      '<div class="mp-panel"><p class="mp-secao-titulo">Forma de pagamento</p>' +
      '<div class="mp-cartao-row"><div class="mp-cartao"><i class="ti ti-credit-card"></i><div>' +
      "<strong>" + (cartao ? esc(cartao.bandeira || "Cartão") + " •••• " + esc(cartao.final) : "Cartão de crédito") + "</strong>" +
      "<span>Usado nas cobranças recorrentes da assinatura</span></div></div>" +
      (cancelamentoAgendado() ? "" : '<button class="mp-btn" data-abrir-cartao><i class="ti ti-edit"></i> Alterar cartão</button>') +
      "</div></div>" +

      '<div class="mp-panel"><div class="mp-secao-head"><p class="mp-secao-titulo">Histórico de pagamentos</p>' +
      '<button class="mp-link" data-recarregar-fin><i class="ti ti-refresh"></i> ' + (f.carregando ? "Atualizando…" : "Atualizar") + "</button></div>" +
      (f.dados && totalPago ? '<p class="mp-nota" style="margin:-6px 0 12px">Total pago nas cobranças listadas: <strong>' + fmtPreco(totalPago) + "</strong></p>" : "") +
      corpo + "</div>"
    );
  }

  // ---------------------------------------------------------------------------
  // modais
  // ---------------------------------------------------------------------------

  function comparacao(atual, novo) {
    var campos = [
      ["medicos", "Médicos", ""],
      ["secretarias", "Usuários de gestão", ""],
      ["copiloto", "Copiloto", " consultas"],
      ["whatsapp", "WhatsApp", " conversas"],
      ["video", "Vídeo", " min"],
    ];
    return (
      '<table class="mp-comparacao"><thead><tr><th></th><th>Atual</th><th>Novo</th></tr></thead><tbody>' +
      campos.map(function (c) {
        var de = Number(atual[c[0]]);
        var para = novo[c[0]];
        var cls = para > de ? "mais" : para < de ? "menos" : "";
        return "<tr><td>" + c[1] + "</td><td>" + fmtNum(de) + c[2] + '</td><td class="' + cls + '">' + fmtNum(para) + c[2] + "</td></tr>";
      }).join("") +
      "<tr><td>Mensalidade</td><td>" + fmtPreco(atual.preco_mensal) + '</td><td class="' + (novo.precoMensal > atual.preco_mensal ? "menos" : "mais") + '">' + fmtPreco(novo.precoMensal) + "</td></tr>" +
      "</tbody></table>"
    );
  }

  function modalTrocarPlano() {
    var a = S.assinatura;
    var p = planoPorId(S.modal.planoId);
    var upgrade = p.precoMensal > Number(a.preco_mensal);
    var proxima = proximaCobranca();
    var hoje = new Date().toISOString().slice(0, 10);
    var agenda = !upgrade && proxima && proxima > hoje;
    var texto = upgrade
      ? "As novas franquias são liberadas agora. A partir da próxima fatura" + (proxima ? " (" + fmtData(proxima) + ")" : "") + " o valor passa a ser " + fmtPreco(p.precoMensal) + "/mês."
      : agenda
        ? "A mudança entra em " + fmtData(proxima) + ", na próxima cobrança. Até lá você continua com as franquias do plano atual, e pode desfazer o agendamento quando quiser."
        : "A mudança vale a partir de agora e a próxima fatura vem com o novo valor.";
    var perdas = [];
    if (p.medicos < a.medicos || p.secretarias < a.secretarias) perdas.push("menos licenças de usuário — remova o excedente em Minha equipe");
    if (p.video === 0 && a.video > 0) perdas.push("o plano " + p.nome + " não inclui vídeo/telemedicina");
    return (
      "<h3>" + (upgrade ? "Upgrade" : "Downgrade") + " para " + p.nome + "</h3>" +
      comparacao(a, p) +
      "<p>" + texto + "</p>" +
      (perdas.length ? '<div class="mp-alerta" style="margin:0 0 14px"><i class="ti ti-alert-triangle"></i><div>Atenção: ' + perdas.join("; ") + ".</div></div>" : "") +
      '<div class="mp-modal-actions"><button class="mp-btn primary" data-confirmar-trocar="' + p.id + '">' + (agenda ? "Agendar downgrade" : "Confirmar " + (upgrade ? "upgrade" : "troca")) + "</button>" +
      '<button class="mp-btn" data-fechar-modal>Voltar</button></div>'
    );
  }

  function modalCancelar() {
    var a = S.assinatura;
    var proxima = proximaCobranca();
    var hoje = new Date().toISOString().slice(0, 10);
    var acessoAte = a.status === "ativa" && proxima && proxima > hoje ? proxima : null;
    var basic = planoPorId("basic");
    var retencao =
      a.plano !== "basic" && Number(a.preco_mensal) > basic.precoMensal
        ? '<div class="mp-retencao"><i class="ti ti-discount"></i><div><strong>Que tal um plano mais leve?</strong><br>' +
          "O Basic custa " + fmtPreco(basic.precoMensal) + "/mês e mantém sua agenda, prontuário e Copiloto." +
          '<br><button class="mp-link" data-trocar-plano="basic">Mudar para o Basic em vez de cancelar</button></div></div>'
        : "";
    return (
      "<h3>Cancelar assinatura</h3>" +
      "<p>" + (acessoAte
        ? "As cobranças param imediatamente. Você continua com acesso completo até <strong>" + fmtData(acessoAte) + "</strong>; depois disso a conta volta para o plano Free (somente Receitas)."
        : "As cobranças param imediatamente e a conta volta para o plano Free (somente Receitas).") + "</p>" +
      retencao +
      '<p class="mp-form-label">Conte pra gente o motivo</p>' +
      '<div class="mp-motivos">' +
      MOTIVOS_CANCELAMENTO.map(function (m) {
        return '<label><input type="radio" name="mp-motivo" value="' + esc(m) + '"> ' + m + "</label>";
      }).join("") +
      "</div>" +
      '<textarea id="mp-cancel-comentario" class="mp-input" rows="2" maxlength="1000" placeholder="Comentário (opcional)"></textarea>' +
      '<label class="mp-check"><input type="checkbox" id="mp-cancel-ciente"> Entendo que o cancelamento não pode ser desfeito por aqui.</label>' +
      '<p class="mp-erro-form" id="mp-cancel-erro"></p>' +
      '<div class="mp-modal-actions"><button class="mp-btn danger" data-confirmar-cancelar>Confirmar cancelamento</button>' +
      '<button class="mp-btn" data-fechar-modal>Manter assinatura</button></div>'
    );
  }

  function modalCartao() {
    return (
      "<h3>Alterar cartão de crédito</h3>" +
      "<p>O novo cartão passa a ser usado nas próximas cobranças. Nenhum valor é cobrado agora.</p>" +
      '<form id="mp-form-cartao" autocomplete="on">' +
      '<p class="mp-form-label">Dados do cartão</p>' +
      '<input class="mp-input" name="numero" inputmode="numeric" autocomplete="cc-number" placeholder="Número do cartão" maxlength="23">' +
      '<input class="mp-input" name="nomeTitular" autocomplete="cc-name" placeholder="Nome impresso no cartão">' +
      '<div class="mp-form-row">' +
      '<input class="mp-input" name="validade" inputmode="numeric" autocomplete="cc-exp" placeholder="Validade (MM/AA)" maxlength="7">' +
      '<input class="mp-input" name="cvv" inputmode="numeric" autocomplete="cc-csc" placeholder="CVV" maxlength="4">' +
      "</div>" +
      '<p class="mp-form-label">Titular do cartão</p>' +
      '<input class="mp-input" name="nome" autocomplete="name" placeholder="Nome completo">' +
      '<div class="mp-form-row">' +
      '<input class="mp-input" name="cpfCnpj" inputmode="numeric" placeholder="CPF ou CNPJ">' +
      '<input class="mp-input" name="telefone" inputmode="tel" autocomplete="tel" placeholder="Telefone com DDD">' +
      "</div>" +
      '<input class="mp-input" name="email" type="email" autocomplete="email" placeholder="E-mail" value="' + esc(S.email) + '">' +
      '<div class="mp-form-row">' +
      '<input class="mp-input" name="cep" inputmode="numeric" autocomplete="postal-code" placeholder="CEP">' +
      '<input class="mp-input" name="numeroEndereco" placeholder="Nº do endereço">' +
      "</div>" +
      '<p class="mp-erro-form" id="mp-cartao-erro"></p>' +
      '<div class="mp-modal-actions"><button type="submit" class="mp-btn primary" id="mp-salvar-cartao"><i class="ti ti-lock"></i> Salvar cartão</button>' +
      '<button type="button" class="mp-btn" data-fechar-modal>Cancelar</button></div>' +
      '<p class="mp-nota" style="text-align:center;margin-top:10px"><i class="ti ti-shield-lock"></i> Os dados vão direto para o Asaas, nosso processador de pagamentos. Não armazenamos o número do cartão.</p>' +
      "</form>"
    );
  }

  function modalHtml() {
    if (!S.modal) return "";
    var conteudo =
      S.modal.tipo === "cancelar" ? modalCancelar() :
      S.modal.tipo === "trocar-plano" ? modalTrocarPlano() :
      S.modal.tipo === "cartao" ? modalCartao() :
      S.modal.tipo === "sacola" ? modalSacola() : "";
    if (!conteudo) return "";
    return '<div class="mp-modal-bg"><div class="mp-modal' + (S.modal.tipo === "cartao" || S.modal.tipo === "cancelar" || S.modal.tipo === "sacola" ? " largo" : "") + '">' + conteudo + "</div></div>";
  }

  // ---------------------------------------------------------------------------
  // render
  // ---------------------------------------------------------------------------

  function render() {
    var el = document.getElementById("s-meu-plano");
    if (!el) return;

    // Não redesenha por cima de um formulário aberto (perderia o que foi digitado).
    if (S.modal && (S.modal.tipo === "cartao" || S.modal.tipo === "cancelar") && el.querySelector(".mp-modal")) return;

    if (S.carregando) {
      el.innerHTML = VOLTAR + '<div class="mp-panel">Carregando sua assinatura…</div>';
      return;
    }
    if (S.erro) {
      el.innerHTML = VOLTAR + '<div class="mp-panel">' + esc(S.erro) + "</div>";
      return;
    }
    if (!S.assinatura) {
      el.innerHTML =
        VOLTAR + CABECALHO +
        '<div class="mp-panel"><div class="mp-plano-row"><div>' +
        '<div class="mp-plano-nome">Free <span class="mp-badge ativa">Gratuito</span></div>' +
        '<div style="color:#9ca3af;font-size:12px;margin-top:4px">Sem cobrança recorrente</div>' +
        "</div><div class=\"mp-plano-preco\">" + fmtPreco(0) + "<span> /mês</span></div></div>" +
        '<div style="margin-top:14px;font-size:12.5px;color:#6b7280;line-height:1.6">' +
        "Acesso liberado: <strong>emissão e consulta de receitas</strong>.<br>" +
        "Agenda, prontuário, Copiloto de IA, WhatsApp automatizado, telemedicina e os demais recursos ficam disponíveis a partir do plano Basic." +
        "</div></div>" +
        '<div class="mp-panel"><p class="mp-secao-titulo">Fazer upgrade</p><div class="mp-planos-grid">' +
        PLANOS.map(function (p) {
          return (
            '<div class="mp-plano-card"><h4>' + p.nome + "</h4>" +
            '<div class="preco">' + fmtPreco(p.precoMensal) + '<span style="font-size:11px;color:#9ca3af;font-weight:400"> /mês</span></div>' +
            itensPlano(p) +
            '<a class="mp-btn primary" href="/planos" style="text-decoration:none;justify-content:center">Assinar ' + p.nome + "</a></div>"
          );
        }).join("") +
        "</div></div>";
      return;
    }

    var conteudoAba =
      S.aba === "planos" ? abaPlanos() :
      S.aba === "consumo" ? abaConsumo() :
      S.aba === "creditos" ? abaCreditos() :
      S.aba === "pagamentos" ? abaPagamentos() : abaGeral();

    el.innerHTML =
      VOLTAR + CABECALHO +
      (S.aviso ? '<div class="mp-aviso ' + S.aviso.tipo + '"><i class="ti ' + (S.aviso.tipo === "erro" ? "ti-alert-circle" : "ti-circle-check") + '"></i> ' + esc(S.aviso.texto) + "</div>" : "") +
      resumoAssinatura() + abas() + conteudoAba + botaoSacolaFlutuante() + modalHtml();
  }

  function fecharModal() {
    S.modal = null;
    var bg = document.querySelector("#s-meu-plano .mp-modal-bg");
    if (bg) bg.remove();
    render();
  }

  function abrirModal(modal) {
    S.modal = modal;
    var el = document.getElementById("s-meu-plano");
    var bg = el && el.querySelector(".mp-modal-bg");
    if (bg) bg.remove();
    render();
  }

  // ---------------------------------------------------------------------------
  // ações
  // ---------------------------------------------------------------------------

  function luhnOk(num) {
    var soma = 0;
    var dobra = false;
    for (var i = num.length - 1; i >= 0; i--) {
      var d = Number(num.charAt(i));
      if (dobra) { d *= 2; if (d > 9) d -= 9; }
      soma += d;
      dobra = !dobra;
    }
    return soma % 10 === 0;
  }

  async function salvarCartao(form) {
    var erroEl = form.querySelector("#mp-cartao-erro");
    var btn = form.querySelector("#mp-salvar-cartao");
    var v = function (n) { return (form.elements[n].value || "").trim(); };
    var dig = function (n) { return v(n).replace(/\D/g, ""); };

    var validade = v("validade").split("/");
    var numero = dig("numero");
    var erro = null;
    if (numero.length < 13 || !luhnOk(numero)) erro = "Número do cartão inválido.";
    else if (v("nomeTitular").length < 3) erro = "Informe o nome impresso no cartão.";
    else if (validade.length !== 2 || !/^\d{1,2}$/.test(validade[0].trim()) || !/^\d{2}(\d{2})?$/.test(validade[1].trim())) erro = "Validade no formato MM/AA.";
    else if (dig("cvv").length < 3) erro = "CVV inválido.";
    else if (v("nome").length < 3) erro = "Informe o nome do titular.";
    else if ([11, 14].indexOf(dig("cpfCnpj").length) === -1) erro = "CPF ou CNPJ inválido.";
    else if (dig("telefone").length < 10) erro = "Telefone com DDD inválido.";
    else if (!/^\S+@\S+\.\S+$/.test(v("email"))) erro = "E-mail inválido.";
    else if (dig("cep").length !== 8) erro = "CEP inválido.";
    else if (!v("numeroEndereco")) erro = "Informe o número do endereço.";
    if (erro) {
      erroEl.textContent = erro;
      return;
    }

    erroEl.textContent = "";
    btn.disabled = true;
    btn.textContent = "Salvando…";
    try {
      var resp = await chamarApi("/api/assinatura/atualizar-cartao", {
        cartao: { nomeTitular: v("nomeTitular"), numero: numero, mesValidade: validade[0].trim(), anoValidade: validade[1].trim(), cvv: dig("cvv") },
        titular: { nome: v("nome"), email: v("email"), cpfCnpj: dig("cpfCnpj"), cep: dig("cep"), numeroEndereco: v("numeroEndereco"), telefone: dig("telefone") },
      });
      S.assinatura.cartao_final = resp.final;
      S.assinatura.cartao_bandeira = resp.bandeira;
      if (S.fin.dados) S.fin.dados.cartao = { bandeira: resp.bandeira, final: resp.final };
      fecharModal();
      avisar("Cartão atualizado. As próximas cobranças serão feitas no cartão final " + resp.final + ".");
    } catch (err) {
      erroEl.textContent = err.message || "Não foi possível atualizar o cartão.";
      btn.disabled = false;
      btn.innerHTML = '<i class="ti ti-lock"></i> Salvar cartão';
    }
  }

  document.addEventListener("submit", function (e) {
    if (e.target && e.target.id === "mp-form-cartao") {
      e.preventDefault();
      salvarCartao(e.target);
    }
  });

  // Máscara leve na validade (MMAA -> MM/AA).
  document.addEventListener("input", function (e) {
    var t = e.target;
    if (t && t.name === "validade" && t.closest("#mp-form-cartao")) {
      var d = t.value.replace(/\D/g, "").slice(0, 4);
      t.value = d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
    }
  });

  document.addEventListener("click", async function (e) {
    var raiz = document.getElementById("s-meu-plano");
    if (!raiz || !raiz.contains(e.target)) return;

    if (e.target.classList.contains("mp-modal-bg")) {
      fecharModal();
      return;
    }
    if (e.target.closest("[data-fechar-modal]")) {
      fecharModal();
      return;
    }

    var abaBtn = e.target.closest("[data-aba]");
    if (abaBtn) {
      S.aba = abaBtn.getAttribute("data-aba");
      render();
      return;
    }

    var trocarBtn = e.target.closest("[data-trocar-plano]");
    if (trocarBtn) {
      abrirModal({ tipo: "trocar-plano", planoId: trocarBtn.getAttribute("data-trocar-plano") });
      return;
    }

    if (e.target.closest("[data-abrir-cancelar]")) {
      abrirModal({ tipo: "cancelar" });
      return;
    }

    if (e.target.closest("[data-abrir-cartao]")) {
      abrirModal({ tipo: "cartao" });
      return;
    }

    if (e.target.closest("[data-exportar-consumo]")) {
      exportarConsumoCsv();
      return;
    }

    if (e.target.closest("[data-recarregar]")) {
      carregar();
      return;
    }

    if (e.target.closest("[data-recarregar-fin]")) {
      carregarFinanceiro();
      return;
    }

    var desfazerBtn = e.target.closest("[data-desfazer-agendamento]");
    if (desfazerBtn) {
      desfazerBtn.disabled = true;
      try {
        await chamarApi("/api/assinatura/trocar-plano", { novoPlano: S.assinatura.plano });
        await carregar();
        avisar("Agendamento desfeito — você continua no plano atual.");
      } catch (err) {
        desfazerBtn.disabled = false;
        avisar(err.message || "Não foi possível desfazer o agendamento.", "erro");
      }
      return;
    }

    var confirmarTrocar = e.target.closest("[data-confirmar-trocar]");
    if (confirmarTrocar) {
      var novoPlano = confirmarTrocar.getAttribute("data-confirmar-trocar");
      confirmarTrocar.disabled = true;
      confirmarTrocar.textContent = "Processando…";
      try {
        var r = await chamarApi("/api/assinatura/trocar-plano", { novoPlano: novoPlano });
        S.modal = null;
        await carregar();
        var nome = planoPorId(novoPlano).nome;
        avisar(r.efeito === "agendado" ? "Downgrade para " + nome + " agendado para " + fmtData(r.vigenciaEm) + "." : "Pronto! Você agora está no plano " + nome + ".");
      } catch (err) {
        S.modal = null;
        render();
        avisar(err.message || "Não foi possível trocar de plano.", "erro");
      }
      return;
    }

    var btnCancelar = e.target.closest("[data-confirmar-cancelar]");
    if (btnCancelar) {
      var modal = btnCancelar.closest(".mp-modal");
      var erroEl = modal.querySelector("#mp-cancel-erro");
      var motivoEl = modal.querySelector('input[name="mp-motivo"]:checked');
      if (!motivoEl) {
        erroEl.textContent = "Selecione um motivo.";
        return;
      }
      if (!modal.querySelector("#mp-cancel-ciente").checked) {
        erroEl.textContent = "Confirme que está ciente para continuar.";
        return;
      }
      erroEl.textContent = "";
      btnCancelar.disabled = true;
      btnCancelar.textContent = "Cancelando…";
      try {
        var resp = await chamarApi("/api/assinatura/cancelar", {
          motivo: motivoEl.value,
          comentario: modal.querySelector("#mp-cancel-comentario").value || undefined,
        });
        S.modal = null;
        await carregar();
        avisar(resp.acessoAte ? "Assinatura cancelada. Seu acesso continua até " + fmtData(resp.acessoAte) + "." : "Assinatura cancelada.");
      } catch (err) {
        erroEl.textContent = err.message || "Não foi possível cancelar.";
        btnCancelar.disabled = false;
        btnCancelar.textContent = "Confirmar cancelamento";
      }
      return;
    }

    var maisBtn = e.target.closest("[data-sacola-mais]");
    if (maisBtn) {
      alterarSacola(maisBtn.getAttribute("data-sacola-mais"), 1);
      return;
    }

    var menosBtn = e.target.closest("[data-sacola-menos]");
    if (menosBtn) {
      alterarSacola(menosBtn.getAttribute("data-sacola-menos"), -1);
      return;
    }

    if (e.target.closest("[data-abrir-sacola]")) {
      abrirModal({ tipo: "sacola" });
      return;
    }

    if (e.target.closest("[data-esvaziar-sacola]")) {
      S.sacola = {};
      salvarSacola();
      fecharModal();
      return;
    }

    var pagarBtn = e.target.closest("[data-pagar-sacola]");
    if (pagarBtn) {
      pagarBtn.disabled = true;
      pagarBtn.textContent = "Abrindo pagamento…";
      try {
        var respCompra = await chamarApi("/api/assinatura/comprar-creditos", {
          itens: itensSacola().map(function (i) { return { recurso: i.recurso, quantidade: i.quantidade, vezes: i.vezes }; }),
        });
        if (respCompra.checkoutUrl) {
          // A compra já ficou registrada como pendente; esvazia a sacola antes de sair pro Asaas.
          S.sacola = {};
          salvarSacola();
          window.location.href = respCompra.checkoutUrl;
        }
      } catch (err) {
        S.modal = null;
        render();
        avisar(err.message || "Não foi possível abrir o pagamento.", "erro");
      }
    }
  });

  window.initMeuPlano = function () {
    S.modal = null;
    carregar();
  };
})();
