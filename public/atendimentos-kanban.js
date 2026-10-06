/* ============================================================
   ATENDIMENTOS — kanban da tela inicial (fluxo do paciente na clínica)
   Etapas configuráveis em atendimento_etapas; cada card é uma linha de
   atendimento_fluxo (criada no primeiro movimento de uma consulta da agenda
   ou num encaixe). O "tipo" da etapa dá a semântica:
     agendado    consultas da agenda que ainda não chegaram (atraso)
     espera      paciente na clínica aguardando (tempo de espera)
     triagem     enfermagem: sinais vitais + classificação de risco
     consultorio com o médico
     concluido   destino do "Finalizar atendimento" do prontuário
   Migração: supabase/migrations/20261008120000_atendimentos_kanban_triagem.sql
   ============================================================ */
(function () {
  const TIPOS = {
    agendado: { label: "Agendados (entrada da agenda)", icon: "ti-calendar-time" },
    espera: { label: "Sala de espera", icon: "ti-armchair" },
    triagem: { label: "Triagem", icon: "ti-heart-rate-monitor" },
    consultorio: { label: "Consultório", icon: "ti-stethoscope" },
    concluido: { label: "Concluído", icon: "ti-circle-check" },
    personalizada: { label: "Personalizada", icon: "ti-layout-kanban" },
  };
  const ACOES = {
    chegada: { label: "Registrar chegada", icon: "ti-door-enter" },
    entrada: { label: "Dar entrada", icon: "ti-login" },
    triagem: { label: "Fazer triagem", icon: "ti-heart-rate-monitor" },
    atender: { label: "Chamar para o consultório", icon: "ti-stethoscope" },
    finalizar: { label: "Finalizar atendimento", icon: "ti-circle-check" },
    cobrar: { label: "Cobrar", icon: "ti-cash" },
    confirmar: { label: "Enviar confirmação", icon: "ti-brand-whatsapp" },
    reagendar: { label: "Reagendar", icon: "ti-calendar-event" },
    prontuario: { label: "Abrir prontuário", icon: "ti-file-text" },
  };
  const RISCOS = {
    vermelho: { label: "Emergência", cor: "#dc2626", alvo: 0, ordem: 0 },
    laranja: { label: "Muito urgente", cor: "#ea580c", alvo: 10, ordem: 1 },
    amarelo: { label: "Urgente", cor: "#ca8a04", alvo: 60, ordem: 2 },
    verde: { label: "Pouco urgente", cor: "#16a34a", alvo: 120, ordem: 3 },
    azul: { label: "Não urgente", cor: "#2563eb", alvo: 240, ordem: 4 },
  };
  const MEIOS = ["PIX", "Dinheiro", "Cartão de débito", "Cartão de crédito", "Transferência", "Boleto"];
  const CONVENIOS = ["Particular", "SUS", "Unimed", "Bradesco", "Amil", "SulAmérica", "Hapvida"];
  const AG_OCULTOS = ["cancelado", "cancelada", "reagendado", "faltou"];

  const S = {
    etapas: [],
    fluxo: [],
    lanc: {},
    filtro: "hoje",
    carregado: false,
    recarga: null,
    pendente: false,
    offset: 0,
    canal: null,
    movidosAqui: {},
    arrastando: null,
    atendendo: null,
    modal: null,
  };

  /* ---------- utilidades ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const agora = () => Date.now() + S.offset;
  const agoraIso = () => new Date(agora()).toISOString();
  const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—");
  const ddmm = (iso) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const hojeIso = () => {
    const d = new Date(agora());
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };
  const minutosDesde = (iso) => (iso ? Math.max(0, Math.floor((agora() - new Date(iso).getTime()) / 60000)) : 0);
  const dur = (min) => (min < 60 ? min + " min" : Math.floor(min / 60) + "h" + String(min % 60).padStart(2, "0"));
  const dinheiro = (v) => "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const toast = (m, t) => (typeof showToast === "function" ? showToast(m, t) : console.log(m));
  const db = () => window.sb;
  const listaPacientes = () => (typeof patients !== "undefined" && Array.isArray(patients) ? patients : []);
  const listaAgendamentos = () => (typeof AGENDAMENTOS !== "undefined" && Array.isArray(AGENDAMENTOS) ? AGENDAMENTOS : []);
  const usuarioAtual = () => (typeof currentUser !== "undefined" ? currentUser : null);
  function nomeUsuario() {
    const u = usuarioAtual();
    return (u && ((u.user_metadata && u.user_metadata.full_name) || u.email)) || "";
  }
  function lsGet(k) {
    try {
      return JSON.parse(localStorage.getItem(k) || "null");
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  }

  /* ---------- etapas ---------- */
  const etapa = (id) => S.etapas.find((e) => e.id === id) || null;
  const etapaTipo = (tipo) => S.etapas.find((e) => e.tipo === tipo) || null;
  function etapaSeguinte(e) {
    const i = S.etapas.indexOf(e);
    return i >= 0 && i < S.etapas.length - 1 ? S.etapas[i + 1] : null;
  }
  function podeMover(de, para) {
    if (!de || !para || de.id === para.id) return false;
    return !de.destinos_permitidos || !de.destinos_permitidos.length || de.destinos_permitidos.includes(para.id);
  }
  // Para onde o card vai depois que uma ação termina: o encaminhamento da
  // etapa vale para o atalho dela; chamar e finalizar têm destino próprio.
  function destinoApos(acao, e) {
    if (e && e.atalho === acao && e.encaminhar_para && etapa(e.encaminhar_para)) return etapa(e.encaminhar_para);
    if (acao === "atender" && (!e || e.tipo !== "consultorio")) return etapaTipo("consultorio");
    if (acao === "finalizar" && (!e || e.tipo !== "concluido")) return etapaTipo("concluido");
    if (acao === "chegada" && e && e.tipo === "agendado") return etapaSeguinte(e);
    return null;
  }

  /* ---------- período ---------- */
  function intervalo() {
    const now = new Date(agora());
    const ini = new Date(now);
    ini.setHours(0, 0, 0, 0);
    const fim = new Date(now);
    fim.setHours(23, 59, 59, 999);
    const dia = ini.getDay();
    const seg = dia === 0 ? -6 : 1 - dia;
    const semana = (desloc) => {
      const s = new Date(ini);
      s.setDate(s.getDate() + seg + desloc);
      const e = new Date(s);
      e.setDate(e.getDate() + 6);
      e.setHours(23, 59, 59, 999);
      return [s, e];
    };
    if (S.filtro === "semana") return semana(0);
    if (S.filtro === "proxsemana") return semana(7);
    if (S.filtro === "anterior") return semana(-7);
    if (S.filtro === "mes") return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)];
    if (S.filtro === "custom") {
      const f = $("atd-custom-from") && $("atd-custom-from").value;
      const t = $("atd-custom-to") && $("atd-custom-to").value;
      return [f ? new Date(f + "T00:00:00") : new Date(0), t ? new Date(t + "T23:59:59") : new Date(8640000000000000)];
    }
    return [ini, fim];
  }

  /* ---------- carga ---------- */
  async function carregar() {
    const sb = db();
    if (!sb || !usuarioAtual()) return;
    const { data: etapas, error: eErr } = await sb.rpc("atendimento_etapas_garantir");
    if (eErr) {
      console.error("[kanban] etapas", eErr);
      toast("Não foi possível carregar as etapas do kanban", "error");
      return;
    }
    S.etapas = etapas || [];
    const [ini, fim] = intervalo();
    const [{ data: fluxo, error: fErr }] = await Promise.all([
      sb
        .from("atendimento_fluxo")
        .select("*")
        .gte("agendado_para", ini.toISOString())
        .lte("agendado_para", fim.toISOString())
        .order("agendado_para", { ascending: true }),
      typeof loadAgendamentos === "function" ? loadAgendamentos() : Promise.resolve(),
    ]);
    if (fErr) console.error("[kanban] fluxo", fErr);
    S.fluxo = fluxo || [];
    const ids = S.fluxo.map((f) => f.lancamento_id).filter(Boolean);
    S.lanc = {};
    if (ids.length) {
      const { data: l } = await sb.from("lancamentos_financeiros").select("id,valor,pago").in("id", ids);
      (l || []).forEach((r) => (S.lanc[r.id] = r));
    }
    S.carregado = true;
    render();
    ligarTempoReal();
  }
  // Agrupa recargas disparadas em sequência (tempo real + ação local).
  function recarregar() {
    if (S.recarga) {
      S.pendente = true;
      return S.recarga;
    }
    S.recarga = carregar()
      .catch((e) => console.error("[kanban]", e))
      .finally(() => {
        S.recarga = null;
        if (S.pendente) {
          S.pendente = false;
          recarregar();
        }
      });
    return S.recarga;
  }

  function ligarTempoReal() {
    const sb = db();
    if (S.canal || !sb || !sb.channel) return;
    let t = null;
    const agendar = () => {
      clearTimeout(t);
      t = setTimeout(recarregar, 400);
    };
    S.canal = sb
      .channel("atendimentos-kanban")
      .on("postgres_changes", { event: "*", schema: "public", table: "atendimento_fluxo" }, (p) => {
        avisarEntrada(p.new);
        agendar();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "agendamentos" }, agendar)
      .subscribe();
  }

  // Gatilho "Notificar a equipe": a mesma conta aberta na recepção, na
  // enfermagem e no consultório recebe o aviso quando o card entra na etapa.
  function avisarEntrada(novo) {
    if (!novo || !novo.id) return;
    const antes = S.fluxo.find((f) => f.id === novo.id);
    if (antes && antes.etapa_id === novo.etapa_id) return;
    if (S.movidosAqui[novo.id] && Date.now() - S.movidosAqui[novo.id] < 8000) return;
    const e = etapa(novo.etapa_id);
    if (!e || !e.gatilho_notificar) return;
    const msg = (novo.paciente_nome || "Paciente") + " entrou em " + e.nome;
    toast(msg, "success");
    try {
      if (window.Notification && Notification.permission === "granted") new Notification("Atendimentos", { body: msg });
    } catch (e2) {}
  }

  /* ---------- cards ---------- */
  function montarCards() {
    const [ini, fim] = intervalo();
    const ags = listaAgendamentos();
    const agPorId = {};
    ags.forEach((a) => (agPorId[a.id] = a));
    const pacPorId = {};
    listaPacientes().forEach((p) => (pacPorId[p.id] = p));
    const primeira = S.etapas.find((e) => e.tipo !== "agendado") || S.etapas[0];
    const cards = [];
    const comFluxo = new Set();
    S.fluxo.forEach((f) => {
      const ag = f.agendamento_id ? agPorId[f.agendamento_id] : null;
      if (f.agendamento_id) comFluxo.add(f.agendamento_id);
      if (f.faltou_em) return;
      if (ag && AG_OCULTOS.includes(String(ag.status || "").toLowerCase()) && !f.chegada_em) return;
      let e = etapa(f.etapa_id);
      if (!e) e = f.finalizado_em ? etapaTipo("concluido") : primeira;
      if (!e) return;
      cards.push(montarCard(f, ag, e, pacPorId));
    });
    const eAg = etapaTipo("agendado");
    if (eAg) {
      ags.forEach((a) => {
        if (comFluxo.has(a.id)) return;
        if (AG_OCULTOS.includes(String(a.status || "agendado").toLowerCase())) return;
        if (["atendido", "compareceu"].includes(String(a.status || "").toLowerCase())) return;
        const d = new Date(a.data_hora);
        if (d < ini || d > fim) return;
        cards.push(montarCard(null, a, eAg, pacPorId));
      });
    }
    return cards;
  }
  function montarCard(f, ag, e, pacPorId) {
    const pid = (f && f.paciente_id) || (ag && ag.paciente_id) || null;
    const p = pid ? pacPorId[pid] : null;
    const nome = (p && p.name) || (f && f.paciente_nome) || (ag && ag.paciente_nome) || "Paciente";
    return {
      key: f ? f.id : "ag:" + ag.id,
      f,
      ag,
      etapa: e,
      pacienteId: pid,
      nome,
      init: (p && p.init) || nome.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase(),
      horario: (f && f.agendado_para) || (ag && ag.data_hora),
      medico: (f && f.medico) || (ag && ag.medico_nome) || "",
      motivo: (f && (f.motivo || f.especialidade)) || (ag && (ag.motivo || ag.especialidade)) || "",
      modalidade: (f && f.modalidade) || (ag && ag.modalidade) || "presencial",
      desde: f ? f.etapa_desde : null,
      risco: f && f.risco,
      lanc: f && f.lancamento_id ? S.lanc[f.lancamento_id] : null,
    };
  }
  const cardPorKey = (k) => montarCards().find((c) => c.key === k) || null;

  function atrasoMin(c) {
    if (c.etapa.tipo !== "agendado" || (c.f && c.f.chegada_em)) return 0;
    const tol = c.etapa.limite_minutos || 10;
    const m = Math.floor((agora() - new Date(c.horario).getTime()) / 60000);
    return m > tol ? m : 0;
  }
  function nivelTempo(min, lim) {
    if (!lim) return "neutral";
    if (min >= lim) return "bad";
    if (min >= lim * 0.6) return "warn";
    return "ok";
  }
  function ordenar(lista, e) {
    if (e.tipo === "agendado") return lista.sort((a, b) => new Date(a.horario) - new Date(b.horario));
    if (e.tipo === "concluido")
      return lista.sort((a, b) => new Date((b.f && b.f.finalizado_em) || b.desde || 0) - new Date((a.f && a.f.finalizado_em) || a.desde || 0));
    const ordemRisco = (c) => (c.risco ? RISCOS[c.risco].ordem : 9);
    return lista.sort((a, b) => ordemRisco(a) - ordemRisco(b) || new Date(a.desde || a.horario) - new Date(b.desde || b.horario));
  }

  /* ---------- render ---------- */
  function render() {
    const board = $("ak-board");
    if (!board) return;
    if (!S.carregado) {
      board.innerHTML = '<div class="ak-loading"><i class="ti ti-loader-2"></i> Carregando atendimentos…</div>';
      return;
    }
    const q = (($("atd-search-input") && $("atd-search-input").value) || "").trim().toLowerCase();
    const todos = montarCards();
    const cards = q ? todos.filter((c) => c.nome.toLowerCase().includes(q)) : todos;
    renderResumo(todos);
    board.innerHTML =
      S.etapas
        .map((e) => {
          const lista = ordenar(cards.filter((c) => c.etapa.id === e.id), e);
          const tipo = TIPOS[e.tipo] || TIPOS.personalizada;
          return (
            '<div class="ak-col" data-etapa="' + e.id + '" style="--ak-cor:' + esc(e.cor) + '">' +
            '<div class="ak-col-hd"><span class="ak-col-dot"></span>' +
            '<span class="ak-col-title" title="' + esc(tipo.label) + '">' + esc(e.nome) + "</span>" +
            '<span class="ak-col-ct">' + lista.length + "</span>" +
            '<button class="ak-col-cfg" title="Configurar etapa" onclick="AK.configurar(\'' + e.id + '\')"><i class="ti ti-adjustments-horizontal"></i></button></div>' +
            '<div class="ak-col-body">' +
            (lista.length ? lista.map(cardHtml).join("") : '<div class="ak-empty"><i class="ti ' + tipo.icon + '"></i>Nenhum paciente</div>') +
            "</div></div>"
          );
        })
        .join("") +
      '<button class="ak-col-new" onclick="AK.configurar(null)"><i class="ti ti-plus"></i><span>Nova etapa</span></button>';
    ligarArrastar();
  }

  function renderResumo(cards) {
    const el = $("ak-resumo");
    if (!el) return;
    const [ini, fim] = intervalo();
    const atrasados = cards.filter((c) => atrasoMin(c) > 0);
    const aguardando = cards.filter((c) => ["espera", "triagem", "personalizada"].includes(c.etapa.tipo));
    const maior = aguardando.slice().sort((a, b) => new Date(a.desde) - new Date(b.desde))[0];
    const consultorio = cards.filter((c) => c.etapa.tipo === "consultorio");
    const atendidos = cards.filter((c) => c.etapa.tipo === "concluido");
    const esperas = atendidos
      .filter((c) => c.f && c.f.chegada_em && c.f.chamado_em)
      .map((c) => (new Date(c.f.chamado_em) - new Date(c.f.chegada_em)) / 60000);
    const media = esperas.length ? Math.round(esperas.reduce((s, v) => s + v, 0) / esperas.length) : null;
    const faltas =
      listaAgendamentos().filter((a) => {
        const d = new Date(a.data_hora);
        return String(a.status || "").toLowerCase() === "faltou" && d >= ini && d <= fim;
      }).length;
    const aChegar = cards.filter((c) => c.etapa.tipo === "agendado");
    const agendados = aChegar.length;
    const proximo = aChegar
      .filter((c) => new Date(c.horario).getTime() >= agora())
      .sort((a, b) => new Date(a.horario) - new Date(b.horario))[0];
    const chip = (cls, icon, num, label, sub, alvo) =>
      '<button class="ak-stat ' + cls + '"' + (alvo ? ' onclick="AK.focar(\'' + alvo + "')\"" : "") + ">" +
      '<span class="ak-stat-ic"><i class="ti ' + icon + '"></i></span>' +
      '<span class="ak-stat-tx"><b>' + num + "</b><span>" + label + "</span>" + (sub ? "<small>" + sub + "</small>" : "") + "</span></button>";
    el.innerHTML =
      chip("sky", "ti-calendar-time", agendados, "a chegar", proximo ? "próximo: " + esc(proximo.nome.split(" ")[0]) + " " + hhmm(proximo.horario) : "", "agendado") +
      chip(atrasados.length ? "rose" : "slate", "ti-clock-exclamation", atrasados.length, "atrasados",
        atrasados.length ? esc(atrasados.slice(0, 2).map((c) => c.nome.split(" ")[0] + " +" + dur(atrasoMin(c))).join(" · ")) : "", "agendado") +
      chip("amber", "ti-armchair", aguardando.length, "aguardando",
        maior ? "maior espera: " + esc(maior.nome.split(" ")[0]) + " · " + dur(minutosDesde(maior.desde)) : "", "espera") +
      chip("violet", "ti-stethoscope", consultorio.length, "no consultório",
        consultorio.length ? esc(consultorio.map((c) => c.nome.split(" ")[0] + " " + dur(minutosDesde(c.desde))).slice(0, 2).join(" · ")) : "", "consultorio") +
      chip("emerald", "ti-circle-check", atendidos.length, "atendidos", media != null ? "espera média " + dur(media) : "", "concluido") +
      (faltas ? chip("slate", "ti-user-x", faltas, faltas === 1 ? "falta" : "faltas", "", null) : "");
  }

  function cardHtml(c) {
    const e = c.etapa;
    const f = c.f;
    const linhas = [];
    const badges = [];
    if (e.tipo === "agendado") {
      linhas.push('<span><i class="ti ti-clock"></i>' + hhmm(c.horario) + (S.filtro === "hoje" ? "" : " · " + ddmm(c.horario)) + "</span>");
      const atraso = atrasoMin(c);
      if (atraso) badges.push('<span class="ak-badge bad"><i class="ti ti-clock-exclamation"></i><span class="ak-atraso" data-hora="' + esc(c.horario) + '">Atrasado ' + dur(atraso) + "</span></span>");
      const st = String((c.ag && c.ag.status) || "").toLowerCase();
      if (c.ag) {
        if (st === "confirmado") badges.push('<span class="ak-badge ok"><i class="ti ti-check"></i>Confirmado</span>');
        else if (st === "confirmacao_enviada") badges.push('<span class="ak-badge warn"><i class="ti ti-send"></i>Confirmação enviada</span>');
        else badges.push('<span class="ak-badge neutral"><i class="ti ti-help-circle"></i>Sem confirmação</span>');
      }
    } else if (e.tipo === "concluido") {
      linhas.push('<span><i class="ti ti-circle-check"></i>Atendido ' + hhmm((f && f.finalizado_em) || c.desde) + "</span>");
      if (f && f.chegada_em && f.chamado_em)
        linhas.push('<span title="Da chegada até ser chamado"><i class="ti ti-hourglass"></i>esperou ' + dur(Math.round((new Date(f.chamado_em) - new Date(f.chegada_em)) / 60000)) + "</span>");
      if (f && f.chamado_em && f.finalizado_em)
        linhas.push('<span title="Tempo no consultório"><i class="ti ti-stethoscope"></i>' + dur(Math.round((new Date(f.finalizado_em) - new Date(f.chamado_em)) / 60000)) + "</span>");
    } else {
      const min = minutosDesde(c.desde);
      const verbo = e.tipo === "consultorio" ? "com o médico há" : "aguardando há";
      badges.push(
        '<span class="ak-badge ' + nivelTempo(min, e.limite_minutos) + '"><i class="ti ' + (e.tipo === "consultorio" ? "ti-stethoscope" : "ti-hourglass") + '"></i>' +
        '<span class="ak-timer" data-desde="' + esc(c.desde) + '" data-lim="' + (e.limite_minutos || "") + '" data-verbo="' + verbo + '">' + verbo + " " + dur(min) + "</span></span>",
      );
      linhas.push('<span><i class="ti ti-calendar"></i>' + (f && f.agendamento_id ? "agendado " + hhmm(c.horario) : "encaixe") + "</span>");
      if (f && f.chegada_em) linhas.push('<span><i class="ti ti-door-enter"></i>chegou ' + hhmm(f.chegada_em) + "</span>");
    }
    if (c.risco) badges.push('<span class="ak-badge risco" style="--rc:' + RISCOS[c.risco].cor + '"><span class="dot"></span>' + RISCOS[c.risco].label + "</span>");
    if (c.lanc && Number(c.lanc.valor) > 0)
      badges.push('<span class="ak-money ' + (c.lanc.pago ? "paid" : "due") + '">' + dinheiro(c.lanc.valor) + (c.lanc.pago ? " · pago" : " · em aberto") + "</span>");
    const acao = e.atalho && acaoDisponivel(e.atalho, c) ? e.atalho : "";
    const cta = acao
      ? '<button class="ak-cta" onclick="event.stopPropagation();AK.acao(\'' + acao + "','" + c.key + '\')"><i class="ti ' + ACOES[acao].icon + '"></i>' + ACOES[acao].label + "</button>"
      : "";
    const sub = [c.medico, c.motivo].filter(Boolean).map(esc).join(" · ") || "Sem médico definido";
    return (
      '<div class="ak-card' + (c.risco ? " has-risco" : "") + '" draggable="true" data-key="' + esc(c.key) + '"' +
      (c.risco ? ' style="--rc:' + RISCOS[c.risco].cor + '"' : "") +
      ' onclick="AK.abrirCard(\'' + esc(c.key) + "')\">" +
      '<div class="ak-card-hd"><div class="ak-av">' + esc(c.init || "?") + "</div>" +
      '<div class="ak-id"><div class="ak-name">' + esc(c.nome) + "</div>" +
      '<div class="ak-sub">' + sub + "</div>" +
      (c.modalidade === "video" ? '<div class="ak-video"><i class="ti ti-video"></i>Vídeo</div>' : "") +
      "</div>" +
      '<button class="ak-menu-btn" title="Ações" onclick="event.stopPropagation();AK.menu(event,\'' + esc(c.key) + "')\"><i class=\"ti ti-dots-vertical\"></i></button></div>" +
      (linhas.length ? '<div class="ak-rows">' + linhas.join("") + "</div>" : "") +
      (badges.length ? '<div class="ak-badges">' + badges.join("") + "</div>" : "") +
      (cta ? '<div class="ak-actions">' + cta + "</div>" : "") +
      "</div>"
    );
  }

  function acaoDisponivel(a, c) {
    const f = c.f;
    const st = String((c.ag && c.ag.status) || "").toLowerCase();
    switch (a) {
      case "chegada":
        return !(f && f.chegada_em);
      case "entrada":
        return !(f && f.entrada_em);
      case "triagem":
        return !!c.pacienteId && c.etapa.tipo !== "concluido";
      case "atender":
        return c.etapa.tipo !== "consultorio" && c.etapa.tipo !== "concluido";
      case "finalizar":
        return c.etapa.tipo !== "concluido";
      case "cobrar":
        return !(c.lanc && c.lanc.pago);
      case "confirmar":
        return !!c.ag && c.etapa.tipo === "agendado" && st !== "confirmado";
      case "reagendar":
        return !!c.ag && c.etapa.tipo === "agendado";
      case "prontuario":
        return !!c.pacienteId;
    }
    return false;
  }

  // Atualiza cronômetros sem redesenhar o quadro (não atrapalha o arrastar).
  function tick() {
    if (!$("ak-board") || !S.carregado || document.hidden) return;
    document.querySelectorAll("#ak-board .ak-timer").forEach((el) => {
      const min = minutosDesde(el.dataset.desde);
      el.textContent = el.dataset.verbo + " " + dur(min);
      const b = el.parentElement;
      b.classList.remove("ok", "warn", "bad", "neutral");
      b.classList.add(nivelTempo(min, Number(el.dataset.lim) || 0));
    });
    if (!S.arrastando) renderResumo(montarCards());
  }

  /* ---------- persistência do card ---------- */
  async function garantirFluxo(c) {
    if (c.f) return c.f;
    const ag = c.ag;
    const row = {
      agendamento_id: ag.id,
      paciente_id: ag.paciente_id || null,
      paciente_nome: c.nome,
      etapa_id: c.etapa.id,
      agendado_para: ag.data_hora,
      medico: ag.medico_nome || null,
      especialidade: ag.especialidade || null,
      motivo: ag.motivo || null,
      modalidade: ag.modalidade || null,
    };
    let { data, error } = await db().from("atendimento_fluxo").insert(row).select("*").single();
    if (error && error.code === "23505") {
      ({ data, error } = await db().from("atendimento_fluxo").select("*").eq("agendamento_id", ag.id).single());
    }
    if (error) throw error;
    S.movidosAqui[data.id] = Date.now();
    guardarFluxo(data);
    c.f = data;
    c.key = data.id;
    return data;
  }
  function guardarFluxo(row) {
    const i = S.fluxo.findIndex((x) => x.id === row.id);
    if (i >= 0) S.fluxo[i] = row;
    else S.fluxo.push(row);
  }
  async function atualizarFluxo(c, patch) {
    const f = await garantirFluxo(c);
    const { data, error } = await db().from("atendimento_fluxo").update(patch).eq("id", f.id).select("*").single();
    if (error) throw error;
    guardarFluxo(data);
    c.f = data;
    return data;
  }
  async function atualizarAgendamento(c, patch) {
    if (!c.ag) return;
    const { error } = await db().from("agendamentos").update(patch).eq("id", c.ag.id);
    if (error) throw error;
    Object.assign(c.ag, patch);
    if (typeof agMapRow === "function" && typeof AG_APTS !== "undefined") {
      AG_APTS = listaAgendamentos().map(agMapRow).sort((a, b) => a.dateObj - b.dateObj);
    }
  }

  // Move o card e executa o que a etapa de destino manda fazer ao entrar.
  async function mover(c, destino, opts) {
    opts = opts || {};
    if (!destino || destino.id === c.etapa.id) return;
    const f = await garantirFluxo(c);
    S.movidosAqui[f.id] = Date.now();
    const de = c.etapa;
    const data = await atualizarFluxo(c, { etapa_id: destino.id });
    S.offset = new Date(data.etapa_desde).getTime() - Date.now();
    c.etapa = destino;
    c.desde = data.etapa_desde;
    render();
    await aoEntrar(c, destino, de, opts);
  }

  async function aoEntrar(c, e, de, opts) {
    if (e.gatilho_confirmar && c.ag && acaoDisponivel("confirmar", c)) await executar("confirmar", c, { silencioso: true, semDestino: true });
    if (e.acao_ao_entrar && e.acao_ao_entrar !== opts.origem) {
      await executar(e.acao_ao_entrar, c, { aoEntrar: true });
    }
    if (e.gatilho_cobranca && c.lanc && Number(c.lanc.valor) > 0 && !c.lanc.pago && e.acao_ao_entrar !== "cobrar" && opts.origem !== "cobrar") {
      abrirCobrar(c, true);
    }
  }

  async function seguir(c, acao) {
    const d = destinoApos(acao, c.etapa);
    if (d) await mover(c, d, { origem: acao });
    else render();
  }

  /* ---------- ações ---------- */
  async function executar(acao, c, opts) {
    opts = opts || {};
    try {
      switch (acao) {
        case "chegada":
          return await acaoChegada(c, opts);
        case "entrada":
          return abrirEntrada(c, opts);
        case "triagem":
          return abrirTriagem(c, opts);
        case "atender":
          return await acaoAtender(c, opts);
        case "finalizar":
          return await acaoFinalizar(c, opts);
        case "cobrar":
          return abrirCobrar(c, false);
        case "confirmar":
          return await acaoConfirmar(c, opts);
        case "reagendar":
          return abrirReagendar(c);
        case "prontuario":
          return abrirProntuario(c);
      }
    } catch (e) {
      console.error("[kanban] " + acao, e);
      toast("Não foi possível concluir: " + (e.message || e), "error");
    }
  }

  async function registrarPresenca(c) {
    if (!c.ag) return;
    const patch = {};
    if (!c.ag.horario_entrada) patch.horario_entrada = agoraIso();
    if (!["atendido"].includes(String(c.ag.status || "").toLowerCase())) patch.status = "compareceu";
    if (Object.keys(patch).length) await atualizarAgendamento(c, patch);
  }

  async function acaoChegada(c, opts) {
    if (!(c.f && c.f.chegada_em)) {
      await atualizarFluxo(c, { chegada_em: agoraIso() });
      await registrarPresenca(c);
      toast(c.nome.split(" ")[0] + " chegou", "success");
    }
    if (!opts.aoEntrar) await seguir(c, "chegada");
    else render();
  }

  async function acaoAtender(c, opts) {
    if (!c.pacienteId) {
      toast("Vincule o paciente ao agendamento para abrir o prontuário", "error");
      return;
    }
    const patch = { chamado_em: agoraIso() };
    if (!(c.f && c.f.chegada_em)) patch.chegada_em = patch.chamado_em;
    await atualizarFluxo(c, patch);
    await registrarPresenca(c);
    S.atendendo = c.f.id;
    if (!opts.aoEntrar) await seguir(c, "atender");
    abrirProntuario(c);
  }

  async function acaoFinalizar(c, opts) {
    const patch = { finalizado_em: agoraIso() };
    if (opts.consultaId) patch.consulta_id = opts.consultaId;
    await atualizarFluxo(c, patch);
    if (c.ag) await atualizarAgendamento(c, { status: "atendido" });
    if (S.atendendo === c.f.id) S.atendendo = null;
    if (!opts.aoEntrar) await seguir(c, "finalizar");
    else render();
  }

  async function acaoConfirmar(c, opts) {
    if (!c.ag) return;
    const { data } = await db().auth.getSession();
    const token = data && data.session && data.session.access_token;
    const res = await fetch("/api/comunicacao/confirmar-agendamento", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ agendamento_id: c.ag.id }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(j.message || "Falha ao enviar a confirmação pelo WhatsApp", "error");
      return;
    }
    if (String(c.ag.status || "agendado").toLowerCase() === "agendado") c.ag.status = "confirmacao_enviada";
    if (!opts.silencioso) toast(j.ja_enviado ? "A confirmação já tinha sido enviada" : "Confirmação enviada pelo WhatsApp", "success");
    if (!opts.semDestino && !opts.aoEntrar) await seguir(c, "confirmar");
    else render();
  }

  async function marcarConfirmado(c) {
    await atualizarAgendamento(c, { status: "confirmado" });
    toast("Consulta confirmada", "success");
    render();
  }

  async function marcarFalta(c) {
    if (!confirm("Registrar falta de " + c.nome + "?")) return;
    if (c.ag) await atualizarAgendamento(c, { status: "faltou" });
    if (c.f) await atualizarFluxo(c, { faltou_em: agoraIso() });
    toast("Falta registrada", "success");
    render();
  }

  function abrirProntuario(c) {
    if (!c.pacienteId || typeof openPatient !== "function") {
      toast("Este agendamento não tem paciente cadastrado vinculado", "error");
      return;
    }
    openPatient(c.pacienteId);
  }

  /* ---------- modais ---------- */
  function modalHtml(id, icon, grad, titulo, sub, corpo, rodape, largura) {
    return (
      '<div class="modal akm" id="m-' + id + '" style="display:none' + (largura ? ";width:" + largura + "px" : "") + '">' +
      '<div class="mhd"><div class="akm-ic ' + grad + '"><i class="ti ' + icon + '"></i></div>' +
      '<div class="akm-ht"><span class="mhd-title">' + titulo + "</span>" + (sub ? '<span class="akm-sub">' + sub + "</span>" : "") + "</div>" +
      '<button class="mclose" onclick="closeModal()"><i class="ti ti-x"></i></button></div>' +
      '<div class="mbody">' + corpo + "</div>" +
      '<div class="mfoot">' + rodape + "</div></div>"
    );
  }
  function abrirModal(id, html) {
    const ov = $("modal-overlay");
    if (!ov) return;
    const velho = $("m-" + id);
    if (velho) velho.remove();
    ov.insertAdjacentHTML("beforeend", html);
    if (typeof openModal === "function") openModal(id);
  }
  const fecharModal = () => typeof closeModal === "function" && closeModal();
  const val = (id) => (($(id) && $(id).value) || "").trim();
  const num = (id) => {
    const v = val(id).replace(",", ".");
    return v === "" ? null : Number(v);
  };
  const opcoes = (lista, sel) => lista.map((o) => '<option value="' + esc(o) + '"' + (o === sel ? " selected" : "") + ">" + esc(o) + "</option>").join("");
  function medicosConhecidos() {
    const set = new Set();
    const eu = nomeUsuario();
    if (eu) set.add(eu);
    listaAgendamentos().forEach((a) => a.medico_nome && set.add(a.medico_nome));
    S.fluxo.forEach((f) => f.medico && set.add(f.medico));
    return [...set];
  }

  // ----- Dar entrada -----
  function abrirEntrada(c, opts) {
    S.modal = { c, opts };
    const f = c.f || {};
    const p = listaPacientes().find((x) => x.id === c.pacienteId) || {};
    const conv = f.convenio || p.conv || "Particular";
    const valor = c.lanc ? c.lanc.valor : "";
    const corpo =
      '<div class="akm-grid">' +
      '<div class="fld"><label>Médico</label><input id="ake-medico" list="ake-medicos" value="' + esc(c.medico || nomeUsuario()) + '"><datalist id="ake-medicos">' +
      medicosConhecidos().map((m) => '<option value="' + esc(m) + '">').join("") + "</datalist></div>" +
      '<div class="fld"><label>Especialidade</label><input id="ake-esp" value="' + esc(f.especialidade || (c.ag && c.ag.especialidade) || "") + '" placeholder="Ex.: Cardiologia"></div>' +
      '<div class="fld wide"><label>Motivo da consulta</label><input id="ake-motivo" value="' + esc(f.motivo || (c.ag && c.ag.motivo) || "") + '"></div>' +
      '<div class="fld"><label>Convênio</label><select id="ake-conv">' + opcoes(CONVENIOS.includes(conv) ? CONVENIOS : [conv].concat(CONVENIOS), conv) + "</select></div>" +
      '<div class="fld"><label>Valor da consulta (R$)</label><input id="ake-valor" type="number" min="0" step="0.01" value="' + esc(valor) + '" placeholder="0,00"></div>' +
      '<div class="fld"><label>Pagamento</label><select id="ake-pg" onchange="document.getElementById(\'ake-meio-w\').style.display=this.value===\'agora\'?\'\':\'none\'">' +
      '<option value="depois">Cobrar depois</option><option value="agora">Recebido agora</option></select></div>' +
      '<div class="fld" id="ake-meio-w" style="display:none"><label>Forma de pagamento</label><select id="ake-meio">' + opcoes(MEIOS, "PIX") + "</select></div>" +
      "</div>" +
      '<p class="akm-hint"><i class="ti ti-info-circle"></i> Com valor informado, a consulta entra no Faturamento como receita' + (c.lanc ? " (o lançamento existente será atualizado)." : ".") + "</p>";
    abrirModal(
      "ak-entrada",
      modalHtml("ak-entrada", "ti-login", "g-amber", "Dar entrada", esc(c.nome), corpo,
        '<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="ake-ok" onclick="AK.salvarEntrada()"><i class="ti ti-check"></i> Registrar entrada</button>', 540),
    );
  }
  async function salvarEntrada() {
    const m = S.modal;
    if (!m) return;
    const c = m.c;
    const btn = $("ake-ok");
    if (btn) btn.disabled = true;
    try {
      const valor = num("ake-valor") || 0;
      const pagoAgora = val("ake-pg") === "agora";
      const medico = val("ake-medico");
      const esp = val("ake-esp");
      const patch = {
        medico: medico || null,
        especialidade: esp || null,
        motivo: val("ake-motivo") || null,
        convenio: val("ake-conv") || null,
        entrada_em: agoraIso(),
      };
      if (!(c.f && c.f.chegada_em)) patch.chegada_em = patch.entrada_em;
      await garantirFluxo(c);
      if (valor > 0 || c.f.lancamento_id) {
        const lanc = await salvarLancamento(c, { valor, medico, especialidade: esp, pago: pagoAgora && valor > 0, meio: val("ake-meio") });
        patch.lancamento_id = lanc.id;
      }
      await atualizarFluxo(c, patch);
      await registrarPresenca(c);
      c.lanc = c.f.lancamento_id ? S.lanc[c.f.lancamento_id] : null;
      fecharModal();
      toast("Entrada registrada", "success");
      if (m.opts && m.opts.aoEntrar) render();
      else await seguir(c, "entrada");
    } catch (e) {
      console.error("[kanban] entrada", e);
      toast("Erro ao registrar entrada: " + (e.message || e), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Faturamento é o livro único de recebimentos (AGENTS.md): a consulta vira
  // um lançamento de receita, e o "pago" do card vem sempre de lá.
  async function salvarLancamento(c, d) {
    const hoje = hojeIso();
    const status = d.pago ? "Recebido" : "A receber";
    const base = {
      valor: d.valor,
      medico: d.medico || null,
      especialidade: d.especialidade || null,
      pago: d.pago,
      status,
      etiqueta: status,
      data_pagamento: d.pago ? hoje : null,
      meio_pagamento: d.pago ? d.meio || null : null,
    };
    let res;
    if (c.f.lancamento_id) {
      res = await db().from("lancamentos_financeiros").update(base).eq("id", c.f.lancamento_id).select("id,valor,pago").single();
    } else {
      res = await db()
        .from("lancamentos_financeiros")
        .insert(Object.assign(base, {
          tipo: "Receita",
          origem: "consulta",
          natureza: "Consulta",
          descricao: "Consulta — " + c.nome,
          paciente_id: c.pacienteId,
          paciente_nome: c.nome,
          data: hoje,
          vencimento: hoje,
        }))
        .select("id,valor,pago")
        .single();
    }
    if (res.error) throw res.error;
    S.lanc[res.data.id] = res.data;
    return res.data;
  }

  // ----- Cobrar -----
  function abrirCobrar(c, pendencia) {
    S.modal = { c };
    const corpo =
      (pendencia ? '<div class="akm-alert"><i class="ti ti-alert-triangle"></i> Há valor em aberto desta consulta.</div>' : "") +
      '<div class="akm-grid">' +
      '<div class="fld"><label>Valor (R$)</label><input id="akc-valor" type="number" min="0" step="0.01" value="' + esc((c.lanc && c.lanc.valor) || "") + '"></div>' +
      '<div class="fld"><label>Forma de pagamento</label><select id="akc-meio">' + opcoes(MEIOS, "PIX") + "</select></div>" +
      "</div>";
    abrirModal(
      "ak-cobrar",
      modalHtml("ak-cobrar", "ti-cash", "g-emerald", "Receber pagamento", esc(c.nome), corpo,
        '<button class="btn" onclick="closeModal()">' + (pendencia ? "Depois" : "Cancelar") + '</button><button class="btn primary" id="akc-ok" onclick="AK.salvarCobranca()"><i class="ti ti-check"></i> Registrar recebimento</button>', 440),
    );
  }
  async function salvarCobranca() {
    const m = S.modal;
    if (!m) return;
    const c = m.c;
    const valor = num("akc-valor") || 0;
    if (valor <= 0) {
      toast("Informe o valor recebido", "error");
      return;
    }
    const btn = $("akc-ok");
    if (btn) btn.disabled = true;
    try {
      await garantirFluxo(c);
      const lanc = await salvarLancamento(c, { valor, medico: c.medico, especialidade: c.f.especialidade, pago: true, meio: val("akc-meio") });
      if (c.f.lancamento_id !== lanc.id) await atualizarFluxo(c, { lancamento_id: lanc.id });
      c.lanc = lanc;
      fecharModal();
      toast("Recebimento registrado no Faturamento", "success");
      await seguir(c, "cobrar");
    } catch (e) {
      console.error("[kanban] cobrar", e);
      toast("Erro ao registrar recebimento: " + (e.message || e), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ----- Reagendar -----
  function abrirReagendar(c) {
    S.modal = { c };
    const d = new Date(c.horario);
    const pad = (n) => String(n).padStart(2, "0");
    const corpo =
      '<div class="akm-grid">' +
      '<div class="fld"><label>Nova data</label><input id="akr-data" type="date" value="' + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + '"></div>' +
      '<div class="fld"><label>Horário</label><input id="akr-hora" type="time" value="' + pad(d.getHours()) + ":" + pad(d.getMinutes()) + '"></div></div>' +
      '<p class="akm-hint"><i class="ti ti-info-circle"></i> A confirmação volta a ficar pendente para o novo horário.</p>';
    abrirModal(
      "ak-reagendar",
      modalHtml("ak-reagendar", "ti-calendar-event", "g-sky", "Reagendar consulta", esc(c.nome), corpo,
        '<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="AK.salvarReagendamento()"><i class="ti ti-check"></i> Reagendar</button>', 420),
    );
  }
  async function salvarReagendamento() {
    const c = S.modal && S.modal.c;
    if (!c || !c.ag) return;
    const dt = val("akr-data");
    const hr = val("akr-hora");
    if (!dt || !hr) {
      toast("Informe data e horário", "error");
      return;
    }
    try {
      const iso = new Date(dt + "T" + hr + ":00").toISOString();
      await atualizarAgendamento(c, { data_hora: iso, status: "agendado" });
      if (c.f) await atualizarFluxo(c, { agendado_para: iso });
      fecharModal();
      toast("Consulta reagendada para " + new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }), "success");
      recarregar();
    } catch (e) {
      toast("Erro ao reagendar: " + (e.message || e), "error");
    }
  }

  // ----- Encaixe (paciente sem agendamento) -----
  function abrirEncaixe() {
    S.modal = {};
    const dest = S.etapas.filter((e) => e.tipo !== "agendado" && e.tipo !== "concluido");
    const corpo =
      '<div class="akm-grid">' +
      '<div class="fld wide"><label>Paciente</label><input id="akx-pac" list="akx-pacs" placeholder="Digite o nome do paciente" autocomplete="off"><datalist id="akx-pacs">' +
      listaPacientes().map((p) => '<option value="' + esc(p.name) + '">' + esc(p.cpf ? "CPF " + p.cpf : "") + "</option>").join("") + "</datalist></div>" +
      '<div class="fld"><label>Médico</label><input id="akx-medico" list="akx-medicos" value="' + esc(nomeUsuario()) + '"><datalist id="akx-medicos">' +
      medicosConhecidos().map((m) => '<option value="' + esc(m) + '">').join("") + "</datalist></div>" +
      '<div class="fld"><label>Colocar em</label><select id="akx-etapa">' + dest.map((e) => '<option value="' + e.id + '">' + esc(e.nome) + "</option>").join("") + "</select></div>" +
      '<div class="fld wide"><label>Motivo</label><input id="akx-motivo" placeholder="Ex.: dor abdominal, retorno sem agenda"></div></div>' +
      '<p class="akm-hint"><i class="ti ti-info-circle"></i> Paciente novo? Cadastre em "Novo paciente" e volte aqui.</p>';
    abrirModal(
      "ak-encaixe",
      modalHtml("ak-encaixe", "ti-user-plus", "g-violet", "Encaixe / chegada sem agenda", "O paciente entra direto na fila", corpo,
        '<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" onclick="AK.salvarEncaixe()"><i class="ti ti-check"></i> Adicionar à fila</button>', 520),
    );
  }
  async function salvarEncaixe() {
    const nome = val("akx-pac");
    const p = listaPacientes().find((x) => x.name.toLowerCase() === nome.toLowerCase());
    if (!p) {
      toast("Escolha um paciente cadastrado da lista", "error");
      return;
    }
    const e = etapa(val("akx-etapa"));
    if (!e) return;
    try {
      const ts = agoraIso();
      const { data, error } = await db()
        .from("atendimento_fluxo")
        .insert({
          paciente_id: p.id,
          paciente_nome: p.name,
          etapa_id: e.id,
          agendado_para: ts,
          chegada_em: ts,
          medico: val("akx-medico") || null,
          motivo: val("akx-motivo") || null,
          convenio: p.conv || null,
        })
        .select("*")
        .single();
      if (error) throw error;
      S.movidosAqui[data.id] = Date.now();
      guardarFluxo(data);
      fecharModal();
      toast(p.name.split(" ")[0] + " entrou em " + e.nome, "success");
      render();
      const c = cardPorKey(data.id);
      if (c) await aoEntrar(c, e, null, {});
    } catch (err) {
      toast("Erro ao criar encaixe: " + (err.message || err), "error");
    }
  }

  // ----- Triagem -----
  function abrirTriagem(c, opts) {
    if (!c.pacienteId) {
      toast("Vincule o paciente ao agendamento antes da triagem", "error");
      return;
    }
    S.modal = { c, opts, risco: c.risco || "" };
    const p = listaPacientes().find((x) => x.id === c.pacienteId) || {};
    const ic = p.infoComp || {};
    const altCad = parseFloat(String(ic.altura || "").replace(",", "."));
    const alturaInicial = altCad > 0 && altCad < 3 ? Math.round(altCad * 100) : ic.altura || "";
    const prof = lsGet("akTriagemProf") || {};
    const campo = (id, label, un, ph, attrs) =>
      '<div class="fld akt-v"><label>' + label + '</label><div class="akt-in"><input id="' + id + '" type="number" inputmode="decimal" placeholder="' + (ph || "") + '" oninput="AK.alertasTriagem()" ' + (attrs || "") + ">" +
      (un ? "<span>" + un + "</span>" : "") + "</div></div>";
    const corpo =
      '<div class="akt-sec">Profissional</div><div class="akm-grid">' +
      '<div class="fld"><label>Nome</label><input id="akt-prof" value="' + esc(prof.nome || "") + '" placeholder="Quem está triando"></div>' +
      '<div class="fld"><label>COREN / registro</label><input id="akt-reg" value="' + esc(prof.registro || "") + '" placeholder="Opcional"></div></div>' +
      '<div class="akt-sec">Sinais vitais</div><div class="akt-vitais">' +
      '<div class="fld akt-v akt-pa"><label>Pressão arterial</label><div class="akt-in"><input id="akt-pas" type="number" placeholder="sist." oninput="AK.alertasTriagem()"><b>/</b><input id="akt-pad" type="number" placeholder="diast." oninput="AK.alertasTriagem()"><span>mmHg</span></div></div>' +
      campo("akt-fc", "Freq. cardíaca", "bpm") +
      campo("akt-fr", "Freq. respiratória", "irpm") +
      campo("akt-temp", "Temperatura", "°C", "", 'step="0.1"') +
      campo("akt-spo2", "Saturação O₂", "%") +
      campo("akt-gli", "Glicemia capilar", "mg/dL") +
      campo("akt-peso", "Peso", "kg", "", 'step="0.1" value="' + esc(ic.peso || "") + '"') +
      campo("akt-alt", "Altura", "cm", "", 'value="' + esc(alturaInicial) + '"') +
      '<div class="fld akt-v"><label>IMC</label><div class="akt-in akt-ro"><span id="akt-imc">—</span></div></div>' +
      "</div>" +
      '<div class="fld akt-dor"><label>Dor <b id="akt-dor-v">—</b></label><input id="akt-dor" type="range" min="0" max="10" step="1" value="0" data-tocado="0" oninput="this.dataset.tocado=1;document.getElementById(\'akt-dor-v\').textContent=this.value+\'/10\';AK.alertasTriagem()"></div>' +
      '<div id="akt-alertas" class="akt-alertas"></div>' +
      '<div class="akt-sec">Queixa e história</div>' +
      '<div class="fld"><label>Queixa principal</label><textarea id="akt-queixa" rows="2" placeholder="O que trouxe o paciente hoje, desde quando"></textarea></div>' +
      '<div class="akm-grid"><div class="fld"><label>Alergias</label><input id="akt-alerg" value="' + esc(ic.alerg || "") + '" placeholder="Nega alergias"></div>' +
      '<div class="fld"><label>Medicamentos em uso</label><input id="akt-meds" value="' + esc(ic.meds || "") + '"></div></div>' +
      '<div class="fld"><label>Observações</label><textarea id="akt-obs" rows="2"></textarea></div>' +
      '<div class="akt-sec">Classificação de risco (Manchester)</div><div class="akt-riscos">' +
      Object.keys(RISCOS)
        .map((k) => {
          const r = RISCOS[k];
          return '<button type="button" class="akt-risco' + (S.modal.risco === k ? " on" : "") + '" data-r="' + k + '" style="--rc:' + r.cor + '" onclick="AK.escolherRisco(\'' + k + '\')"><span class="dot"></span><b>' + r.label + "</b><small>" +
            (r.alvo ? "até " + dur(r.alvo) : "imediato") + "</small></button>";
        })
        .join("") +
      "</div>";
    const destino = destinoApos("triagem", c.etapa);
    abrirModal(
      "ak-triagem",
      modalHtml("ak-triagem", "ti-heart-rate-monitor", "g-violet", "Triagem", esc(c.nome) + (c.medico ? " · " + esc(c.medico) : ""), corpo,
        '<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="akt-ok" onclick="AK.salvarTriagem()"><i class="ti ti-check"></i> Salvar' +
        (destino && !(opts && opts.aoEntrar) ? " e encaminhar para " + esc(destino.nome) : " triagem") + "</button>", 680),
    );
    alertasTriagem();
  }
  function escolherRisco(k) {
    if (!S.modal) return;
    S.modal.risco = k;
    document.querySelectorAll("#m-ak-triagem .akt-risco").forEach((b) => b.classList.toggle("on", b.dataset.r === k));
  }
  // Mesmas faixas dos CHECKs de public.triagens: o erro aparece no campo
  // antes de chegar ao banco.
  const FAIXAS = [
    ["akt-pas", "Pressão sistólica", 30, 300, "mmHg"],
    ["akt-pad", "Pressão diastólica", 10, 200, "mmHg"],
    ["akt-fc", "Frequência cardíaca", 10, 300, "bpm"],
    ["akt-fr", "Frequência respiratória", 2, 80, "irpm"],
    ["akt-temp", "Temperatura", 25, 45, "°C"],
    ["akt-spo2", "Saturação O₂", 30, 100, "%"],
    ["akt-gli", "Glicemia capilar", 10, 1500, "mg/dL"],
    ["akt-peso", "Peso", 0.3, 400, "kg"],
    ["akt-alt", "Altura", 20, 250, "cm"],
  ];
  // Altura do cadastro costuma vir em metros (1,76).
  function alturaCm() {
    const a = num("akt-alt");
    return a != null && a > 0 && a < 3 ? Math.round(a * 1000) / 10 : a;
  }
  function validarVitais() {
    const erros = [];
    FAIXAS.forEach(([id, nome, min, max, un]) => {
      const el = $(id);
      const v = id === "akt-alt" ? alturaCm() : num(id);
      const ruim = el && el.value.trim() !== "" && (v == null || !isFinite(v) || v < min || v > max);
      if (el) el.closest(".akt-in").classList.toggle("akt-erro", !!ruim);
      if (ruim) erros.push(nome + " (" + String(min).replace(".", ",") + "–" + max + " " + un + ")");
    });
    return erros;
  }

  // Sinais de alerta só sinalizam: a classificação é sempre do profissional.
  function alertasTriagem() {
    const box = $("akt-alertas");
    if (!box) return;
    const pas = num("akt-pas"), pad = num("akt-pad"), fc = num("akt-fc"), fr = num("akt-fr");
    const t = num("akt-temp"), sat = num("akt-spo2"), gli = num("akt-gli"), peso = num("akt-peso"), alt = alturaCm();
    const dorEl = $("akt-dor");
    const dor = dorEl && dorEl.dataset.tocado === "1" ? Number(dorEl.value) : null;
    const imcEl = $("akt-imc");
    if (imcEl) imcEl.textContent = peso && alt ? (peso / Math.pow(alt / 100, 2)).toFixed(1).replace(".", ",") : "—";
    const a = [];
    if (sat != null && sat < 92) a.push("SpO₂ " + sat + "%");
    if (pas != null && (pas >= 180 || pas < 90)) a.push("PAS " + pas);
    if (pad != null && pad >= 110) a.push("PAD " + pad);
    if (fc != null && (fc > 120 || fc < 50)) a.push("FC " + fc);
    if (fr != null && (fr > 24 || fr < 10)) a.push("FR " + fr);
    if (t != null && (t >= 39 || t < 35)) a.push("Temp " + String(t).replace(".", ",") + "°C");
    if (gli != null && (gli < 70 || gli > 300)) a.push("Glicemia " + gli);
    if (dor != null && dor >= 8) a.push("Dor " + dor + "/10");
    box.innerHTML = a.length ? '<i class="ti ti-alert-triangle"></i> Sinais de alerta: <b>' + a.join(" · ") + "</b> — considere classificar como laranja ou vermelho." : "";
    box.style.display = a.length ? "block" : "none";
    validarVitais();
  }
  async function salvarTriagem() {
    const m = S.modal;
    if (!m || !m.c) return;
    const c = m.c;
    const prof = val("akt-prof");
    if (!prof) {
      toast("Informe o nome de quem fez a triagem", "error");
      return;
    }
    const foraDaFaixa = validarVitais();
    if (foraDaFaixa.length) {
      toast("Confira os valores: " + foraDaFaixa.join(", "), "error");
      return;
    }
    if (!m.risco) {
      toast("Escolha a classificação de risco", "error");
      return;
    }
    const btn = $("akt-ok");
    if (btn) btn.disabled = true;
    try {
      lsSet("akTriagemProf", { nome: prof, registro: val("akt-reg") });
      const f = await garantirFluxo(c);
      const dorEl = $("akt-dor");
      const ts = agoraIso();
      const { error } = await db()
        .from("triagens")
        .insert({
          paciente_id: c.pacienteId,
          fluxo_id: f.id,
          agendamento_id: f.agendamento_id || null,
          pa_sistolica: num("akt-pas"),
          pa_diastolica: num("akt-pad"),
          fc: num("akt-fc"),
          fr: num("akt-fr"),
          temperatura: num("akt-temp"),
          spo2: num("akt-spo2"),
          glicemia: num("akt-gli"),
          peso: num("akt-peso"),
          altura: alturaCm(),
          dor: dorEl && dorEl.dataset.tocado === "1" ? Number(dorEl.value) : null,
          queixa_principal: val("akt-queixa") || null,
          alergias: val("akt-alerg") || null,
          medicamentos: val("akt-meds") || null,
          observacoes: val("akt-obs") || null,
          risco: m.risco,
          profissional_nome: prof,
          profissional_registro: val("akt-reg") || null,
          realizado_em: ts,
        });
      if (error) throw error;
      const patch = { risco: m.risco, triagem_em: ts };
      if (!f.chegada_em) patch.chegada_em = ts;
      await atualizarFluxo(c, patch);
      c.risco = m.risco;
      await registrarPresenca(c);
      fecharModal();
      toast("Triagem registrada · " + RISCOS[m.risco].label, "success");
      if (m.opts && m.opts.aoEntrar) render();
      else await seguir(c, "triagem");
    } catch (e) {
      console.error("[kanban] triagem", e);
      toast("Erro ao salvar triagem: " + (e.message || e), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ----- Detalhes / linha do tempo -----
  async function abrirDetalhes(c) {
    let eventos = [];
    let tri = null;
    if (c.f) {
      const [ev, tr] = await Promise.all([
        db().from("atendimento_fluxo_eventos").select("*").eq("fluxo_id", c.f.id).order("entrou_em"),
        db().from("triagens").select("*").eq("fluxo_id", c.f.id).order("realizado_em", { ascending: false }).limit(1),
      ]);
      eventos = ev.data || [];
      tri = (tr.data || [])[0] || null;
    }
    const linha = eventos.length
      ? eventos
          .map((e) => {
            const min = Math.round(((e.saiu_em ? new Date(e.saiu_em).getTime() : agora()) - new Date(e.entrou_em).getTime()) / 60000);
            return '<div class="akd-ev"><span class="akd-dot"></span><b>' + esc(e.etapa_nome) + "</b><span>" + hhmm(e.entrou_em) + "</span><small>" + (e.saiu_em ? dur(min) : "agora · " + dur(min)) + "</small></div>";
          })
          .join("")
      : '<div class="akm-hint">Ainda não houve movimentação deste card.</div>';
    const corpo =
      '<div class="akd-head"><span><i class="ti ti-clock"></i>' + (c.f && !c.f.agendamento_id ? "Encaixe " : "Agendado ") + hhmm(c.horario) + " · " + ddmm(c.horario) + "</span>" +
      (c.f && c.f.chegada_em ? '<span><i class="ti ti-door-enter"></i>Chegou ' + hhmm(c.f.chegada_em) + "</span>" : "") +
      (c.medico ? '<span><i class="ti ti-user"></i>' + esc(c.medico) + "</span>" : "") + "</div>" +
      '<div class="akt-sec">Linha do tempo</div><div class="akd-tl">' + linha + "</div>" +
      (tri ? '<div class="akt-sec">Triagem</div>' + triagemResumoHtml(tri) : "");
    abrirModal(
      "ak-detalhes",
      modalHtml("ak-detalhes", "ti-timeline", "g-sky", esc(c.nome), esc(c.etapa.nome), corpo,
        (c.pacienteId ? '<button class="btn" onclick="closeModal();AK.acao(\'prontuario\',\'' + esc(c.key) + '\')"><i class="ti ti-file-text"></i> Prontuário</button>' : "") +
        '<button class="btn primary" onclick="closeModal()">Fechar</button>', 520),
    );
  }
  function triagemResumoHtml(t) {
    const it = [];
    if (t.pa_sistolica && t.pa_diastolica) it.push(["PA", t.pa_sistolica + "/" + t.pa_diastolica]);
    if (t.fc) it.push(["FC", t.fc + " bpm"]);
    if (t.fr) it.push(["FR", t.fr + " irpm"]);
    if (t.temperatura != null) it.push(["Temp", String(t.temperatura).replace(".", ",") + " °C"]);
    if (t.spo2) it.push(["SpO₂", t.spo2 + "%"]);
    if (t.glicemia) it.push(["Glic", t.glicemia + " mg/dL"]);
    if (t.peso) it.push(["Peso", String(t.peso).replace(".", ",") + " kg"]);
    if (t.peso && t.altura) it.push(["IMC", (t.peso / Math.pow(t.altura / 100, 2)).toFixed(1).replace(".", ",")]);
    if (t.dor != null) it.push(["Dor", t.dor + "/10"]);
    const r = t.risco && RISCOS[t.risco];
    return (
      '<div class="akd-tri">' +
      (r ? '<span class="ak-badge risco" style="--rc:' + r.cor + '"><span class="dot"></span>' + r.label + "</span>" : "") +
      '<div class="akd-vit">' + it.map((x) => "<span><small>" + x[0] + "</small><b>" + esc(x[1]) + "</b></span>").join("") + "</div>" +
      (t.queixa_principal ? "<p><b>Queixa:</b> " + esc(t.queixa_principal) + "</p>" : "") +
      (t.alergias ? "<p><b>Alergias:</b> " + esc(t.alergias) + "</p>" : "") +
      (t.medicamentos ? "<p><b>Medicamentos:</b> " + esc(t.medicamentos) + "</p>" : "") +
      (t.observacoes ? "<p><b>Obs.:</b> " + esc(t.observacoes) + "</p>" : "") +
      "<small>" + esc(t.profissional_nome) + (t.profissional_registro ? " · " + esc(t.profissional_registro) : "") + " · " + hhmm(t.realizado_em) + "</small></div>"
    );
  }

  /* ---------- menu do card ---------- */
  function menu(ev, key) {
    const c = cardPorKey(key);
    if (!c) return;
    let el = $("ak-pop");
    if (!el) {
      el = document.createElement("div");
      el.id = "ak-pop";
      el.className = "ak-pop";
      document.body.appendChild(el);
      document.addEventListener("click", (e) => {
        if (!el.contains(e.target)) el.classList.remove("open");
      });
    }
    const st = String((c.ag && c.ag.status) || "").toLowerCase();
    const itens = ["chegada", "entrada", "triagem", "atender", "finalizar", "cobrar", "confirmar", "reagendar", "prontuario"]
      .filter((a) => acaoDisponivel(a, c))
      .map((a) => '<button onclick="AK.acao(\'' + a + "','" + esc(key) + '\')"><i class="ti ' + ACOES[a].icon + '"></i>' + ACOES[a].label + "</button>");
    if (c.ag && c.etapa.tipo === "agendado" && st !== "confirmado")
      itens.push('<button onclick="AK.extra(\'confirmado\',\'' + esc(key) + '\')"><i class="ti ti-check"></i>Marcar como confirmado</button>');
    itens.push('<button onclick="AK.extra(\'detalhes\',\'' + esc(key) + '\')"><i class="ti ti-timeline"></i>Linha do tempo</button>');
    if (c.etapa.tipo !== "concluido")
      itens.push('<button class="danger" onclick="AK.extra(\'falta\',\'' + esc(key) + '\')"><i class="ti ti-user-x"></i>Registrar falta</button>');
    const destinos = S.etapas.filter((e) => podeMover(c.etapa, e));
    el.innerHTML =
      itens.join("") +
      (destinos.length
        ? '<div class="ak-pop-sep">Mover para</div>' +
          destinos.map((e) => '<button onclick="AK.moverPara(\'' + esc(key) + "','" + e.id + '\')"><span class="ak-pop-dot" style="background:' + esc(e.cor) + '"></span>' + esc(e.nome) + "</button>").join("")
        : "");
    el.classList.add("open");
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(8, Math.min(ev.clientX, window.innerWidth - r.width - 8)) + "px";
    el.style.top = Math.max(8, Math.min(ev.clientY + 6, window.innerHeight - r.height - 8)) + "px";
  }
  const fecharMenu = () => $("ak-pop") && $("ak-pop").classList.remove("open");

  /* ---------- arrastar e soltar ---------- */
  function ligarArrastar() {
    document.querySelectorAll("#ak-board .ak-card").forEach((card) => {
      card.ondragstart = (ev) => {
        S.arrastando = card.dataset.key;
        card.classList.add("dragging");
        ev.dataTransfer.effectAllowed = "move";
        try {
          ev.dataTransfer.setData("text/plain", S.arrastando);
        } catch (e) {}
      };
      card.ondragend = () => {
        S.arrastando = null;
        card.classList.remove("dragging");
        document.querySelectorAll("#ak-board .ak-col").forEach((c) => c.classList.remove("drag-over", "drag-block"));
      };
    });
    document.querySelectorAll("#ak-board .ak-col").forEach((col) => {
      const destino = etapa(col.dataset.etapa);
      col.ondragover = (ev) => {
        if (!S.arrastando) return;
        const c = cardPorKey(S.arrastando);
        if (!c || c.etapa.id === destino.id) return;
        ev.preventDefault();
        const ok = podeMover(c.etapa, destino);
        col.classList.toggle("drag-over", ok);
        col.classList.toggle("drag-block", !ok);
        ev.dataTransfer.dropEffect = ok ? "move" : "none";
      };
      col.ondragleave = (ev) => {
        if (!col.contains(ev.relatedTarget)) col.classList.remove("drag-over", "drag-block");
      };
      col.ondrop = async (ev) => {
        ev.preventDefault();
        col.classList.remove("drag-over", "drag-block");
        const key = S.arrastando;
        S.arrastando = null;
        await moverPara(key, destino.id);
      };
    });
  }
  async function moverPara(key, etapaId) {
    fecharMenu();
    const c = cardPorKey(key);
    const destino = etapa(etapaId);
    if (!c || !destino || c.etapa.id === destino.id) return;
    if (!podeMover(c.etapa, destino)) {
      toast('A etapa "' + c.etapa.nome + '" não permite mover para "' + destino.nome + '"', "error");
      return;
    }
    try {
      await mover(c, destino, {});
    } catch (e) {
      console.error("[kanban] mover", e);
      toast("Não foi possível mover: " + (e.message || e), "error");
      recarregar();
    }
  }

  /* ---------- configuração das etapas ---------- */
  function configurar(id) {
    const e = id ? etapa(id) : null;
    const novo = !e;
    const cfg = e || {
      nome: "",
      cor: "#64748b",
      tipo: "personalizada",
      atalho: "",
      acao_ao_entrar: "",
      encaminhar_para: null,
      gatilho_notificar: false,
      gatilho_confirmar: false,
      gatilho_cobranca: false,
      limite_minutos: 20,
      destinos_permitidos: [],
    };
    S.modal = { etapa: e };
    const outras = S.etapas.filter((x) => !e || x.id !== e.id);
    const conc = etapaTipo("concluido");
    const posAtual = e ? S.etapas.indexOf(e) : conc ? S.etapas.indexOf(conc) : S.etapas.length;
    const totalPos = novo ? S.etapas.length + 1 : S.etapas.length;
    const tipoOpts = Object.keys(TIPOS)
      .map((k) => {
        const ocupado = (k === "agendado" || k === "concluido") && S.etapas.some((x) => x.tipo === k && (!e || x.id !== e.id));
        return '<option value="' + k + '"' + (cfg.tipo === k ? " selected" : "") + (ocupado ? " disabled" : "") + ">" + TIPOS[k].label + (ocupado ? " (já existe)" : "") + "</option>";
      })
      .join("");
    const travaTipo = e && (e.tipo === "agendado" || e.tipo === "concluido");
    const acaoOpts = (sel, lista) =>
      '<option value="">Nenhuma</option>' + lista.map((a) => '<option value="' + a + '"' + (sel === a ? " selected" : "") + ">" + ACOES[a].label + "</option>").join("");
    const toggle = (id2, on, t, s) =>
      '<label class="akm-toggle"><input type="checkbox" id="' + id2 + '"' + (on ? " checked" : "") + '><span class="tr"><span class="th"></span></span><span class="tx"><strong>' + t + "</strong><small>" + s + "</small></span></label>";
    const corpo =
      '<div class="akt-sec">Identidade</div><div class="akm-grid">' +
      '<div class="fld"><label>Nome da etapa</label><input id="akg-nome" maxlength="40" value="' + esc(cfg.nome) + '" placeholder="Ex.: Exames, Pós-consulta"></div>' +
      '<div class="fld akg-cor"><label>Cor</label><input id="akg-cor" type="color" value="' + esc(cfg.cor) + '"></div>' +
      '<div class="fld"><label>Tipo</label><select id="akg-tipo" onchange="AK.tipoMudou()"' + (travaTipo ? " disabled" : "") + ">" + tipoOpts + "</select>" +
      '<span class="akm-hint">' + (travaTipo ? "Etapa obrigatória do fluxo." : "Define como o tempo é medido nos cards.") + "</span></div>" +
      '<div class="fld"><label>Posição</label><select id="akg-pos">' +
      Array.from({ length: totalPos }, (_, i) => '<option value="' + i + '"' + (i === posAtual ? " selected" : "") + ">" + (i + 1) + "ª coluna</option>").join("") + "</select></div>" +
      '<div class="fld"><label id="akg-lim-lb">' + (cfg.tipo === "agendado" ? "Tolerância de atraso" : "Tempo-alvo na etapa") + '</label><div class="akt-in"><input id="akg-lim" type="number" min="1" max="1440" value="' + esc(cfg.limite_minutos || "") + '"><span>min</span></div>' +
      '<span class="akm-hint" id="akg-lim-h">' + (cfg.tipo === "agendado" ? "Depois disso o card aparece como atrasado." : "O cronômetro fica amarelo e depois vermelho ao passar desse tempo.") + "</span></div>" +
      "</div>" +
      '<div class="akt-sec sec-auto">Atalho e automação</div><div class="akm-grid">' +
      '<div class="fld"><label>Atalho no card</label><select id="akg-atalho">' + acaoOpts(cfg.atalho, Object.keys(ACOES)) + "</select>" +
      '<span class="akm-hint">Botão de ação rápida enquanto o card está aqui.</span></div>' +
      '<div class="fld"><label>Depois do atalho, encaminhar para</label><select id="akg-enc"><option value="">Ficar nesta etapa</option>' +
      outras.map((x) => '<option value="' + x.id + '"' + (cfg.encaminhar_para === x.id ? " selected" : "") + ">" + esc(x.nome) + "</option>").join("") + "</select>" +
      '<span class="akm-hint">Ex.: triagem salva → "Aguardando médico".</span></div>' +
      '<div class="fld wide"><label>Ao entrar nesta etapa, executar</label><select id="akg-entrar">' +
      acaoOpts(cfg.acao_ao_entrar, ["chegada", "entrada", "triagem", "atender", "finalizar", "cobrar", "confirmar"]) + "</select>" +
      '<span class="akm-hint">Roda quando um card é arrastado ou encaminhado para cá. Formulários (entrada, triagem, cobrança) abrem na hora.</span></div>' +
      "</div>" +
      '<div class="akt-sec sec-trg">Gatilhos</div><div class="akm-toggles">' +
      toggle("akg-notif", cfg.gatilho_notificar, "Notificar a equipe", "Aviso nos outros computadores abertos (recepção, enfermagem, consultório) quando um paciente entrar aqui.") +
      toggle("akg-conf", cfg.gatilho_confirmar, "Enviar confirmação pelo WhatsApp", "Usa o modelo de confirmação escolhido em WhatsApp dos pacientes › Automações.") +
      toggle("akg-cob", cfg.gatilho_cobranca, "Alertar pendência financeira", "Abre a cobrança se a consulta tiver valor em aberto.") +
      "</div>" +
      '<div class="akt-sec sec-perm">Regras de movimento</div>' +
      '<div class="fld"><label>Desta etapa o card pode ir para</label><div class="akm-multi" id="akg-dest">' +
      outras.map((x) => '<label><input type="checkbox" value="' + x.id + '"' + ((cfg.destinos_permitidos || []).includes(x.id) ? " checked" : "") + ">" + '<span class="ak-pop-dot" style="background:' + esc(x.cor) + '"></span>' + esc(x.nome) + "</label>").join("") +
      '</div><span class="akm-hint">Nenhuma marcada = qualquer etapa.</span></div>';
    const podeArquivar = e && e.tipo !== "agendado" && e.tipo !== "concluido";
    abrirModal(
      "ak-etapa",
      modalHtml("ak-etapa", "ti-adjustments-horizontal", "g-emerald", novo ? "Nova etapa" : "Configurar etapa", novo ? "Adicione uma coluna ao fluxo da clínica" : esc(e.nome), corpo,
        (podeArquivar ? '<button class="btn danger" style="margin-right:auto" onclick="AK.arquivarEtapa()"><i class="ti ti-archive"></i> Remover etapa</button>' : "") +
        '<button class="btn" onclick="closeModal()">Cancelar</button><button class="btn primary" id="akg-ok" onclick="AK.salvarEtapa()"><i class="ti ti-check"></i> ' + (novo ? "Criar etapa" : "Salvar etapa") + "</button>", 640),
    );
  }
  function tipoMudou() {
    const ag = val("akg-tipo") === "agendado";
    $("akg-lim-lb").textContent = ag ? "Tolerância de atraso" : "Tempo-alvo na etapa";
    $("akg-lim-h").textContent = ag ? "Depois disso o card aparece como atrasado." : "O cronômetro fica amarelo e depois vermelho ao passar desse tempo.";
  }
  async function salvarEtapa() {
    const e = S.modal && S.modal.etapa;
    const nome = val("akg-nome");
    if (!nome) {
      toast("Dê um nome à etapa", "error");
      return;
    }
    const notificar = $("akg-notif").checked;
    const row = {
      nome,
      cor: val("akg-cor") || "#64748b",
      tipo: e && (e.tipo === "agendado" || e.tipo === "concluido") ? e.tipo : val("akg-tipo") || "personalizada",
      atalho: val("akg-atalho"),
      acao_ao_entrar: val("akg-entrar"),
      encaminhar_para: val("akg-enc") || null,
      gatilho_notificar: notificar,
      gatilho_confirmar: $("akg-conf").checked,
      gatilho_cobranca: $("akg-cob").checked,
      limite_minutos: num("akg-lim") || null,
      destinos_permitidos: Array.from(document.querySelectorAll("#akg-dest input:checked")).map((i) => i.value),
    };
    const btn = $("akg-ok");
    if (btn) btn.disabled = true;
    try {
      let salvo;
      if (e) {
        const r = await db().from("atendimento_etapas").update(row).eq("id", e.id).select("*").single();
        if (r.error) throw r.error;
        salvo = r.data;
        S.etapas[S.etapas.indexOf(e)] = salvo;
      } else {
        const r = await db().from("atendimento_etapas").insert(Object.assign(row, { ordem: 0 })).select("*").single();
        if (r.error) throw r.error;
        salvo = r.data;
        S.etapas.push(salvo);
      }
      await reordenar(salvo, Number(val("akg-pos")));
      if (notificar && window.Notification && Notification.permission === "default") {
        try {
          Notification.requestPermission();
        } catch (e2) {}
      }
      fecharModal();
      toast(e ? "Etapa atualizada" : "Etapa criada", "success");
      render();
    } catch (err) {
      console.error("[kanban] etapa", err);
      toast("Erro ao salvar etapa: " + (err.message || err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  async function reordenar(alvo, pos) {
    const lista = S.etapas.filter((x) => x.id !== alvo.id);
    lista.splice(Math.max(0, Math.min(pos, lista.length)), 0, alvo);
    const mudancas = [];
    lista.forEach((x, i) => {
      const ordem = (i + 1) * 10;
      if (x.ordem !== ordem) {
        x.ordem = ordem;
        mudancas.push(db().from("atendimento_etapas").update({ ordem }).eq("id", x.id));
      }
    });
    S.etapas = lista;
    const res = await Promise.all(mudancas);
    const erro = res.find((r) => r.error);
    if (erro) throw erro.error;
  }
  async function arquivarEtapa() {
    const e = S.modal && S.modal.etapa;
    if (!e) return;
    const { count, error } = await db()
      .from("atendimento_fluxo")
      .select("id", { count: "exact", head: true })
      .eq("etapa_id", e.id)
      .is("finalizado_em", null)
      .is("faltou_em", null);
    if (error) {
      toast("Erro ao verificar a etapa: " + error.message, "error");
      return;
    }
    if (count) {
      toast("Há " + count + " paciente(s) nesta etapa. Mova-os antes de removê-la.", "error");
      return;
    }
    if (!confirm('Remover a etapa "' + e.nome + '"? O histórico de tempo dos atendimentos é mantido.')) return;
    try {
      const refs = S.etapas.filter((x) => x.encaminhar_para === e.id || (x.destinos_permitidos || []).includes(e.id));
      await Promise.all(
        refs.map((x) =>
          db()
            .from("atendimento_etapas")
            .update({
              encaminhar_para: x.encaminhar_para === e.id ? null : x.encaminhar_para,
              destinos_permitidos: (x.destinos_permitidos || []).filter((d) => d !== e.id),
            })
            .eq("id", x.id),
        ),
      );
      const r = await db().from("atendimento_etapas").update({ arquivada: true }).eq("id", e.id);
      if (r.error) throw r.error;
      fecharModal();
      toast("Etapa removida", "success");
      recarregar();
    } catch (err) {
      toast("Erro ao remover etapa: " + (err.message || err), "error");
    }
  }

  /* ---------- prontuário ---------- */
  // "Salvar e finalizar" no prontuário conclui o card do paciente no kanban.
  async function onConsultaFinalizada(pacienteId, consultaId) {
    try {
      if (!S.carregado) await recarregar();
      const hoje = hojeIso();
      const ativos = montarCards().filter((c) => c.pacienteId === pacienteId && c.etapa.tipo !== "concluido");
      const naClinica = ativos.filter((c) => c.etapa.tipo !== "agendado");
      // Atendido sem a recepção registrar a chegada: conclui a consulta de hoje
      // mais próxima do horário atual.
      const agendadoHoje = ativos
        .filter((c) => c.etapa.tipo === "agendado" && new Date(c.horario).toLocaleDateString("sv-SE") === hoje)
        .sort((a, b) => Math.abs(new Date(a.horario) - agora()) - Math.abs(new Date(b.horario) - agora()))[0];
      const c =
        naClinica.find((x) => x.f && x.f.id === S.atendendo) ||
        naClinica.find((x) => x.etapa.tipo === "consultorio") ||
        naClinica.sort((a, b) => new Date(b.desde) - new Date(a.desde))[0] ||
        agendadoHoje;
      if (!c) return;
      if (!(c.f && c.f.chamado_em)) {
        const ts = c.etapa.tipo === "consultorio" ? c.desde : agoraIso();
        await atualizarFluxo(c, c.f && c.f.chegada_em ? { chamado_em: ts } : { chamado_em: ts, chegada_em: ts });
      }
      await acaoFinalizar(c, { consultaId });
      toast(c.nome.split(" ")[0] + " movido para " + c.etapa.nome, "success");
    } catch (e) {
      console.error("[kanban] finalizar pelo prontuário", e);
    }
  }

  // Faixa com a triagem do dia no topo do prontuário, para o médico.
  async function triagemBanner(pacienteId) {
    const ref = $("pth-video-banner");
    if (!ref) return;
    let el = $("pth-triagem");
    if (!el) {
      el = document.createElement("div");
      el.id = "pth-triagem";
      el.className = "pth-triagem";
      ref.parentNode.insertBefore(el, ref.nextSibling);
    }
    el.style.display = "none";
    el.dataset.pid = pacienteId || "";
    if (!pacienteId || !db()) return;
    const desde = new Date(agora() - 18 * 3600 * 1000).toISOString();
    const { data } = await db()
      .from("triagens")
      .select("*")
      .eq("paciente_id", pacienteId)
      .gte("realizado_em", desde)
      .order("realizado_em", { ascending: false })
      .limit(1);
    const t = (data || [])[0];
    if (!t || el.dataset.pid !== pacienteId) return;
    el.innerHTML =
      '<div class="ptt-ic"><i class="ti ti-heart-rate-monitor"></i></div><div class="ptt-body"><div class="ptt-title">Triagem de hoje · ' + hhmm(t.realizado_em) + "</div>" +
      triagemResumoHtml(t) + "</div>";
    el.style.display = "flex";
  }

  /* ---------- API pública ---------- */
  window.AK = {
    recarregar,
    render,
    configurar,
    tipoMudou,
    salvarEtapa,
    arquivarEtapa,
    menu,
    moverPara,
    focar(tipo) {
      const e = etapaTipo(tipo);
      const col = e && document.querySelector('#ak-board .ak-col[data-etapa="' + e.id + '"]');
      if (col) {
        col.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        col.classList.add("pulse");
        setTimeout(() => col.classList.remove("pulse"), 900);
      }
    },
    abrirCard(key) {
      const c = cardPorKey(key);
      if (c) abrirDetalhes(c);
    },
    acao(a, key) {
      fecharMenu();
      const c = cardPorKey(key);
      if (c) executar(a, c, {});
    },
    extra(a, key) {
      fecharMenu();
      const c = cardPorKey(key);
      if (!c) return;
      const run = a === "confirmado" ? marcarConfirmado : a === "falta" ? marcarFalta : abrirDetalhes;
      Promise.resolve(run(c)).catch((e) => toast("Erro: " + (e.message || e), "error"));
    },
    encaixe: abrirEncaixe,
    salvarEntrada,
    salvarCobranca,
    salvarReagendamento,
    salvarEncaixe,
    salvarTriagem,
    escolherRisco,
    alertasTriagem,
  };
  window.atdOnConsultaFinalizada = onConsultaFinalizada;
  window.atdTriagemBanner = triagemBanner;
  // Nomes usados pelo HTML da tela e pelo carregamento do app.
  window.renderKanban = recarregar;
  window.setKanbanFilter = function (f) {
    S.filtro = f;
    const sel = $("atd-period-select");
    if (sel) sel.value = f;
    const cu = $("atd-custom");
    if (cu) cu.classList.toggle("show", f === "custom");
    recarregar();
  };

  // O quadro antigo guardava cards e etapas só no navegador.
  ["kanbanAtend", "kanbanMeta", "kanbanColsCfg"].forEach((k) => {
    try {
      localStorage.removeItem(k);
    } catch (e) {}
  });
  setInterval(tick, 30000);
  // Sem tempo real (ou com a aba em segundo plano), sincroniza de tempos em tempos.
  setInterval(() => {
    if (!document.hidden && $("s-atendimentos") && $("s-atendimentos").style.display !== "none" && S.carregado && !S.arrastando && !(S.modal && $("modal-overlay") && $("modal-overlay").classList.contains("open")))
      recarregar();
  }, 90000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && S.carregado) recarregar();
  });
  if (usuarioAtual()) recarregar();
})();
