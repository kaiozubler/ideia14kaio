/* FATURAMENTO — módulo standalone.
   Quatro perspectivas sobre o mesmo dinheiro:
   - Lançamentos: recebimentos e pagamentos (lancamentos_financeiros) — o razão central.
   - Trabalhos: cada serviço prestado (faturamento_execucoes) e os serviços frequentes programados (faturamento_servicos).
   - Clientes: tomadores dos serviços (faturamento_clientes — não são pacientes) e os próximos 6 pagamentos de cada um.
   - Notas fiscais: faturamento_notas, que podem agrupar vários recebimentos (quinzenal/mensal).
   Serviços frequentes mantêm sempre os próximos 6 pagamentos previstos materializados; cada um pode ser editado
   individualmente (editado = true) e nunca é recalculado depois disso. */
(function () {
  const MEIOS = ["PIX", "Transferência", "Boleto", "Cartão de crédito", "Cartão de débito", "Dinheiro", "Depósito", "Repasse"];
  const TIPOS_SERVICO = ["Plantão", "Consulta", "Procedimento", "Cirurgia", "Laudo", "Telemedicina", "Assessoria / Consultoria", "Aula / Palestra", "Outros"];
  const CATEGORIAS_SAIDA = ["Aluguel", "Pessoal", "Impostos", "Insumos", "Serviços de terceiros", "Equipamentos", "Marketing", "Gastos", "Outros"];
  const EMISSAO = {
    cada_servico: "A cada serviço",
    quinzenal: "A cada 15 dias",
    mensal: "Todo mês",
    autorizacao: "Mediante autorização",
    sem_emissao: "Sem emissão",
  };
  const EMISSAO_CONSULTA = { cada_servico: "Emitir na data do atendimento", autorizacao: "Mediante autorização", sem_emissao: "Sem emissão" };
  const AGRUP = { por_servico: "A cada serviço", quinzenal: "Quinzenal", mensal: "Mensal" };
  const AGRUP_DA_EMISSAO = { cada_servico: "por_servico", quinzenal: "quinzenal", mensal: "mensal" };
  const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const DIAS_SEMANA_LONGO = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];
  const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const PREVISAO_PAGAMENTOS = 6;
  const HORIZONTE_DIAS = 30;

  const VIEWS = [
    { key: "lancamentos", label: "Lançamentos" },
    { key: "trabalhos", label: "Trabalhos" },
    { key: "clientes", label: "Clientes" },
    { key: "notas", label: "Notas fiscais" },
  ];
  const TABS = [
    { key: "todos", label: "Todos" },
    { key: "a_receber", label: "A receber" },
    { key: "previstos", label: "Previsões" },
    { key: "recebidos", label: "Recebidos" },
    { key: "atrasados", label: "Atrasados" },
    { key: "a_pagar", label: "A pagar" },
    { key: "pagos", label: "Pagos" },
    { key: "comissoes", label: "Comissões" },
  ];
  const NOTA_TABS = [
    { key: "todas", label: "Todas" },
    { key: "aguardando_autorizacao", label: "Aguardando autorização" },
    { key: "pendente", label: "A emitir" },
    { key: "emitida", label: "Emitidas" },
    { key: "cancelada", label: "Canceladas" },
  ];
  const SIT = {
    Recebido: { bg: "rgba(209,250,229,.9)", color: "#065f46", dot: "#10b981" },
    Pago: { bg: "rgba(209,250,229,.9)", color: "#065f46", dot: "#10b981" },
    "A receber": { bg: "rgba(254,249,195,.9)", color: "#92400e", dot: "#f59e0b" },
    "A pagar": { bg: "rgba(254,249,195,.9)", color: "#78350f", dot: "#f59e0b" },
    Previsto: { bg: "rgba(237,233,254,.9)", color: "#5b21b6", dot: "#8b5cf6" },
    Atrasado: { bg: "rgba(255,237,213,.9)", color: "#c2410c", dot: "#f97316" },
    Realizado: { bg: "rgba(209,250,229,.9)", color: "#065f46", dot: "#10b981" },
    Cancelado: { bg: "rgba(243,244,246,.9)", color: "#6b7280", dot: "#9ca3af" },
    Cobrado: { bg: "rgba(243,244,246,.9)", color: "#374151", dot: "#9ca3af" },
  };
  const NOTA_SIT = {
    pendente: { l: "NF a emitir", bg: "rgba(254,249,195,.9)", color: "#92400e", dot: "#f59e0b" },
    aguardando_autorizacao: { l: "Aguardando autorização", bg: "rgba(237,233,254,.9)", color: "#5b21b6", dot: "#8b5cf6" },
    emitida: { l: "Emitida", bg: "rgba(219,234,254,.9)", color: "#1d4ed8", dot: "#3b82f6" },
    cancelada: { l: "Cancelada", bg: "rgba(254,226,226,.9)", color: "#991b1b", dot: "#ef4444" },
  };
  const TIPO = {
    Receita: { bg: "rgba(220,252,231,.85)", color: "#065f46" },
    Despesa: { bg: "rgba(254,226,226,.85)", color: "#991b1b" },
    "Comissão": { bg: "rgba(219,234,254,.85)", color: "#1e40af" },
  };
  const CARDS_T = [
    { bg: "rgba(220,252,231,.72)", c: "#16a34a" },
    { bg: "rgba(237,233,254,.72)", c: "#7c3aed" },
    { bg: "rgba(255,237,213,.72)", c: "#ea580c" },
    { bg: "rgba(254,226,226,.72)", c: "#dc2626" },
  ];

  /* ---------- UTIL ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v) => "R$ " + Number(v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fmtDate = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—");
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
  const round2 = (v) => Math.round(v * 100) / 100;
  const sbc = () => window.sb || window.__sb;
  const toast = (m) => { if (typeof window.toast === "function") window.toast(m); };
  const digits = (s) => String(s || "").replace(/\D/g, "");

  /* Datas como "AAAA-MM-DD", aritmética em UTC para não sofrer com fuso/horário de verão. */
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (y, m, d) => y + "-" + pad(m) + "-" + pad(d);
  const parts = (iso) => iso.split("-").map(Number);
  const toUTC = (iso) => { const [y, m, d] = parts(iso); return Date.UTC(y, m - 1, d); };
  const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (iso, n) => fromUTC(toUTC(iso) + n * 86400000);
  const dow = (iso) => new Date(toUTC(iso)).getUTCDay();
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const maxIso = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
  const minIso = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
  const today = () => { const d = new Date(); return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); };
  const mesLabel = (iso) => { const [y, m] = parts(iso); return MESES[m - 1] + "/" + y; };

  /* ---------- AGENDA (funções puras) ---------- */
  function ocorrencias(svc, de, ate) {
    const ini = maxIso(de, svc.data_inicio), fim = minIso(ate, svc.data_fim);
    if (!ini || !fim || ini > fim) return [];
    const out = [];
    if (svc.frequencia === "mensal") {
      const dias = [...new Set((svc.dias_mes || []).map(Number))].sort((a, b) => a - b);
      if (!dias.length) return [];
      let [y, m] = parts(ini);
      for (let guard = 0; guard < 400; guard++) {
        const ld = lastDay(y, m);
        const doMes = [...new Set(dias.map((d) => Math.min(d, ld)))];
        for (const d of doMes) { const iso = ymd(y, m, d); if (iso >= ini && iso <= fim) out.push(iso); }
        if (ymd(y, m, ld) >= fim) break;
        m++; if (m > 12) { m = 1; y++; }
      }
      return out;
    }
    const dias = new Set((svc.dias_semana || []).map(Number));
    if (!dias.size) return [];
    const intervalo = Math.max(1, Number(svc.intervalo_semanas) || 1);
    const semanaBase = toUTC(addDays(svc.data_inicio || ini, -dow(svc.data_inicio || ini)));
    for (let d = ini, guard = 0; d <= fim && guard < 3700; d = addDays(d, 1), guard++) {
      if (!dias.has(dow(d))) continue;
      const semana = Math.round((toUTC(addDays(d, -dow(d))) - semanaBase) / (7 * 86400000));
      if (semana % intervalo === 0) out.push(d);
    }
    return out;
  }

  function periodo(iso, agrupamento) {
    const [y, m, d] = parts(iso);
    if (agrupamento === "mensal") return { inicio: ymd(y, m, 1), fim: ymd(y, m, lastDay(y, m)) };
    if (agrupamento === "quinzenal") return d <= 15 ? { inicio: ymd(y, m, 1), fim: ymd(y, m, 15) } : { inicio: ymd(y, m, 16), fim: ymd(y, m, lastDay(y, m)) };
    return { inicio: iso, fim: iso };
  }

  function periodoLabel(inicio, fim, agrupamento) {
    if (agrupamento === "mensal") return mesLabel(inicio);
    if (agrupamento === "quinzenal") return (parts(inicio)[2] === 1 ? "1ª" : "2ª") + " quinzena " + mesLabel(inicio);
    return fmtDate(inicio) + (fim && fim !== inicio ? " a " + fmtDate(fim) : "");
  }

  function vencimento(svc, fimPeriodo) {
    if (svc.pagamento_regra === "dia_fixo" && svc.pagamento_dia_mes) {
      let [y, m] = parts(fimPeriodo);
      const dia = Number(svc.pagamento_dia_mes);
      let c = ymd(y, m, Math.min(dia, lastDay(y, m)));
      if (c < fimPeriodo) { m++; if (m > 12) { m = 1; y++; } c = ymd(y, m, Math.min(dia, lastDay(y, m))); }
      return c;
    }
    return addDays(fimPeriodo, Math.max(0, Number(svc.pagamento_dias) || 0));
  }

  /* Períodos de cobrança a partir de `inicio` até reunir `minFuturos` pagamentos em aberto (vencimento >= hoje).
     `existentes` (inicio do período → { aberto }) são pulados mas contam como futuros quando ainda abertos. */
  function planejar(svc, opts) {
    const hoje = opts.hoje || today();
    const minFuturos = opts.minFuturos ?? PREVISAO_PAGAMENTOS;
    const maxPeriodos = opts.maxPeriodos || 120;
    const existentes = opts.existentes || new Map();
    const agr = svc.agrupamento || "por_servico";
    const out = [];
    let futuros = 0, iter = 0;
    if (minFuturos <= 0) return out;
    const conta = (p) => {
      iter++;
      const ex = existentes.get(p.inicio);
      if (ex) { if (ex.aberto) futuros++; return; }
      out.push(p);
      if (p.vencimento >= hoje) futuros++;
    };
    let cursor = maxIso(opts.inicio, svc.data_inicio);
    if (!cursor) return out;
    if (agr === "por_servico") {
      while (futuros < minFuturos && iter < maxPeriodos) {
        if (svc.data_fim && cursor > svc.data_fim) break;
        const datas = ocorrencias(svc, cursor, addDays(cursor, 400));
        if (!datas.length) break;
        for (const d of datas) {
          conta({ inicio: d, fim: d, datas: [d], vencimento: vencimento(svc, d) });
          if (futuros >= minFuturos || iter >= maxPeriodos) break;
        }
        cursor = addDays(datas[datas.length - 1], 1);
      }
      return out;
    }
    let p = periodo(cursor, agr), vazios = 0;
    while (futuros < minFuturos && iter < maxPeriodos && vazios < 26) {
      if (svc.data_fim && p.inicio > svc.data_fim) break;
      const datas = ocorrencias(svc, maxIso(p.inicio, cursor), p.fim);
      if (datas.length) { vazios = 0; conta({ inicio: p.inicio, fim: p.fim, datas, vencimento: vencimento(svc, p.fim) }); }
      else vazios++;
      p = periodo(addDays(p.fim, 1), agr);
    }
    return out;
  }

  function recorrenciaTexto(svc) {
    if (svc.frequencia === "mensal") {
      const d = [...(svc.dias_mes || [])].sort((a, b) => a - b);
      return d.length ? (d.length === 1 ? "Todo dia " + d[0] : "Dias " + d.slice(0, -1).join(", ") + " e " + d[d.length - 1]) + " de cada mês" : "Sem dias definidos";
    }
    const d = [...(svc.dias_semana || [])].sort((a, b) => a - b).map((i) => DIAS_SEMANA_LONGO[i]);
    if (!d.length) return "Sem dias definidos";
    const lista = d.length === 1 ? d[0] : d.slice(0, -1).join(", ") + " e " + d[d.length - 1];
    const n = Number(svc.intervalo_semanas) || 1;
    return lista.charAt(0).toUpperCase() + lista.slice(1) + (n === 1 ? ", toda semana" : ", a cada " + n + " semanas");
  }

  function pagamentoTexto(svc) {
    const base = (svc.agrupamento || "por_servico") === "por_servico" ? "o serviço" : "o fechamento do período";
    if (svc.pagamento_regra === "dia_fixo") return "Dia " + svc.pagamento_dia_mes + " após " + base;
    const n = Number(svc.pagamento_dias) || 0;
    return n ? n + " dia" + (n > 1 ? "s" : "") + " após " + base : "No dia do " + (base === "o serviço" ? "serviço" : "fechamento");
  }

  window.FaturamentoAgenda = { ocorrencias, periodo, periodoLabel, vencimento, planejar, recorrenciaTexto, addDays };

  /* ---------- VALIDAÇÃO ---------- */
  function cpfValido(v) {
    const c = digits(v); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
    for (let t = 9; t < 11; t++) {
      let s = 0; for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
      if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
    }
    return true;
  }
  function cnpjValido(v) {
    const c = digits(v); if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
    const calc = (n) => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += Number(c[i]) * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
  }
  function fmtDoc(v) {
    const c = digits(v);
    if (c.length === 11) return c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
    if (c.length === 14) return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    return v || "";
  }

  /* ---------- ESTADO ---------- */
  const filtrosVazios = () => ({ cliente: "", origem: "", meio: "", tipo: "", medico: "", nat: "", vmin: "", vmax: "" });
  const S = {
    view: "lancamentos", tab: "todos", notaTab: "todas", trabMes: today().slice(0, 7), cliBusca: "",
    rows: [], clientes: [], servicos: [], execucoes: [], notas: [],
    selected: [], showFilters: false, loading: true, busy: false, filters: filtrosVazios(),
    modal: null, modal2: null,
  };
  const cliente = (id) => S.clientes.find((c) => c.id === id) || null;
  const nota = (id) => S.notas.find((n) => n.id === id) || null;
  const servico = (id) => S.servicos.find((s) => s.id === id) || null;

  function mapRow(r) {
    return {
      id: r.id, tipo: r.tipo, desc: r.descricao, paciente: r.paciente_nome || "",
      paciente_id: r.paciente_id || null, medico: r.medico || "", esp: r.especialidade || "",
      data: r.data, venc: r.vencimento, valor: Number(r.valor || 0),
      status: r.status, etiqueta: r.etiqueta, natureza: r.natureza || "", pago: !!r.pago,
      comissao_pct: Number(r.comissao_pct || 0), comissao_val: Number(r.comissao_val || 0),
      nf_numero: r.nf_numero, nf_serie: r.nf_serie, nf_status: r.nf_status, nf_emitida_em: r.nf_emitida_em,
      origem: r.origem || (r.tipo === "Receita" ? "outros" : null), cliente_id: r.cliente_id || null,
      servico_id: r.servico_id || null, nota_id: r.nota_id || null, tipo_servico: r.tipo_servico || "",
      comp_ini: r.competencia_inicio || null, comp_fim: r.competencia_fim || null,
      valor_nf: r.valor_nf == null ? null : Number(r.valor_nf), observacao_nf: r.observacao_nf || "",
      nf_modo: r.nf_modo || null, meio: r.meio_pagamento || "", data_pagamento: r.data_pagamento || null,
      editado: !!r.editado,
    };
  }
  const valorNF = (r) => (r.valor_nf == null ? r.valor : r.valor_nf);
  const valorLinha = (r) => (r.tipo === "Comissão" ? r.comissao_val : r.valor);
  const nomeContraparte = (r) => (r.cliente_id && cliente(r.cliente_id) ? cliente(r.cliente_id).nome : r.paciente || (r.tipo !== "Receita" ? r.medico : ""));

  function situacao(r) {
    const h = today();
    if (r.tipo === "Receita") {
      if (r.pago) return "Recebido";
      if (r.venc && r.venc < h) return "Atrasado";
      if (r.venc && r.venc > addDays(h, HORIZONTE_DIAS)) return "Previsto";
      return "A receber";
    }
    if (r.pago) return "Pago";
    return r.venc && r.venc < h ? "Atrasado" : "A pagar";
  }

  /* ---------- DADOS ---------- */
  async function load() {
    const sb = sbc(); if (!sb) return;
    S.loading = true; render();
    try {
      await fetchAll();
      if (await sincronizar()) await fetchAll();
    } catch (err) {
      console.error("[faturamento]", err);
      toast("Erro ao carregar o faturamento: " + (err.message || err));
    }
    S.loading = false; render();
  }

  async function fetchAll() {
    const sb = sbc();
    const [l, c, s, e, n] = await Promise.all([
      sb.from("lancamentos_financeiros").select("*").order("vencimento", { ascending: false, nullsFirst: false }).order("data", { ascending: false }),
      sb.from("faturamento_clientes").select("*").order("nome"),
      sb.from("faturamento_servicos").select("*").order("created_at", { ascending: false }),
      sb.from("faturamento_execucoes").select("*").order("data"),
      sb.from("faturamento_notas").select("*").order("created_at", { ascending: false }),
    ]);
    const err = l.error || c.error || s.error || e.error || n.error;
    if (err) throw err;
    S.rows = (l.data || []).map(mapRow);
    S.clientes = c.data || [];
    S.servicos = s.data || [];
    S.execucoes = e.data || [];
    S.notas = n.data || [];
  }

  /* Mantém os próximos pagamentos dos serviços frequentes e gera as NFs cujo momento chegou. */
  async function sincronizar() {
    let mudou = false;
    for (const svc of S.servicos.filter((x) => x.modalidade === "frequente" && x.ativo)) {
      if (await completarPrevisao(svc)) mudou = true;
    }
    if (mudou) await fetchAll();
    if (await processarNotas()) mudou = true;
    return mudou;
  }

  async function completarPrevisao(svc) {
    const h = today();
    const doSvc = S.rows.filter((r) => r.servico_id === svc.id);
    const abertos = doSvc.filter((r) => !r.pago && r.venc && r.venc >= h).length;
    if (abertos >= PREVISAO_PAGAMENTOS) return false;
    const ultimoFim = doSvc.reduce((m, r) => maxIso(m, r.comp_fim || r.comp_ini), null);
    const inicio = ultimoFim ? addDays(ultimoFim, 1) : svc.data_inicio;
    const periodos = planejar(svc, { inicio, hoje: h, minFuturos: PREVISAO_PAGAMENTOS - abertos });
    if (!periodos.length) return false;
    await inserirPeriodos(svc, periodos, {});
    return true;
  }

  function linhaDoPeriodo(svc, p, ov) {
    const qtd = p.datas.length;
    const agr = svc.agrupamento || "por_servico";
    const desc = svc.tipo_servico + (svc.descricao ? " — " + svc.descricao : "") + (agr !== "por_servico" ? " (" + periodoLabel(p.inicio, p.fim, agr) + ", " + qtd + "×)" : "");
    const o = ov || {};
    return {
      tipo: "Receita", origem: "servico", natureza: "Serviço", descricao: desc,
      cliente_id: svc.cliente_id, servico_id: svc.id, tipo_servico: svc.tipo_servico,
      data: p.inicio, competencia_inicio: p.inicio, competencia_fim: p.fim,
      vencimento: o.vencimento || p.vencimento,
      valor: o.valor != null && o.valor !== "" ? round2(num(o.valor)) : round2(qtd * Number(svc.valor_bruto)),
      valor_nf: o.valor_nf != null && o.valor_nf !== "" ? round2(num(o.valor_nf)) : round2(qtd * Number(svc.valor_nf)),
      observacao_nf: o.observacao_nf != null ? o.observacao_nf || null : svc.observacao_nf || null,
      nf_modo: svc.emissao_nf, meio_pagamento: svc.meio_pagamento || null,
      status: "A receber", etiqueta: "A receber", pago: false, editado: !!ov,
    };
  }

  async function inserirPeriodos(svc, periodos, overrides) {
    const sb = sbc();
    const linhas = periodos.map((p) => linhaDoPeriodo(svc, p, overrides[p.inicio]));
    const ins = await sb.from("lancamentos_financeiros").upsert(linhas, { onConflict: "servico_id,competencia_inicio", ignoreDuplicates: true });
    if (ins.error) throw ins.error;
    const { data: ids, error } = await sb.from("lancamentos_financeiros").select("id,competencia_inicio").eq("servico_id", svc.id).in("competencia_inicio", periodos.map((p) => p.inicio));
    if (error) throw error;
    const porComp = new Map((ids || []).map((r) => [r.competencia_inicio, r.id]));
    const execs = [];
    for (const p of periodos) for (const d of p.datas) {
      execs.push({ servico_id: svc.id, lancamento_id: porComp.get(p.inicio) || null, data: d, valor_bruto: svc.valor_bruto, valor_nf: svc.valor_nf, status: "previsto" });
    }
    if (execs.length) {
      const r = await sb.from("faturamento_execucoes").upsert(execs, { onConflict: "servico_id,data", ignoreDuplicates: true });
      if (r.error) throw r.error;
    }
  }

  /* ---------- NOTAS FISCAIS ---------- */
  async function proximoNumero(serie) {
    const sb = sbc();
    const [a, b] = await Promise.all([
      sb.from("faturamento_notas").select("numero").eq("serie", serie).not("numero", "is", null).order("numero", { ascending: false }).limit(1),
      sb.from("lancamentos_financeiros").select("nf_numero").not("nf_numero", "is", null).order("nf_numero", { ascending: false }).limit(1),
    ]);
    return Math.max((a.data && a.data[0] && a.data[0].numero) || 0, (b.data && b.data[0] && b.data[0].nf_numero) || 0) + 1;
  }

  async function emitirNota(id, extra) {
    const sb = sbc();
    const n = nota(id) || { serie: "1" };
    for (let t = 0; t < 5; t++) {
      const numero = await proximoNumero(n.serie || "1");
      const { error } = await sb.from("faturamento_notas").update({ numero, status: "emitida", emitida_em: new Date().toISOString(), ...(extra || {}) }).eq("id", id);
      if (!error) return numero;
      if (error.code !== "23505") throw error;
    }
    throw new Error("Não foi possível reservar o número da NF");
  }

  /* Cria uma NF para os recebimentos informados. Os recebimentos são "reservados" (nota_id) antes da numeração,
     para que duas abas abertas não gerem NFs em dobro. */
  async function criarNota(linhas, status, modo) {
    const sb = sbc();
    const valor = round2(linhas.reduce((s, r) => s + valorNF(r), 0));
    if (valor <= 0) return null;
    const r0 = linhas[0];
    const cli = r0.cliente_id ? cliente(r0.cliente_id) : null;
    const comps = linhas.map((r) => r.comp_ini || r.data).sort();
    const fins = linhas.map((r) => r.comp_fim || r.comp_ini || r.data).sort();
    const obs = [...new Set(linhas.map((r) => r.observacao_nf).filter(Boolean))].join("\n");
    const { data: nt, error } = await sb.from("faturamento_notas").insert({
      cliente_id: r0.cliente_id, paciente_id: r0.cliente_id ? null : r0.paciente_id,
      tomador_nome: cli ? cli.nome : r0.paciente || null, status: "pendente", modo: modo || r0.nf_modo,
      competencia_inicio: comps[0], competencia_fim: fins[fins.length - 1], valor,
      descricao: linhas.map((r) => r.desc).join("\n"), observacao: obs || null,
      payload: { tomador: cli ? { nome: cli.nome, documento: cli.documento, email: cli.email, iss_retido: cli.iss_retido, codigo_municipio: cli.codigo_municipio } : { nome: r0.paciente }, emitida_por: "MediCopilot" },
    }).select("*").single();
    if (error) throw error;
    const claim = await sb.from("lancamentos_financeiros").update({ nota_id: nt.id }).in("id", linhas.map((r) => r.id)).is("nota_id", null).select("id");
    if (claim.error || !(claim.data || []).length) { await sb.from("faturamento_notas").delete().eq("id", nt.id); return null; }
    S.notas.unshift(nt);
    if (status === "emitida") return { ...nt, numero: await emitirNota(nt.id) };
    if (status !== "pendente") await sb.from("faturamento_notas").update({ status }).eq("id", nt.id);
    return nt;
  }

  async function processarNotas() {
    const h = today();
    const grupos = new Map();
    for (const r of S.rows) {
      if (r.tipo !== "Receita" || r.nota_id || r.nf_numero || !r.nf_modo || r.nf_modo === "sem_emissao") continue;
      const comp = r.comp_ini || r.data, fim = r.comp_fim || comp;
      let chave = null;
      if (r.nf_modo === "cada_servico" || r.nf_modo === "autorizacao") { if (fim <= h) chave = r.id; }
      else {
        const p = periodo(comp, r.nf_modo);
        if (p.fim < h && fim <= p.fim) chave = [r.nf_modo, r.cliente_id || r.paciente_id || r.paciente || "-", p.inicio].join("|");
        else if (p.fim < h && fim < h) chave = r.id;
      }
      if (!chave) continue;
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(r);
    }
    let mudou = false;
    for (const linhas of grupos.values()) {
      const modo = linhas[0].nf_modo;
      try { if (await criarNota(linhas, modo === "autorizacao" ? "aguardando_autorizacao" : "emitida", modo)) mudou = true; }
      catch (err) { console.error("[faturamento] NF", err); }
    }
    return mudou;
  }

  /* ---------- AÇÕES ---------- */
  async function run(fn, okMsg) {
    if (S.busy) return false;
    S.busy = true;
    let ok = true;
    try { await fn(); if (okMsg) toast(okMsg); }
    catch (err) { ok = false; console.error("[faturamento]", err); alert("Erro: " + (err.message || err)); }
    S.busy = false;
    await load();
    return ok;
  }

  const statusPago = (r) => (r.tipo === "Receita" ? "Recebido" : "Pago");
  async function marcarPago(ids, data) {
    const sb = sbc();
    for (const id of ids) {
      const r = S.rows.find((x) => x.id === id); if (!r || r.pago) continue;
      const { error } = await sb.from("lancamentos_financeiros").update({ pago: true, data_pagamento: data || today(), status: statusPago(r), etiqueta: statusPago(r) }).eq("id", id);
      if (error) throw error;
    }
  }

  async function emitirParaLinhas(ids) {
    const sb = sbc();
    for (const id of ids) {
      const r = S.rows.find((x) => x.id === id);
      if (!r || r.tipo !== "Receita" || r.nf_numero) continue;
      const n = r.nota_id ? nota(r.nota_id) : null;
      if (n && n.status === "aguardando_autorizacao") { await emitirNota(n.id, { autorizada_em: new Date().toISOString() }); continue; }
      if (n && n.status === "pendente") { await emitirNota(n.id); continue; }
      if (n && n.status === "emitida") continue;
      if (n) { await sb.from("lancamentos_financeiros").update({ nota_id: null }).eq("id", id); r.nota_id = null; }
      await criarNota([r], "emitida", "manual");
    }
  }

  async function rowAction(id, action) {
    const sb = sbc(); const r = S.rows.find((x) => x.id === id); if (!sb || !r) return;
    if (action === "receber" || action === "pagar") return run(() => marcarPago([id]), action === "receber" ? "Recebimento registrado" : "Pagamento registrado");
    if (action === "nf") return run(() => emitirParaLinhas([id]), "NF emitida");
    if (action === "cobrar") return run(async () => { const { error } = await sb.from("lancamentos_financeiros").update({ etiqueta: "Cobrado" }).eq("id", id); if (error) throw error; }, "Marcado como cobrado");
    if (action === "editar") { S.modal = abrirLancamento(r); return render(); }
  }

  async function massAction(action) {
    const sel = S.rows.filter((r) => S.selected.includes(r.id));
    let ids = [];
    if (action === "receber") ids = sel.filter((r) => r.tipo === "Receita" && !r.pago).map((r) => r.id);
    if (action === "pagar") ids = sel.filter((r) => r.tipo !== "Receita" && !r.pago).map((r) => r.id);
    if (action === "nf") ids = sel.filter((r) => r.tipo === "Receita" && !r.nf_numero && !(r.nota_id && nota(r.nota_id) && nota(r.nota_id).status === "emitida")).map((r) => r.id);
    if (action === "cobrar") ids = sel.filter((r) => r.tipo === "Receita" && !r.pago && situacao(r) === "Atrasado").map((r) => r.id);
    S.selected = [];
    if (!ids.length) { toast("Nenhum lançamento selecionado se aplica a esta ação"); return render(); }
    if (action === "receber" || action === "pagar") return run(() => marcarPago(ids), ids.length + " lançamento(s) baixado(s)");
    if (action === "nf") return run(() => emitirParaLinhas(ids), "NFs emitidas");
    if (action === "cobrar") return run(async () => { const { error } = await sbc().from("lancamentos_financeiros").update({ etiqueta: "Cobrado" }).in("id", ids); if (error) throw error; });
  }

  async function notaAction(id, action) {
    const sb = sbc(); const n = nota(id); if (!n) return;
    const fechar = (ok) => { if (ok && S.modal && S.modal.kind === "nota") { S.modal = null; render(); } };
    if (action === "autorizar") return fechar(await run(() => emitirNota(id, { autorizada_em: new Date().toISOString() }), "NF autorizada e emitida"));
    if (action === "emitir") return fechar(await run(() => emitirNota(id), "NF emitida"));
    if (action === "cancelar") {
      if (!confirm("Cancelar a NF" + (n.numero ? " " + n.numero : "") + "? Os recebimentos vinculados continuam lançados e poderão receber uma nova NF.")) return;
      return run(async () => { const { error } = await sb.from("faturamento_notas").update({ status: "cancelada", cancelada_em: new Date().toISOString() }).eq("id", id); if (error) throw error; }, "NF cancelada");
    }
    if (action === "editar") { S.modal = { kind: "nota", id, observacao: n.observacao || "", valor: n.valor }; return render(); }
  }

  async function execAction(id, action) {
    const sb = sbc();
    const ex = S.execucoes.find((x) => x.id === id); if (!ex) return;
    return run(async () => {
      const { error } = await sb.from("faturamento_execucoes").update({ status: action === "cancelar" ? "cancelado" : "previsto" }).eq("id", id);
      if (error) throw error;
      const l = ex.lancamento_id && S.rows.find((r) => r.id === ex.lancamento_id);
      if (!l || l.pago || l.editado || l.nota_id) return;
      const execs = S.execucoes.filter((x) => x.lancamento_id === l.id).map((x) => (x.id === id ? { ...x, status: action === "cancelar" ? "cancelado" : "previsto" } : x)).filter((x) => x.status !== "cancelado");
      const upd = { valor: round2(execs.reduce((s, x) => s + Number(x.valor_bruto), 0)), valor_nf: round2(execs.reduce((s, x) => s + Number(x.valor_nf), 0)) };
      const r = await sb.from("lancamentos_financeiros").update(upd).eq("id", l.id);
      if (r.error) throw r.error;
    }, action === "cancelar" ? "Serviço cancelado — recebimento recalculado" : "Serviço restaurado");
  }

  /* Remove os pagamentos futuros ainda "automáticos" de um serviço (sem baixa, sem NF, sem edição individual). */
  async function limparFuturos(svc) {
    const h = today();
    const apagar = S.rows.filter((r) => r.servico_id === svc.id && !r.pago && !r.editado && !r.nota_id && !r.nf_numero && (r.comp_ini || r.data) >= h);
    if (apagar.length) {
      const { error } = await sbc().from("lancamentos_financeiros").delete().in("id", apagar.map((r) => r.id));
      if (error) throw error;
    }
    const execs = S.execucoes.filter((x) => x.servico_id === svc.id && !x.lancamento_id && x.data >= h);
    if (execs.length) await sbc().from("faturamento_execucoes").delete().in("id", execs.map((x) => x.id));
    return apagar;
  }

  async function encerrarServico(id) {
    const svc = servico(id); if (!svc) return;
    if (!confirm("Encerrar o serviço frequente? Os pagamentos futuros ainda não editados, sem NF e sem baixa serão removidos.")) return;
    return run(async () => {
      await limparFuturos(svc);
      const { error } = await sbc().from("faturamento_servicos").update({ ativo: false, data_fim: today() }).eq("id", id);
      if (error) throw error;
    }, "Serviço encerrado");
  }

  /* ---------- FORMULÁRIOS ---------- */
  function novaEntrada(preset) {
    return {
      kind: "entrada", tipo: "servico", modalidade: "avulso",
      cliente_id: "", cliBusca: "", paciente_id: "", paciente_nome: "", pacBusca: "", pacResults: [],
      tipo_servico: "Plantão", descricao: "", valor_bruto: "", valor_nf: "", nfTouched: false,
      emissao_nf: "cada_servico", observacao_nf: "", medico: "",
      data_servico: today(), data_pagamento: "", meio_pagamento: "PIX",
      frequencia: "semanal", dias_semana: [], intervalo_semanas: 1, dias_mes: [], data_inicio: today(), data_fim: "",
      agrupamento: "por_servico", pagamento_regra: "dias_apos", pagamento_dias: 0, pagamento_dia_mes: 10,
      overrides: {}, editId: null, erro: "",
      ...(preset || {}),
    };
  }

  function aplicarCliente(E, c) {
    E.cliente_id = c ? c.id : ""; E.cliBusca = "";
    if (!c) return;
    if (c.emissao_nf) { E.emissao_nf = c.emissao_nf; if (AGRUP_DA_EMISSAO[c.emissao_nf]) E.agrupamento = AGRUP_DA_EMISSAO[c.emissao_nf]; }
    if (c.meio_pagamento) E.meio_pagamento = c.meio_pagamento;
  }

  function entradaDeServico(svc) {
    return novaEntrada({
      tipo: "servico", modalidade: "frequente", editId: svc.id, cliente_id: svc.cliente_id,
      tipo_servico: svc.tipo_servico, descricao: svc.descricao || "", valor_bruto: String(svc.valor_bruto), valor_nf: String(svc.valor_nf), nfTouched: Number(svc.valor_nf) !== Number(svc.valor_bruto),
      emissao_nf: svc.emissao_nf, observacao_nf: svc.observacao_nf || "", meio_pagamento: svc.meio_pagamento || "PIX",
      frequencia: svc.frequencia || "semanal", dias_semana: svc.dias_semana || [], intervalo_semanas: svc.intervalo_semanas || 1, dias_mes: svc.dias_mes || [],
      data_inicio: svc.data_inicio || today(), data_fim: svc.data_fim || "", agrupamento: svc.agrupamento,
      pagamento_regra: svc.pagamento_regra, pagamento_dias: svc.pagamento_dias, pagamento_dia_mes: svc.pagamento_dia_mes || 10,
    });
  }

  function svcDoForm(E) {
    const agr = AGRUP_DA_EMISSAO[E.emissao_nf] || E.agrupamento || "por_servico";
    return {
      cliente_id: E.cliente_id, modalidade: E.modalidade, tipo_servico: (E.tipo_servico || "Outros").trim(), descricao: E.descricao.trim() || null,
      valor_bruto: round2(num(E.valor_bruto)), valor_nf: round2(num(E.nfTouched ? E.valor_nf : E.valor_bruto)),
      emissao_nf: E.emissao_nf, agrupamento: E.modalidade === "avulso" ? "por_servico" : agr, observacao_nf: E.observacao_nf.trim() || null,
      meio_pagamento: E.meio_pagamento || null,
      data_servico: E.modalidade === "avulso" ? E.data_servico : null, data_pagamento: E.modalidade === "avulso" ? E.data_pagamento : null,
      frequencia: E.modalidade === "frequente" ? E.frequencia : null,
      intervalo_semanas: Number(E.intervalo_semanas) || 1,
      dias_semana: E.frequencia === "semanal" ? E.dias_semana.map(Number) : [],
      dias_mes: E.frequencia === "mensal" ? E.dias_mes.map(Number) : [],
      data_inicio: E.modalidade === "frequente" ? E.data_inicio : E.data_servico, data_fim: E.modalidade === "frequente" ? E.data_fim || null : E.data_servico,
      pagamento_regra: E.pagamento_regra, pagamento_dias: Math.max(0, parseInt(E.pagamento_dias, 10) || 0),
      pagamento_dia_mes: E.pagamento_regra === "dia_fixo" ? Math.min(31, Math.max(1, parseInt(E.pagamento_dia_mes, 10) || 1)) : null,
    };
  }

  /* Plano exibido no formulário de serviço frequente: na edição considera o que já está lançado e será mantido. */
  function planoDoForm(E) {
    const svc = svcDoForm(E);
    if (!svc.data_inicio || !(svc.frequencia === "semanal" ? svc.dias_semana.length : svc.dias_mes.length)) return { periodos: [], svc, mantidos: 0 };
    const h = today();
    let inicio = svc.data_inicio, existentes = new Map(), mantidos = 0;
    if (E.editId) {
      const doSvc = S.rows.filter((r) => r.servico_id === E.editId);
      const removiveis = new Set(doSvc.filter((r) => !r.pago && !r.editado && !r.nota_id && !r.nf_numero && (r.comp_ini || r.data) >= h).map((r) => r.id));
      const mantem = doSvc.filter((r) => !removiveis.has(r.id));
      mantidos = mantem.filter((r) => !r.pago && r.venc >= h).length;
      const ultimoPassado = mantem.filter((r) => (r.comp_ini || r.data) < h).reduce((m, r) => maxIso(m, r.comp_fim || r.comp_ini), null);
      inicio = ultimoPassado ? maxIso(addDays(ultimoPassado, 1), svc.data_inicio) : maxIso(svc.data_inicio, h);
      for (const r of mantem) if ((r.comp_ini || r.data) >= inicio) existentes.set(r.comp_ini, { aberto: !r.pago && r.venc >= h });
      const abertosAntes = mantem.filter((r) => (r.comp_ini || r.data) < inicio && !r.pago && r.venc >= h).length;
      return { periodos: planejar({ ...svc, id: E.editId }, { inicio, hoje: h, existentes, minFuturos: PREVISAO_PAGAMENTOS - abertosAntes }), svc, mantidos };
    }
    return { periodos: planejar(svc, { inicio, hoje: h, existentes }), svc, mantidos };
  }

  function validarEntrada(E) {
    if (E.tipo === "consulta") {
      if (!E.paciente_id && !E.paciente_nome.trim()) return "Selecione o paciente";
      if (num(E.valor_bruto) <= 0) return "Informe o valor";
      if (!E.data_servico) return "Informe a data do atendimento";
      if (!E.data_pagamento) return "Informe a data de pagamento prevista";
      return "";
    }
    if (E.tipo === "outros") {
      if (!E.descricao.trim()) return "Informe a descrição";
      if (num(E.valor_bruto) <= 0) return "Informe o valor";
      if (!E.data_pagamento) return "Informe a data de pagamento prevista";
      return "";
    }
    if (!E.cliente_id) return "Selecione ou cadastre o cliente";
    if (!E.tipo_servico.trim()) return "Informe o tipo de serviço";
    if (num(E.valor_bruto) <= 0) return "Informe o valor bruto do serviço";
    if (E.modalidade === "avulso") {
      if (!E.data_servico) return "Informe a data de prestação do serviço";
      if (!E.data_pagamento) return "Informe a data de pagamento prevista";
      return "";
    }
    if (E.frequencia === "semanal" && !E.dias_semana.length) return "Selecione os dias da semana em que o serviço acontece";
    if (E.frequencia === "mensal" && !E.dias_mes.length) return "Selecione os dias do mês em que o serviço acontece";
    if (!E.data_inicio) return "Informe a data de início";
    if (E.data_fim && E.data_fim < E.data_inicio) return "A data de término é anterior ao início";
    if (!planoDoForm(E).periodos.length && !E.editId) return "Nenhum serviço cai no período informado";
    return "";
  }

  async function salvarEntrada() {
    const E = S.modal; if (!E) return;
    E.erro = validarEntrada(E);
    if (E.erro) return render();
    const sb = sbc();
    const valor = round2(num(E.valor_bruto)), vnf = round2(num(E.nfTouched ? E.valor_nf : E.valor_bruto));
    const ok = await run(async () => {
      if (E.tipo === "consulta" || E.tipo === "outros") {
        const c = E.cliente_id ? cliente(E.cliente_id) : null;
        const row = {
          tipo: "Receita", origem: E.tipo, natureza: E.tipo === "consulta" ? "Consulta" : "Outros",
          descricao: E.descricao.trim() || (E.tipo === "consulta" ? "Consulta médica" : "Entrada"),
          paciente_id: E.tipo === "consulta" ? E.paciente_id || null : null,
          paciente_nome: E.tipo === "consulta" ? E.paciente_nome || null : null,
          cliente_id: E.tipo === "outros" && c ? c.id : null,
          medico: E.medico.trim() || null, data: E.data_servico || today(),
          competencia_inicio: null, competencia_fim: null,
          vencimento: E.data_pagamento, valor, valor_nf: vnf, observacao_nf: E.observacao_nf.trim() || null,
          nf_modo: E.emissao_nf, meio_pagamento: E.meio_pagamento || null,
          status: "A receber", etiqueta: "A receber", pago: false,
        };
        const { error } = await sb.from("lancamentos_financeiros").insert(row);
        if (error) throw error;
        return;
      }
      const svcRow = svcDoForm(E);
      if (E.modalidade === "avulso") {
        const { data: svc, error } = await sb.from("faturamento_servicos").insert({ ...svcRow, ativo: true }).select("*").single();
        if (error) throw error;
        const desc = svc.tipo_servico + (svc.descricao ? " — " + svc.descricao : "");
        const { data: l, error: e2 } = await sb.from("lancamentos_financeiros").insert({
          tipo: "Receita", origem: "servico", natureza: "Serviço", descricao: desc,
          cliente_id: svc.cliente_id, servico_id: svc.id, tipo_servico: svc.tipo_servico,
          data: svc.data_servico, competencia_inicio: svc.data_servico, competencia_fim: svc.data_servico,
          vencimento: svc.data_pagamento, valor, valor_nf: vnf, observacao_nf: svc.observacao_nf,
          nf_modo: svc.emissao_nf, meio_pagamento: svc.meio_pagamento, status: "A receber", etiqueta: "A receber", pago: false,
        }).select("id").single();
        if (e2) throw e2;
        const e3 = await sb.from("faturamento_execucoes").insert({ servico_id: svc.id, lancamento_id: l.id, data: svc.data_servico, valor_bruto: valor, valor_nf: vnf, status: "previsto" });
        if (e3.error) throw e3.error;
        return;
      }
      const plano = planoDoForm(E);
      let svc;
      if (E.editId) {
        const atual = servico(E.editId);
        await limparFuturos(atual);
        const { data, error } = await sb.from("faturamento_servicos").update({ ...svcRow, ativo: true }).eq("id", E.editId).select("*").single();
        if (error) throw error;
        svc = data;
      } else {
        const { data, error } = await sb.from("faturamento_servicos").insert({ ...svcRow, ativo: true }).select("*").single();
        if (error) throw error;
        svc = data;
      }
      if (plano.periodos.length) await inserirPeriodos(svc, plano.periodos, E.overrides);
    }, E.editId ? "Serviço atualizado" : "Entrada lançada");
    if (ok) { S.modal = null; S.modal2 = null; render(); }
  }

  function novaSaida() {
    return { kind: "saida", tipo: "Despesa", categoria: "Gastos", descricao: "", medico: "", valor: "", comissao_pct: 30, venc: today(), meio: "PIX", pago: false, erro: "" };
  }

  async function salvarSaida() {
    const F = S.modal;
    if (!F.descricao.trim() && F.tipo === "Despesa") { F.erro = "Informe a descrição"; return render(); }
    if ((F.tipo === "Comissão" || F.tipo === "Plantão") && !F.medico.trim()) { F.erro = "Informe o profissional"; return render(); }
    if (num(F.valor) <= 0) { F.erro = "Informe o valor"; return render(); }
    const valor = round2(num(F.valor)), pct = num(F.comissao_pct);
    const tipo = F.tipo === "Comissão" ? "Comissão" : "Despesa";
    const st = F.pago ? "Pago" : "A pagar";
    const row = {
      tipo, origem: F.tipo === "Comissão" ? "comissao" : F.tipo === "Plantão" ? "plantao" : "despesa",
      descricao: F.descricao.trim() || (F.tipo === "Comissão" ? "Comissão" : "Plantão") + " — " + F.medico.trim(),
      medico: F.medico.trim() || null, natureza: F.tipo === "Despesa" ? F.categoria : F.tipo,
      data: today(), vencimento: F.venc || today(), valor, meio_pagamento: F.meio || null,
      status: st, etiqueta: st, pago: !!F.pago, data_pagamento: F.pago ? today() : null,
      comissao_pct: tipo === "Comissão" ? pct : 0, comissao_val: tipo === "Comissão" ? round2((valor * pct) / 100) : 0,
    };
    if (await run(async () => { const { error } = await sbc().from("lancamentos_financeiros").insert(row); if (error) throw error; }, "Saída lançada")) { S.modal = null; render(); }
  }

  function abrirLancamento(r) {
    return {
      kind: "lanc", id: r.id, valor: String(r.valor), valor_nf: r.valor_nf == null ? "" : String(r.valor_nf),
      venc: r.venc || "", meio: r.meio, observacao_nf: r.observacao_nf, nf_modo: r.nf_modo || "sem_emissao",
      data_pagamento: r.data_pagamento || today(), comissao_pct: String(r.comissao_pct), erro: "",
    };
  }

  async function salvarLancamento() {
    const F = S.modal; const r = S.rows.find((x) => x.id === F.id); if (!r) return;
    if (num(F.valor) <= 0) { F.erro = "Informe o valor"; return render(); }
    const valor = round2(num(F.valor));
    const patch = { valor, vencimento: F.venc || null, meio_pagamento: F.meio || null, editado: true };
    if (r.tipo === "Receita") Object.assign(patch, { valor_nf: F.valor_nf === "" ? valor : round2(num(F.valor_nf)), observacao_nf: F.observacao_nf.trim() || null, nf_modo: F.nf_modo });
    if (r.tipo === "Comissão") Object.assign(patch, { comissao_pct: num(F.comissao_pct), comissao_val: round2((valor * num(F.comissao_pct)) / 100) });
    if (r.pago) patch.data_pagamento = F.data_pagamento || null;
    if (await run(async () => { const { error } = await sbc().from("lancamentos_financeiros").update(patch).eq("id", r.id); if (error) throw error; }, "Lançamento atualizado")) { S.modal = null; render(); }
  }

  async function baixarLancamento(estornar) {
    const F = S.modal; const r = S.rows.find((x) => x.id === F.id); if (!r) return;
    const patch = estornar
      ? { pago: false, data_pagamento: null, status: r.tipo === "Receita" ? "A receber" : "A pagar", etiqueta: r.tipo === "Receita" ? "A receber" : "A pagar" }
      : { pago: true, data_pagamento: F.data_pagamento || today(), meio_pagamento: F.meio || null, status: statusPago(r), etiqueta: statusPago(r) };
    if (await run(async () => { const { error } = await sbc().from("lancamentos_financeiros").update(patch).eq("id", r.id); if (error) throw error; }, estornar ? "Baixa estornada" : r.tipo === "Receita" ? "Recebimento registrado" : "Pagamento registrado")) { S.modal = null; render(); }
  }

  async function excluirLancamento() {
    const F = S.modal; const r = S.rows.find((x) => x.id === F.id); if (!r) return;
    if (r.nota_id && nota(r.nota_id) && nota(r.nota_id).status === "emitida") { alert("Cancele a NF vinculada antes de excluir este lançamento."); return; }
    if (!confirm("Excluir este lançamento?")) return;
    if (await run(async () => { const { error } = await sbc().from("lancamentos_financeiros").delete().eq("id", r.id); if (error) throw error; }, "Lançamento excluído")) { S.modal = null; render(); }
  }

  async function salvarNota() {
    const F = S.modal;
    const ok = await run(async () => {
      const { error } = await sbc().from("faturamento_notas").update({ observacao: F.observacao.trim() || null, valor: round2(num(F.valor)) }).eq("id", F.id);
      if (error) throw error;
    }, "NF atualizada");
    if (ok) { S.modal = null; render(); }
  }

  /* ----- Cliente ----- */
  function novoCliente(c) {
    const base = {
      kind: "cliente", id: null, tipo_pessoa: "PJ", nome: "", nome_fantasia: "", documento: "", inscricao_municipal: "", inscricao_estadual: "",
      email: "", telefone: "", cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", codigo_municipio: "",
      iss_retido: false, emissao_nf: "cada_servico", meio_pagamento: "PIX", observacoes: "", erro: "", cepBusy: false,
    };
    if (!c) return base;
    const o = { ...base };
    for (const k of Object.keys(base)) if (c[k] != null && k !== "kind") o[k] = c[k];
    o.documento = fmtDoc(c.documento);
    return o;
  }

  async function salvarCliente() {
    const F = S.modal2 || S.modal;
    const doc = digits(F.documento);
    F.erro = "";
    if (!F.nome.trim()) F.erro = F.tipo_pessoa === "PJ" ? "Informe a razão social" : "Informe o nome";
    else if (!doc && F.emissao_nf !== "sem_emissao") F.erro = "Informe o " + (F.tipo_pessoa === "PJ" ? "CNPJ" : "CPF") + " — é obrigatório para emitir NF";
    else if (doc && F.tipo_pessoa === "PJ" && !cnpjValido(doc)) F.erro = "CNPJ inválido";
    else if (doc && F.tipo_pessoa === "PF" && !cpfValido(doc)) F.erro = "CPF inválido";
    else if (F.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+/.test(F.email.trim())) F.erro = "E-mail inválido";
    if (F.erro) return render();
    const row = {};
    for (const k of ["tipo_pessoa", "nome", "nome_fantasia", "inscricao_municipal", "inscricao_estadual", "email", "telefone", "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf", "codigo_municipio", "emissao_nf", "meio_pagamento", "observacoes"]) {
      const v = typeof F[k] === "string" ? F[k].trim() : F[k];
      row[k] = v === "" ? null : v;
    }
    row.nome = F.nome.trim(); row.documento = doc || null; row.iss_retido = !!F.iss_retido;
    row.uf = row.uf ? String(row.uf).toUpperCase().slice(0, 2) : null;
    const sb = sbc();
    const q = F.id ? sb.from("faturamento_clientes").update(row).eq("id", F.id) : sb.from("faturamento_clientes").insert(row);
    const { data, error } = await q.select("*").single();
    if (error) { F.erro = "Erro ao salvar: " + error.message; return render(); }
    const i = S.clientes.findIndex((c) => c.id === data.id);
    if (i >= 0) S.clientes[i] = data; else S.clientes.push(data);
    S.clientes.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    toast(F.id ? "Cliente atualizado" : "Cliente cadastrado");
    if (S.modal2) { S.modal2 = null; if (S.modal && S.modal.kind === "entrada") aplicarCliente(S.modal, data); }
    else S.modal = null;
    render();
  }

  async function buscarCep(F) {
    const c = digits(F.cep); if (c.length !== 8 || F.cepBusy) return;
    F.cepBusy = true;
    try {
      const resp = await fetch("https://viacep.com.br/ws/" + c + "/json/");
      const j = await resp.json();
      if (!j.erro) Object.assign(F, { logradouro: j.logradouro || F.logradouro, bairro: j.bairro || F.bairro, cidade: j.localidade || F.cidade, uf: j.uf || F.uf, codigo_municipio: j.ibge || F.codigo_municipio });
    } catch (x) { /* CEP é só uma ajuda de preenchimento */ }
    F.cepBusy = false; render();
  }

  let pacTimer = null;
  function buscarPacientes(E) {
    clearTimeout(pacTimer);
    const q = E.pacBusca.trim();
    if (q.length < 2) { E.pacResults = []; return atualizarParcial("fa-pac-res", pacResultsHtml(E)); }
    pacTimer = setTimeout(async () => {
      const { data } = await sbc().from("pacientes").select("paciente_id,name,cpf").ilike("name", "%" + q + "%").order("name").limit(12);
      if (S.modal !== E) return;
      E.pacResults = data || [];
      atualizarParcial("fa-pac-res", pacResultsHtml(E));
    }, 250);
  }

  /* ---------- FILTRO ---------- */
  function tabMatch(tab, r) {
    const s = situacao(r);
    switch (tab) {
      case "todos": return !(s === "Previsto");
      case "a_receber": return r.tipo === "Receita" && (s === "A receber" || s === "Atrasado");
      case "previstos": return s === "Previsto";
      case "recebidos": return s === "Recebido";
      case "atrasados": return s === "Atrasado";
      case "a_pagar": return r.tipo !== "Receita" && !r.pago;
      case "pagos": return r.tipo !== "Receita" && r.pago;
      case "comissoes": return r.tipo === "Comissão";
      default: return false;
    }
  }
  function displayRows() {
    const f = S.filters;
    return S.rows.filter((r) => {
      if (!tabMatch(S.tab, r)) return false;
      if (f.cliente && r.cliente_id !== f.cliente) return false;
      if (f.origem && r.origem !== f.origem) return false;
      if (f.meio && r.meio !== f.meio) return false;
      if (f.medico && r.medico !== f.medico) return false;
      if (f.tipo && r.tipo !== f.tipo) return false;
      if (f.nat && r.natureza !== f.nat) return false;
      if (f.vmin && valorLinha(r) < num(f.vmin)) return false;
      if (f.vmax && valorLinha(r) > num(f.vmax)) return false;
      return true;
    });
  }
  const uniq = (k) => [...new Set(S.rows.map((r) => r[k]).filter(Boolean))].sort();

  /* ---------- RENDER: peças ---------- */
  function chip(label, cfg) {
    if (!label) return "";
    const c = cfg || SIT[label] || { bg: "rgba(243,244,246,.9)", color: "#374151", dot: "#9ca3af" };
    return `<span class="fa-chip" style="background:${c.bg};color:${c.color}"><span class="d" style="background:${c.dot}"></span>${esc(label)}</span>`;
  }
  function tipoChip(r) {
    const t = r.origem === "plantao" ? "Plantão" : r.tipo;
    const c = TIPO[r.tipo] || { bg: "rgba(243,244,246,.85)", color: "#374151" };
    return `<span class="fa-chip" style="background:${c.bg};color:${c.color}">${esc(t === "Receita" ? "Entrada" : t)}</span>`;
  }
  function nfChip(r) {
    if (r.tipo !== "Receita") return `<span class="fa-muted">—</span>`;
    if (r.nf_numero) return chip("NF " + r.nf_numero, NOTA_SIT.emitida);
    const n = r.nota_id ? nota(r.nota_id) : null;
    if (n) return chip(n.status === "emitida" ? "NF " + n.numero : NOTA_SIT[n.status].l, NOTA_SIT[n.status]);
    if (!r.nf_modo || r.nf_modo === "sem_emissao") return `<span class="fa-muted">Sem NF</span>`;
    return `<span class="fa-muted" title="Emissão programada">⏱ ${esc(EMISSAO[r.nf_modo] || "")}</span>`;
  }
  function seg(name, opts, val, attr) {
    return `<div class="fa-seg">${Object.entries(opts).map(([k, l]) => `<button type="button" class="${val === k ? "on" : ""}" data-${attr}="${name}" data-val="${k}">${esc(l)}</button>`).join("")}</div>`;
  }
  function selOpts(opts, val, vazio) {
    const list = Array.isArray(opts) ? opts.map((o) => [o, o]) : Object.entries(opts);
    return (vazio != null ? `<option value="">${esc(vazio)}</option>` : "") + list.map(([k, l]) => `<option value="${esc(k)}" ${String(val) === String(k) ? "selected" : ""}>${esc(l)}</option>`).join("");
  }
  function atualizarParcial(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }

  function cardsHtml() {
    const h = today(), mes = h.slice(0, 7), lim = addDays(h, HORIZONTE_DIAS);
    const rec = S.rows.filter((r) => r.tipo === "Receita");
    const vals = [
      { lbl: "Recebido no mês", v: rec.filter((r) => r.pago && (r.data_pagamento || r.venc || r.data || "").slice(0, 7) === mes).reduce((s, r) => s + r.valor, 0), icon: "$" },
      { lbl: "A receber (30 dias)", v: rec.filter((r) => !r.pago && r.venc && r.venc >= h && r.venc <= lim).reduce((s, r) => s + r.valor, 0), icon: "⏳" },
      { lbl: "Recebimentos em atraso", v: rec.filter((r) => situacao(r) === "Atrasado").reduce((s, r) => s + r.valor, 0), icon: "!" },
      { lbl: "A pagar (contas e comissões)", v: S.rows.filter((r) => r.tipo !== "Receita" && !r.pago).reduce((s, r) => s + valorLinha(r), 0), icon: "↓" },
    ];
    return `<div class="fa-cards">${vals.map((c, i) => `
      <div class="fa-card" style="background:${CARDS_T[i].bg}">
        <div style="display:flex;align-items:center;gap:10px"><div class="ico" style="color:${CARDS_T[i].c}">${c.icon}</div><span class="lbl">${c.lbl}</span></div>
        <div class="val">${fmt(c.v)}</div>
      </div>`).join("")}</div>`;
  }

  function avisosHtml() {
    const ag = S.notas.filter((n) => n.status === "aguardando_autorizacao");
    if (!ag.length) return "";
    return `<div class="fa-aviso"><span>🧾 <b>${ag.length}</b> NF${ag.length > 1 ? "s" : ""} aguardando sua autorização (${fmt(ag.reduce((s, n) => s + Number(n.valor), 0))})</span>
      <button class="fa-btn xs primary" data-view="notas" data-notatab="aguardando_autorizacao">Revisar</button></div>`;
  }

  /* ---------- VIEW: Lançamentos ---------- */
  function rowActionsHtml(r) {
    const b = [];
    const s = situacao(r);
    if (r.tipo === "Receita" && !r.pago) b.push(`<button class="fa-btn primary xs" data-act="receber" data-id="${r.id}">✓ Receber</button>`);
    if (r.tipo === "Receita" && !r.nf_numero) {
      const n = r.nota_id ? nota(r.nota_id) : null;
      if (n && n.status === "aguardando_autorizacao") b.push(`<button class="fa-btn xs violet" data-act="nf" data-id="${r.id}">🧾 Autorizar NF</button>`);
      else if (!n || n.status === "cancelada" || n.status === "pendente") b.push(`<button class="fa-btn xs" data-act="nf" data-id="${r.id}">🧾 ${n && n.status === "cancelada" ? "Nova NF" : "Emitir NF"}</button>`);
    }
    if (s === "Atrasado" && r.tipo === "Receita" && r.etiqueta !== "Cobrado") b.push(`<button class="fa-btn xs" data-act="cobrar" data-id="${r.id}">🔔 Cobrar</button>`);
    if (r.tipo !== "Receita" && !r.pago) b.push(`<button class="fa-btn danger xs" data-act="pagar" data-id="${r.id}">↓ Pagar</button>`);
    if (!b.length) return `<span class="fa-muted" style="font-size:18px;letter-spacing:2px">···</span>`;
    return `<div style="display:flex;gap:5px;flex-wrap:wrap">${b.join("")}</div>`;
  }
  function rowHtml(r) {
    const s = situacao(r);
    const vc = r.tipo === "Receita" ? (s === "Atrasado" ? "#c2410c" : "#16a34a") : r.tipo === "Comissão" ? "#1e40af" : "#dc2626";
    const dv = r.tipo === "Receita" ? fmt(r.valor) : "-" + fmt(valorLinha(r));
    const quem = nomeContraparte(r);
    return `<tr data-detail="${r.id}">
      <td data-stop="1"><input type="checkbox" class="fa-chk" data-sel="${r.id}" ${S.selected.includes(r.id) ? "checked" : ""}></td>
      <td>${tipoChip(r)}</td>
      <td><div class="fa-strong">${esc(r.desc)}</div>
        ${quem ? `<div class="fa-sub">${esc(quem)}${r.servico_id && servico(r.servico_id) && servico(r.servico_id).modalidade === "frequente" ? " · ↻ frequente" : ""}${r.editado ? " · editado" : ""}</div>` : ""}</td>
      <td class="fa-dim">${fmtDate(r.comp_ini || r.data)}</td>
      <td class="fa-dim">${fmtDate(r.venc)}</td>
      <td><span style="color:${vc};font-weight:700;font-size:14px">${dv}</span>
        ${r.tipo === "Comissão" ? `<div class="fa-sub">${r.comissao_pct}% de ${fmt(r.valor)}</div>` : ""}
        ${r.tipo === "Receita" && r.valor_nf != null && r.valor_nf !== r.valor ? `<div class="fa-sub">NF: ${fmt(r.valor_nf)}</div>` : ""}</td>
      <td>${nfChip(r)}</td>
      <td class="fa-dim">${esc(r.meio) || "—"}</td>
      <td>${chip(s)}${r.etiqueta === "Cobrado" && !r.pago ? " " + chip("Cobrado") : ""}</td>
      <td style="min-width:140px" data-stop="1">${rowActionsHtml(r)}</td>
    </tr>`;
  }
  function filtersHtml() {
    const f = S.filters;
    const defs = [
      { k: "cliente", l: "Cliente", o: Object.fromEntries(S.clientes.map((c) => [c.id, c.nome])) },
      { k: "origem", l: "Origem", o: { consulta: "Consulta médica", servico: "Serviço", outros: "Outros", despesa: "Despesa", comissao: "Comissão", plantao: "Plantão" } },
      { k: "tipo", l: "Tipo", o: { Receita: "Entrada", Despesa: "Despesa", "Comissão": "Comissão" } },
      { k: "meio", l: "Meio de pagamento", o: MEIOS },
      { k: "medico", l: "Profissional", o: uniq("medico") },
      { k: "nat", l: "Natureza", o: uniq("natureza") },
    ];
    const active = Object.values(f).filter((v) => v !== "").length;
    return `<div class="fa-filters">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="fa-label-up">Filtros</span>
          ${active ? `<span class="fa-badge">${active} ativos</span>` : ""}
        </div>
        ${active ? `<button class="fa-btn xs" data-clearf="1" style="color:#dc2626;background:rgba(254,226,226,.8)">✕ Limpar tudo</button>` : ""}
      </div>
      <div class="fa-fgrid">
        ${defs.map((d) => `<div><label>${d.l}</label><select class="fa-sel ${f[d.k] ? "act" : ""}" data-filt="${d.k}">${selOpts(d.o, f[d.k], "Todos")}</select></div>`).join("")}
        <div style="grid-column:span 2"><label>Faixa de valor</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="fa-in ${f.vmin ? "act" : ""}" type="number" placeholder="Mín" data-filt="vmin" value="${esc(f.vmin)}">
            <span class="fa-muted">–</span>
            <input class="fa-in ${f.vmax ? "act" : ""}" type="number" placeholder="Máx" data-filt="vmax" value="${esc(f.vmax)}">
          </div></div>
      </div></div>`;
  }
  function lancamentosHtml() {
    const rows = displayRows();
    const sel = S.rows.filter((r) => S.selected.includes(r.id));
    const selTotal = sel.reduce((s, r) => s + valorLinha(r), 0);
    const hasF = Object.values(S.filters).some((v) => v !== "");
    const ocultos = S.tab === "todos" ? S.rows.filter((r) => situacao(r) === "Previsto").length : 0;
    return `<div class="fa-panel">
      <div class="fa-tabsrow">
        <div class="fa-tabs">${TABS.map((t) => `<button class="${S.tab === t.key ? "on" : ""}" data-tab="${t.key}">${t.label}</button>`).join("")}</div>
        <button class="fa-filtbtn ${S.showFilters || hasF ? "on" : ""}" data-togglef="1" title="Filtros">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1.5 3.5h13L9.5 9v4.5l-3-1.5V9L1.5 3.5Z" stroke="${S.showFilters || hasF ? "#16a34a" : "#9ca3af"}" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </div>
      ${S.showFilters ? filtersHtml() : ""}
      ${S.selected.length ? `<div class="fa-selbar">
        <span style="width:8px;height:8px;border-radius:50%;background:#16a34a"></span>
        <span style="font-size:13px;font-weight:600;color:#16a34a">${S.selected.length} selecionado${S.selected.length > 1 ? "s" : ""}</span>
        <span class="fa-muted">|</span><span class="fa-strong">${fmt(selTotal)}</span>
        <div style="flex:1"></div>
        <button class="fa-btn xs" data-mass="cobrar">🔔 Cobrar</button>
        <button class="fa-btn xs" data-mass="pagar">↓ Pagar</button>
        <button class="fa-btn xs" data-mass="nf">🧾 Emitir NF</button>
        <button class="fa-btn primary xs" data-mass="receber">✓ Receber</button>
        <button class="fa-x" data-clearsel="1">✕</button></div>` : ""}
      <div style="overflow-x:auto">
        <table class="fa-table"><thead><tr>
          <th><input type="checkbox" class="fa-chk" data-all="1" ${rows.length && rows.every((r) => S.selected.includes(r.id)) ? "checked" : ""}></th>
          <th>Tipo</th><th>Descrição / Cliente</th><th>Competência</th><th>Vencimento</th><th>Valor</th><th>NF</th><th>Meio</th><th>Situação</th><th>Ações</th>
        </tr></thead><tbody>
          ${S.loading && !S.rows.length ? `<tr><td colspan="10" class="fa-empty">Carregando…</td></tr>`
            : rows.length ? rows.map(rowHtml).join("")
            : `<tr><td colspan="10" class="fa-empty">Nenhum lançamento encontrado</td></tr>`}
        </tbody></table>
      </div>
      ${ocultos ? `<div class="fa-foot">${ocultos} recebimento${ocultos > 1 ? "s" : ""} previsto${ocultos > 1 ? "s" : ""} para depois de ${HORIZONTE_DIAS} dias — <a href="#" data-tab="previstos">ver previsões</a></div>` : ""}
    </div>`;
  }

  /* ---------- VIEW: Trabalhos ---------- */
  function trabalhosHtml() {
    const freq = S.servicos.filter((s) => s.modalidade === "frequente" && s.ativo);
    const mes = S.trabMes;
    const h = today();
    const linhas = S.execucoes.filter((x) => x.data.slice(0, 7) === mes).map((x) => {
      const svc = servico(x.servico_id) || {};
      const l = x.lancamento_id ? S.rows.find((r) => r.id === x.lancamento_id) : null;
      return { id: x.id, data: x.data, cliente: (cliente(svc.cliente_id) || {}).nome || "—", servico: svc.tipo_servico + (svc.descricao ? " — " + svc.descricao : ""),
        modalidade: svc.modalidade, bruto: Number(x.valor_bruto), nf: Number(x.valor_nf),
        sit: x.status === "cancelado" ? "Cancelado" : x.data <= h ? "Realizado" : "Previsto", l, exec: true };
    });
    for (const r of S.rows) {
      if (r.origem !== "consulta" || (r.data || "").slice(0, 7) !== mes) continue;
      linhas.push({ id: r.id, data: r.data, cliente: r.paciente || "—", servico: r.desc, modalidade: "consulta", bruto: r.valor, nf: valorNF(r), sit: r.data <= h ? "Realizado" : "Previsto", l: r, exec: false });
    }
    linhas.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    const ativas = linhas.filter((x) => x.sit !== "Cancelado");
    const [y, m] = mes.split("-").map(Number);
    const prev = m === 1 ? ymd(y - 1, 12, 1).slice(0, 7) : ymd(y, m - 1, 1).slice(0, 7);
    const next = m === 12 ? ymd(y + 1, 1, 1).slice(0, 7) : ymd(y, m + 1, 1).slice(0, 7);
    const modLabel = { avulso: "Avulso", frequente: "↻ Frequente", consulta: "Consulta" };
    return `
      <div class="fa-section-h"><h3>Serviços frequentes</h3><span class="fa-sub">${freq.length} ativo${freq.length === 1 ? "" : "s"}</span></div>
      ${freq.length ? `<div class="fa-grid">${freq.map((s) => {
        const prox = S.execucoes.filter((x) => x.servico_id === s.id && x.data >= h && x.status !== "cancelado")[0];
        return `<div class="fa-tile">
          <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
            <div><div class="fa-strong">${esc(s.tipo_servico)}${s.descricao ? " — " + esc(s.descricao) : ""}</div><div class="fa-sub">${esc((cliente(s.cliente_id) || {}).nome || "—")}</div></div>
            <div class="fa-strong" style="color:#16a34a;white-space:nowrap">${fmt(s.valor_bruto)}</div>
          </div>
          <div class="fa-kv"><span>Repete</span><span>${esc(recorrenciaTexto(s))}</span></div>
          <div class="fa-kv"><span>Cobrança</span><span>${esc(AGRUP[s.agrupamento])} · ${esc(pagamentoTexto(s))}</span></div>
          <div class="fa-kv"><span>NF</span><span>${esc(EMISSAO[s.emissao_nf])}</span></div>
          <div class="fa-kv"><span>Próximo</span><span>${prox ? fmtDate(prox.data) : "—"}${s.data_fim ? " · até " + fmtDate(s.data_fim) : ""}</span></div>
          <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px">
            <button class="fa-btn xs" data-svc-encerrar="${s.id}">Encerrar</button>
            <button class="fa-btn xs primary" data-svc-editar="${s.id}">Editar</button>
          </div></div>`;
      }).join("")}</div>` : `<div class="fa-panel fa-empty" style="padding:24px">Nenhum serviço frequente. Use <b>Lançar entrada → Serviço → Frequente</b> para programar plantões e trabalhos recorrentes.</div>`}
      <div class="fa-section-h" style="margin-top:22px">
        <h3>Trabalhos realizados e previstos</h3>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="fa-x" data-trabmes="${prev}">‹</button>
          <span class="fa-strong" style="min-width:90px;text-align:center">${mesLabel(mes + "-01")}</span>
          <button class="fa-x" data-trabmes="${next}">›</button>
        </div>
      </div>
      <div class="fa-panel"><div style="overflow-x:auto"><table class="fa-table"><thead><tr>
        <th>Data</th><th>Cliente / Paciente</th><th>Serviço</th><th>Modalidade</th><th>Valor bruto</th><th>Valor NF</th><th>Situação</th><th>Recebimento</th><th>NF</th><th></th>
      </tr></thead><tbody>
      ${linhas.length ? linhas.map((x) => `<tr ${x.l ? `data-detail="${x.l.id}"` : ""}>
        <td class="fa-dim">${fmtDate(x.data)} <span class="fa-sub">${DIAS_SEMANA[dow(x.data)]}</span></td>
        <td class="fa-strong">${esc(x.cliente)}</td>
        <td>${esc(x.servico)}</td>
        <td><span class="fa-sub">${modLabel[x.modalidade] || ""}</span></td>
        <td class="fa-strong">${fmt(x.bruto)}</td>
        <td class="fa-dim">${fmt(x.nf)}</td>
        <td>${chip(x.sit)}</td>
        <td class="fa-dim">${x.l ? fmtDate(x.l.venc) + " " + chip(situacao(x.l)) : "—"}</td>
        <td>${x.l ? nfChip(x.l) : "—"}</td>
        <td data-stop="1">${x.exec && (!x.l || (!x.l.pago && !x.l.nota_id)) ? `<button class="fa-btn xs" data-exec="${x.id}" data-execact="${x.sit === "Cancelado" ? "restaurar" : "cancelar"}">${x.sit === "Cancelado" ? "Restaurar" : "Não realizado"}</button>` : ""}</td>
      </tr>`).join("") : `<tr><td colspan="10" class="fa-empty">Nenhum trabalho em ${mesLabel(mes + "-01")}</td></tr>`}
      </tbody>${ativas.length ? `<tfoot><tr><td colspan="4" class="fa-dim">${ativas.length} trabalho${ativas.length > 1 ? "s" : ""}</td>
        <td class="fa-strong">${fmt(ativas.reduce((s, x) => s + x.bruto, 0))}</td><td class="fa-dim">${fmt(ativas.reduce((s, x) => s + x.nf, 0))}</td><td colspan="4"></td></tr></tfoot>` : ""}
      </table></div></div>`;
  }

  /* ---------- VIEW: Clientes ---------- */
  function clientesHtml() {
    const h = today(), ano = addDays(h, -365);
    const q = S.cliBusca.trim().toLowerCase();
    const lista = S.clientes.filter((c) => !q || c.nome.toLowerCase().includes(q) || digits(c.documento).includes(digits(q) || "§") || (c.nome_fantasia || "").toLowerCase().includes(q));
    return `<div class="fa-section-h">
        <input class="fa-in" style="max-width:320px" placeholder="Buscar cliente por nome ou CPF/CNPJ" data-clibusca="1" value="${esc(S.cliBusca)}">
        <button class="fa-btn primary" data-cli-novo="1">+ Novo cliente</button>
      </div>
      ${lista.length ? `<div class="fa-grid">${lista.map((c) => {
        const rs = S.rows.filter((r) => r.cliente_id === c.id && r.tipo === "Receita");
        const prox = rs.filter((r) => !r.pago && r.venc && r.venc >= h).sort((a, b) => (a.venc < b.venc ? -1 : 1)).slice(0, PREVISAO_PAGAMENTOS);
        const atras = rs.filter((r) => situacao(r) === "Atrasado");
        const svcs = S.servicos.filter((s) => s.cliente_id === c.id && s.modalidade === "frequente" && s.ativo);
        return `<div class="fa-tile">
          <div style="display:flex;justify-content:space-between;gap:8px">
            <div><div class="fa-strong">${esc(c.nome)}</div><div class="fa-sub">${c.tipo_pessoa} · ${esc(fmtDoc(c.documento)) || "sem documento"}${c.cidade ? " · " + esc(c.cidade) + "/" + esc(c.uf || "") : ""}</div></div>
            <span class="fa-sub" style="white-space:nowrap">NF: ${esc(EMISSAO[c.emissao_nf])}</span>
          </div>
          <div class="fa-kpis">
            <div><span>Recebido 12m</span><b style="color:#16a34a">${fmt(rs.filter((r) => r.pago && (r.data_pagamento || r.venc || "") >= ano).reduce((s, r) => s + r.valor, 0))}</b></div>
            <div><span>A receber</span><b>${fmt(rs.filter((r) => !r.pago && r.venc >= h).reduce((s, r) => s + r.valor, 0))}</b></div>
            <div><span>Em atraso</span><b style="color:${atras.length ? "#c2410c" : "inherit"}">${fmt(atras.reduce((s, r) => s + r.valor, 0))}</b></div>
          </div>
          ${svcs.length ? `<div class="fa-sub" style="margin:6px 0 2px">↻ ${svcs.map((s) => esc(s.tipo_servico) + " — " + esc(recorrenciaTexto(s).toLowerCase())).join("<br>↻ ")}</div>` : ""}
          <div class="fa-label-up" style="margin:10px 0 4px">Próximos pagamentos</div>
          ${prox.length ? `<div class="fa-prox">${prox.map((r) => `<button class="fa-prox-i" data-detail="${r.id}" title="Editar este pagamento">
              <span>${fmtDate(r.venc)}</span><span class="fa-sub" style="flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.desc)}</span>
              <b>${fmt(r.valor)}</b>${r.editado ? `<span class="fa-sub">✎</span>` : ""}</button>`).join("")}</div>` : `<div class="fa-sub">Nenhum pagamento previsto</div>`}
          <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:10px">
            <button class="fa-btn xs" data-cli-editar="${c.id}">Editar cadastro</button>
            <button class="fa-btn xs primary" data-cli-lancar="${c.id}">+ Lançar serviço</button>
          </div></div>`;
      }).join("")}</div>` : `<div class="fa-panel fa-empty" style="padding:24px">${S.clientes.length ? "Nenhum cliente encontrado" : "Nenhum cliente cadastrado. Clientes são os tomadores dos seus serviços (hospitais, clínicas, empresas) — diferentes dos pacientes."}</div>`}`;
  }

  /* ---------- VIEW: Notas ---------- */
  function notasHtml() {
    const legado = S.rows.filter((r) => r.nf_numero).map((r) => ({
      id: null, legado: true, numero: r.nf_numero, serie: r.nf_serie || "1", tomador_nome: r.paciente || nomeContraparte(r), status: "emitida",
      competencia_inicio: r.data, valor: r.valor, emitida_em: r.nf_emitida_em, observacao: "", descricao: r.desc,
    }));
    const todas = [...S.notas, ...legado].filter((n) => S.notaTab === "todas" || n.status === S.notaTab);
    const cont = (k) => S.notas.filter((n) => n.status === k).length;
    return `<div class="fa-panel">
      <div class="fa-tabsrow"><div class="fa-tabs">${NOTA_TABS.map((t) => `<button class="${S.notaTab === t.key ? "on" : ""}" data-notatab="${t.key}">${t.label}${t.key !== "todas" && cont(t.key) ? ` <span class="fa-badge">${cont(t.key)}</span>` : ""}</button>`).join("")}</div></div>
      <div class="fa-foot" style="border-top:none;border-bottom:1px solid rgba(0,0,0,.06)">Numeração interna de controle. A transmissão para a prefeitura (NFS-e) ainda não está integrada — use o número e os dados abaixo no emissor da sua prefeitura.</div>
      <div style="overflow-x:auto"><table class="fa-table"><thead><tr>
        <th>Nº</th><th>Tomador</th><th>Competência</th><th>Valor</th><th>Situação</th><th>Emitida em</th><th>Recebimentos</th><th>Ações</th>
      </tr></thead><tbody>
      ${todas.length ? todas.map((n) => {
        const vinc = n.id ? S.rows.filter((r) => r.nota_id === n.id) : [];
        const recebido = vinc.length && vinc.every((r) => r.pago);
        const acoes = n.legado ? `<span class="fa-sub">legado</span>` : [
          n.status === "aguardando_autorizacao" ? `<button class="fa-btn xs primary" data-nota="${n.id}" data-notaact="autorizar">✓ Autorizar e emitir</button>` : "",
          n.status === "pendente" ? `<button class="fa-btn xs primary" data-nota="${n.id}" data-notaact="emitir">Emitir</button>` : "",
          n.status !== "emitida" && n.status !== "cancelada" ? `<button class="fa-btn xs" data-nota="${n.id}" data-notaact="editar">Editar</button>` : "",
          n.status === "emitida" ? `<button class="fa-btn xs" data-nota="${n.id}" data-notaact="cancelar">Cancelar</button>` : "",
        ].join("");
        return `<tr ${n.id ? `data-notadet="${n.id}"` : ""}>
          <td class="fa-strong">${n.numero ? n.numero + (n.serie && n.serie !== "1" ? "/" + esc(n.serie) : "") : "—"}</td>
          <td><div class="fa-strong">${esc(n.tomador_nome || "—")}</div>${n.observacao ? `<div class="fa-sub" title="${esc(n.observacao)}">Obs.: ${esc(n.observacao.length > 60 ? n.observacao.slice(0, 60) + "…" : n.observacao)}</div>` : ""}</td>
          <td class="fa-dim">${n.competencia_inicio ? periodoLabel(n.competencia_inicio, n.competencia_fim, n.modo === "mensal" || n.modo === "quinzenal" ? n.modo : "por_servico") : "—"}</td>
          <td class="fa-strong">${fmt(n.valor)}</td>
          <td>${chip(NOTA_SIT[n.status].l, NOTA_SIT[n.status])}</td>
          <td class="fa-dim">${n.emitida_em ? new Date(n.emitida_em).toLocaleDateString("pt-BR") : "—"}</td>
          <td class="fa-dim">${n.legado ? "—" : vinc.length + (recebido ? " · recebido" : "")}</td>
          <td data-stop="1"><div style="display:flex;gap:5px;flex-wrap:wrap">${acoes}</div></td>
        </tr>`;
      }).join("") : `<tr><td colspan="8" class="fa-empty">Nenhuma nota fiscal</td></tr>`}
      </tbody></table></div></div>`;
  }

  /* ---------- MODAIS ---------- */
  function campo(label, inner, extra) { return `<label class="fa-field" ${extra || ""}><span>${label}</span>${inner}</label>`; }
  function inp(attr, key, val, more) { return `<input class="fa-in" data-${attr}="${key}" value="${esc(val)}" ${more || ""}>`; }

  function clientePickerHtml(E, opcional) {
    const c = E.cliente_id ? cliente(E.cliente_id) : null;
    if (c) {
      return campo("Cliente" + (opcional ? " (opcional)" : ""), `<div class="fa-picked"><div><b>${esc(c.nome)}</b><div class="fa-sub">${esc(fmtDoc(c.documento))} · NF: ${esc(EMISSAO[c.emissao_nf])}</div></div>
        <button type="button" class="fa-x" data-cli-editar="${c.id}" title="Editar cadastro">✎</button><button type="button" class="fa-x" data-unpick-cli="1" title="Trocar cliente">✕</button></div>`);
    }
    return campo("Cliente" + (opcional ? " (opcional)" : ""), `<div class="fa-search">
      <input class="fa-in" data-e="cliBusca" value="${esc(E.cliBusca)}" placeholder="Buscar cliente cadastrado…" autocomplete="off">
      <button type="button" class="fa-iconbtn" data-cli-novo="1" title="Cadastrar novo cliente">＋</button>
    </div><div id="fa-cli-res">${cliResultsHtml(E)}</div>`);
  }
  function cliResultsHtml(E) {
    const q = E.cliBusca.trim().toLowerCase();
    const lista = S.clientes.filter((c) => c.ativo !== false && (!q || c.nome.toLowerCase().includes(q) || (c.nome_fantasia || "").toLowerCase().includes(q) || (digits(q) && digits(c.documento).includes(digits(q))))).slice(0, 8);
    if (!S.clientes.length) return `<div class="fa-sub" style="margin-top:6px">Nenhum cliente cadastrado ainda — use o ＋ para cadastrar.</div>`;
    if (!lista.length) return `<div class="fa-sub" style="margin-top:6px">Nenhum cliente encontrado. <a href="#" data-cli-novo="1">Cadastrar “${esc(E.cliBusca)}”</a></div>`;
    return `<div class="fa-results">${lista.map((c) => `<button type="button" data-pick-cli="${c.id}"><b>${esc(c.nome)}</b><span class="fa-sub">${esc(fmtDoc(c.documento))}</span></button>`).join("")}</div>`;
  }
  function pacResultsHtml(E) {
    if (!E.pacResults.length) return E.pacBusca.trim().length >= 2 ? `<div class="fa-sub" style="margin-top:6px">Nenhum paciente encontrado</div>` : "";
    return `<div class="fa-results">${E.pacResults.map((p) => `<button type="button" data-pick-pac="${p.paciente_id}" data-nome="${esc(p.name)}"><b>${esc(p.name)}</b><span class="fa-sub">${esc(fmtDoc(p.cpf))}</span></button>`).join("")}</div>`;
  }

  function valoresHtml(E, labelBruto) {
    return `<div class="fa-row2">
      ${campo(labelBruto, inp("e", "valor_bruto", E.valor_bruto, `type="number" step="0.01" min="0" placeholder="0,00" data-preview="1"`))}
      ${campo(`Valor da NF ${E.nfTouched ? `<a href="#" data-nfreset="1" class="fa-sub">(igualar)</a>` : `<span class="fa-sub">(= valor do serviço)</span>`}`, inp("e", "valor_nf", E.nfTouched ? E.valor_nf : E.valor_bruto, `type="number" step="0.01" min="0" placeholder="0,00" data-preview="1" ${E.emissao_nf === "sem_emissao" ? "disabled" : ""}`))}
    </div>`;
  }

  function previewHtml(E) {
    const { periodos, mantidos } = planoDoForm(E);
    const h = today();
    const futuros = periodos.filter((p) => p.vencimento >= h);
    const passados = periodos.length - futuros.length;
    if (!periodos.length && !mantidos) return `<div class="fa-sub">Selecione os dias e o início para ver a previsão.</div>`;
    const svc = svcDoForm(E);
    return `${E.editId ? `<div class="fa-sub" style="margin-bottom:6px">Pagamentos já recebidos, com NF ou editados individualmente são mantidos${mantidos ? ` (${mantidos} em aberto)` : ""}. Os demais serão recalculados com a nova configuração a partir de hoje.</div>` : ""}
      ${passados ? `<div class="fa-sub" style="margin-bottom:6px">+ ${passados} período${passados > 1 ? "s" : ""} anterior${passados > 1 ? "es" : ""} a hoje também ser${passados > 1 ? "ão" : "á"} lançado${passados > 1 ? "s" : ""} (para dar baixa).</div>` : ""}
      <table class="fa-prev"><thead><tr><th>Competência</th><th>Serviços</th><th>Valor</th><th>Valor NF</th><th>Vencimento</th><th>Obs. NF</th></tr></thead><tbody>
      ${futuros.map((p) => {
        const o = E.overrides[p.inicio] || {};
        const vb = round2(p.datas.length * svc.valor_bruto), vn = round2(p.datas.length * svc.valor_nf);
        return `<tr class="${E.overrides[p.inicio] ? "ov" : ""}">
          <td>${esc(periodoLabel(p.inicio, p.fim, svc.agrupamento))}</td>
          <td class="fa-sub" title="${p.datas.map(fmtDate).join(", ")}">${p.datas.length}× ${p.datas.length <= 3 ? "(" + p.datas.map((d) => d.slice(8) + "/" + d.slice(5, 7)).join(", ") + ")" : ""}</td>
          <td><input class="fa-in sm" type="number" step="0.01" data-ov="${p.inicio}" data-ovk="valor" value="${esc(o.valor ?? vb)}"></td>
          <td><input class="fa-in sm" type="number" step="0.01" data-ov="${p.inicio}" data-ovk="valor_nf" value="${esc(o.valor_nf ?? vn)}" ${svc.emissao_nf === "sem_emissao" ? "disabled" : ""}></td>
          <td><input class="fa-in sm" type="date" data-ov="${p.inicio}" data-ovk="vencimento" value="${esc(o.vencimento || p.vencimento)}"></td>
          <td><input class="fa-in sm" data-ov="${p.inicio}" data-ovk="observacao_nf" value="${esc(o.observacao_nf ?? svc.observacao_nf ?? "")}" placeholder="—"></td>
        </tr>`;
      }).join("")}</tbody></table>
      <div class="fa-sub" style="margin-top:6px">Cada pagamento pode ser ajustado aqui ou depois, individualmente. Novos pagamentos são previstos automaticamente para manter sempre os próximos ${PREVISAO_PAGAMENTOS}.</div>`;
  }

  function entradaHtml() {
    const E = S.modal;
    const tipos = { consulta: "Consulta médica", servico: "Serviço", outros: "Outros" };
    let corpo = "";
    if (E.tipo === "consulta") {
      corpo = `
        ${E.paciente_id || E.paciente_nome ? campo("Paciente", `<div class="fa-picked"><b>${esc(E.paciente_nome)}</b><button type="button" class="fa-x" data-unpick-pac="1">✕</button></div>`)
          : campo("Paciente", `${inp("e", "pacBusca", E.pacBusca, `placeholder="Buscar paciente pelo nome…" autocomplete="off"`)}<div id="fa-pac-res">${pacResultsHtml(E)}</div>`)}
        <div class="fa-row2">
          ${campo("Data do atendimento", inp("e", "data_servico", E.data_servico, `type="date"`))}
          ${campo("Profissional (opcional)", inp("e", "medico", E.medico, `placeholder="Nome do médico"`))}
        </div>
        ${campo("Descrição", inp("e", "descricao", E.descricao, `placeholder="Consulta médica"`))}
        ${valoresHtml(E, "Valor da consulta (R$)")}
        ${campo("Emissão de NF", `<select class="fa-sel" data-e="emissao_nf">${selOpts(EMISSAO_CONSULTA, E.emissao_nf)}</select>`)}
        ${E.emissao_nf !== "sem_emissao" ? campo("Observação na NF (opcional)", `<textarea class="fa-in" rows="2" data-e="observacao_nf">${esc(E.observacao_nf)}</textarea>`) : ""}
        ${pagamentoHtml(E)}`;
    } else if (E.tipo === "outros") {
      corpo = `
        ${campo("Descrição", inp("e", "descricao", E.descricao, `placeholder="Ex.: reembolso, aluguel de sala, palestra…"`))}
        ${clientePickerHtml(E, true)}
        <div class="fa-row2">
          ${campo("Data de competência", inp("e", "data_servico", E.data_servico, `type="date"`))}
          ${campo("Profissional (opcional)", inp("e", "medico", E.medico))}
        </div>
        ${valoresHtml(E, "Valor (R$)")}
        ${campo("Emissão de NF", `<select class="fa-sel" data-e="emissao_nf">${selOpts(EMISSAO_CONSULTA, E.emissao_nf)}</select>`)}
        ${E.emissao_nf !== "sem_emissao" ? campo("Observação na NF (opcional)", `<textarea class="fa-in" rows="2" data-e="observacao_nf">${esc(E.observacao_nf)}</textarea>`) : ""}
        ${pagamentoHtml(E)}`;
    } else {
      const agrTravado = !!AGRUP_DA_EMISSAO[E.emissao_nf];
      corpo = `
        ${E.editId ? "" : `<div class="fa-field">Modalidade${seg("modalidade", { avulso: "Avulso", frequente: "Frequente" }, E.modalidade, "eseg")}</div>`}
        ${clientePickerHtml(E, false)}
        <div class="fa-row2">
          ${campo("Tipo de serviço", `<input class="fa-in" list="fa-tipos-servico" data-e="tipo_servico" value="${esc(E.tipo_servico)}"><datalist id="fa-tipos-servico">${TIPOS_SERVICO.map((t) => `<option value="${esc(t)}">`).join("")}</datalist>`)}
          ${campo("Descrição (opcional)", inp("e", "descricao", E.descricao, `placeholder="Ex.: UTI adulto 12h"`))}
        </div>
        ${valoresHtml(E, E.modalidade === "frequente" ? "Valor bruto por serviço (R$)" : "Valor bruto do serviço (R$)")}
        ${campo("Emissão de NF", `<select class="fa-sel" data-e="emissao_nf">${selOpts(EMISSAO, E.emissao_nf)}</select>`)}
        ${E.emissao_nf !== "sem_emissao" ? campo("Observação na NF (opcional)", `<textarea class="fa-in" rows="2" data-e="observacao_nf" data-preview="1" placeholder="Texto que vai no corpo de cada NF">${esc(E.observacao_nf)}</textarea>`) : ""}
        ${E.modalidade === "avulso" ? `
          ${campo("Data de prestação do serviço", inp("e", "data_servico", E.data_servico, `type="date"`))}
          ${pagamentoHtml(E)}` : `
          <div class="fa-box">
            <div class="fa-field">Repetição${seg("frequencia", { semanal: "Semanal", mensal: "Mensal" }, E.frequencia, "eseg")}</div>
            ${E.frequencia === "semanal" ? `
              <div class="fa-field">Dias da semana<div class="fa-days">${DIAS_SEMANA.map((d, i) => `<button type="button" class="${E.dias_semana.includes(i) ? "on" : ""}" data-dsem="${i}">${d}</button>`).join("")}</div></div>
              ${campo("Repete", `<select class="fa-sel" data-e="intervalo_semanas">${selOpts({ 1: "Toda semana", 2: "A cada 2 semanas", 3: "A cada 3 semanas", 4: "A cada 4 semanas" }, E.intervalo_semanas)}</select>`)}`
            : `<div class="fa-field">Dias do mês<div class="fa-days mes">${Array.from({ length: 31 }, (_, i) => i + 1).map((d) => `<button type="button" class="${E.dias_mes.includes(d) ? "on" : ""}" data-dmes="${d}">${d}</button>`).join("")}</div>
                <span class="fa-sub">Em meses mais curtos, os dias 29–31 caem no último dia do mês.</span></div>`}
            <div class="fa-row2">
              ${campo("Início", inp("e", "data_inicio", E.data_inicio, `type="date" data-preview="1"`))}
              ${campo("Término (opcional)", inp("e", "data_fim", E.data_fim, `type="date" data-preview="1"`))}
            </div>
            <div class="fa-sub">${esc(recorrenciaTexto(svcDoForm(E)))}</div>
          </div>
          <div class="fa-box">
            ${campo("Agrupar cobrança", agrTravado
              ? `<div class="fa-sub" style="padding:6px 0">${esc(AGRUP[AGRUP_DA_EMISSAO[E.emissao_nf]])} — acompanha a emissão de NF escolhida</div>`
              : `<select class="fa-sel" data-e="agrupamento">${selOpts(AGRUP, E.agrupamento)}</select>`)}
            <div class="fa-row2">
              ${campo("Pagamento previsto", `<select class="fa-sel" data-e="pagamento_regra">${selOpts({ dias_apos: "Dias após " + ((AGRUP_DA_EMISSAO[E.emissao_nf] || E.agrupamento) === "por_servico" ? "o serviço" : "o fechamento"), dia_fixo: "Dia fixo do mês" }, E.pagamento_regra)}</select>`)}
              ${E.pagamento_regra === "dia_fixo"
                ? campo("Dia do pagamento", inp("e", "pagamento_dia_mes", E.pagamento_dia_mes, `type="number" min="1" max="31" data-preview="1"`))
                : campo("Quantos dias", inp("e", "pagamento_dias", E.pagamento_dias, `type="number" min="0" max="365" data-preview="1"`))}
            </div>
            ${campo("Meio de pagamento", `<select class="fa-sel" data-e="meio_pagamento">${selOpts(MEIOS, E.meio_pagamento)}</select>`)}
          </div>
          <div class="fa-label-up" style="margin:4px 0 8px">Previsão dos próximos ${PREVISAO_PAGAMENTOS} pagamentos</div>
          <div id="fa-preview">${previewHtml(E)}</div>`}`;
    }
    return `<div class="fa-modal-bg" data-close="1"><div class="fa-modal wide">
      <div class="fa-mh"><h2>${E.editId ? "Editar serviço frequente" : "Lançar entrada"}</h2><button class="fa-x" data-close="1">✕</button></div>
      ${E.editId ? "" : `<div class="fa-field">Tipo de entrada${seg("tipo", tipos, E.tipo, "eseg")}</div>`}
      ${corpo}
      ${E.erro ? `<div class="fa-err">${esc(E.erro)}</div>` : ""}
      <div class="fa-mfoot"><button class="fa-btn outline" data-close="1">Cancelar</button><button class="fa-btn primary" data-save="entrada" ${S.busy ? "disabled" : ""}>✓ ${E.editId ? "Salvar alterações" : "Lançar"}</button></div>
    </div></div>`;
  }

  function pagamentoHtml(E) {
    return `<div class="fa-row2">
      ${campo("Data de pagamento prevista", inp("e", "data_pagamento", E.data_pagamento, `type="date"`))}
      ${campo("Meio de pagamento", `<select class="fa-sel" data-e="meio_pagamento">${selOpts(MEIOS, E.meio_pagamento)}</select>`)}
    </div>`;
  }

  function saidaHtml() {
    const F = S.modal;
    const tipos = { Despesa: "Conta / despesa", "Comissão": "Comissão", "Plantão": "Plantão / repasse" };
    return `<div class="fa-modal-bg" data-close="1"><div class="fa-modal">
      <div class="fa-mh"><h2>Lançar saída</h2><button class="fa-x" data-close="1">✕</button></div>
      <div class="fa-field">Tipo${seg("tipo", tipos, F.tipo, "sseg")}</div>
      ${F.tipo === "Despesa" ? campo("Categoria", `<select class="fa-sel" data-s="categoria">${selOpts(CATEGORIAS_SAIDA, F.categoria)}</select>`) : campo("Profissional", inp("s", "medico", F.medico, `placeholder="Nome do profissional"`))}
      ${campo("Descrição" + (F.tipo === "Despesa" ? "" : " (opcional)"), inp("s", "descricao", F.descricao))}
      <div class="fa-row2">
        ${campo(F.tipo === "Comissão" ? "Valor base (R$)" : "Valor (R$)", inp("s", "valor", F.valor, `type="number" step="0.01" min="0" placeholder="0,00"`))}
        ${F.tipo === "Comissão" ? campo("Comissão (%)", inp("s", "comissao_pct", F.comissao_pct, `type="number" min="0" max="100"`)) : campo("Vencimento", inp("s", "venc", F.venc, `type="date"`))}
      </div>
      ${F.tipo === "Comissão" ? campo("Vencimento", inp("s", "venc", F.venc, `type="date"`)) : ""}
      ${campo("Meio de pagamento", `<select class="fa-sel" data-s="meio">${selOpts(MEIOS, F.meio)}</select>`)}
      <label class="fa-check"><input type="checkbox" class="fa-chk" data-s="pago" ${F.pago ? "checked" : ""}> Já foi pago</label>
      ${F.erro ? `<div class="fa-err">${esc(F.erro)}</div>` : ""}
      <div class="fa-mfoot"><button class="fa-btn outline" data-close="1">Cancelar</button><button class="fa-btn primary" data-save="saida">✓ Lançar</button></div>
    </div></div>`;
  }

  function lancHtml() {
    const F = S.modal; const r = S.rows.find((x) => x.id === F.id);
    if (!r) return "";
    const n = r.nota_id ? nota(r.nota_id) : null;
    const svc = r.servico_id ? servico(r.servico_id) : null;
    const execs = S.execucoes.filter((x) => x.lancamento_id === r.id);
    const quem = nomeContraparte(r);
    const isRec = r.tipo === "Receita";
    return `<div class="fa-modal-bg" data-close="1"><div class="fa-modal">
      <div class="fa-mh"><div><h2>${esc(r.desc)}</h2><div class="fa-sub">${esc(quem)}${svc ? " · " + (svc.modalidade === "frequente" ? "↻ " + esc(recorrenciaTexto(svc)) : "avulso") : ""}</div></div><button class="fa-x" data-close="1">✕</button></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${chip(situacao(r))} ${isRec ? nfChip(r) : ""} ${r.editado ? `<span class="fa-sub">✎ editado individualmente</span>` : ""}</div>
      ${execs.length ? `<div class="fa-sub" style="margin-bottom:10px">Serviços neste pagamento: ${execs.map((x) => `<span style="${x.status === "cancelado" ? "text-decoration:line-through" : ""}">${fmtDate(x.data)}</span>`).join(", ")}</div>` : ""}
      <div class="fa-row2">
        ${campo(r.tipo === "Comissão" ? "Valor base (R$)" : "Valor (R$)", inp("l", "valor", F.valor, `type="number" step="0.01"`))}
        ${isRec ? campo("Valor da NF (R$)", inp("l", "valor_nf", F.valor_nf, `type="number" step="0.01" placeholder="${esc(F.valor)}" ${n && n.status === "emitida" ? "disabled" : ""}`))
          : r.tipo === "Comissão" ? campo("Comissão (%)", inp("l", "comissao_pct", F.comissao_pct, `type="number"`)) : "<div></div>"}
      </div>
      <div class="fa-row2">
        ${campo(isRec ? "Pagamento previsto" : "Vencimento", inp("l", "venc", F.venc, `type="date"`))}
        ${campo("Meio de pagamento", `<select class="fa-sel" data-l="meio">${selOpts(MEIOS, F.meio, "—")}</select>`)}
      </div>
      ${isRec && !n && !r.nf_numero ? campo("Emissão de NF", `<select class="fa-sel" data-l="nf_modo">${selOpts(EMISSAO, F.nf_modo)}</select>`) : ""}
      ${isRec ? campo("Observação na NF", `<textarea class="fa-in" rows="2" data-l="observacao_nf" ${n && n.status === "emitida" ? "disabled" : ""}>${esc(F.observacao_nf)}</textarea>`) : ""}
      ${r.pago ? campo(isRec ? "Recebido em" : "Pago em", inp("l", "data_pagamento", F.data_pagamento, `type="date"`)) : ""}
      ${F.erro ? `<div class="fa-err">${esc(F.erro)}</div>` : ""}
      <div class="fa-mfoot" style="justify-content:space-between;flex-wrap:wrap">
        <div style="display:flex;gap:6px"><button class="fa-btn xs outline" data-lanc="excluir" style="color:#dc2626">Excluir</button>
          ${r.pago ? `<button class="fa-btn xs outline" data-lanc="estornar">Estornar baixa</button>` : ""}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${!r.pago ? `<button class="fa-btn" data-lanc="baixar">${isRec ? "✓ Registrar recebimento" : "↓ Registrar pagamento"}</button>` : ""}
          <button class="fa-btn primary" data-save="lanc">Salvar</button>
        </div>
      </div>
    </div></div>`;
  }

  function notaHtml() {
    const F = S.modal; const n = nota(F.id); if (!n) return "";
    const vinc = S.rows.filter((r) => r.nota_id === n.id);
    return `<div class="fa-modal-bg" data-close="1"><div class="fa-modal">
      <div class="fa-mh"><h2>NF ${n.numero || "(sem número)"} — ${esc(n.tomador_nome || "")}</h2><button class="fa-x" data-close="1">✕</button></div>
      <div style="margin-bottom:10px">${chip(NOTA_SIT[n.status].l, NOTA_SIT[n.status])}</div>
      <div class="fa-sub" style="margin-bottom:10px">${vinc.map((r) => esc(r.desc) + " — " + fmt(valorNF(r))).join("<br>")}</div>
      ${campo("Valor da NF (R$)", inp("n", "valor", F.valor, `type="number" step="0.01" ${n.status === "emitida" || n.status === "cancelada" ? "disabled" : ""}`))}
      ${campo("Observação", `<textarea class="fa-in" rows="3" data-n="observacao" ${n.status === "emitida" || n.status === "cancelada" ? "disabled" : ""}>${esc(F.observacao)}</textarea>`)}
      <div class="fa-mfoot">
        <button class="fa-btn outline" data-close="1">Fechar</button>
        ${n.status === "aguardando_autorizacao" || n.status === "pendente" ? `<button class="fa-btn" data-save="nota">Salvar</button><button class="fa-btn primary" data-nota="${n.id}" data-notaact="${n.status === "pendente" ? "emitir" : "autorizar"}">✓ ${n.status === "pendente" ? "Emitir" : "Autorizar e emitir"}</button>` : ""}
      </div>
    </div></div>`;
  }

  function clienteHtml(F, nivel2) {
    const pj = F.tipo_pessoa === "PJ";
    return `<div class="fa-modal-bg ${nivel2 ? "lvl2" : ""}" data-close="${nivel2 ? "2" : "1"}"><div class="fa-modal wide">
      <div class="fa-mh"><h2>${F.id ? "Editar cliente" : "Novo cliente"}</h2><button class="fa-x" data-close="${nivel2 ? "2" : "1"}">✕</button></div>
      <div class="fa-field">Tipo de pessoa${seg("tipo_pessoa", { PJ: "Pessoa jurídica", PF: "Pessoa física" }, F.tipo_pessoa, "cseg")}</div>
      <div class="fa-row2">
        ${campo(pj ? "Razão social" : "Nome completo", inp("c", "nome", F.nome))}
        ${campo(pj ? "CNPJ" : "CPF", inp("c", "documento", F.documento, `inputmode="numeric" placeholder="${pj ? "00.000.000/0000-00" : "000.000.000-00"}"`))}
      </div>
      ${pj ? `<div class="fa-row2">
        ${campo("Nome fantasia", inp("c", "nome_fantasia", F.nome_fantasia))}
        ${campo("Inscrição municipal", inp("c", "inscricao_municipal", F.inscricao_municipal))}
      </div>` : ""}
      <div class="fa-row2">
        ${campo("E-mail (envio da NF)", inp("c", "email", F.email, `type="email"`))}
        ${campo("Telefone", inp("c", "telefone", F.telefone))}
      </div>
      <div class="fa-row3">
        ${campo("CEP" + (F.cepBusy ? " …" : ""), inp("c", "cep", F.cep, `inputmode="numeric" placeholder="00000-000"`))}
        ${campo("Cidade", inp("c", "cidade", F.cidade))}
        ${campo("UF", inp("c", "uf", F.uf, `maxlength="2"`))}
      </div>
      <div class="fa-row3" style="grid-template-columns:2fr 1fr 1fr">
        ${campo("Logradouro", inp("c", "logradouro", F.logradouro))}
        ${campo("Número", inp("c", "numero", F.numero))}
        ${campo("Complemento", inp("c", "complemento", F.complemento))}
      </div>
      <div class="fa-row2">
        ${campo("Bairro", inp("c", "bairro", F.bairro))}
        ${campo("Código do município (IBGE)", inp("c", "codigo_municipio", F.codigo_municipio, `inputmode="numeric"`))}
      </div>
      <div class="fa-box">
        <div class="fa-row2">
          ${campo("Emissão de NF (padrão)", `<select class="fa-sel" data-c="emissao_nf">${selOpts(EMISSAO, F.emissao_nf)}</select>`)}
          ${campo("Meio de pagamento (padrão)", `<select class="fa-sel" data-c="meio_pagamento">${selOpts(MEIOS, F.meio_pagamento, "—")}</select>`)}
        </div>
        ${pj ? `<label class="fa-check"><input type="checkbox" class="fa-chk" data-c="iss_retido" ${F.iss_retido ? "checked" : ""}> ISS retido pelo tomador</label>` : ""}
      </div>
      ${campo("Observações", `<textarea class="fa-in" rows="2" data-c="observacoes">${esc(F.observacoes)}</textarea>`)}
      ${F.erro ? `<div class="fa-err">${esc(F.erro)}</div>` : ""}
      <div class="fa-mfoot"><button class="fa-btn outline" data-close="${nivel2 ? "2" : "1"}">Cancelar</button><button class="fa-btn primary" data-save="cliente">✓ Salvar cliente</button></div>
    </div></div>`;
  }

  function modalHtml() {
    const M = S.modal;
    let h = "";
    if (M) h = { entrada: entradaHtml, saida: saidaHtml, lanc: lancHtml, nota: notaHtml, cliente: () => clienteHtml(M, false) }[M.kind]();
    if (S.modal2) h += clienteHtml(S.modal2, true);
    return h;
  }

  /* ---------- RENDER ---------- */
  function render() {
    const el = document.getElementById("s-faturamento"); if (!el) return;
    const ativo = document.activeElement;
    const foco = ativo && el.contains(ativo) ? { sel: focoSeletor(ativo), pos: ativo.selectionStart } : null;
    const scroll = el.querySelector(".fa-modal") ? el.querySelector(".fa-modal").scrollTop : 0;
    const view = { lancamentos: lancamentosHtml, trabalhos: trabalhosHtml, clientes: clientesHtml, notas: notasHtml }[S.view]();
    el.innerHTML = `
      <div class="fa-head">
        <div><h1>Faturamento</h1><p>Recebimentos, serviços, notas fiscais, contas e comissões em um só lugar</p></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="fa-btn" data-new="saida">— Lançar saída</button>
          <button class="fa-btn primary" data-new="entrada">+ Lançar entrada</button>
        </div>
      </div>
      ${cardsHtml()}
      ${avisosHtml()}
      <div class="fa-views">${VIEWS.map((v) => `<button class="${S.view === v.key ? "on" : ""}" data-view="${v.key}">${v.label}</button>`).join("")}${S.loading && S.rows.length ? `<span class="fa-sub" style="margin-left:auto">Atualizando…</span>` : ""}</div>
      ${view}
      ${modalHtml()}`;
    const m = el.querySelector(".fa-modal"); if (m && scroll) m.scrollTop = scroll;
    if (foco && foco.sel) {
      const n = el.querySelector(foco.sel);
      if (n) { n.focus(); try { if (foco.pos != null) n.setSelectionRange(foco.pos, foco.pos); } catch (x) { /* inputs de data/número */ } }
    }
  }
  function focoSeletor(n) {
    for (const k of ["e", "c", "s", "l", "n", "filt", "clibusca"]) if (n.dataset && n.dataset[k] != null) {
      const attr = "data-" + k;
      const extra = n.closest(".lvl2") ? ".lvl2 " : "";
      return `${extra}[${attr}="${n.dataset[k]}"]`;
    }
    if (n.dataset && n.dataset.ov) return `[data-ov="${n.dataset.ov}"][data-ovk="${n.dataset.ovk}"]`;
    return null;
  }

  /* ---------- EVENTOS ---------- */
  const visivel = () => { const el = document.getElementById("s-faturamento"); return el && el.style.display !== "none" ? el : null; };
  const formAtual = (attr) => (attr === "c" ? S.modal2 || (S.modal && S.modal.kind === "cliente" ? S.modal : null) : S.modal);
  const ATTRS = { e: "entrada", s: "saida", l: "lanc", n: "nota", c: "cliente" };

  document.addEventListener("click", (e) => {
    const root = visivel(); if (!root) return;
    const el = e.target.closest("[data-view],[data-tab],[data-notatab],[data-togglef],[data-clearf],[data-new],[data-act],[data-mass],[data-clearsel],[data-close],[data-save],[data-detail],[data-eseg],[data-sseg],[data-cseg],[data-dsem],[data-dmes],[data-pick-cli],[data-unpick-cli],[data-cli-novo],[data-cli-editar],[data-cli-lancar],[data-pick-pac],[data-unpick-pac],[data-nfreset],[data-lanc],[data-nota],[data-notadet],[data-exec],[data-svc-editar],[data-svc-encerrar],[data-trabmes]");
    if (!el || !root.contains(el)) return;
    const d = el.dataset;
    if (d.close) { if (e.target !== el && !e.target.closest(".fa-x,.fa-btn")) return; if (d.close === "2") S.modal2 = null; else { S.modal = null; S.modal2 = null; } return render(); }
    if (e.target.closest("[data-stop]") && (d.detail || d.notadet)) return;
    if (el.tagName === "A") e.preventDefault();
    if (d.view) { S.view = d.view; if (d.notatab) S.notaTab = d.notatab; S.selected = []; return render(); }
    if (d.tab) { S.tab = d.tab; S.selected = []; return render(); }
    if (d.notatab) { S.notaTab = d.notatab; return render(); }
    if (d.togglef) { S.showFilters = !S.showFilters; return render(); }
    if (d.clearf) { S.filters = filtrosVazios(); return render(); }
    if (d.new) { S.modal = d.new === "entrada" ? novaEntrada() : novaSaida(); return render(); }
    if (d.act) return rowAction(d.id, d.act);
    if (d.mass) return massAction(d.mass);
    if (d.clearsel) { S.selected = []; return render(); }
    if (d.trabmes) { S.trabMes = d.trabmes; return render(); }
    if (d.exec) return execAction(d.exec, d.execact);
    if (d.svcEditar) { const s = servico(d.svcEditar); if (s) { S.modal = entradaDeServico(s); render(); } return; }
    if (d.svcEncerrar) return encerrarServico(d.svcEncerrar);
    if (d.nota) return notaAction(d.nota, d.notaact);
    if (d.notadet) return notaAction(d.notadet, "editar");
    if (d.save) {
      if (d.save === "cliente") return salvarCliente();
      if (d.save === "entrada") return salvarEntrada();
      if (d.save === "saida") return salvarSaida();
      if (d.save === "lanc") return salvarLancamento();
      if (d.save === "nota") return salvarNota();
    }
    if (d.lanc) { if (d.lanc === "baixar") return baixarLancamento(false); if (d.lanc === "estornar") return baixarLancamento(true); if (d.lanc === "excluir") return excluirLancamento(); }
    if (d.cliNovo != null) {
      const ent = S.modal && S.modal.kind === "entrada" ? S.modal : null;
      const c = novoCliente();
      if (ent && ent.cliBusca.trim() && !digits(ent.cliBusca)) c.nome = ent.cliBusca.trim();
      if (ent) S.modal2 = c; else S.modal = c;
      return render();
    }
    if (d.cliEditar) { const c = novoCliente(cliente(d.cliEditar)); if (S.modal && S.modal.kind === "entrada") S.modal2 = c; else S.modal = c; return render(); }
    if (d.cliLancar) { const E = novaEntrada(); aplicarCliente(E, cliente(d.cliLancar)); S.modal = E; return render(); }
    if (d.detail) { const r = S.rows.find((x) => x.id === d.detail); if (r) { S.modal = abrirLancamento(r); render(); } return; }
    const E = S.modal;
    if (d.eseg && E) {
      E[d.eseg] = d.val; E.erro = "";
      if (d.eseg === "tipo") { if (d.val !== "servico" && !EMISSAO_CONSULTA[E.emissao_nf]) E.emissao_nf = "cada_servico"; if (d.val === "consulta") E.emissao_nf = "cada_servico"; if (d.val === "outros") E.emissao_nf = "sem_emissao"; if (d.val === "servico" && E.cliente_id) aplicarCliente(E, cliente(E.cliente_id)); }
      return render();
    }
    if (d.sseg && E) { E.tipo = d.val; E.erro = ""; return render(); }
    if (d.cseg) { const F = formAtual("c"); if (F) { F.tipo_pessoa = d.val; F.erro = ""; render(); } return; }
    if (d.dsem && E) { const i = Number(d.dsem); E.dias_semana = E.dias_semana.includes(i) ? E.dias_semana.filter((x) => x !== i) : [...E.dias_semana, i].sort(); E.overrides = {}; return render(); }
    if (d.dmes && E) { const i = Number(d.dmes); E.dias_mes = E.dias_mes.includes(i) ? E.dias_mes.filter((x) => x !== i) : [...E.dias_mes, i].sort((a, b) => a - b); E.overrides = {}; return render(); }
    if (d.pickCli && E) { aplicarCliente(E, cliente(d.pickCli)); E.erro = ""; return render(); }
    if (d.unpickCli && E) { E.cliente_id = ""; return render(); }
    if (d.pickPac && E) { E.paciente_id = d.pickPac; E.paciente_nome = d.nome; E.pacBusca = ""; E.pacResults = []; return render(); }
    if (d.unpickPac && E) { E.paciente_id = ""; E.paciente_nome = ""; return render(); }
    if (d.nfreset && E) { E.nfTouched = false; E.valor_nf = ""; return render(); }
  });

  function onField(e, isChange) {
    const t = e.target; const d = t.dataset || {};
    if (d.clibusca != null) { S.cliBusca = t.value; return render(); }
    if (d.ov && S.modal && S.modal.kind === "entrada") {
      const E = S.modal; E.overrides[d.ov] = { ...(E.overrides[d.ov] || {}), [d.ovk]: t.value };
      t.closest("tr") && t.closest("tr").classList.add("ov");
      return;
    }
    for (const attr of Object.keys(ATTRS)) {
      if (d[attr] == null) continue;
      const F = formAtual(attr); if (!F) return;
      const k = d[attr];
      F[k] = t.type === "checkbox" ? t.checked : t.value;
      if (attr === "c" && k === "cep" && digits(t.value).length === 8 && isChange !== false) buscarCep(F);
      if (attr !== "e") { if (t.tagName === "SELECT" || t.type === "checkbox") render(); return; }
      if (k === "valor_nf") F.nfTouched = true;
      if (k === "cliBusca") return atualizarParcial("fa-cli-res", cliResultsHtml(F));
      if (k === "pacBusca") return buscarPacientes(F);
      if (k === "valor_bruto" && !F.nfTouched) { const nf = document.querySelector('[data-e="valor_nf"]'); if (nf) nf.value = t.value; }
      if (k === "emissao_nf" && AGRUP_DA_EMISSAO[t.value]) F.agrupamento = AGRUP_DA_EMISSAO[t.value];
      if (t.tagName === "SELECT") { if (["emissao_nf", "agrupamento", "pagamento_regra", "intervalo_semanas"].includes(k)) F.overrides = {}; return render(); }
      if (d.preview && F.tipo === "servico" && F.modalidade === "frequente") {
        if (["data_inicio", "data_fim", "pagamento_dias", "pagamento_dia_mes"].includes(k)) F.overrides = {};
        atualizarParcial("fa-preview", previewHtml(F));
      }
      return;
    }
    if (d.filt) {
      S.filters[d.filt] = t.value;
      if (d.filt === "vmin" || d.filt === "vmax") return render();
      return render();
    }
  }
  document.addEventListener("input", (e) => {
    if (!visivel()) return;
    if (e.target.tagName === "SELECT" || e.target.type === "checkbox") return;
    if (e.target.type === "date") return;
    onField(e, false);
  });
  document.addEventListener("change", (e) => {
    if (!visivel()) return;
    const d = e.target.dataset || {};
    if (d.sel) { S.selected = e.target.checked ? [...new Set([...S.selected, d.sel])] : S.selected.filter((x) => x !== d.sel); return render(); }
    if (d.all) { S.selected = e.target.checked ? displayRows().map((r) => r.id) : []; return render(); }
    if (e.target.tagName === "SELECT" || e.target.type === "checkbox" || e.target.type === "date") return onField(e, true);
    if (d.c === "cep") { const F = formAtual("c"); if (F) buscarCep(F); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !visivel()) return;
    if (S.modal2) S.modal2 = null; else if (S.modal) S.modal = null; else return;
    render();
  });

  window.initFaturamento = function () {
    render(); load();
  };
})();
