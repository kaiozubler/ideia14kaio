// CONVERSAS — atendimento CLÍNICA ↔ PACIENTE pelo WhatsApp da própria clínica.
//
// Lê as conversas/mensagens direto do Supabase (RLS de dono) e envia tudo
// pela rota /api/comunicacao/enviar, que fala com a Cloud API da Meta usando
// as credenciais de Configurações > Meu WhatsApp. Não tem relação
// com o WhatsApp do assistente do app (número único do MediCopilot).
//
// Regras da Meta refletidas na tela:
//  - dentro de 24h desde a última mensagem do paciente: texto livre, PDF, fotos;
//  - fora da janela (ou para iniciar conversa): só modelo aprovado — o
//    composer trava e oferece os modelos.
//
// Atualiza por polling (a cada POLL_MS) enquanto a tela está aberta;
// goScreen chama pararConversas() ao sair.
//
// Define os handlers globais usados pelo markup de #s-conversas em
// medicopilot.html (initConversas, renderConversas, cvSend, cvToggleModelos...).
(function () {
  var POLL_MS = 7000;
  var LIMITE_MSGS = 300;
  var MAX_ARQUIVO = 15 * 1024 * 1024;

  var CV = {
    conversas: [],
    sel: null,
    aba: "abertas",
    mensagens: {},
    assinaturaMsgs: "",
    conexao: null,
    modelos: [],
    timer: null,
    userId: null,
    userNome: "",
    agendas: {},
    docs: {},
  };

  function W() {
    return window.CPWhatsApp || {};
  }
  function sb() {
    return window.sb || window.__sb;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(m, t) {
    if (typeof window.showToast === "function") window.showToast(m, t);
  }
  function api(path, body, metodo) {
    return W().api(path, body, metodo);
  }

  function fmtTelefone(t) {
    var d = String(t || "").replace(/\D/g, "");
    if (d.length === 13 && d.indexOf("55") === 0) return "+55 (" + d.slice(2, 4) + ") " + d.slice(4, 9) + "-" + d.slice(9);
    if (d.length === 12 && d.indexOf("55") === 0) return "+55 (" + d.slice(2, 4) + ") " + d.slice(4, 8) + "-" + d.slice(8);
    return d ? "+" + d : "—";
  }
  function iniciais(nome) {
    var p = String(nome || "?").trim().split(/\s+/);
    return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }
  function nomeConversa(c) {
    return (c.pacientes && c.pacientes.name) || c.nome_contato || fmtTelefone(c.telefone);
  }
  function hora(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    var hoje = new Date();
    if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    var ontem = new Date(hoje.getTime() - 864e5);
    if (d.toDateString() === ontem.toDateString()) return "Ontem";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }
  function horasRestantes(c) {
    if (!c || !c.ultima_entrada_em) return 0;
    return Math.max(0, 24 - (Date.now() - new Date(c.ultima_entrada_em).getTime()) / 36e5);
  }
  function janelaAberta(c) {
    return horasRestantes(c) > 0;
  }
  function conectado() {
    return CV.conexao && CV.conexao.status === "conectado";
  }
  function atual() {
    return CV.conversas.find(function (c) { return c.id === CV.sel; }) || null;
  }
  function idade(nasc) {
    if (!nasc) return "";
    var d = new Date(nasc);
    if (isNaN(d)) return "";
    var a = new Date().getFullYear() - d.getFullYear();
    var m = new Date().getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && new Date().getDate() < d.getDate())) a--;
    return a + " anos";
  }

  // ---------------------------------------------------------------------------
  // carga
  // ---------------------------------------------------------------------------

  async function carregarBase() {
    var s = await sb().auth.getSession();
    var sess = s.data && s.data.session;
    if (!sess) return;
    CV.userId = sess.user.id;
    var md = sess.user.user_metadata || {};
    CV.userNome = md.full_name || md.name || sess.user.email || "Eu";
    try {
      CV.conexao = await api("/api/comunicacao/conexao", null, "GET");
    } catch (e) {
      CV.conexao = null;
    }
    var r = await sb().from("comunicacao_whatsapp_modelos").select("*").eq("id_medico", CV.userId).eq("status", "APPROVED").order("nome");
    CV.modelos = r.data || [];
  }

  async function carregarConversas() {
    if (!CV.userId) return;
    var r = await sb()
      .from("comunicacao_whatsapp_conversas")
      .select("*, pacientes(paciente_id,name,cpf,telefone,email,data_nascimento)")
      .eq("id_medico", CV.userId)
      .order("ultima_mensagem_em", { ascending: false, nullsFirst: false })
      .limit(300);
    if (r.error) {
      console.error("[conversas] falha ao listar:", r.error.message);
      return;
    }
    CV.conversas = r.data || [];
  }

  async function carregarMensagens(id) {
    var r = await sb()
      .from("comunicacao_whatsapp_mensagens")
      .select("*")
      .eq("conversa_id", id)
      .order("criada_em", { ascending: false })
      .limit(LIMITE_MSGS);
    if (r.error) return;
    CV.mensagens[id] = (r.data || []).reverse();
  }

  async function carregarLateral(c) {
    if (!c || !c.paciente_id) return;
    var desde = new Date(Date.now() - 30 * 864e5).toISOString();
    var res = await Promise.all([
      sb().from("agendamentos").select("id,data_hora,status,modalidade,motivo,tipo").eq("paciente_id", c.paciente_id).gte("data_hora", desde).order("data_hora", { ascending: true }).limit(6),
      sb().from("documentos_paciente").select("id,tipo,created_at,status,arquivo_path,arquivo_nome").eq("paciente_id", c.paciente_id).order("created_at", { ascending: false }).limit(6),
    ]);
    CV.agendas[c.paciente_id] = res[0].data || [];
    CV.docs[c.paciente_id] = res[1].data || [];
  }

  async function ciclo() {
    await carregarConversas();
    renderConversas();
    if (CV.sel) {
      await carregarMensagens(CV.sel);
      renderCvChat();
    }
  }

  function iniciarPolling() {
    pararConversas();
    CV.timer = setInterval(function () {
      var tela = document.getElementById("s-conversas");
      if (!tela || tela.style.display === "none" || document.hidden) return;
      ciclo();
    }, POLL_MS);
  }

  function pararConversas() {
    if (CV.timer) clearInterval(CV.timer);
    CV.timer = null;
  }

  var _docClickLigado = false;
  async function initConversas() {
    if (!_docClickLigado) {
      document.addEventListener("click", cvDocClick);
      _docClickLigado = true;
    }
    renderCvChat();
    await carregarBase();
    await carregarConversas();
    if (!CV.sel) {
      var primeira = listaFiltrada()[0];
      if (primeira) CV.sel = primeira.id;
    }
    renderConversas();
    if (CV.sel) await selecionar(CV.sel);
    else renderCvChat();
    iniciarPolling();
  }

  // ---------------------------------------------------------------------------
  // lista
  // ---------------------------------------------------------------------------

  function listaFiltrada() {
    var q = ((document.getElementById("cv-search") || {}).value || "").toLowerCase().trim();
    var qd = q.replace(/\D/g, "");
    return CV.conversas.filter(function (c) {
      if (CV.aba === "finalizadas" ? c.status !== "finalizada" : c.status === "finalizada") return false;
      if (CV.aba === "nao_lidas" && !(c.nao_lidas > 0)) return false;
      if (!q) return true;
      return nomeConversa(c).toLowerCase().indexOf(q) >= 0 || (qd && String(c.telefone).indexOf(qd) >= 0);
    });
  }

  function renderConversas() {
    var el = document.getElementById("cv-list");
    if (!el) return;
    var list = listaFiltrada();
    if (!list.length) {
      el.innerHTML =
        '<div style="padding:24px 16px;text-align:center;font-size:12px;color:#9ca3af">' +
        (CV.conversas.length ? "Nenhuma conversa neste filtro." : conectado() ? "Nenhuma conversa ainda. Use o + para chamar um paciente." : "Conecte o WhatsApp da clínica para começar.") +
        "</div>";
    } else {
      el.innerHTML = list.map(function (c) {
        var nome = nomeConversa(c);
        return (
          '<div class="cv-item ' + (c.id === CV.sel ? "active" : "") + '" onclick="cvSelect(\'' + c.id + "')\">" +
          '<div class="cv-avatar">' + esc(iniciais(nome)) + "</div>" +
          '<div class="cv-item-body"><div class="cv-item-top"><span class="cv-name">' + esc(nome) + "</span>" +
          (c.nao_lidas > 0 ? '<span class="cv-badge">' + c.nao_lidas + "</span>" : "") + "</div>" +
          '<div class="cv-last">' + esc(c.ultima_mensagem || "") + "</div>" +
          '<div class="cv-meta"><span>' + hora(c.ultima_mensagem_em) + "</span><span>" +
          (janelaAberta(c) ? '<i class="ti ti-message-circle" style="color:#16a34a" title="Janela de 24h aberta"></i> ' : "") +
          esc(c.responsavel || "") + "</span></div></div></div>"
        );
      }).join("");
    }
    var foot = document.getElementById("cv-foot");
    if (foot) foot.textContent = list.length + " conversa" + (list.length === 1 ? "" : "s");
    var tabs = document.querySelectorAll("#cv-tabs button");
    Array.prototype.forEach.call(tabs, function (b) { b.classList.toggle("active", b.getAttribute("data-aba") === CV.aba); });
  }

  function cvTab(aba) {
    CV.aba = aba;
    renderConversas();
  }

  async function selecionar(id) {
    CV.sel = id;
    CV.assinaturaMsgs = "";
    var c = atual();
    renderConversas();
    renderCvChat();
    await carregarMensagens(id);
    renderCvChat();
    if (c && c.nao_lidas > 0) {
      c.nao_lidas = 0;
      renderConversas();
      sb().from("comunicacao_whatsapp_conversas").update({ nao_lidas: 0 }).eq("id", id).then(function () {});
    }
    if (c) {
      await carregarLateral(c);
      renderLateral();
    }
  }

  // ---------------------------------------------------------------------------
  // chat
  // ---------------------------------------------------------------------------

  var ICONE_STATUS = {
    enviando: '<i class="ti ti-clock" title="Enviando"></i>',
    enviada: '<i class="ti ti-check" title="Enviada"></i>',
    entregue: '<i class="ti ti-checks" title="Entregue"></i>',
    lida: '<i class="ti ti-checks" style="color:#38bdf8" title="Lida"></i>',
    falhou: '<i class="ti ti-alert-circle" style="color:#ef4444"></i>',
  };

  function htmlMensagem(m) {
    var me = m.direcao === "saida";
    var texto = W().formatarWa ? W().formatarWa(esc(m.conteudo || "")) : esc(m.conteudo || "");
    var midia = "";
    if (m.midia && m.midia.id) {
      var rot = { image: "Ver foto", video: "Ver vídeo", audio: "Ouvir áudio", document: "Abrir arquivo", sticker: "Ver figurinha", template: "Abrir anexo" }[m.tipo] || "Abrir anexo";
      midia = '<button onclick="cvAbrirMidia(\'' + m.id + '\')" style="display:flex;align-items:center;gap:6px;margin-bottom:5px;padding:6px 10px;border-radius:8px;border:none;cursor:pointer;font-size:11.5px;font-weight:600;background:' +
        (me ? "#f3f4f6;color:#111827" : "rgba(255,255,255,.25);color:#fff") + '"><i class="ti ti-paperclip"></i>' + esc(m.midia.filename || rot) + "</button>";
    }
    var selo = m.tipo === "template" ? '<div style="font-size:10px;font-weight:700;opacity:.65;margin-bottom:3px"><i class="ti ti-template"></i> Modelo</div>' : "";
    var erro = m.status === "falhou" && m.erro ? '<div style="font-size:10.5px;color:#dc2626;margin-top:4px">Falhou: ' + esc(m.erro) + "</div>" : "";
    var h = new Date(m.criada_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return (
      '<div class="cv-msg ' + (me ? "me" : "them") + '"><div class="cv-bub">' + selo + midia +
      '<div style="white-space:pre-wrap;word-wrap:break-word">' + texto + "</div>" + erro +
      '<div class="time">' + h + (me ? " " + (ICONE_STATUS[m.status] || "") : "") + "</div></div></div>"
    );
  }

  function rotuloDia(d) {
    var hoje = new Date();
    if (d.toDateString() === hoje.toDateString()) return "Hoje";
    if (d.toDateString() === new Date(hoje.getTime() - 864e5).toDateString()) return "Ontem";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  }

  function renderCvChat() {
    var box = document.getElementById("cv-msgs");
    if (!box) return;
    var c = atual();
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
    var input = document.getElementById("cv-input");
    var dot = document.getElementById("cv-pdot");

    if (!c) {
      set("cv-pname", conectado() ? "Selecione uma conversa" : "Conversas");
      set("cv-phora", "—");
      set("cv-ptel", "");
      set("cv-ponline", "");
      if (dot) dot.style.display = "none";
      box.innerHTML =
        '<div style="margin:auto;text-align:center;color:#6b7280;font-size:12.5px;max-width:360px;line-height:1.6">' +
        '<i class="ti ti-brand-whatsapp" style="font-size:40px;color:#22c55e"></i><br>' +
        (CV.conexao && CV.conexao.configurado && conectado()
          ? "Selecione uma conversa à esquerda ou clique em <b>+</b> para chamar um paciente com um modelo aprovado."
          : "Conecte o WhatsApp Business da clínica (API oficial da Meta) para conversar com os pacientes, avisar sobre consultas e enviar receitas.<br><br>" +
            '<button class="cv-assume" onclick="goScreen(\'whatsapp-pacientes\')">Configurar Meu WhatsApp</button>') +
        "</div>";
      renderJanela(null);
      if (input) input.disabled = true;
      return;
    }

    var nome = nomeConversa(c);
    set("cv-pname", nome);
    set("cv-phora", hora(c.ultima_mensagem_em) || "—");
    set("cv-ptel", fmtTelefone(c.telefone));
    var horas = horasRestantes(c);
    if (dot) {
      dot.style.display = "inline-block";
      dot.style.background = horas > 0 ? "#22c55e" : "#f59e0b";
    }
    var on = document.getElementById("cv-ponline");
    if (on) {
      on.textContent = horas > 0 ? "Janela aberta · " + (horas >= 1 ? Math.floor(horas) + "h restantes" : "menos de 1h") : "Fora da janela de 24h";
      on.style.color = horas > 0 ? "#16a34a" : "#b45309";
    }

    var msgs = CV.mensagens[c.id] || [];
    var assinatura = c.id + ":" + msgs.length + ":" + msgs.map(function (m) { return m.status; }).join("");
    if (assinatura !== CV.assinaturaMsgs) {
      var noFim = box.scrollHeight - box.scrollTop - box.clientHeight < 80 || !CV.assinaturaMsgs;
      CV.assinaturaMsgs = assinatura;
      var html = "";
      var dia = "";
      msgs.forEach(function (m) {
        var d = new Date(m.criada_em);
        var r = rotuloDia(d);
        if (r !== dia) { dia = r; html += '<div class="cv-day">' + r + "</div>"; }
        html += htmlMensagem(m);
      });
      box.innerHTML = html || '<div class="cv-day">Nenhuma mensagem ainda</div>';
      if (noFim) box.scrollTop = box.scrollHeight;
    }
    renderJanela(c);
    renderLateralTopo(c);
  }

  function renderJanela(c) {
    var el = document.getElementById("cv-janela");
    var input = document.getElementById("cv-input");
    if (!el) return;
    var msg = "";
    var bloqueia = false;
    if (!conectado()) {
      msg = '<i class="ti ti-plug-x"></i> WhatsApp da clínica não conectado. <a href="#" onclick="goScreen(\'whatsapp-pacientes\');return false">Configurar</a>';
      bloqueia = true;
    } else if (c && !janelaAberta(c)) {
      msg = '<i class="ti ti-clock-exclamation"></i> Mais de 24h sem mensagem do paciente: a Meta só permite <b>modelo aprovado</b> para retomar a conversa. ' +
        '<a href="#" onclick="cvToggleModelos(event);return false">Escolher modelo</a>';
      bloqueia = true;
    }
    el.innerHTML = msg;
    el.style.cssText = msg
      ? "display:block;padding:8px 18px;font-size:11.5px;background:#fffbeb;color:#92400e;border-top:1px solid #fde68a"
      : "display:none";
    if (input) {
      input.disabled = !c || bloqueia;
      input.placeholder = !c ? "Selecione uma conversa" : bloqueia ? "Envie um modelo para reabrir a conversa" : "Digite sua mensagem...";
    }
  }

  // ---------------------------------------------------------------------------
  // coluna direita
  // ---------------------------------------------------------------------------

  function renderLateralTopo(c) {
    var p = (c && c.pacientes) || {};
    var nome = nomeConversa(c);
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v; };
    set("cv-rav", iniciais(nome));
    set("cv-rnome", nome);
    set("cv-ridade", idade(p.data_nascimento));
    set("cv-rcpf", p.cpf || "—");
    set("cv-rtel", fmtTelefone(c.telefone));
    set("cv-remail", p.email || "—");
    set("cv-rjanela", c.responsavel ? "Responsável: " + c.responsavel : "");
    var v = document.getElementById("cv-rvinculo");
    if (v) {
      if (!c.paciente_id) {
        v.style.display = "flex";
        v.innerHTML = '<i class="ti ti-link"></i> Contato sem cadastro vinculado. <a href="#" onclick="cvVincular();return false" style="color:#2563eb;font-weight:600">Vincular paciente</a>';
      } else {
        v.style.display = "none";
      }
    }
  }

  var TIPO_DOC = { receita: "Receita", atestado: "Atestado", declaracao: "Declaração", laudo: "Laudo", solicitacao_exame: "Solicitação de exame", encaminhamento: "Encaminhamento" };

  function renderLateral() {
    var c = atual();
    if (!c) return;
    var ag = document.getElementById("cv-r-agenda");
    var dc = document.getElementById("cv-r-docs");
    if (!c.paciente_id) {
      if (ag) ag.textContent = "Vincule o contato a um paciente para ver a agenda.";
      if (dc) dc.textContent = "—";
      return;
    }
    var agendas = CV.agendas[c.paciente_id] || [];
    if (ag) {
      ag.innerHTML = agendas.length
        ? agendas.map(function (a) {
            var d = new Date(a.data_hora);
            var futuro = d.getTime() > Date.now();
            var st = String(a.status || "agendado");
            return (
              '<div class="cv-ag"><div><div style="color:#6b7280">' + d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", weekday: "short" }) + "</div>" +
              '<div style="font-weight:500;color:#111827">' + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + " - " + esc(a.tipo || a.motivo || "Consulta") + "</div></div>" +
              (futuro && st !== "cancelado"
                ? '<button class="cv-btn-out" style="padding:4px 8px;font-size:10.5px;border-radius:6px;cursor:pointer" onclick="cvAvisarConsulta(\'' + a.id + '\')"><i class="ti ti-bell"></i> Avisar</button>'
                : '<span class="pill">' + esc(st) + "</span>") +
              "</div>"
            );
          }).join("")
        : "Nenhuma consulta nos últimos 30 dias ou futura.";
    }
    var docs = CV.docs[c.paciente_id] || [];
    if (dc) {
      dc.innerHTML = docs.length
        ? docs.map(function (d) {
            return (
              '<div class="cv-ag"><div><div style="font-weight:500;color:#111827">' + esc(TIPO_DOC[d.tipo] || d.tipo) + "</div>" +
              '<div style="color:#6b7280">' + new Date(d.created_at).toLocaleDateString("pt-BR") + (d.status === "enviado" ? " · enviado" : "") + "</div></div>" +
              (d.arquivo_path
                ? '<button class="cv-btn-out" style="padding:4px 8px;font-size:10.5px;border-radius:6px;cursor:pointer" onclick="cvEnviarDocumento(\'' + d.id + '\')"><i class="ti ti-send"></i> Enviar</button>'
                : "") +
              "</div>"
            );
          }).join("")
        : "Nenhum documento emitido.";
    }
  }

  // ---------------------------------------------------------------------------
  // envio
  // ---------------------------------------------------------------------------

  async function enviar(body, rotulo) {
    try {
      var r = await api("/api/comunicacao/enviar", body);
      if (r.conversa_id && r.conversa_id !== CV.sel) CV.sel = r.conversa_id;
      await carregarConversas();
      if (CV.aba === "finalizadas") CV.aba = "abertas";
      renderConversas();
      await carregarMensagens(CV.sel);
      CV.assinaturaMsgs = "";
      renderCvChat();
      if (rotulo) toast(rotulo, "success");
      return r;
    } catch (e) {
      toast(e.message || String(e), "error");
      if (CV.sel) {
        await carregarMensagens(CV.sel);
        renderCvChat();
      }
      if (e.codigo === "janela_fechada") cvToggleModelos();
      throw e;
    }
  }

  async function cvSend() {
    var i = document.getElementById("cv-input");
    var t = ((i && i.value) || "").trim();
    var c = atual();
    if (!t || !c) return;
    i.value = "";
    try {
      await enviar({ tipo: "texto", conversa_id: c.id, texto: t });
    } catch (e) {
      if (!i.value) i.value = t;
    }
  }

  function cvAnexar() {
    var c = atual();
    if (!c) return toast("Selecione uma conversa", "error");
    var f = document.getElementById("cv-anexo");
    if (f) f.click();
  }

  async function cvArquivoEscolhido(input) {
    var f = input.files && input.files[0];
    input.value = "";
    var c = atual();
    if (!f || !c) return;
    if (f.size > MAX_ARQUIVO) return toast("Arquivo acima de 15MB", "error");
    if (!janelaAberta(c) && f.type !== "application/pdf") {
      return toast("Fora da janela de 24h só é possível enviar PDF pelo modelo de documentos.", "error");
    }
    var legenda = ((document.getElementById("cv-input") || {}).value || "").trim();
    toast("Enviando " + f.name + "…");
    try {
      await enviar(
        { tipo: "documento", conversa_id: c.id, legenda: legenda || null, arquivo: { base64: await W().arquivoParaBase64(f), mime: f.type || "application/octet-stream", nome: f.name } },
        "Arquivo enviado",
      );
      var i = document.getElementById("cv-input");
      if (i && legenda) i.value = "";
    } catch (e) { /* toast já exibido */ }
  }

  async function cvEnviarDocumento(id) {
    var c = atual();
    if (!c) return;
    if (!confirm("Enviar este documento ao paciente pelo WhatsApp?")) return;
    try {
      await enviar({ tipo: "documento", conversa_id: c.id, documento_id: id }, "Documento enviado");
      await carregarLateral(c);
      renderLateral();
    } catch (e) { /* toast já exibido */ }
  }

  async function cvAbrirMidia(mensagemId) {
    try {
      var s = await sb().auth.getSession();
      var token = s.data && s.data.session && s.data.session.access_token;
      var r = await fetch("/api/comunicacao/midia?mensagem_id=" + encodeURIComponent(mensagemId), { headers: { Authorization: "Bearer " + token } });
      if (!r.ok) throw new Error("Mídia indisponível (a Meta guarda arquivos por tempo limitado).");
      var url = URL.createObjectURL(await r.blob());
      window.open(url, "_blank");
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    } catch (e) {
      toast(e.message, "error");
    }
  }

  // ---------------------------------------------------------------------------
  // modelos (popover + modal de envio)
  // ---------------------------------------------------------------------------

  function renderListaModelos() {
    var el = document.getElementById("cv-modelos-list");
    if (!el) return;
    if (!CV.modelos.length) {
      el.innerHTML =
        '<div style="padding:12px;font-size:11.5px;color:#6b7280;line-height:1.5">Nenhum modelo aprovado ainda. ' +
        '<a href="#" onclick="goScreen(\'whatsapp-pacientes\');return false" style="color:#2563eb;font-weight:600">Criar modelos</a></div>';
      return;
    }
    var F = W().FINALIDADES || {};
    el.innerHTML = CV.modelos.map(function (m) {
      return (
        '<button class="opt" onclick="cvAbrirModelo(\'' + m.id + "')\"><b style=\"font-family:'JetBrains Mono',monospace;font-size:11px\">" + esc(m.nome) + "</b>" +
        '<span style="display:block;font-size:10.5px;color:#9ca3af">' + esc(F[m.finalidade] || "") + "</span>" +
        '<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.corpo) + "</span></button>"
      );
    }).join("");
  }

  function cvToggleModelos(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    var p = document.getElementById("cv-modelos-pop");
    var ip = document.getElementById("cv-ia-pop");
    if (!p) return;
    if (!atual()) return toast("Selecione uma conversa ou use o + para chamar um paciente", "error");
    renderListaModelos();
    p.style.display = p.style.display === "none" ? "block" : "none";
    if (ip) ip.style.display = "none";
  }

  function modalRaiz() {
    var r = document.getElementById("cv-modal-dinamico");
    if (!r) {
      r = document.createElement("div");
      r.id = "cv-modal-dinamico";
      r.className = "cv-modal";
      r.addEventListener("click", function (e) { if (e.target === r) fecharModal(); });
      document.body.appendChild(r);
    }
    return r;
  }
  function fecharModal() {
    var r = document.getElementById("cv-modal-dinamico");
    if (r) { r.classList.remove("open"); r.innerHTML = ""; }
    ENV = null;
  }

  var ENV = null; // envio de modelo em andamento: {modelo, destino, agendamentoId, valores, arquivo}

  function rotuloFonte(id) {
    var f = (W().FONTES || []).find(function (x) { return x.id === id; });
    return f ? f.rotulo : id;
  }

  async function cvAbrirModelo(modeloId, destino, agendamentoId) {
    var m = CV.modelos.find(function (x) { return x.id === modeloId; });
    if (!m) return;
    var p = document.getElementById("cv-modelos-pop");
    if (p) p.style.display = "none";
    var c = atual();
    destino = destino || (c ? { conversa_id: c.id, paciente_id: c.paciente_id } : null);
    if (!destino) return;
    var agendas = [];
    if (destino.paciente_id) {
      var r = await sb().from("agendamentos").select("id,data_hora,status").eq("paciente_id", destino.paciente_id).gte("data_hora", new Date(Date.now() - 864e5).toISOString()).order("data_hora").limit(10);
      agendas = r.data || [];
    }
    if (!agendamentoId && agendas.length && /consulta|agendamento|lembrete/.test(m.finalidade)) agendamentoId = agendas[0].id;
    ENV = { modelo: m, destino: destino, agendamentoId: agendamentoId || null, valores: {}, arquivo: null, agendas: agendas };
    renderModalModelo();
  }

  function variaveisDoModelo(m) {
    var ex = W().extrairVariaveis;
    var lista = [];
    if (m.cabecalho && m.cabecalho.tipo === "TEXT") {
      var hv = ex(m.cabecalho.texto, m.parameter_format)[0];
      if (hv) lista.push({ chave: "header." + hv, rotulo: "Cabeçalho {{" + hv + "}}" });
    }
    ex(m.corpo, m.parameter_format).forEach(function (v) { lista.push({ chave: v, rotulo: "{{" + v + "}}" }); });
    (m.botoes || []).forEach(function (b, i) {
      if (b.tipo === "URL" && /\{\{1\}\}$/.test(b.url || "")) lista.push({ chave: "botao." + i, rotulo: "Final do link “" + b.texto + "”" });
    });
    return lista;
  }

  function renderModalModelo() {
    if (!ENV) return;
    var m = ENV.modelo;
    var vars = variaveisDoModelo(m);
    var mapa = m.variaveis || {};
    var precisaArquivo = m.cabecalho && ["IMAGE", "VIDEO", "DOCUMENT"].indexOf(m.cabecalho.tipo) >= 0;
    var prev = {};
    vars.forEach(function (v) {
      prev[v.chave] = ENV.valores[v.chave] || (mapa[v.chave] ? "‹" + rotuloFonte(mapa[v.chave]) + "›" : "");
    });
    if (ENV.arquivo) prev.__arquivo = ENV.arquivo.nome;
    var root = modalRaiz();
    root.innerHTML =
      '<div class="cv-modal-box" style="max-width:760px">' +
      '<h3>Enviar modelo <span style="font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#047857">' + esc(m.nome) + "</span>" +
      '<button onclick="cvFecharModal()" style="background:none;border:none;color:#6b7280"><i class="ti ti-x"></i></button></h3>' +
      '<div style="display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:16px">' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
      (ENV.agendas.length
        ? '<div><label style="font-size:11.5px;font-weight:600;color:#374151">Consulta de referência</label>' +
          '<select style="width:100%;padding:7px;border:1px solid #d1d5db;border-radius:6px;font-size:12px" onchange="cvEnvAgenda(this.value)"><option value="">— nenhuma —</option>' +
          ENV.agendas.map(function (a) {
            var d = new Date(a.data_hora);
            return '<option value="' + a.id + '"' + (ENV.agendamentoId === a.id ? " selected" : "") + ">" + d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) + "</option>";
          }).join("") + "</select>" +
          '<small style="font-size:10.5px;color:#9ca3af">Usada para preencher data, hora, modalidade e link da consulta.</small></div>'
        : "") +
      vars.map(function (v) {
        var auto = mapa[v.chave];
        return (
          '<div><label style="font-size:11.5px;font-weight:600;color:#374151">' + esc(v.rotulo) + "</label>" +
          '<input style="width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px" value="' + esc(ENV.valores[v.chave] || "") + '" ' +
          'placeholder="' + esc(auto ? "Automático: " + rotuloFonte(auto) : "Obrigatório") + '" oninput="cvEnvValor(\'' + v.chave + '\',this.value)" /></div>'
        );
      }).join("") +
      (precisaArquivo
        ? '<div><label style="font-size:11.5px;font-weight:600;color:#374151">Arquivo do cabeçalho (' + esc(m.cabecalho.tipo.toLowerCase()) + ') *</label>' +
          '<input type="file" accept="' + (m.cabecalho.tipo === "DOCUMENT" ? "application/pdf" : m.cabecalho.tipo === "IMAGE" ? "image/jpeg,image/png" : "video/mp4") + '" onchange="cvEnvArquivo(this)" style="font-size:12px" />' +
          (ENV.arquivo ? '<small style="font-size:10.5px;color:#16a34a">' + esc(ENV.arquivo.nome) + "</small>" : "") + "</div>"
        : "") +
      (!vars.length && !precisaArquivo ? '<p style="font-size:12px;color:#6b7280">Este modelo não tem variáveis.</p>' : "") +
      "</div>" +
      '<div style="background:#efeae2;border-radius:12px;padding:10px">' + W().bolhaModelo(m, prev) + "</div>" +
      "</div>" +
      '<div class="cv-modal-actions"><button onclick="cvFecharModal()">Cancelar</button><button class="primary" id="cv-env-btn" onclick="cvEnvConfirmar()"><i class="ti ti-send"></i> Enviar</button></div>' +
      "</div>";
    root.classList.add("open");
  }

  function cvEnvValor(chave, valor) {
    if (!ENV) return;
    ENV.valores[chave] = valor;
    var foco = document.activeElement;
    var pos = foco && foco.selectionStart;
    var idx = Array.prototype.indexOf.call(document.querySelectorAll("#cv-modal-dinamico input"), foco);
    renderModalModelo();
    var el = document.querySelectorAll("#cv-modal-dinamico input")[idx];
    if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} }
  }
  function cvEnvAgenda(id) {
    if (ENV) { ENV.agendamentoId = id || null; }
  }
  async function cvEnvArquivo(input) {
    var f = input.files && input.files[0];
    if (!f || !ENV) return;
    if (f.size > MAX_ARQUIVO) return toast("Arquivo acima de 15MB", "error");
    ENV.arquivo = { base64: await W().arquivoParaBase64(f), mime: f.type, nome: f.name };
    renderModalModelo();
  }
  async function cvEnvConfirmar() {
    if (!ENV) return;
    var btn = document.getElementById("cv-env-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Enviando…"; }
    var body = Object.assign({}, ENV.destino.conversa_id ? { conversa_id: ENV.destino.conversa_id } : {}, ENV.destino.paciente_id && !ENV.destino.conversa_id ? { paciente_id: ENV.destino.paciente_id } : {}, ENV.destino.telefone ? { telefone: ENV.destino.telefone } : {}, {
      tipo: "modelo",
      modelo_id: ENV.modelo.id,
      valores: ENV.valores,
      agendamento_id: ENV.agendamentoId,
      arquivo: ENV.arquivo,
    });
    try {
      await enviar(body, "Modelo enviado");
      fecharModal();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="ti ti-send"></i> Enviar'; }
    }
  }

  async function cvAvisarConsulta(agendamentoId) {
    var c = atual();
    if (!c) return;
    var m = CV.modelos.find(function (x) { return x.finalidade === "lembrete_consulta"; }) ||
      CV.modelos.find(function (x) { return x.finalidade === "confirmacao_agendamento"; });
    if (!m) {
      toast("Nenhum modelo aprovado de lembrete/confirmação. Crie em Configurações > Meu WhatsApp.", "error");
      return;
    }
    cvAbrirModelo(m.id, { conversa_id: c.id, paciente_id: c.paciente_id }, agendamentoId);
  }

  // ---------------------------------------------------------------------------
  // nova conversa / vincular paciente
  // ---------------------------------------------------------------------------

  var _buscaTimer = null;
  function modalBuscaPaciente(titulo, aoEscolher, permiteTelefone) {
    var root = modalRaiz();
    root.innerHTML =
      '<div class="cv-modal-box" style="max-width:460px"><h3>' + esc(titulo) +
      '<button onclick="cvFecharModal()" style="background:none;border:none;color:#6b7280"><i class="ti ti-x"></i></button></h3>' +
      '<input id="cv-busca-pac" placeholder="Buscar paciente pelo nome…" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12.5px" />' +
      '<div id="cv-busca-res" style="margin-top:8px;max-height:300px;overflow:auto"></div>' +
      (permiteTelefone
        ? '<div style="border-top:1px solid #e5e7eb;margin-top:10px;padding-top:10px;display:flex;gap:6px"><input id="cv-busca-tel" placeholder="Ou digite o celular com DDD" style="flex:1;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12.5px" />' +
          '<button class="cv-assume" onclick="cvEscolherTelefone()">Usar número</button></div>'
        : "") +
      "</div>";
    root.classList.add("open");
    window.__cvEscolher = aoEscolher;
    var inp = document.getElementById("cv-busca-pac");
    var buscar = async function () {
      var q = inp.value.trim();
      var res = document.getElementById("cv-busca-res");
      if (q.length < 2) { res.innerHTML = '<div style="font-size:11.5px;color:#9ca3af;padding:6px">Digite ao menos 2 letras.</div>'; return; }
      var r = await sb().from("pacientes").select("paciente_id,name,telefone").eq("user_id", CV.userId).ilike("name", "%" + q + "%").order("name").limit(20);
      var lista = r.data || [];
      res.innerHTML = lista.length
        ? lista.map(function (p) {
            return '<button class="cv-equipe-item" ' + (p.telefone ? "" : "disabled style=\"opacity:.5\"") + ' onclick="cvEscolherPaciente(\'' + p.paciente_id + '\')"><b>' + esc(p.name) + "</b><span>" + esc(p.telefone || "sem telefone no cadastro") + "</span></button>";
          }).join("")
        : '<div style="font-size:11.5px;color:#9ca3af;padding:6px">Nenhum paciente encontrado.</div>';
    };
    inp.addEventListener("input", function () { clearTimeout(_buscaTimer); _buscaTimer = setTimeout(buscar, 250); });
    inp.focus();
    buscar();
  }

  function cvNovaConversa() {
    if (!conectado()) {
      toast("Conecte o WhatsApp da clínica primeiro", "error");
      if (typeof window.goScreen === "function") window.goScreen("whatsapp-pacientes");
      return;
    }
    if (!CV.modelos.length) {
      toast("Para iniciar uma conversa é preciso um modelo aprovado pela Meta.", "error");
      return;
    }
    modalBuscaPaciente("Chamar paciente", function (destino) {
      // Conversa já existente com esse paciente: abre ela.
      var existente = destino.paciente_id && CV.conversas.find(function (c) { return c.paciente_id === destino.paciente_id; });
      if (existente) {
        fecharModal();
        CV.aba = existente.status === "finalizada" ? "finalizadas" : "abertas";
        selecionar(existente.id).then(function () {
          if (!janelaAberta(existente)) cvToggleModelos();
        });
        return;
      }
      escolherModeloPara(destino);
    }, true);
  }

  function escolherModeloPara(destino) {
    var root = modalRaiz();
    var F = W().FINALIDADES || {};
    root.innerHTML =
      '<div class="cv-modal-box" style="max-width:460px"><h3>Escolha o modelo de abertura' +
      '<button onclick="cvFecharModal()" style="background:none;border:none;color:#6b7280"><i class="ti ti-x"></i></button></h3>' +
      '<p style="font-size:11.5px;color:#6b7280;margin:-4px 0 10px">A primeira mensagem para o paciente precisa ser um modelo aprovado pela Meta.</p>' +
      CV.modelos.map(function (m) {
        return '<button class="cv-equipe-item" onclick="cvModeloPara(\'' + m.id + '\')"><b>' + esc(m.nome) + "</b><span>" + esc(F[m.finalidade] || "") + " — " + esc(String(m.corpo).slice(0, 90)) + "</span></button>";
      }).join("") +
      "</div>";
    root.classList.add("open");
    window.__cvDestino = destino;
  }

  function cvEscolherPaciente(id) {
    if (typeof window.__cvEscolher === "function") window.__cvEscolher({ paciente_id: id });
  }
  function cvEscolherTelefone() {
    var t = ((document.getElementById("cv-busca-tel") || {}).value || "").replace(/\D/g, "");
    if (t.length < 10) return toast("Informe o celular com DDD", "error");
    if (typeof window.__cvEscolher === "function") window.__cvEscolher({ telefone: t });
  }
  function cvModeloPara(id) {
    var d = window.__cvDestino;
    if (d) cvAbrirModelo(id, d);
  }

  function cvVincular() {
    var c = atual();
    if (!c) return;
    modalBuscaPaciente("Vincular contato a um paciente", async function (destino) {
      if (!destino.paciente_id) return;
      var r = await sb().from("comunicacao_whatsapp_conversas").update({ paciente_id: destino.paciente_id }).eq("id", c.id);
      if (r.error) return toast(r.error.message, "error");
      fecharModal();
      await carregarConversas();
      renderConversas();
      renderCvChat();
      await carregarLateral(atual());
      renderLateral();
      toast("Contato vinculado ao paciente", "success");
    }, false);
  }

  // ---------------------------------------------------------------------------
  // ações do cabeçalho
  // ---------------------------------------------------------------------------

  async function atualizarConversa(campos, msg) {
    var c = atual();
    if (!c) return;
    var r = await sb().from("comunicacao_whatsapp_conversas").update(campos).eq("id", c.id);
    if (r.error) return toast(r.error.message, "error");
    Object.assign(c, campos);
    renderConversas();
    renderCvChat();
    if (msg) toast(msg, "success");
  }

  function cvAssumir() {
    atualizarConversa({ responsavel: CV.userNome, status: "aberta" }, "Você assumiu o atendimento");
  }
  function cvFinalizar() {
    var c = atual();
    if (!c) return;
    if (c.status === "finalizada") return atualizarConversa({ status: "aberta" }, "Conversa reaberta");
    atualizarConversa({ status: "finalizada", nao_lidas: 0 }, "Atendimento finalizado");
  }
  function cvLigar() {
    var c = atual();
    if (c) window.open("tel:+" + c.telefone);
  }
  function cvAbrirCadastro() {
    var c = atual();
    if (!c) return;
    if (!c.paciente_id) return cvVincular();
    if (typeof window.openPatient === "function") window.openPatient(c.paciente_id);
  }
  function cvOpenTransfer() {
    var c = atual();
    if (!c) return;
    var eq = document.getElementById("cv-equipe");
    if (eq) {
      eq.innerHTML =
        '<label style="font-size:11.5px;font-weight:600;color:#374151">Responsável pelo atendimento</label>' +
        '<input id="cv-transfer-nome" value="' + esc(c.responsavel || "") + '" placeholder="Nome de quem vai atender" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12.5px;margin-top:4px" />';
    }
    var m = document.getElementById("cv-modal-transfer");
    if (m) m.classList.add("open");
  }
  function cvCloseTransfer() {
    var m = document.getElementById("cv-modal-transfer");
    if (m) m.classList.remove("open");
  }
  function cvDoTransfer() {
    var nome = ((document.getElementById("cv-transfer-nome") || {}).value || "").trim();
    cvCloseTransfer();
    atualizarConversa({ responsavel: nome || null }, nome ? "Atendimento transferido para " + nome : "Responsável removido");
  }

  // ---------------------------------------------------------------------------
  // popovers e painéis (comportamento original da tela)
  // ---------------------------------------------------------------------------

  function cvDocClick(e) {
    var mp = document.getElementById("cv-modelos-pop");
    var ip = document.getElementById("cv-ia-pop");
    if (mp && mp.style.display !== "none" && !e.target.closest("#cv-modelos-pop") && !e.target.closest(".modelos-btn") && !e.target.closest("#cv-janela")) mp.style.display = "none";
    if (ip && ip.style.display !== "none" && !e.target.closest("#cv-ia-pop") && !e.target.closest(".ia-btn")) ip.style.display = "none";
  }
  function cvToggleIa(e) {
    if (e) e.stopPropagation();
    var p = document.getElementById("cv-ia-pop");
    var m = document.getElementById("cv-modelos-pop");
    p.style.display = p.style.display === "none" ? "flex" : "none";
    if (m) m.style.display = "none";
    var ch = document.getElementById("cv-ia-chev");
    if (ch) ch.style.transform = p.style.display === "none" ? "" : "rotate(180deg)";
  }
  function cvCloseIa() {
    document.getElementById("cv-ia-pop").style.display = "none";
    var ch = document.getElementById("cv-ia-chev");
    if (ch) ch.style.transform = "";
  }
  function cvToggleRight() {
    document.getElementById("cv-col-right").classList.toggle("hidden");
  }
  function cvOpenFiltros() {
    document.getElementById("cv-modal-filtros").classList.add("open");
  }
  function cvCloseFiltros() {
    document.getElementById("cv-modal-filtros").classList.remove("open");
  }
  function cvUseModelo() {
    cvToggleModelos();
  }

  Object.assign(window, {
    initConversas: initConversas,
    pararConversas: pararConversas,
    renderConversas: renderConversas,
    renderCvChat: renderCvChat,
    cvSelect: function (id) { selecionar(id); },
    cvTab: cvTab,
    cvSend: cvSend,
    cvAnexar: cvAnexar,
    cvArquivoEscolhido: cvArquivoEscolhido,
    cvEnviarDocumento: cvEnviarDocumento,
    cvAbrirMidia: cvAbrirMidia,
    cvToggleModelos: cvToggleModelos,
    cvUseModelo: cvUseModelo,
    cvAbrirModelo: cvAbrirModelo,
    cvEnvValor: cvEnvValor,
    cvEnvAgenda: cvEnvAgenda,
    cvEnvArquivo: cvEnvArquivo,
    cvEnvConfirmar: cvEnvConfirmar,
    cvAvisarConsulta: cvAvisarConsulta,
    cvNovaConversa: cvNovaConversa,
    cvEscolherPaciente: cvEscolherPaciente,
    cvEscolherTelefone: cvEscolherTelefone,
    cvModeloPara: cvModeloPara,
    cvVincular: cvVincular,
    cvFecharModal: fecharModal,
    cvAssumir: cvAssumir,
    cvFinalizar: cvFinalizar,
    cvLigar: cvLigar,
    cvAbrirCadastro: cvAbrirCadastro,
    cvOpenTransfer: cvOpenTransfer,
    cvCloseTransfer: cvCloseTransfer,
    cvDoTransfer: cvDoTransfer,
    cvToggleIa: cvToggleIa,
    cvCloseIa: cvCloseIa,
    cvToggleRight: cvToggleRight,
    cvOpenFiltros: cvOpenFiltros,
    cvCloseFiltros: cvCloseFiltros,
  });
})();
