// CAPTAÇÃO PELO SMARTPHONE — o celular vira o microfone do copiloto (chat_ai).
// O computador abre a chamada (POST /api/captacao-movel) e mostra o QR para
// /captar#<token>; o celular conecta, começa a captar sozinho, transcreve no
// Deepgram e envia texto + nível. Aqui o texto chega pelo Supabase Realtime
// (captacao_movel_trechos / captacao_movel_sessoes, RLS do dono) e entra na
// mesma transcrição da gravação local (addTranscriptLine), então o copiloto
// segue igual — só muda a fonte do áudio.
// Abrir e retomar é só pelo computador; os dois lados podem encerrar.
// Segue o contrato dos outros módulos: IIFE, usa window.sb, expõe
// window.captacaoMovel. Ganchos em medicopilot.html: botão "Smartphone",
// toggleListen (pausar/retomar) e resetAI (encerrar).
(function () {
  var QR_LIB = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
  var SEM_SINAL_MS = 15000;

  var S = {
    id: null,
    url: null,
    status: null, // aguardando | conectado | pausado | encerrado
    encerradoPor: null,
    expiraEm: null,
    canal: null,
    poll: null,
    relogio: null,
    ultimoTrecho: 0,
    vistoEm: 0,
    nivel: 0,
    confianca: null,
    parcial: "",
    linhas: [],
    jaConectou: false,
    minimizado: false,
    criando: false,
    tk: null,
  };

  function db() {
    return window.sb || null;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg, tipo) {
    if (typeof window.showToast === "function") window.showToast(msg, tipo);
  }
  async function token() {
    var sb = db();
    if (!sb) return null;
    var r = await sb.auth.getSession();
    return r && r.data && r.data.session ? r.data.session.access_token : null;
  }
  async function api(body) {
    var tk = await token();
    if (!tk) throw new Error("Sessão expirada. Entre novamente.");
    S.tk = tk;
    var r = await fetch("/api/captacao-movel", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tk },
      body: JSON.stringify(body),
    });
    var j = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) throw new Error(j.error || "Falha " + r.status);
    return j;
  }
  var _qr = null;
  function carregarQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    _qr =
      _qr ||
      new Promise(function (ok, falha) {
        var s = document.createElement("script");
        s.src = QR_LIB;
        s.onload = function () {
          window.qrcode ? ok(window.qrcode) : falha(new Error("qrcode indisponível"));
        };
        s.onerror = function () {
          _qr = null;
          falha(new Error("qrcode indisponível"));
        };
        document.head.appendChild(s);
      });
    return _qr;
  }

  function qualidade(nivel, ativo) {
    if (!ativo) return { rotulo: "Sem áudio", cls: "off" };
    if (nivel >= 96) return { rotulo: "Saturado", cls: "alto" };
    if (nivel < 18) return { rotulo: "Baixo", cls: "baixo" };
    if (nivel < 35) return { rotulo: "Razoável", cls: "medio" };
    return { rotulo: "Boa", cls: "bom" };
  }
  function semSinal() {
    return (
      (S.status === "conectado" || S.status === "pausado") &&
      S.vistoEm &&
      Date.now() - S.vistoEm > SEM_SINAL_MS
    );
  }

  // ---------- estado do copiloto (mesmas variáveis de toggleListen) ----------
  function copilotoEscutando() {
    return typeof listening !== "undefined" && listening;
  }
  function entrarEscuta(rotulo) {
    // A captação local cede o lugar: uma fonte de áudio por vez.
    if (typeof dgLive !== "undefined" && (dgLive.active || dgLive.starting)) dgLive.stop();
    if (!copilotoEscutando()) {
      listening = true;
      aiPaused = false;
      setOrbState("listening");
      setListenBtnState("listening");
      var ph = document.getElementById("orb-center-placeholder");
      if (ph) {
        ph.style.transition = "opacity .4s";
        ph.style.opacity = "0.35";
        ph.style.pointerEvents = "none";
      }
      if (typeof startCopilotoLoop === "function") startCopilotoLoop();
      if (typeof startCopVoiceScanner === "function") startCopVoiceScanner();
    }
    var td = document.getElementById("tdot");
    if (td) td.classList.add("live");
    var lbl = document.getElementById("trans-lbl");
    if (lbl) {
      lbl.textContent = rotulo;
      lbl.className = "trans-lbl live-lbl";
    }
  }
  function sairEscuta(rotulo) {
    if (copilotoEscutando()) {
      listening = false;
      aiPaused = true;
      if (typeof transcriptInterval !== "undefined") clearInterval(transcriptInterval);
      setOrbState("paused");
      setListenBtnState("paused");
      if (typeof stopCopilotoLoop === "function") stopCopilotoLoop();
      if (typeof stopCopVoiceScanner === "function") stopCopVoiceScanner();
    }
    var td = document.getElementById("tdot");
    if (td) td.classList.remove("live");
    var lbl = document.getElementById("trans-lbl");
    if (lbl) {
      lbl.textContent = rotulo;
      lbl.className = "trans-lbl";
    }
    if (typeof dgLive !== "undefined") dgLive.removeInterim();
  }

  // ---------- transcrição recebida ----------
  function receberTrecho(row) {
    if (!row || row.sessao_id !== S.id || row.id <= S.ultimoTrecho) return;
    S.ultimoTrecho = row.id;
    if (typeof dgLive !== "undefined") dgLive.removeInterim();
    S.parcial = "";
    addTranscriptLine(row.texto);
    S.linhas.push(row.texto);
    if (S.linhas.length > 60) S.linhas.shift();
    desenharAoVivo();
  }
  async function buscarTrechosPerdidos() {
    var sb = db();
    if (!sb || !S.id) return;
    var r = await sb
      .from("captacao_movel_trechos")
      .select("id,sessao_id,texto")
      .eq("sessao_id", S.id)
      .gt("id", S.ultimoTrecho)
      .order("id")
      .limit(200);
    (r.data || []).forEach(receberTrecho);
  }

  function aplicarSessao(row) {
    if (!row || row.id !== S.id) return;
    var antes = S.status;
    S.status = row.status;
    S.encerradoPor = row.encerrado_por;
    S.expiraEm = row.expira_em ? Date.parse(row.expira_em) : S.expiraEm;
    S.vistoEm = row.visto_em ? Date.parse(row.visto_em) : S.vistoEm;
    S.nivel = row.nivel || 0;
    S.confianca = row.confianca == null ? null : row.confianca;
    S.parcial = row.parcial || "";

    if (row.status === "conectado" && antes !== "conectado") {
      if (!S.jaConectou) {
        S.jaConectou = true;
        addTranscriptLine("[ Captação pelo smartphone iniciada ]");
        S.minimizado = true;
      }
      entrarEscuta("Transcrevendo pelo smartphone...");
    } else if (row.status === "pausado" && antes !== "pausado") {
      sairEscuta("Pausado — smartphone em espera");
    } else if (row.status === "encerrado" && antes !== "encerrado") {
      finalizarLocal();
      return;
    }
    if (row.status === "conectado" && S.parcial && typeof dgLive !== "undefined")
      dgLive.showInterim(S.parcial);
    desenhar();
  }

  function finalizarLocal() {
    var motivo =
      S.encerradoPor === "smartphone"
        ? "Encerrada pelo smartphone"
        : S.encerradoPor === "expirado"
          ? "Chamada expirada"
          : "Encerrada no computador";
    if (S.jaConectou) {
      buscarTrechosPerdidos().catch(function () {});
      addTranscriptLine("[ Captação pelo smartphone encerrada — " + motivo.toLowerCase() + " ]");
      sairEscuta("Pausado — " + motivo.toLowerCase());
      if (S.encerradoPor === "smartphone") toast("O smartphone encerrou a captação.", "info");
    }
    pararCanal();
    S.minimizado = false;
    desenhar();
  }

  // ---------- realtime + polling de segurança ----------
  function assinar() {
    var sb = db();
    if (!sb || !sb.channel || !S.id) return;
    pararCanal();
    S.canal = sb
      .channel("captacao-movel-" + S.id)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "captacao_movel_sessoes",
          filter: "id=eq." + S.id,
        },
        function (p) {
          aplicarSessao(p.new);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "captacao_movel_trechos",
          filter: "sessao_id=eq." + S.id,
        },
        function (p) {
          receberTrecho(p.new);
        },
      )
      .subscribe(function (st) {
        if (st === "SUBSCRIBED") buscarTrechosPerdidos().catch(function () {});
      });
    // Se o realtime cair, o polling ainda traz estado e falas.
    S.poll = setInterval(function () {
      if (!S.id) return;
      sb.from("captacao_movel_sessoes")
        .select("id,status,encerrado_por,expira_em,visto_em,nivel,confianca,parcial")
        .eq("id", S.id)
        .maybeSingle()
        .then(function (r) {
          if (r.data) aplicarSessao(r.data);
        });
      buscarTrechosPerdidos().catch(function () {});
    }, 4000);
    S.relogio = setInterval(desenhar, 1000);
  }
  function pararCanal() {
    var sb = db();
    if (S.canal && sb) sb.removeChannel(S.canal);
    S.canal = null;
    clearInterval(S.poll);
    clearInterval(S.relogio);
    S.poll = null;
    S.relogio = null;
  }

  // ---------- painel ----------
  function painel() {
    var el = document.getElementById("cm-painel");
    if (!el) {
      el = document.createElement("div");
      el.id = "cm-painel";
      el.className = "cm-painel";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-label", "Gravar pelo smartphone");
      document.body.appendChild(el);
      el.addEventListener("click", function (e) {
        var b = e.target.closest("[data-cm]");
        if (!b) return;
        var a = b.getAttribute("data-cm");
        if (a === "fechar") fechar();
        else if (a === "min") {
          S.minimizado = !S.minimizado;
          desenhar();
        } else if (a === "encerrar") encerrar();
        else if (a === "pausa") alternarPausa();
        else if (a === "novo") novaChamada();
      });
    }
    return el;
  }
  function medidorTransBar() {
    var top = document.querySelector("#trans-bar .trans-bar-top");
    if (!top) return null;
    var el = document.getElementById("trans-nivel");
    if (!el) {
      el = document.createElement("span");
      el.id = "trans-nivel";
      el.className = "cm-medidor-mini";
      el.title = "Qualidade do áudio do smartphone — clique para abrir";
      el.innerHTML =
        '<i class="ti ti-device-mobile"></i><span class="cm-barra"><span class="cm-barra-fill"></span></span>';
      el.addEventListener("click", function () {
        S.minimizado = false;
        desenhar();
      });
      var ref = document.getElementById("trans-exp-btn");
      top.insertBefore(el, ref || null);
    }
    return el;
  }

  function desenharMedidores() {
    var ativo = S.status === "conectado" && !semSinal();
    var q = semSinal()
      ? { rotulo: "Sem sinal do smartphone", cls: "baixo" }
      : qualidade(S.nivel, ativo);
    var vivo = S.status === "conectado" || S.status === "pausado";
    var btn = document.getElementById("movel-btn");
    if (btn) btn.classList.toggle("live", vivo);
    var mini = medidorTransBar();
    if (mini) {
      mini.style.display = vivo ? "inline-flex" : "none";
      mini.className = "cm-medidor-mini " + q.cls;
      mini.querySelector(".cm-barra-fill").style.width = (ativo ? S.nivel : 0) + "%";
      mini.title = "Smartphone — qualidade: " + q.rotulo + " (clique para abrir)";
    }
    var fill = document.querySelector("#cm-painel .cm-barra-fill");
    if (fill) {
      fill.style.width = (ativo ? S.nivel : 0) + "%";
      var med = document.querySelector("#cm-painel .cm-medidor");
      med.className = "cm-medidor " + q.cls;
      var rot = document.querySelector("#cm-painel .cm-qualidade");
      rot.textContent =
        q.rotulo + (S.confianca != null && ativo ? " · precisão " + S.confianca + "%" : "");
    }
  }

  function desenharAoVivo() {
    var box = document.querySelector("#cm-painel .cm-texto");
    if (!box) return;
    var html = S.linhas
      .slice(-12)
      .map(function (t) {
        return "<p>" + esc(t) + "</p>";
      })
      .join("");
    if (S.parcial && S.status === "conectado")
      html += '<p class="cm-parcial">' + esc(S.parcial) + "</p>";
    box.innerHTML = html || '<p class="cm-vazio">A fala transcrita no smartphone aparece aqui.</p>';
    box.scrollTop = box.scrollHeight;
  }

  function desenhar() {
    if (!S.id && !S.criando) return;
    var el = painel();
    el.style.display = "flex";
    el.classList.toggle("min", !!S.minimizado);
    var st = S.status;
    var corpo = "";
    var titulo = "Gravar pelo smartphone";

    if (S.criando) {
      corpo =
        '<div class="cm-centro"><i class="ti ti-loader-2 cm-gira"></i><p>Gerando QR code…</p></div>';
    } else if (st === "aguardando") {
      var resta = Math.max(0, Math.round(((S.expiraEm || 0) - Date.now()) / 1000));
      if (resta === 0) {
        corpo =
          '<div class="cm-centro"><i class="ti ti-clock-off"></i><p>O QR code expirou sem ser lido.</p>' +
          '<button class="btn sm primary" data-cm="novo"><i class="ti ti-refresh"></i> Gerar novo QR</button></div>';
      } else {
        corpo =
          '<div class="cm-qr" id="cm-qr"></div>' +
          '<p class="cm-ajuda">Aponte a câmera do celular para o QR code. A captação começa sozinha no smartphone.</p>' +
          '<p class="cm-expira">Expira em ' +
          Math.floor(resta / 60) +
          ":" +
          String(resta % 60).padStart(2, "0") +
          "</p>" +
          '<div class="cm-acoes"><button class="btn sm" data-cm="encerrar">Cancelar</button></div>';
      }
    } else if (st === "conectado" || st === "pausado") {
      titulo = st === "pausado" ? "Smartphone — pausado" : "Smartphone conectado";
      corpo =
        '<div class="cm-medidor"><div class="cm-medidor-top"><span>Qualidade do áudio</span><span class="cm-qualidade"></span></div>' +
        '<span class="cm-barra"><span class="cm-barra-fill"></span></span></div>' +
        '<div class="cm-texto" aria-live="polite"></div>' +
        '<div class="cm-acoes">' +
        '<button class="btn sm" data-cm="pausa">' +
        (st === "pausado"
          ? '<i class="ti ti-player-play"></i> Retomar'
          : '<i class="ti ti-player-pause"></i> Pausar') +
        "</button>" +
        '<button class="btn sm cm-perigo" data-cm="encerrar"><i class="ti ti-phone-off"></i> Encerrar</button></div>';
    } else if (st === "encerrado") {
      titulo = "Captação encerrada";
      var m =
        S.encerradoPor === "smartphone"
          ? "O smartphone encerrou a chamada."
          : S.encerradoPor === "expirado"
            ? "A chamada expirou."
            : "A chamada foi encerrada.";
      corpo =
        '<div class="cm-centro"><i class="ti ti-phone-off"></i><p>' +
        m +
        "</p>" +
        '<p class="cm-ajuda">A transcrição recebida continua no atendimento.</p></div>' +
        '<div class="cm-acoes"><button class="btn sm" data-cm="fechar">Fechar</button>' +
        '<button class="btn sm primary" data-cm="novo"><i class="ti ti-qrcode"></i> Gerar novo QR</button></div>';
    }

    // Só refaz o corpo quando o "tipo" de tela muda: o QR e o texto não piscam a cada segundo.
    var chave =
      (S.criando ? "c" : st) +
      "|" +
      (S.minimizado ? 1 : 0) +
      "|" +
      (st === "aguardando" ? ((S.expiraEm || 0) <= Date.now() ? "x" : "q") : "");
    if (el.getAttribute("data-chave") !== chave) {
      el.setAttribute("data-chave", chave);
      el.innerHTML =
        '<div class="cm-hd"><span class="cm-titulo"><i class="ti ti-device-mobile"></i> ' +
        esc(titulo) +
        "</span>" +
        '<span class="cm-hd-acoes">' +
        (st === "conectado" || st === "pausado"
          ? '<button class="mclose" data-cm="min" title="' +
            (S.minimizado ? "Expandir" : "Minimizar") +
            '"><i class="ti ti-' +
            (S.minimizado ? "chevron-up" : "minus") +
            '"></i></button>'
          : "") +
        (st === "conectado" || st === "pausado"
          ? ""
          : '<button class="mclose" data-cm="fechar" title="Fechar"><i class="ti ti-x"></i></button>') +
        "</span></div>" +
        '<div class="cm-corpo">' +
        corpo +
        "</div>";
      if (st === "aguardando" && S.url) desenharQr();
    } else if (st === "aguardando") {
      var ex = el.querySelector(".cm-expira");
      var r2 = Math.max(0, Math.round(((S.expiraEm || 0) - Date.now()) / 1000));
      if (ex)
        ex.textContent =
          "Expira em " + Math.floor(r2 / 60) + ":" + String(r2 % 60).padStart(2, "0");
    }
    desenharMedidores();
    desenharAoVivo();
  }

  function desenharQr() {
    carregarQr()
      .then(function (qrcode) {
        var alvo = document.getElementById("cm-qr");
        if (!alvo || !S.url) return;
        var qr = qrcode(0, "M");
        qr.addData(S.url);
        qr.make();
        alvo.innerHTML =
          '<img alt="QR code para conectar o smartphone" src="' + qr.createDataURL(6, 2) + '" />';
      })
      .catch(function () {
        var alvo = document.getElementById("cm-qr");
        if (alvo)
          alvo.innerHTML =
            '<p class="cm-ajuda">Não foi possível gerar o QR code. Verifique a conexão.</p>';
      });
  }

  // ---------- ações ----------
  function podeGravar() {
    var cfg =
      typeof getCopilotoCfg === "function" ? getCopilotoCfg() : { enabled: true, voz: true };
    if (!cfg.enabled) {
      toast("Ative o copiloto em Minhas IA's › Copiloto de consulta para iniciar a gravação.");
      return false;
    }
    if (!cfg.voz) {
      toast("A captura de voz está desativada nas configurações do copiloto.");
      return false;
    }
    if (!window.isSecureContext) {
      toast("A captação pelo smartphone precisa do site em HTTPS.");
      return false;
    }
    return true;
  }

  async function novaChamada() {
    if (S.criando) return;
    if (!podeGravar()) return;
    if (S.id && (S.status === "aguardando" || S.status === "conectado" || S.status === "pausado")) {
      S.minimizado = false;
      desenhar();
      return;
    }
    pararCanal();
    Object.assign(S, {
      id: null,
      url: null,
      status: null,
      encerradoPor: null,
      ultimoTrecho: 0,
      vistoEm: 0,
      nivel: 0,
      confianca: null,
      parcial: "",
      linhas: [],
      jaConectou: false,
      minimizado: false,
      criando: true,
    });
    desenhar();
    try {
      var r = await api({ acao: "criar" });
      S.id = r.id;
      S.url = r.url;
      S.status = "aguardando";
      S.expiraEm = Date.parse(r.expira_em);
      S.criando = false;
      assinar();
      desenhar();
    } catch (e) {
      S.criando = false;
      fechar();
      toast("Não foi possível abrir a captação pelo smartphone: " + e.message, "error");
    }
  }

  async function encerrar(silencioso) {
    if (!S.id || S.status === "encerrado") {
      if (!silencioso) fechar();
      return;
    }
    if (
      !silencioso &&
      S.status !== "aguardando" &&
      !window.confirm("Encerrar a captação pelo smartphone?")
    )
      return;
    var id = S.id;
    S.encerradoPor = "computador";
    try {
      await api({ acao: "encerrar", id: id });
    } catch (e) {
      if (!silencioso) toast("Falha ao encerrar: " + e.message, "error");
    }
    if (S.id !== id) return;
    var eraAguardando = S.status === "aguardando";
    aplicarSessao({ id: id, status: "encerrado", encerrado_por: "computador" });
    if (eraAguardando || silencioso) fechar();
  }

  async function alternarPausa() {
    if (!S.id) return;
    var acao = S.status === "pausado" ? "retomar" : "pausar";
    if (acao === "retomar" && !podeGravar()) return;
    try {
      var r = await api({ acao: acao, id: S.id });
      aplicarSessao({
        id: S.id,
        status: r.status,
        encerrado_por: S.encerradoPor,
        nivel: 0,
        confianca: S.confianca,
        parcial: "",
        visto_em: S.vistoEm ? new Date(S.vistoEm).toISOString() : null,
      });
      addTranscriptLine(acao === "pausar" ? "[ Gravação pausada ]" : "[ Gravação retomada ]");
    } catch (e) {
      toast("Falha ao " + acao + ": " + e.message, "error");
    }
  }

  function fechar() {
    if (S.status === "aguardando") {
      // Fechar o QR sem leitura cancela a chamada.
      encerrar(true);
      return;
    }
    if (S.status === "conectado" || S.status === "pausado") {
      S.minimizado = true;
      desenhar();
      return;
    }
    pararCanal();
    var el = document.getElementById("cm-painel");
    if (el) el.style.display = "none";
    var mini = document.getElementById("trans-nivel");
    if (mini) mini.style.display = "none";
    S.id = null;
    S.status = null;
  }

  // Fechar ou recarregar a aba encerra a chamada, para o celular não seguir captando sozinho.
  window.addEventListener("pagehide", function () {
    if (!S.id || !S.tk || S.status === "encerrado") return;
    try {
      fetch("/api/captacao-movel", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + S.tk },
        body: JSON.stringify({ acao: "encerrar", id: S.id }),
      });
    } catch (e) {
      /* melhor esforço */
    }
  });

  window.captacaoMovel = {
    abrir: novaChamada,
    encerrar: encerrar,
    alternarPausa: alternarPausa,
    /** A captação do copiloto está vindo do smartphone (conectado ou pausado). */
    ativo: function () {
      return !!S.id && (S.status === "conectado" || S.status === "pausado");
    },
  };
})();
