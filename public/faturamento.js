/* FATURAMENTO — módulo standalone (replica Faturamento.jsx) */
(function () {
  const TABS = [
    { key: "todos", label: "Todos" },
    { key: "receitas", label: "Recebidos" },
    { key: "despesas", label: "Pagos" },
    { key: "atrasados", label: "Atrasados" },
    { key: "comissoes", label: "Comissões" },
    { key: "faturado", label: "Faturado" },
    { key: "a_faturar", label: "A faturar" },
    { key: "a_pagar", label: "A pagar" },
  ];
  const STATUS = {
    Faturado: { bg: "rgba(219,234,254,.9)", color: "#1d4ed8", dot: "#3b82f6" },
    "A faturar": { bg: "rgba(254,249,195,.9)", color: "#92400e", dot: "#f59e0b" },
    Atrasado: { bg: "rgba(255,237,213,.9)", color: "#c2410c", dot: "#f97316" },
    Cobrado: { bg: "rgba(243,244,246,.9)", color: "#374151", dot: "#9ca3af" },
    Pago: { bg: "rgba(209,250,229,.9)", color: "#065f46", dot: "#10b981" },
    "A pagar": { bg: "rgba(254,249,195,.9)", color: "#78350f", dot: "#f59e0b" },
  };
  const TIPO = {
    Receita: { bg: "rgba(220,252,231,.85)", color: "#065f46" },
    Despesa: { bg: "rgba(254,226,226,.85)", color: "#991b1b" },
    "Comissão": { bg: "rgba(219,234,254,.85)", color: "#1e40af" },
  };
  const CARDS_T = [
    { bg: "rgba(220,252,231,.72)", c: "#16a34a" },
    { bg: "rgba(254,226,226,.72)", c: "#dc2626" },
    { bg: "rgba(237,233,254,.72)", c: "#7c3aed" },
    { bg: "rgba(255,237,213,.72)", c: "#ea580c" },
  ];
  const NATUREZAS = ["Consulta", "Exame", "Cirurgia", "Insumo", "Gastos", "Outros"];
  const AUTO_KEY = "faturamentoAutoNF";

  const S = {
    rows: [], tab: "todos", selected: [], detail: null, form: null,
    showFilters: false, loading: true, autoNF: false,
    filters: { medico: "", esp: "", tipo: "", status: "", nat: "", etq: "", vmin: "", vmax: "" },
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (v) => "R$ " + Number(v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fmtDate = (d) => (d ? String(d).split("-").reverse().join("/") : "—");
  const today = () => new Date().toISOString().slice(0, 10);
  const sbc = () => window.sb || window.__sb;

  const tabMatch = (tab, r) => ({
    todos: true,
    receitas: r.tipo === "Receita" && r.pago,
    despesas: r.tipo === "Despesa" && r.pago,
    atrasados: r.status === "Atrasado",
    comissoes: r.tipo === "Comissão",
    faturado: r.etiqueta === "Faturado",
    a_faturar: r.etiqueta === "A faturar",
    a_pagar: r.etiqueta === "A pagar",
  }[tab] || false);

  /* ---------- DATA ---------- */
  function mapRow(r) {
    return {
      id: r.id, tipo: r.tipo, desc: r.descricao, paciente: r.paciente_nome || "",
      paciente_id: r.paciente_id || null, medico: r.medico || "", esp: r.especialidade || "",
      data: r.data, venc: r.vencimento, valor: Number(r.valor || 0),
      status: r.status, etiqueta: r.etiqueta, natureza: r.natureza || "", pago: !!r.pago,
      comissao_pct: Number(r.comissao_pct || 0), comissao_val: Number(r.comissao_val || 0),
      nf_numero: r.nf_numero, nf_serie: r.nf_serie, nf_status: r.nf_status, nf_emitida_em: r.nf_emitida_em,
    };
  }

  async function load() {
    const sb = sbc(); if (!sb) return;
    S.loading = true; render();
    const { data } = await sb.from("lancamentos_financeiros").select("*").order("data", { ascending: false });
    S.rows = (data || []).map(mapRow).map(overdue);
    S.loading = false; render();
    if (S.autoNF) await autoEmitir();
  }

  function overdue(r) {
    if (!r.pago && r.venc && r.venc < today() && r.status !== "Faturado" && r.status !== "Pago") {
      return { ...r, status: "Atrasado", etiqueta: r.etiqueta === "Cobrado" ? "Cobrado" : "Atrasado" };
    }
    return r;
  }

  async function nextNF() {
    const sb = sbc();
    const { data } = await sb.from("lancamentos_financeiros").select("nf_numero").not("nf_numero", "is", null).order("nf_numero", { ascending: false }).limit(1);
    return ((data && data[0] && data[0].nf_numero) || 0) + 1;
  }

  async function emitirNF(id, silent) {
    const sb = sbc(); const r = S.rows.find((x) => x.id === id);
    if (!sb || !r || r.tipo !== "Receita") return;
    const numero = await nextNF();
    const patch = {
      status: "Faturado", etiqueta: "Faturado", pago: true,
      nf_numero: numero, nf_serie: "1", nf_status: "Emitida", nf_emitida_em: new Date().toISOString(),
      nf_payload: { descricao: r.desc, paciente: r.paciente, valor: r.valor, natureza: r.natureza, emitida_por: "MediCopilot" },
    };
    await sb.from("lancamentos_financeiros").update(patch).eq("id", id);
    if (!silent) { await load(); if (window.toast) window.toast("NF " + numero + " emitida"); }
  }

  async function autoEmitir() {
    const pend = S.rows.filter((r) => r.tipo === "Receita" && r.status !== "Faturado" && r.venc && r.venc <= today());
    if (!pend.length) return;
    for (const r of pend) await emitirNF(r.id, true);
    await load();
  }

  async function rowAction(id, action) {
    const sb = sbc(); const r = S.rows.find((x) => x.id === id); if (!sb || !r) return;
    if (action === "faturar") return emitirNF(id);
    let patch = null;
    if (action === "pagar") patch = { pago: true, status: r.tipo === "Receita" ? "Faturado" : "Pago", etiqueta: r.tipo === "Receita" ? "Faturado" : "Pago" };
    if (action === "cobrar") patch = { etiqueta: "Cobrado" };
    if (!patch) return;
    await sb.from("lancamentos_financeiros").update(patch).eq("id", id);
    await load();
  }

  async function massAction(action) {
    const ids = [...S.selected];
    for (const id of ids) {
      const r = S.rows.find((x) => x.id === id); if (!r) continue;
      if (action === "faturar" && (r.tipo !== "Receita" || r.status === "Faturado")) continue;
      if (action === "pagar" && (r.pago || r.tipo === "Receita")) continue;
      if (action === "cobrar" && (r.status !== "Atrasado" || r.tipo === "Despesa")) continue;
      await rowAction(id, action);
    }
    S.selected = []; await load();
  }

  async function saveForm() {
    const sb = sbc(); if (!sb || !S.form) return;
    const f = S.form, isRec = f.mode === "receita";
    const valor = parseFloat(f.valor) || 0, pct = parseFloat(f.comissao_pct) || 0;
    const tipo = isRec ? "Receita" : (f.tipo === "Comissão" ? "Comissão" : "Despesa");
    const row = {
      tipo, descricao: f.desc || "Novo lançamento", paciente_nome: f.paciente || null,
      medico: f.medico || null, especialidade: f.esp || null, natureza: f.natureza || "Outros",
      data: today(), vencimento: f.venc || today(), valor,
      status: isRec ? "A faturar" : "A pagar", etiqueta: isRec ? "A faturar" : "A pagar",
      pago: false, comissao_pct: pct, comissao_val: (valor * pct) / 100,
    };
    const { data, error } = await sb.from("lancamentos_financeiros").insert(row).select("id").single();
    S.form = null;
    if (error) { alert("Erro ao salvar: " + error.message); return render(); }
    await load();
    if (S.autoNF && isRec && row.vencimento <= today() && data) await emitirNF(data.id);
  }

  /* ---------- FILTER ---------- */
  function displayRows() {
    const f = S.filters;
    return S.rows.filter((r) => {
      if (!tabMatch(S.tab, r)) return false;
      if (f.medico && r.medico !== f.medico) return false;
      if (f.esp && r.esp !== f.esp) return false;
      if (f.tipo && r.tipo !== f.tipo) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.nat && r.natureza !== f.nat) return false;
      if (f.etq && r.etiqueta !== f.etq) return false;
      if (f.vmin && r.valor < parseFloat(f.vmin)) return false;
      if (f.vmax && r.valor > parseFloat(f.vmax)) return false;
      return true;
    });
  }
  const uniq = (k) => [...new Set(S.rows.map((r) => r[k]).filter(Boolean))];

  /* ---------- RENDER ---------- */
  function chip(label) {
    if (!label) return "";
    const c = STATUS[label] || { bg: "rgba(243,244,246,.9)", color: "#374151", dot: "#9ca3af" };
    return `<span class="fa-chip" style="background:${c.bg};color:${c.color}"><span class="d" style="background:${c.dot}"></span>${esc(label)}</span>`;
  }
  function tipoChip(t) {
    const c = TIPO[t] || { bg: "rgba(243,244,246,.85)", color: "#374151" };
    return `<span class="fa-chip" style="background:${c.bg};color:${c.color}">${esc(t)}</span>`;
  }
  function spark(color, up) {
    const d = up ? "M0,18 C10,16 15,10 25,12 C35,14 40,6 50,8 C60,10 65,4 75,6 C80,7 85,3 90,2"
      : "M0,6 C10,8 15,14 25,12 C35,10 40,16 50,14 C60,12 65,18 75,16 C80,15 85,18 90,19";
    return `<svg width="90" height="22" viewBox="0 0 90 22" fill="none"><path d="${d}" stroke="${color}" stroke-width="1.8" stroke-linecap="round" fill="none" opacity=".7"/></svg>`;
  }
  function cardsHtml() {
    const sum = (fn, key) => S.rows.filter(fn).reduce((s, r) => s + (key ? r[key] : r.valor), 0);
    const vals = [
      { lbl: "Total recebido", v: sum((r) => r.tipo === "Receita" && r.pago), icon: "$", up: true },
      { lbl: "Total pago", v: sum((r) => r.tipo === "Despesa" && r.pago), icon: "↓", up: false },
      { lbl: "A receber", v: sum((r) => r.tipo === "Receita" && !r.pago), icon: "⏳", up: true },
      { lbl: "Comissões a pagar", v: sum((r) => r.tipo === "Comissão" && !r.pago, "comissao_val"), icon: "%", up: true },
    ];
    return `<div class="fa-cards">${vals.map((c, i) => `
      <div class="fa-card" style="background:${CARDS_T[i].bg}">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="ico" style="color:${CARDS_T[i].c}">${c.icon}</div>
          <span class="lbl">${c.lbl}</span>
        </div>
        <div class="val">${fmt(c.v)}</div>
        ${spark(CARDS_T[i].c, c.up)}
      </div>`).join("")}</div>`;
  }
  function rowActionsHtml(r) {
    const b = [];
    if (r.tipo === "Receita" && r.status !== "Faturado") b.push(`<button class="fa-btn primary xs" data-act="faturar" data-id="${r.id}">📄 Emitir NF</button>`);
    if (r.status === "Atrasado" && r.tipo !== "Despesa") b.push(`<button class="fa-btn xs" data-act="cobrar" data-id="${r.id}">🔔 Cobrar</button>`);
    if (r.tipo === "Despesa" && !r.pago) b.push(`<button class="fa-btn danger xs" data-act="pagar" data-id="${r.id}">↓ Baixar</button>`);
    if (r.tipo === "Comissão" && !r.pago) b.push(`<button class="fa-btn primary xs" data-act="pagar" data-id="${r.id}">✓ Pagar</button>`);
    if (!b.length) return `<span style="color:#d1d5db;font-size:18px;letter-spacing:2px">···</span>`;
    return `<div style="display:flex;gap:5px;flex-wrap:wrap">${b.join("")}</div>`;
  }
  function rowHtml(r) {
    const bg = r.tipo === "Comissão" ? (r.pago ? "rgba(220,252,231,.25)" : "rgba(254,249,195,.25)")
      : r.tipo === "Receita" ? (r.status === "Atrasado" ? "rgba(254,249,195,.3)" : "rgba(220,252,231,.22)")
      : r.tipo === "Despesa" ? (r.status === "Atrasado" ? "rgba(254,249,195,.3)" : "rgba(254,226,226,.22)") : "transparent";
    const vc = r.tipo === "Comissão" ? (r.pago ? "#16a34a" : "#92400e") : r.tipo === "Receita" ? (r.status === "Atrasado" ? "#c2410c" : "#16a34a") : "#dc2626";
    const dv = r.tipo === "Comissão" ? fmt(r.comissao_val) : r.tipo === "Despesa" ? "-" + fmt(r.valor) : fmt(r.valor);
    return `<tr style="background:${bg}" data-detail="${r.id}">
      <td data-stop="1"><input type="checkbox" class="fa-chk" data-sel="${r.id}" ${S.selected.includes(r.id) ? "checked" : ""}></td>
      <td>${tipoChip(r.tipo)}</td>
      <td><div style="font-size:13px;color:#111827;font-weight:500">${esc(r.desc)}</div>
        ${r.paciente ? `<div style="font-size:11px;color:#9ca3af;margin-top:2px">${esc(r.paciente)}</div>` : ""}</td>
      <td style="font-size:12px;color:#6b7280">${esc(r.medico) || "—"}</td>
      <td style="font-size:12px;color:#6b7280">${fmtDate(r.data)}</td>
      <td style="font-size:12px;color:#6b7280">${fmtDate(r.venc)}</td>
      <td><span style="color:${vc};font-weight:700;font-size:14px">${dv}</span>
        ${r.tipo === "Comissão" ? `<div style="font-size:10px;color:#9ca3af">${r.comissao_pct}% de ${fmt(r.valor)}</div>` : ""}
        ${r.nf_numero ? `<div style="font-size:10px;color:#16a34a;margin-top:1px">NF ${r.nf_numero}</div>` : ""}</td>
      <td>${chip(r.status)}</td>
      <td style="min-width:130px" data-stop="1">${rowActionsHtml(r)}</td>
    </tr>`;
  }
  function filtersHtml() {
    const f = S.filters;
    const defs = [
      { k: "medico", l: "Médico", o: uniq("medico") },
      { k: "esp", l: "Especialidade", o: uniq("esp") },
      { k: "tipo", l: "Tipo", o: ["Receita", "Despesa", "Comissão"] },
      { k: "status", l: "Status", o: ["Faturado", "A faturar", "Atrasado", "Pago", "A pagar"] },
      { k: "nat", l: "Natureza", o: NATUREZAS },
      { k: "etq", l: "Etiqueta", o: ["Faturado", "A faturar", "Atrasado", "Cobrado", "Pago", "A pagar"] },
    ];
    const active = Object.values(f).filter((v) => v !== "").length;
    return `<div class="fa-filters">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;font-weight:600;color:#374151;letter-spacing:.04em;text-transform:uppercase">Filtros</span>
          ${active ? `<span style="background:rgba(220,252,231,.9);color:#16a34a;font-size:10px;font-weight:700;padding:1px 7px;border-radius:20px;border:1px solid rgba(22,163,74,.3)">${active} ativos</span>` : ""}
        </div>
        ${active ? `<button class="fa-btn xs" data-clearf="1" style="color:#dc2626;background:rgba(254,226,226,.8)">✕ Limpar tudo</button>` : ""}
      </div>
      <div class="fa-fgrid">
        ${defs.map((d) => `<div><label>${d.l}</label>
          <select class="fa-sel ${f[d.k] ? "act" : ""}" data-filt="${d.k}">
            <option value="">Todos</option>
            ${d.o.map((o) => `<option ${f[d.k] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
          </select></div>`).join("")}
        <div style="grid-column:span 2"><label>Faixa de valor</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input class="fa-in ${f.vmin ? "act" : ""}" type="number" placeholder="Mín" data-filt="vmin" value="${esc(f.vmin)}">
            <span style="color:#d1d5db">–</span>
            <input class="fa-in ${f.vmax ? "act" : ""}" type="number" placeholder="Máx" data-filt="vmax" value="${esc(f.vmax)}">
          </div>
        </div>
      </div></div>`;
  }
  function detailHtml() {
    const r = S.detail; if (!r) return "";
    const fields = [
      ["Paciente", r.paciente || "—"], ["Médico", r.medico || "—"], ["Especialidade", r.esp || "—"],
      ["Data", fmtDate(r.data)], ["Vencimento", fmtDate(r.venc)], ["Valor", fmt(r.valor)],
      ["Status", r.status], ["Tipo", r.tipo], ["Natureza", r.natureza || "—"],
      ...(r.tipo === "Comissão" ? [["Comissão", r.comissao_pct + "% = " + fmt(r.comissao_val)]] : []),
      ["Nota fiscal", r.nf_numero ? "NF " + r.nf_numero + " / série " + (r.nf_serie || "1") : "Não emitida"],
      ["Emissão da NF", r.nf_emitida_em ? new Date(r.nf_emitida_em).toLocaleString("pt-BR") : "—"],
    ];
    const showNF = r.tipo === "Receita" && r.status !== "Faturado";
    return `<div class="fa-modal-bg" data-close="1"><div class="fa-modal">
      <div class="fa-mh"><h2>${esc(r.desc)}</h2><button class="fa-x" data-close="1">✕</button></div>
      ${fields.map(([k, v]) => `<div class="fa-drow"><span>${k}</span><span>${esc(v)}</span></div>`).join("")}
      ${showNF ? `<div style="margin-top:16px;display:flex;justify-content:flex-end"><button class="fa-btn primary" data-act="faturar" data-id="${r.id}">📄 Emitir NF</button></div>` : ""}
    </div></div>`;
  }
  function formHtml() {
    const f = S.form; if (!f) return "";
    const isRec = f.mode === "receita";
    return `<div class="fa-modal-bg" data-close="1"><div class="fa-modal">
      <div class="fa-mh"><h2>${isRec ? "Lançar receita" : "Lançar despesa"}</h2><button class="fa-x" data-close="1">✕</button></div>
      ${isRec ? `<label class="fa-field">Paciente<input class="fa-in" data-form="paciente" value="${esc(f.paciente)}" placeholder="Nome do paciente"></label>` : ""}
      <label class="fa-field">Médico<input class="fa-in" data-form="medico" value="${esc(f.medico)}" placeholder="Nome do profissional"></label>
      <label class="fa-field">Especialidade<input class="fa-in" data-form="esp" value="${esc(f.esp)}"></label>
      <label class="fa-field">Descrição<input class="fa-in" data-form="desc" value="${esc(f.desc)}" placeholder="Descrição"></label>
      <label class="fa-field">Valor (R$)<input class="fa-in" type="number" step="0.01" data-form="valor" value="${esc(f.valor)}" placeholder="0,00"></label>
      <label class="fa-field">Vencimento<input class="fa-in" type="date" data-form="venc" value="${esc(f.venc)}"></label>
      ${!isRec ? `<label class="fa-field">Tipo<select class="fa-sel" data-form="tipo">
        ${["Despesa", "Comissão"].map((t) => `<option ${f.tipo === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>` : ""}
      <label class="fa-field">Natureza<select class="fa-sel" data-form="natureza">
        ${NATUREZAS.map((t) => `<option ${f.natureza === t ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      ${isRec ? `<label class="fa-field">Comissão (%)<input class="fa-in" type="number" min="0" max="100" data-form="comissao_pct" value="${esc(f.comissao_pct)}"></label>` : ""}
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:4px">
        <button class="fa-btn outline" data-close="1">Cancelar</button>
        <button class="fa-btn primary" data-save="1">✓ Salvar</button>
      </div></div></div>`;
  }

  function render() {
    const el = document.getElementById("s-faturamento"); if (!el) return;
    const rows = displayRows();
    const sel = S.rows.filter((r) => S.selected.includes(r.id));
    const selTotal = sel.reduce((s, r) => s + (r.tipo === "Comissão" ? r.comissao_val : r.valor), 0);
    const hasF = Object.values(S.filters).some((v) => v !== "");
    el.innerHTML = `
      <div class="fa-head">
        <div><h1>Faturamento</h1><p>Entradas, saídas, comissões e emissão de NF</p></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#374151;background:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.9);padding:6px 12px;border-radius:50px;cursor:pointer">
            <input type="checkbox" class="fa-chk" data-auto="1" ${S.autoNF ? "checked" : ""}> NF automática
          </label>
          <button class="fa-btn" data-new="despesa">— Lançar despesa</button>
          <button class="fa-btn primary" data-new="receita">+ Lançar receita</button>
        </div>
      </div>
      ${cardsHtml()}
      <div class="fa-panel">
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
          <span style="color:#d1d5db">|</span>
          <span style="font-size:13px;font-weight:600;color:#111827">${fmt(selTotal)}</span>
          <div style="flex:1"></div>
          <button class="fa-btn xs" data-mass="cobrar">🔔 Cobrar</button>
          <button class="fa-btn xs" data-mass="pagar">✓ Pagar</button>
          <button class="fa-btn primary xs" data-mass="faturar">📄 Faturar</button>
          <button class="fa-x" data-clearsel="1">✕</button></div>` : ""}
        <div style="overflow-x:auto">
          <table class="fa-table"><thead><tr>
            <th><input type="checkbox" class="fa-chk" data-all="1" ${rows.length && rows.every((r) => S.selected.includes(r.id)) ? "checked" : ""}></th>
            <th>Tipo</th><th>Descrição / Paciente</th><th>Médico</th><th>Data</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Ações</th>
          </tr></thead><tbody>
            ${S.loading ? `<tr><td colspan="9" class="fa-empty">Carregando…</td></tr>`
              : rows.length ? rows.map(rowHtml).join("")
              : `<tr><td colspan="9" class="fa-empty">Nenhum lançamento encontrado</td></tr>`}
          </tbody></table>
        </div>
      </div>
      ${detailHtml()}${formHtml()}`;
  }

  /* ---------- EVENTS ---------- */
  document.addEventListener("click", (e) => {
    if (!document.getElementById("s-faturamento") || document.getElementById("s-faturamento").style.display === "none") return;
    const el = e.target.closest("[data-tab],[data-togglef],[data-clearf],[data-new],[data-act],[data-mass],[data-clearsel],[data-close],[data-save],[data-detail]");
    if (!el || !document.getElementById("s-faturamento").contains(el)) return;
    const d = el.dataset;
    if (e.target.closest("[data-stop]") && d.detail) return;
    if (d.tab) { S.tab = d.tab; S.selected = []; return render(); }
    if (d.togglef) { S.showFilters = !S.showFilters; return render(); }
    if (d.clearf) { S.filters = { medico: "", esp: "", tipo: "", status: "", nat: "", etq: "", vmin: "", vmax: "" }; return render(); }
    if (d.new) { S.form = { mode: d.new, desc: "", valor: "", venc: today(), tipo: "Despesa", medico: "", paciente: "", esp: "", natureza: d.new === "receita" ? "Consulta" : "Gastos", comissao_pct: 30 }; return render(); }
    if (d.act) { S.detail = null; return rowAction(d.id, d.act); }
    if (d.mass) return massAction(d.mass);
    if (d.clearsel) { S.selected = []; return render(); }
    if (d.save) return saveForm();
    if (d.close) { S.detail = null; S.form = null; return render(); }
    if (d.detail) { S.detail = S.rows.find((r) => r.id === d.detail) || null; return render(); }
  });

  document.addEventListener("input", (e) => {
    const d = e.target.dataset || {};
    if (d.form && S.form) { S.form[d.form] = e.target.value; return; }
    if (d.filt && (d.filt === "vmin" || d.filt === "vmax")) {
      S.filters[d.filt] = e.target.value;
      const k = d.filt, p = e.target.selectionStart; render();
      const n = document.querySelector(`[data-filt="${k}"]`); if (n) { n.focus(); try { n.setSelectionRange(p, p); } catch (x) {} }
    }
  });

  document.addEventListener("change", (e) => {
    const d = e.target.dataset || {};
    if (d.form && S.form) { S.form[d.form] = e.target.value; return; }
    if (d.filt && d.filt !== "vmin" && d.filt !== "vmax") { S.filters[d.filt] = e.target.value; return render(); }
    if (d.auto) {
      S.autoNF = e.target.checked;
      try { localStorage.setItem(AUTO_KEY, S.autoNF ? "1" : "0"); } catch (x) {}
      if (S.autoNF) autoEmitir(); else render();
      return;
    }
    if (d.sel) { S.selected = e.target.checked ? [...new Set([...S.selected, d.sel])] : S.selected.filter((x) => x !== d.sel); return render(); }
    if (d.all) { S.selected = e.target.checked ? displayRows().map((r) => r.id) : []; return render(); }
  });

  window.initFaturamento = function () {
    try { S.autoNF = localStorage.getItem(AUTO_KEY) === "1"; } catch (x) {}
    render(); load();
  };
})();
