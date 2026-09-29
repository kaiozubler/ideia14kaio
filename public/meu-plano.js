// MEU PLANO — gestão da assinatura ativa (Configurações -> Meu plano).
// Segue o mesmo contrato dos outros módulos (equipe.js, faturamento.js):
// IIFE, usa window.sb (já autenticado pelo app principal), expõe
// window.initMeuPlano() como ponto de entrada, escreve em #s-meu-plano.
//
// Os números de planos/pacotes de crédito abaixo são uma cópia manual dos
// mesmos valores em src/lib/plans/config.ts -- os dois arquivos não
// compartilham módulo (esse aqui é servido cru em /public, o outro passa
// pelo build do Vite). Se mexer no preço de um lado, replique no outro.
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

  var NOME_RECURSO = { copiloto: "Copiloto IA", whatsapp: "WhatsApp", video: "Vídeo" };
  var UNIDADE_RECURSO = { copiloto: "consultas", whatsapp: "conversas", video: "min" };

  function fmtPreco(v) {
    return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  var S = { assinatura: null, consumo: {}, creditos: [], carregando: true, erro: null, modal: null };

  function sbClient() {
    return window.sb || window.__sb;
  }

  async function tokenAtual() {
    var sb = sbClient();
    var res = await sb.auth.getSession();
    return res.data && res.data.session ? res.data.session.access_token : null;
  }

  async function chamarApi(path, body) {
    var token = await tokenAtual();
    var resp = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body || {}),
    });
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok) throw new Error(data.error || "Erro " + resp.status);
    return data;
  }

  async function carregar() {
    S.carregando = true;
    S.erro = null;
    render();
    try {
      var sb = sbClient();
      var userRes = await sb.auth.getUser();
      var uid = userRes.data && userRes.data.user ? userRes.data.user.id : null;
      if (!uid) throw new Error("Não autenticado.");

      var assinaturaRes = await sb
        .from("assinaturas")
        .select("*")
        .eq("medico_id", uid)
        .neq("status", "cancelada")
        .maybeSingle();
      // Qualquer problema aqui (tabela ainda não migrada, nenhuma linha, etc.)
      // é tratado como "sem assinatura paga" = Free, não como erro bloqueante.
      S.assinatura = assinaturaRes.error ? null : assinaturaRes.data;

      if (S.assinatura) {
        var inicioMes = new Date();
        inicioMes.setDate(1);
        var mesISO = inicioMes.toISOString().slice(0, 10);

        var consumoRes = await sb.from("consumo_mensal").select("*").eq("assinatura_id", S.assinatura.id).eq("mes", mesISO);
        var creditosRes = await sb.from("creditos_adicionais").select("*").eq("assinatura_id", S.assinatura.id).eq("status", "pago");

        S.consumo = {};
        (consumoRes.data || []).forEach(function (c) {
          S.consumo[c.recurso] = c;
        });
        S.creditos = creditosRes.data || [];
      }
    } catch (err) {
      S.erro = (err && err.message) || "Não foi possível carregar sua assinatura.";
    } finally {
      S.carregando = false;
      render();
    }
  }

  function saldoAdicional(recurso) {
    return S.creditos
      .filter(function (c) { return c.recurso === recurso; })
      .reduce(function (soma, c) { return soma + (c.quantidade - c.consumido); }, 0);
  }

  function linhaConsumo(recurso) {
    var a = S.assinatura;
    var franquia = a[recurso];
    var c = S.consumo[recurso];
    var usadoPlano = c ? c.usado_plano : 0;
    var usadoAdicional = c ? c.usado_adicional : 0;
    var saldoExtra = saldoAdicional(recurso);
    var total = franquia + saldoExtra;
    var pctPlano = total > 0 ? Math.min(100, (usadoPlano / total) * 100) : 0;
    var pctAdicional = total > 0 ? Math.min(100 - pctPlano, (usadoAdicional / total) * 100) : 0;
    return (
      '<div class="mp-consumo-item">' +
      '<div class="mp-consumo-top"><span>' + NOME_RECURSO[recurso] + "</span><small>" +
      (usadoPlano + usadoAdicional) + " / " + franquia + (saldoExtra ? " +" + saldoExtra : "") + " " + UNIDADE_RECURSO[recurso] +
      "</small></div>" +
      '<div class="mp-barra"><div class="plano" style="width:' + pctPlano + '%"></div><div class="adicional" style="width:' + pctAdicional + '%"></div></div>' +
      '<div class="mp-consumo-legenda"><span><i class="mp-dot" style="background:#059669"></i>Franquia do plano</span>' +
      (saldoExtra || usadoAdicional ? '<span><i class="mp-dot" style="background:#7c3aed"></i>Crédito extra</span>' : "") +
      "</div></div>"
    );
  }

  function cardPlano(p) {
    var atual = S.assinatura && S.assinatura.plano === p.id;
    return (
      '<div class="mp-plano-card ' + (atual ? "atual" : "") + '">' +
      "<h4>" + p.nome + "</h4>" +
      '<div class="preco">' + fmtPreco(p.precoMensal) + '<span style="font-size:11px;color:#9ca3af;font-weight:400"> /mês</span></div>' +
      "<ul><li>" + p.medicos + " médico(s) · " + p.secretarias + " usuário(s) de gestão</li>" +
      "<li>" + p.copiloto + " consultas de Copiloto</li>" +
      "<li>" + p.whatsapp.toLocaleString("pt-BR") + " conversas de WhatsApp</li>" +
      "<li>" + (p.video ? p.video.toLocaleString("pt-BR") + " min de vídeo" : "Vídeo não incluído") + "</li></ul>" +
      (atual
        ? '<button class="mp-btn" disabled>Plano atual</button>'
        : '<button class="mp-btn primary" data-trocar-plano="' + p.id + '">' +
          (p.precoMensal > S.assinatura.preco_mensal ? "Fazer upgrade" : "Fazer downgrade") +
          "</button>") +
      "</div>"
    );
  }

  function cardPlanoGratis(p) {
    return (
      '<div class="mp-plano-card">' +
      "<h4>" + p.nome + "</h4>" +
      '<div class="preco">' + fmtPreco(p.precoMensal) + '<span style="font-size:11px;color:#9ca3af;font-weight:400"> /mês</span></div>' +
      "<ul><li>" + p.medicos + " médico(s) · " + p.secretarias + " usuário(s) de gestão</li>" +
      "<li>" + p.copiloto + " consultas de Copiloto</li>" +
      "<li>" + p.whatsapp.toLocaleString("pt-BR") + " conversas de WhatsApp</li>" +
      "<li>" + (p.video ? p.video.toLocaleString("pt-BR") + " min de vídeo" : "Vídeo não incluído") + "</li></ul>" +
      '<a class="mp-btn primary" href="/planos" style="text-decoration:none;text-align:center">Assinar ' + p.nome + "</a>" +
      "</div>"
    );
  }

  function pacotesRecurso(recurso) {
    return PACOTES_CREDITO[recurso]
      .map(function (pac) {
        return (
          '<div class="mp-pacote"><span class="qtd">+' + pac.quantidade.toLocaleString("pt-BR") + " " + UNIDADE_RECURSO[recurso] + "</span>" +
          '<span class="preco">' + fmtPreco(pac.preco) + " (avulso, não expira)</span>" +
          '<button class="mp-btn primary xs" data-comprar-credito="' + recurso + ":" + pac.quantidade + '">Comprar</button></div>'
        );
      })
      .join("");
  }

  function modalHtml() {
    if (!S.modal) return "";
    if (S.modal.tipo === "cancelar") {
      return (
        '<div class="mp-modal-bg" data-fechar-modal><div class="mp-modal" onclick="event.stopPropagation()">' +
        "<h3>Cancelar assinatura?</h3>" +
        "<p>Isso interrompe as próximas cobranças. Você continua com acesso até o fim do período já pago.</p>" +
        '<div class="mp-modal-actions"><button class="mp-btn danger" data-confirmar-cancelar>Sim, cancelar</button>' +
        '<button class="mp-btn" data-fechar-modal>Voltar</button></div></div></div>'
      );
    }
    if (S.modal.tipo === "trocar-plano") {
      var p = PLANOS.filter(function (pl) { return pl.id === S.modal.planoId; })[0];
      return (
        '<div class="mp-modal-bg" data-fechar-modal><div class="mp-modal" onclick="event.stopPropagation()">' +
        "<h3>Trocar para " + p.nome + "?</h3>" +
        "<p>Sua próxima cobrança passa a ser de " + fmtPreco(p.precoMensal) + "/mês. A mudança já vale a partir de agora.</p>" +
        '<div class="mp-modal-actions"><button class="mp-btn primary" data-confirmar-trocar="' + p.id + '">Confirmar troca</button>' +
        '<button class="mp-btn" data-fechar-modal>Cancelar</button></div></div></div>'
      );
    }
    return "";
  }

  function render() {
    var el = document.getElementById("s-meu-plano");
    if (!el) return;

    if (S.carregando) {
      el.innerHTML = '<div style="margin-bottom:14px"><button class="btn ghost sm" onclick="goScreen(\'configuracoes\')"><i class="ti ti-arrow-left"></i> Voltar</button></div>' +
      '<div class="mp-panel">Carregando sua assinatura…</div>';
      return;
    }
    if (S.erro) {
      el.innerHTML = '<div style="margin-bottom:14px"><button class="btn ghost sm" onclick="goScreen(\'configuracoes\')"><i class="ti ti-arrow-left"></i> Voltar</button></div>' +
      '<div class="mp-panel">' + S.erro + "</div>";
      return;
    }
    if (!S.assinatura) {
      el.innerHTML =
        '<div style="margin-bottom:14px"><button class="btn ghost sm" onclick="goScreen(\'configuracoes\')"><i class="ti ti-arrow-left"></i> Voltar</button></div>' +
        '<div class="mp-head"><div><h1>Meu plano</h1><p>Gerencie sua assinatura do MediCopilot</p></div></div>' +

        '<div class="mp-panel"><div class="mp-plano-row"><div>' +
        '<div class="mp-plano-nome">Free <span class="mp-badge ativa">Gratuito</span></div>' +
        '<div style="color:#9ca3af;font-size:12px;margin-top:4px">Sem cobrança recorrente</div>' +
        "</div><div class=\"mp-plano-preco\">" + fmtPreco(0) + "<span> /mês</span></div></div>" +
        '<div style="margin-top:14px;font-size:12.5px;color:#6b7280;line-height:1.6">' +
        "Acesso liberado: <strong>emissão e consulta de receitas</strong>.<br>" +
        "Agenda, prontuário, Copiloto de IA, WhatsApp automatizado, telemedicina e os demais recursos ficam disponíveis a partir do plano Basic." +
        "</div></div>" +

        '<div class="mp-panel"><p class="mp-secao-titulo">Fazer upgrade</p><div class="mp-planos-grid">' +
        PLANOS.map(cardPlanoGratis).join("") + "</div></div>";
      return;
    }

    var a = S.assinatura;
    var nomePlano = PLANOS.filter(function (p) { return p.id === a.plano; })[0];
    var statusLabel = a.status === "ativa" ? "Ativa" : a.status === "inadimplente" ? "Pagamento pendente" : "Cancelada";

    el.innerHTML =
      '<div style="margin-bottom:14px"><button class="btn ghost sm" onclick="goScreen(\'configuracoes\')"><i class="ti ti-arrow-left"></i> Voltar</button></div>' +
      '<div class="mp-head"><div><h1>Meu plano</h1><p>Gerencie sua assinatura do MediCopilot</p></div></div>' +
      '<div class="mp-panel"><div class="mp-plano-row"><div>' +
      '<div class="mp-plano-nome">' + (nomePlano ? nomePlano.nome : a.plano) +
      ' <span class="mp-badge ' + a.status + '">' + statusLabel + "</span></div>" +
      '<div style="color:#9ca3af;font-size:12px;margin-top:4px">Cobrança ' + (a.ciclo === "anual" ? "anual" : "mensal") +
      (a.dia_cobranca ? " · todo dia " + a.dia_cobranca : "") + "</div></div>" +
      '<div class="mp-plano-preco">' + fmtPreco(a.preco_mensal) + "<span> /mês</span></div></div>" +
      (a.status === "inadimplente"
        ? '<div class="mp-alerta"><div><strong>Tivemos um problema na última cobrança.</strong><br>' +
          ((a.ultimo_erro_cobranca && a.ultimo_erro_cobranca.mensagem) || "Verifique a forma de pagamento pra não perder acesso.") +
          '<br><button class="mp-btn" data-atualizar-pagamento>Atualizar forma de pagamento</button></div></div>'
        : "") +
      '<div style="margin-top:18px"><button class="mp-btn danger" data-abrir-cancelar>Cancelar assinatura</button></div></div>' +

      '<div class="mp-panel"><p class="mp-secao-titulo">Consumo deste mês</p><div class="mp-consumo">' +
      linhaConsumo("copiloto") + linhaConsumo("whatsapp") + linhaConsumo("video") + "</div></div>" +

      '<div class="mp-panel"><p class="mp-secao-titulo">Mudar de plano</p><div class="mp-planos-grid">' +
      PLANOS.map(cardPlano).join("") + "</div></div>" +

      '<div class="mp-panel"><p class="mp-secao-titulo">Comprar créditos extras</p>' +
      '<p style="font-size:12px;color:#9ca3af;margin:-6px 0 14px">Créditos avulsos somam ao seu saldo e só são usados depois que a franquia mensal do plano acabar.</p>' +
      '<div style="display:flex;flex-direction:column;gap:16px">' +
      '<div><strong style="font-size:12.5px">' + NOME_RECURSO.copiloto + '</strong><div class="mp-creditos-grid" style="margin-top:8px">' + pacotesRecurso("copiloto") + "</div></div>" +
      '<div><strong style="font-size:12.5px">' + NOME_RECURSO.whatsapp + '</strong><div class="mp-creditos-grid" style="margin-top:8px">' + pacotesRecurso("whatsapp") + "</div></div>" +
      '<div><strong style="font-size:12.5px">' + NOME_RECURSO.video + '</strong><div class="mp-creditos-grid" style="margin-top:8px">' + pacotesRecurso("video") + "</div></div>" +
      "</div></div>" +

      modalHtml();
  }

  document.addEventListener("click", async function (e) {
    if (!document.getElementById("s-meu-plano")) return;

    var trocarBtn = e.target.closest("[data-trocar-plano]");
    if (trocarBtn) {
      S.modal = { tipo: "trocar-plano", planoId: trocarBtn.getAttribute("data-trocar-plano") };
      render();
      return;
    }

    if (e.target.closest("[data-abrir-cancelar]")) {
      S.modal = { tipo: "cancelar" };
      render();
      return;
    }

    if (e.target.matches("[data-fechar-modal]")) {
      S.modal = null;
      render();
      return;
    }

    var confirmarTrocar = e.target.closest("[data-confirmar-trocar]");
    if (confirmarTrocar) {
      var novoPlano = confirmarTrocar.getAttribute("data-confirmar-trocar");
      confirmarTrocar.disabled = true;
      confirmarTrocar.textContent = "Trocando…";
      try {
        await chamarApi("/api/assinatura/trocar-plano", { novoPlano: novoPlano });
        S.modal = null;
        await carregar();
      } catch (err) {
        alert(err.message || "Não foi possível trocar de plano.");
        S.modal = null;
        render();
      }
      return;
    }

    if (e.target.closest("[data-confirmar-cancelar]")) {
      var btnCancelar = e.target.closest("[data-confirmar-cancelar]");
      btnCancelar.disabled = true;
      btnCancelar.textContent = "Cancelando…";
      try {
        await chamarApi("/api/assinatura/cancelar", {});
        S.modal = null;
        await carregar();
      } catch (err) {
        alert(err.message || "Não foi possível cancelar.");
        S.modal = null;
        render();
      }
      return;
    }

    var comprarBtn = e.target.closest("[data-comprar-credito]");
    if (comprarBtn) {
      var partes = comprarBtn.getAttribute("data-comprar-credito").split(":");
      var recurso = partes[0];
      var quantidade = Number(partes[1]);
      comprarBtn.disabled = true;
      comprarBtn.textContent = "Abrindo…";
      try {
        var resp = await chamarApi("/api/assinatura/comprar-creditos", { recurso: recurso, quantidade: quantidade });
        if (resp.checkoutUrl) window.location.href = resp.checkoutUrl;
      } catch (err) {
        alert(err.message || "Não foi possível abrir o pagamento.");
        comprarBtn.disabled = false;
        comprarBtn.textContent = "Comprar";
      }
      return;
    }

    if (e.target.closest("[data-atualizar-pagamento]")) {
      window.open(
        "https://wa.me/5511999999999?text=" + encodeURIComponent("Olá! Preciso atualizar a forma de pagamento da minha assinatura do MediCopilot."),
        "_blank",
      );
    }
  });

  window.initMeuPlano = function () {
    carregar();
  };
})();
