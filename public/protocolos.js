/* PROTOCOLOS ASSISTENCIAIS — módulo standalone (replica HealthProtocolSystem.jsx) */
(function () {
  const AT = {
    Consulta: { icon: "🩺" }, Exame: { icon: "🧪" }, Receita: { icon: "💊" },
  };
  const STATUS_NOTICE = {
    green: { label: "Avisado", cls: "green" },
    blue: { label: "Agendado", cls: "blue" },
    red: { label: "Não avisado", cls: "red" },
  };
  const FREQ_PRESETS = [{ label: "30 dias", value: 30 }, { label: "90 dias", value: 90 }, { label: "6 meses", value: 180 }, { label: "12 meses", value: 365 }];
  const ZOOM_OPTIONS = [{ label: "15 dias", step: 15, pxPerDay: 8 }, { label: "30 dias", step: 30, pxPerDay: 4 }, { label: "90 dias", step: 90, pxPerDay: 1.8 }];

  const S = {
    screen: "report", protocols: [], rows: [], selected: [], groupBy: "none",
    search: "", psearch: "", zoom: 1, loading: true,
    modal: null, editingAction: null, showActionEditor: false, cidInput: "",
    aiModal: null,
    filters: { protocols: [], doctors: [], specialties: [], actions: [], statuses: [], patient: "", cid: "" },
    showFilter: false, dd: null,
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => "n" + Math.random().toString(36).slice(2, 9);
  const sbc = () => window.sb || window.__sb;
  const brDate = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
  function fmtDay(d) {
    if (d === 0) return "Início";
    if (d < 30) return d + "d";
    if (d < 365) return Math.round(d / 30) + "m";
    const y = Math.floor(d / 365), rem = Math.round((d % 365) / 30);
    return rem > 0 ? y + "a " + rem + "m" : y + "a";
  }
  const statusColor = (r) => (r.status === "agendado" ? "blue" : r.status === "avisado" ? "green" : "red");

  /* ---------- DATA ---------- */
  async function load() {
    const sb = sbc(); if (!sb) return;
    S.loading = true; render();
    const [{ data: prot }, { data: rep }] = await Promise.all([
      sb.from("protocolos").select("id,titulo,ativo,protocolo_cids(cid_code),protocolo_acoes(*)").order("created_at"),
      sb.rpc("relatorio_protocolos"),
    ]);
    S.rows = (rep || []).map((r) => ({ ...r, due: brDate(r.due) }));
    S.protocols = (prot || []).map((p) => {
      const rows = S.rows.filter((r) => r.protocolo_id === p.id);
      const pts = [...new Set(rows.map((r) => r.paciente_id))].length;
      const late = rows.filter((r) => r.late).length;
      return {
        id: p.id, title: p.titulo, active: p.ativo,
        cids: (p.protocolo_cids || []).map((c) => c.cid_code),
        actions: (p.protocolo_acoes || []).map((a) => ({
          id: a.id, type: a.tipo, name: a.nome, startDay: a.start_day, frequency: a.frequency,
          recurrent: a.recurrent, autoRestart: a.auto_restart, specialty: a.especialidade || "", desc: a.descricao || "",
        })),
        patients: pts,
        late: rows.length ? Math.round((late / rows.length) * 100) : 0,
        onTime: rows.length ? 100 - Math.round((late / rows.length) * 100) : 100,
      };
    });
    S.loading = false; render();
  }

  async function sincronizarProtocolo(id) {
    const sb = sbc(); if (!sb || !id) return;
    try {
      const { data: sess } = await sb.auth.getSession();
      const token = sess && sess.session && sess.session.access_token;
      if (!token) return;
      await fetch("/api/protocolos/sincronizar", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token },
        body: JSON.stringify({ protocoloId: id }),
      });
    } catch (e) { console.error("sincronizar_protocolo", e); }
  }

  async function saveProtocol(form) {
    const sb = sbc(); if (!sb) return;
    let id = form.id;
    if (id) {
      await sb.from("protocolos").update({ titulo: form.title }).eq("id", id);
      await sb.from("protocolo_cids").delete().eq("protocolo_id", id);
      await sb.from("protocolo_acoes").delete().eq("protocolo_id", id);
    } else {
      const { data } = await sb.from("protocolos").insert({ titulo: form.title }).select("id").single();
      id = data && data.id; if (!id) return;
    }
    if (form.cids.length) await sb.from("protocolo_cids").insert(form.cids.map((c) => ({ protocolo_id: id, cid_code: c })));
    if (form.actions.length) await sb.from("protocolo_acoes").insert(form.actions.map((a) => ({
      protocolo_id: id, tipo: a.type, nome: a.name, start_day: a.startDay, frequency: a.frequency,
      recurrent: !!a.recurrent, auto_restart: !!a.autoRestart, especialidade: a.specialty || null, descricao: a.desc || null,
    })));
    await sincronizarProtocolo(id);
    await load();
  }

  async function toggleActive(id) {
    const sb = sbc(); const p = S.protocols.find((x) => x.id === id); if (!sb || !p) return;
    await sb.from("protocolos").update({ ativo: !p.active }).eq("id", id);
    await sincronizarProtocolo(id);
    await load();
  }

  async function rowAction(id, action) {
    const sb = sbc(); const r = S.rows.find((x) => x.id === id); if (!sb || !r) return;
    let patch = null;
    if (action === "notify") patch = { status: "avisado", notice_type: "user", notice_desc: "Avisado manualmente em " + brDate(new Date().toISOString().slice(0, 10)), notified_at: new Date().toISOString() };
    if (action === "ignore") patch = { status: "ignorado" };
    if (action === "postpone") {
      const d = new Date(r.due.split("/").reverse().join("-")); d.setDate(d.getDate() + 30);
      patch = { due_date: d.toISOString().slice(0, 10) };
    }
    if (!patch) return;
    await sb.from("protocolo_tarefas").update(patch).eq("id", id);
    await load();
  }

  /* ---------- FILTERING ---------- */
  function filteredRows() {
    const q = S.search.toLowerCase(), f = S.filters;
    return S.rows.filter((r) => {
      if (q && !(String(r.patient).toLowerCase().includes(q) || String(r.cid).toLowerCase().includes(q) || String(r.action).toLowerCase().includes(q))) return false;
      if (f.protocols.length && !f.protocols.includes(r.protocol)) return false;
      if (f.doctors.length && !f.doctors.includes(r.doctor)) return false;
      if (f.specialties.length && !f.specialties.includes(r.specialty)) return false;
      if (f.actions.length && !f.actions.includes(r.action)) return false;
      if (f.patient && !String(r.patient).toLowerCase().includes(f.patient.toLowerCase())) return false;
      if (f.cid && !String(r.cid).toUpperCase().includes(f.cid.toUpperCase())) return false;
      if (f.statuses.length) {
        const ok = f.statuses.some((s) =>
          (s === "Em dia" && !r.late) || (s === "Atrasado" && r.late) ||
          (s === "Avisados" && r.status === "avisado") || (s === "Não avisados" && r.status === "nao_avisado"));
        if (!ok) return false;
      }
      return true;
    });
  }

  /* ---------- RENDER HELPERS ---------- */
  const dot = (r) => `<span class="pt-dot ${statusColor(r)}" data-tip="${esc(r.notice_desc)}" data-tipt="${esc(STATUS_NOTICE[statusColor(r)].label)}" data-tipk="${esc(r.notice_type || "")}"></span>`;
  const menu = (id) => `<div style="position:relative;display:inline-block">
      <button class="pt-menu-btn" data-menu="${id}"><span></span><span></span><span></span></button>
      ${S.dd === "m" + id ? `<div class="pt-dd" style="right:0;top:30px">
        <button data-act="notify" data-id="${id}">📢 Avisar paciente</button>
        <button data-act="postpone" data-id="${id}">⏭ Adiar</button>
        <button data-act="ignore" data-id="${id}">🚫 Ignorar</button></div>` : ""}
    </div>`;

  function statsHtml() {
    const rows = S.rows;
    const items = [
      ["📋", "Protocolos ativos", S.protocols.filter((p) => p.active).length, "linear-gradient(135deg,rgba(96,165,250,.25),rgba(129,140,248,.2))", "#1d4ed8"],
      ["👤", "Pacientes em protocolo", [...new Set(rows.map((r) => r.paciente_id))].length, "linear-gradient(135deg,rgba(167,139,250,.25),rgba(139,92,246,.2))", "#6d28d9"],
      ["⚠️", "Protocolos em atraso", rows.filter((r) => r.late).length, "linear-gradient(135deg,rgba(248,113,113,.25),rgba(251,113,133,.2))", "#b91c1c"],
      ["📢", "Avisos enviados", rows.filter((r) => r.status === "avisado").length, "linear-gradient(135deg,rgba(52,211,153,.25),rgba(45,212,191,.2))", "#047857"],
    ];
    return `<div class="pt-stats">${items.map(([i, l, v, bg, c]) => `<div class="pt-stat" style="background:${bg}">
      <div class="r"><span style="font-size:18px">${i}</span><span class="lbl">${l}</span></div>
      <div class="val" style="color:${c}">${v}</div></div>`).join("")}</div>`;
  }

  function toolbarHtml() {
    const uniq = (k) => [...new Set(S.rows.map((r) => r[k]).filter(Boolean))];
    const f = S.filters;
    const count = f.protocols.length + f.doctors.length + f.specialties.length + f.actions.length + f.statuses.length + (f.patient ? 1 : 0) + (f.cid ? 1 : 0);
    const combo = (label, key, items) => `<div style="margin-bottom:12px"><div class="pt-lbl">${label}</div>
      <div style="max-height:110px;overflow:auto;border:1px solid rgba(203,213,225,.6);border-radius:12px;padding:6px;background:rgba(255,255,255,.6)">
      ${items.length ? items.map((i) => `<label style="display:flex;gap:8px;align-items:center;font-size:12px;padding:3px 4px;cursor:pointer">
        <input type="checkbox" class="pt-check" data-fmulti="${key}" value="${esc(i)}" ${f[key].includes(i) ? "checked" : ""}> ${esc(i)}</label>`).join("") : '<div style="font-size:11px;color:#94a3b8;padding:4px">Nenhum resultado</div>'}
      </div></div>`;
    return `<div class="pt-toolbar">
      <div class="pt-search pt-pill"><span>🔍</span><input id="pt-q" placeholder="Buscar paciente, CID ou ação..." value="${esc(S.search)}">${S.search ? '<button class="pt-btn ghost" style="padding:0 6px" data-clear="q">×</button>' : ""}</div>
      ${S.selected.length ? `<div style="position:relative">
        <button class="pt-btn pt-pill" data-dd="bulk">${S.selected.length} selecionados ▾</button>
        ${S.dd === "bulk" ? `<div class="pt-dd" style="left:0;top:38px">
          <button data-bulk="notify">📢 Avisar em massa</button>
          <button data-bulk="postpone">⏭ Adiar em massa</button>
          <button data-bulk="ignore">🚫 Ignorar em massa</button></div>` : ""}</div>` : ""}
      <div style="position:relative">
        <button class="pt-btn pt-pill ghost" data-dd="group">⊞ Agrupar${S.groupBy !== "none" ? ": " + (S.groupBy === "patient" ? "Paciente" : "Protocolo") : ""} ▾</button>
        ${S.dd === "group" ? `<div class="pt-dd" style="right:0;top:38px">
          <button data-group="none" class="${S.groupBy === "none" ? "sel" : ""}">Sem agrupamento</button>
          <button data-group="patient" class="${S.groupBy === "patient" ? "sel" : ""}">Por paciente</button>
          <button data-group="protocol" class="${S.groupBy === "protocol" ? "sel" : ""}">Por protocolo</button></div>` : ""}</div>
      <div style="position:relative">
        <button class="pt-btn pt-pill ghost" data-dd="filter" style="width:38px;padding:8px 0;text-align:center">⚙</button>
        ${S.dd === "filter" ? `<div class="pt-dd" style="right:0;top:38px;width:320px;padding:0">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #f1f5f9">
            <b style="font-size:13px;color:#334155">Filtros ${count ? `<span style="background:#6366f1;color:#fff;border-radius:99px;padding:1px 6px;font-size:10px">${count}</span>` : ""}</b>
            <span>${count ? '<button data-fclear="1" style="background:none;border:none;color:#6366f1;font-size:11px;cursor:pointer">Limpar</button>' : ""}</span>
          </div>
          <div style="max-height:44vh;overflow:auto;padding:12px 14px">
            ${combo("Protocolo", "protocols", uniq("protocol"))}
            ${combo("Médico", "doctors", uniq("doctor"))}
            ${combo("Especialidade", "specialties", uniq("specialty"))}
            ${combo("Ação", "actions", uniq("action"))}
            ${combo("Status", "statuses", ["Em dia", "Atrasado", "Avisados", "Não avisados"])}
            <div style="margin-bottom:10px"><div class="pt-lbl">Nome do paciente</div><input class="pt-in" data-ftext="patient" value="${esc(f.patient)}" placeholder="Buscar paciente..."></div>
            <div><div class="pt-lbl">CID</div><input class="pt-in" data-ftext="cid" value="${esc(f.cid)}" placeholder="Ex: I10"></div>
          </div>
          <div style="padding:12px 14px;border-top:1px solid #f1f5f9"><button class="pt-btn indigo" style="width:100%" data-fapply="1">Aplicar filtros</button></div>
        </div>` : ""}</div>
    </div>`;
  }

  function tableHtml(rows) {
    const all = rows.length && rows.every((r) => S.selected.includes(r.id));
    return `<div class="pt-card" style="overflow:hidden"><table class="pt-table">
      <thead><tr><th><input type="checkbox" class="pt-check" data-all="1" ${all ? "checked" : ""}></th>
      <th>Paciente</th><th>CID</th><th>Ação</th><th>Médico</th><th>Status</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td><input type="checkbox" class="pt-check" data-sel="${r.id}" ${S.selected.includes(r.id) ? "checked" : ""}></td>
        <td><b style="font-size:13px;color:${r.late ? "#dc2626" : "#166534"}">${esc(r.patient)}</b><div style="font-size:11px;color:#94a3b8">${r.age != null ? r.age + " anos" : "—"}</div></td>
        <td><span class="pt-cid">${esc(r.cid)}</span></td>
        <td><div style="display:flex;gap:6px;align-items:center"><span>${(AT[r.action_type] || AT.Exame).icon}</span>
          <div><div style="font-size:13px;${r.late ? "font-weight:700;color:#dc2626" : "color:#475569"}">${esc(r.action)}</div>
          <span class="pt-tag ${esc(r.action_type)}">${esc(r.action_type)}</span></div></div></td>
        <td style="font-size:11px;color:#64748b">${esc(r.doctor)}</td>
        <td><div style="display:flex;gap:8px;align-items:center">${dot(r)}<span style="font-size:11px;${r.late ? "color:#dc2626;font-weight:700" : "color:#64748b"}">${r.due}</span></div></td>
        <td style="text-align:right">${menu(r.id)}</td></tr>`).join("")}</tbody></table>
      ${rows.length ? "" : '<div class="pt-empty">Nenhum resultado encontrado.</div>'}</div>`;
  }

  function groupedHtml(rows, key) {
    const groups = {};
    rows.forEach((r) => { const k = key === "patient" ? r.patient : r.protocol; (groups[k] = groups[k] || []).push(r); });
    return Object.entries(groups).map(([name, items]) => {
      const lateCount = items.filter((r) => r.late).length;
      const allSel = items.every((r) => S.selected.includes(r.id));
      return `<div class="pt-card pt-group">
        <div class="pt-group-h">
          <input type="checkbox" class="pt-check" data-gsel="${esc(items.map((r) => r.id).join(","))}" ${allSel ? "checked" : ""}>
          <b style="font-size:13px;color:${lateCount ? "#dc2626" : "#166534"}">${esc(name)}</b>
          ${lateCount ? `<span style="font-size:11px;background:rgba(254,226,226,.7);color:#dc2626;border:1px solid rgba(254,202,202,.6);padding:2px 8px;border-radius:8px">${lateCount} em atraso</span>` : ""}
          <div style="margin-left:auto;display:flex;gap:8px">${lateCount ? ["notify", "postpone", "ignore"].map((a) => `<button class="pt-btn pt-pill ghost" style="padding:4px 10px;font-size:11px" data-gact="${a}" data-ids="${esc(items.filter((r) => r.late).map((r) => r.id).join(","))}">${a === "notify" ? "📢 Avisar" : a === "postpone" ? "⏭ Adiar" : "🚫 Ignorar"}</button>`).join("") : ""}</div>
        </div>
        ${items.map((r) => `<div class="pt-group-row">
          <input type="checkbox" class="pt-check" data-sel="${r.id}" ${S.selected.includes(r.id) ? "checked" : ""}>
          <span>${(AT[r.action_type] || AT.Exame).icon}</span>
          <span style="flex:1;font-size:13px;${r.late ? "font-weight:700;color:#dc2626" : "color:#475569"}">${esc(key === "patient" ? r.action : r.patient)}</span>
          <span class="pt-cid">${esc(r.cid)}</span>
          <span style="font-size:11px;color:#94a3b8">${esc(key === "patient" ? r.protocol : r.action)}</span>
          <span style="font-size:11px;color:#94a3b8">${r.due}</span>
          ${dot(r)}${menu(r.id)}</div>`).join("")}
      </div>`;
    }).join("") || '<div class="pt-empty">Nenhum resultado encontrado.</div>';
  }

  /* ---------- TIMELINE ---------- */
  function timelineHtml(actions) {
    if (!actions.length) return `<div class="pt-empty" style="padding:26px">📋 Nenhuma ação ainda. Clique em <b style="color:#6366f1">+ Adicionar ação</b> para começar.</div>`;
    const { step, pxPerDay } = ZOOM_OPTIONS[S.zoom];
    const maxDay = Math.max(...actions.map((a) => a.startDay + (a.recurrent ? a.frequency * 4 : a.frequency)));
    const total = Math.max(maxDay * pxPerDay, 600);
    const ticks = []; for (let d = 0; d <= maxDay + step; d += step) ticks.push(d);
    return `<div style="user-select:none">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <span style="font-size:11px;color:#94a3b8">Escala:</span>
        ${ZOOM_OPTIONS.map((z, i) => `<button class="pt-btn" style="padding:3px 10px;font-size:11px;${S.zoom === i ? "background:#6366f1;color:#fff;border:none" : ""}" data-zoom="${i}">${z.label}</button>`).join("")}
        <span style="margin-left:auto;font-size:10px;color:#cbd5e1">← arraste para navegar</span>
      </div>
      <div style="display:flex;border-radius:14px;border:1px solid rgba(255,255,255,.5);overflow:hidden;background:rgba(255,255,255,.2)">
        <div style="flex:0 0 160px;background:rgba(255,255,255,.6);box-shadow:2px 0 12px rgba(0,0,0,.06)">
          <div style="height:52px;display:flex;align-items:flex-end;padding:0 14px 8px;border-bottom:1px solid rgba(255,255,255,.5)"><span style="font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#94a3b8">Ação</span></div>
          ${actions.map((a) => `<div class="pt-tl-row"><div class="pt-icon ${a.type}">${AT[a.type].icon}</div>
            <div style="min-width:0;flex:1"><div style="font-size:11px;font-weight:600;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(a.name)}">${esc(a.name)}</div>
            <span class="pt-tag ${a.type}" style="margin-top:2px">${a.type}</span></div></div>`).join("")}
        </div>
        <div style="overflow-x:auto;flex:1"><div style="width:${total + 48}px;min-width:100%">
          <div style="position:relative;height:52px;border-bottom:1px solid rgba(255,255,255,.5);cursor:crosshair" data-tladd="1">
            <div style="position:absolute;left:0;right:0;top:34px;height:2px;background:linear-gradient(90deg,#a5b4fc,#c4b5fd,#86efac);opacity:.6"></div>
            ${ticks.map((t) => { const major = t % (step * 2) === 0 || t === 0; return `<div style="position:absolute;left:${t * pxPerDay + 20}px;bottom:2px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center">
              <div style="width:1px;height:${major ? 14 : 8}px;background:${major ? "#a5b4fc" : "#cbd5e1"};margin-bottom:2px"></div>
              ${major ? `<span style="font-size:9px;color:#94a3b8;white-space:nowrap">${fmtDay(t)}</span>` : ""}</div>`; }).join("")}
          </div>
          ${actions.map((a, ri) => {
            const pos = [a.startDay];
            if (a.recurrent && a.frequency > 0) { let d = a.startDay + a.frequency; while (d <= maxDay) { pos.push(d); d += a.frequency; } }
            return `<div style="position:relative;height:56px;width:${total + 48}px;border-bottom:1px solid rgba(255,255,255,.3);background:${ri % 2 === 0 ? "rgba(255,255,255,.06)" : "transparent"}">
              ${pos.length > 1 ? `<div style="position:absolute;left:${pos[0] * pxPerDay + 20}px;width:${(pos[pos.length - 1] - pos[0]) * pxPerDay}px;top:50%;height:2px;transform:translateY(-50%);background:linear-gradient(90deg,rgba(99,102,241,.22),rgba(168,85,247,.18))"></div>` : ""}
              ${pos.map((p, i) => `<div style="position:absolute;left:${p * pxPerDay + 20}px;top:50%;transform:translate(-50%,-50%);z-index:2">
                <div class="pt-icon ${a.type}" style="width:${i === 0 ? 36 : 28}px;height:${i === 0 ? 36 : 28}px;${i === 0 ? "box-shadow:0 0 0 2px rgba(255,255,255,.9)" : "opacity:.75"}"
                  data-tip="${esc((a.recurrent ? "Repetição " + (i + 1) + " · a cada " + fmtDay(a.frequency) + ". " : "") + (a.desc || ""))}" data-tipt="${esc(a.name)} — ${fmtDay(p)} do protocolo">${AT[a.type].icon}</div></div>`).join("")}
            </div>`;
          }).join("")}
        </div></div>
      </div>
      <div style="display:flex;gap:18px;margin-top:10px;font-size:11px;color:#64748b;flex-wrap:wrap">
        ${Object.entries(AT).map(([t, v]) => `<span>${v.icon} ${t}</span>`).join("")}
        <span style="margin-left:auto;color:#94a3b8">↺ Recorrência</span></div>
    </div>`;
  }

  /* ---------- MODAL ---------- */
  function actionEditorHtml(a) {
    const base = { type: "Exame", name: "", startDay: 0, frequency: 90, recurrent: true, autoRestart: false, specialty: "", desc: "" };
    const f = a || { ...base, ...(S._draft || {}), id: "", type: S._atype || (S._draft && S._draft.type) || "Exame" };
    return `<div class="pt-card" style="padding:16px;margin-bottom:12px" id="pt-aeditor" data-editid="${esc(f.id || "")}">
      <div style="margin-bottom:12px"><span class="pt-lbl">Tipo da ação</span>
        <div style="display:flex;gap:8px">${["Consulta", "Exame", "Receita"].map((t) => `<button class="pt-btn" style="flex:1;${f.type === t ? "color:#fff;border:none;background:" + (t === "Consulta" ? "linear-gradient(135deg,#60a5fa,#6366f1)" : t === "Exame" ? "linear-gradient(135deg,#a78bfa,#7c3aed)" : "linear-gradient(135deg,#34d399,#0d9488)") : ""}" data-atype="${t}">${AT[t].icon} ${t}</button>`).join("")}</div></div>
      <div style="margin-bottom:12px"><span class="pt-lbl">${f.type === "Exame" ? "Nome do exame" : f.type === "Receita" ? "Medicamento(s)" : "Tipo de consulta"}</span>
        <input class="pt-in" id="pt-a-name" value="${esc(f.name)}" placeholder="${f.type === "Exame" ? "Ex: Hemograma completo" : f.type === "Receita" ? "Ex: Losartana 50mg" : "Ex: Acompanhamento cardiológico"}"></div>
      <div style="margin-bottom:12px"><span class="pt-lbl">Especialidade (opcional)</span><input class="pt-in" id="pt-a-spec" value="${esc(f.specialty || "")}" placeholder="Ex: Cardiologia"></div>
      <div style="margin-bottom:12px"><span class="pt-lbl">Início após o protocolo começar</span>
        <input class="pt-in" type="number" min="0" id="pt-a-start" value="${f.startDay}"><span style="font-size:10px;color:#94a3b8">dias a partir do início do protocolo</span></div>
      <div style="margin-bottom:12px"><span class="pt-lbl">Frequência</span>
        <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">${FREQ_PRESETS.map((p) => `<button class="pt-btn" style="padding:3px 10px;font-size:11px;${f.frequency === p.value ? "background:#6366f1;color:#fff;border:none" : ""}" data-afreq="${p.value}">${p.label}</button>`).join("")}</div>
        <input class="pt-in" type="number" min="1" id="pt-a-freq" value="${f.frequency}"><span style="font-size:10px;color:#94a3b8">dias entre repetições</span></div>
      <div style="display:flex;gap:18px;margin-bottom:12px">
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;color:#475569"><input type="checkbox" class="pt-check" id="pt-a-rec" ${f.recurrent ? "checked" : ""}> Recorrente</label>
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;color:#475569"><input type="checkbox" class="pt-check" id="pt-a-auto" ${f.autoRestart ? "checked" : ""}> Reinício automático</label></div>
      <div style="margin-bottom:12px"><span class="pt-lbl">Descrição (opcional)</span><textarea class="pt-in" rows="2" id="pt-a-desc" style="resize:none">${esc(f.desc || "")}</textarea></div>
      <div style="display:flex;gap:12px"><button class="pt-btn ghost" style="flex:1" data-acancel="1">Cancelar</button>
      <button class="pt-btn indigo" style="flex:1" data-asave="1">Salvar</button></div>
    </div>`;
  }

  function modalHtml() {
    const m = S.modal; if (!m) return "";
    const sorted = [...m.actions].sort((a, b) => a.startDay - b.startDay);
    return `<div class="pt-modal-bg" data-mbg="1"><div class="pt-modal">
      <div class="pt-modal-h"><h2>${m.id ? "Editar protocolo" : "Novo protocolo"}</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="pt-btn ai" data-aiopen="1">✨ Criar com IA</button>
          <button class="pt-btn ghost" data-mclose="1" style="padding:2px 10px">×</button></div></div>
      <div class="pt-modal-b">
        <div style="margin-bottom:16px"><span class="pt-lbl">Nome do protocolo</span>
          <input class="pt-in" id="pt-m-title" value="${esc(m.title)}" placeholder="Ex: Hipertensão Arterial"></div>
        <div style="margin-bottom:16px"><span class="pt-lbl">CIDs contemplados</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">${m.cids.map((c) => `<span class="pt-chip">${esc(c)}<button data-cidrm="${esc(c)}">×</button></span>`).join("")}</div>
          <div style="display:flex;gap:8px"><input class="pt-in" id="pt-m-cid" value="${esc(S.cidInput)}" placeholder="Ex: I10">
          <button class="pt-btn" data-cidadd="1">+ Adicionar</button></div></div>
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span class="pt-lbl" style="text-transform:uppercase;letter-spacing:.08em">Ações do protocolo</span>
            <button class="pt-btn indigo" style="padding:5px 12px;font-size:11px" data-anew="1">+ Adicionar ação</button></div>
          ${S.showActionEditor && !S.editingAction ? actionEditorHtml(null) : ""}
          ${sorted.length ? `<div class="pt-card" style="padding:14px;margin-bottom:12px">${timelineHtml(sorted)}</div>` : ""}
          ${sorted.map((a) => S.editingAction === a.id ? actionEditorHtml(a) : `<div class="pt-card" style="padding:10px;display:flex;gap:12px;align-items:center;margin-bottom:8px">
            <div class="pt-icon ${a.type}">${AT[a.type].icon}</div>
            <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600;color:#1e293b">${esc(a.name)}</div>
              <div style="font-size:11px;color:#64748b">Início: dia ${a.startDay} · ${a.frequency}d · ${a.recurrent ? "Recorrente" : "1x"}${a.specialty ? " · " + esc(a.specialty) : ""}</div></div>
            <span class="pt-tag ${a.type}">${a.type}</span>
            <button class="pt-btn ghost" style="padding:2px 8px" data-aedit="${a.id}">✏️</button>
            <button class="pt-btn ghost" style="padding:2px 8px" data-adel="${a.id}">×</button></div>`).join("")}
        </div>
      </div>
      <div class="pt-modal-f"><button class="pt-btn ghost" data-mclose="1">Cancelar</button>
      <button class="pt-btn primary" data-msave="1">Salvar protocolo</button></div>
    </div></div>`;
  }

  function aiModalHtml() {
    const a = S.aiModal; if (!a) return "";
    return `<div class="pt-modal-bg" data-aibg="1" style="z-index:2100"><div class="pt-modal sm">
      <div class="pt-modal-h"><h2>✨ Criar protocolo com IA</h2>
        <button class="pt-btn ghost" data-aiclose="1" style="padding:2px 10px">×</button></div>
      <div class="pt-modal-b">
        <p style="font-size:12px;color:#64748b;margin:0 0 14px">Anexe um PDF com o protocolo (diretriz, artigo, fluxograma) e/ou escreva instruções. A IA monta o nome, os CIDs e as ações.</p>
        <div style="margin-bottom:14px"><span class="pt-lbl">Arquivo PDF (opcional)</span>
          <input class="pt-in" type="file" accept="application/pdf" id="pt-ai-file">
          ${a.filename ? `<div style="font-size:11px;color:#4f46e5;margin-top:6px">📄 ${esc(a.filename)}</div>` : ""}</div>
        <div><span class="pt-lbl">Observações / instruções para a IA</span>
          <textarea class="pt-in" rows="5" id="pt-ai-obs" style="resize:vertical" placeholder="Ex: protocolo de hipertensão, consulta a cada 6 meses, exames laboratoriais anuais...">${esc(a.obs || "")}</textarea></div>
        ${a.error ? `<div style="margin-top:12px;font-size:12px;color:#b91c1c">${esc(a.error)}</div>` : ""}
        ${a.loading ? `<div style="margin-top:12px;font-size:12px;color:#6366f1">Gerando protocolo…</div>` : ""}
      </div>
      <div class="pt-modal-f"><button class="pt-btn ghost" data-aiclose="1">Cancelar</button>
      <button class="pt-btn ai" data-aigen="1" ${a.loading ? "disabled" : ""}>${a.loading ? "Gerando…" : "Gerar protocolo"}</button></div>
    </div></div>`;
  }

  async function generateWithAI() {
    const a = S.aiModal; if (!a || a.loading) return;
    a.obs = (document.getElementById("pt-ai-obs") || {}).value || a.obs || "";
    if (!a.pdf && !a.obs.trim()) { a.error = "Anexe um PDF ou escreva instruções."; return render(); }
    a.loading = true; a.error = ""; render();
    try {
      const res = await fetch("/api/protocolos/gerar-ia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_base64: a.pdf || null, filename: a.filename || null, observacao: a.obs }),
      });
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json();
      S.modal = S.modal || { title: "", cids: [], actions: [] };
      if (d.titulo) S.modal.title = d.titulo;
      if (Array.isArray(d.cids)) S.modal.cids = [...new Set([...S.modal.cids, ...d.cids.map((c) => String(c).toUpperCase())])];
      (d.acoes || []).forEach((x) => S.modal.actions.push({
        id: uid(), type: AT[x.tipo] ? x.tipo : "Exame", name: String(x.nome || ""),
        specialty: x.especialidade || "", startDay: +x.start_day || 0, frequency: +x.frequency || 90,
        recurrent: x.recurrent !== false, autoRestart: !!x.auto_restart, desc: x.descricao || "",
      }));
      S.aiModal = null; render();
    } catch (err) {
      a.loading = false; a.error = String((err && err.message) || err); render();
    }
  }

  /* ---------- SCREENS ---------- */
  function myProtocolsHtml() {
    const q = S.psearch.toLowerCase();
    const list = S.protocols.filter((p) => p.title.toLowerCase().includes(q) || p.cids.some((c) => c.toLowerCase().includes(q)));
    return `<div class="pt-head">
        <div style="display:flex;gap:12px;align-items:center">
          <button class="pt-btn pt-pill ghost" data-back="1">←</button>
          <div><h1>Meus protocolos</h1><p>${S.protocols.length} protocolos cadastrados</p></div></div>
        <button class="pt-btn primary" data-new="1">+ Novo protocolo</button></div>
      <div class="pt-search pt-pill" style="margin-bottom:18px"><span>🔍</span><input id="pt-pq" placeholder="Buscar por nome ou CID..." value="${esc(S.psearch)}"></div>
      ${list.length ? list.map((p) => `<div class="pt-card pt-plist-card ${p.active ? "" : "inactive"}">
        <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:14px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:8px;align-items:center"><h3 style="margin:0;font-size:15px;font-weight:700;color:#1e293b">${esc(p.title)}</h3>
              ${p.active ? "" : '<span style="font-size:10px;font-weight:600;background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0;padding:2px 8px;border-radius:99px">Inativo</span>'}</div>
            <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">${p.cids.map((c) => `<span class="pt-cid">${esc(c)}</span>`).join("")}</div></div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button class="pt-btn pt-pill" data-toggle="${p.id}" title="${p.active ? "Inativar protocolo" : "Ativar protocolo"}">${p.active ? "🟢" : "⭕"}</button>
            <button class="pt-btn pt-pill" data-edit="${p.id}">✏️ Editar</button></div></div>
        <div class="pt-metrics">
          <div class="pt-metric blue"><div class="n">${p.patients}</div><div class="t">Pacientes</div></div>
          <div class="pt-metric green"><div class="n">${p.onTime}%</div><div class="t">Em dia</div></div>
          <div class="pt-metric red"><div class="n">${p.late}%</div><div class="t">Em atraso</div></div></div>
        <div style="border-top:1px solid rgba(255,255,255,.5);padding-top:10px">
          <div style="font-size:11px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Ações (${p.actions.length})</div>
          ${[...p.actions].sort((a, b) => a.startDay - b.startDay).slice(0, 3).map((a) => `<div style="font-size:12px;color:#475569;display:flex;gap:8px;align-items:center">
            <span>${AT[a.type].icon}</span><b style="font-weight:500">${esc(a.name)}</b>
            <span style="color:#94a3b8">— Dia ${a.startDay}, ${a.frequency}d${a.recurrent ? " ↺" : ""}</span></div>`).join("")}
          ${p.actions.length > 3 ? `<div style="font-size:12px;color:#6366f1;cursor:pointer" data-edit="${p.id}">+ ${p.actions.length - 3} mais ações</div>` : ""}
        </div></div>`).join("") : `<div class="pt-empty">🔍 Nenhum protocolo encontrado${S.psearch ? ' para "' + esc(S.psearch) + '"' : ""}</div>`}`;
  }

  function reportHtml() {
    const rows = filteredRows();
    return `<div class="pt-head">
        <div style="display:flex;gap:12px;align-items:center">
          <div class="pt-pill" style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:18px">🏥</div>
          <div><h1>Protocolos Assistenciais</h1><p>Acompanhamento clínico contínuo por CID</p></div></div>
        <button class="pt-btn pt-pill" data-goprot="1">📋 Meus protocolos</button></div>
      ${statsHtml()}${toolbarHtml()}
      ${S.groupBy === "none" ? tableHtml(rows) : groupedHtml(rows, S.groupBy === "patient" ? "patient" : "protocol")}
      <div class="pt-legend pt-pill"><span style="color:#94a3b8;font-weight:500">Status:</span>
        ${Object.values(STATUS_NOTICE).map((s) => `<span style="display:flex;gap:6px;align-items:center"><span class="pt-dot ${s.cls}"></span>${s.label}</span>`).join("")}</div>`;
  }

  function render() {
    const el = document.getElementById("s-protocolos"); if (!el) return;
    el.innerHTML = `<div class="pt-wrap">${S.loading ? '<div class="pt-empty">Carregando protocolos…</div>' : (S.screen === "protocols" ? myProtocolsHtml() : reportHtml())}${modalHtml()}${aiModalHtml()}</div>`;
  }

  /* ---------- EVENTS ---------- */
  function collectAction() {
    const box = document.getElementById("pt-aeditor"); if (!box) return null;
    return {
      id: box.dataset.editid || uid(),
      type: S._atype || (S.editingAction ? (S.modal.actions.find((a) => a.id === S.editingAction) || {}).type : null) || "Exame",
      name: document.getElementById("pt-a-name").value.trim(),
      specialty: document.getElementById("pt-a-spec").value.trim(),
      startDay: +document.getElementById("pt-a-start").value || 0,
      frequency: +document.getElementById("pt-a-freq").value || 1,
      recurrent: document.getElementById("pt-a-rec").checked,
      autoRestart: document.getElementById("pt-a-auto").checked,
      desc: document.getElementById("pt-a-desc").value.trim(),
    };
  }

  document.addEventListener("click", (e) => {
    const root = document.getElementById("s-protocolos");
    if (!root || root.style.display === "none") return;
    const t = e.target.closest("[data-menu],[data-act],[data-dd],[data-group],[data-bulk],[data-clear],[data-goprot],[data-back],[data-new],[data-edit],[data-toggle],[data-mclose],[data-msave],[data-mbg],[data-cidadd],[data-cidrm],[data-anew],[data-aedit],[data-adel],[data-asave],[data-acancel],[data-atype],[data-afreq],[data-zoom],[data-gact],[data-fclear],[data-fapply],[data-tladd],[data-aiopen],[data-aiclose],[data-aigen],[data-aibg]");
    if (!t) { if (S.dd) { S.dd = null; render(); } return; }
    const d = t.dataset;
    if (d.aiopen) { S.aiModal = { obs: "", pdf: null, filename: "", loading: false, error: "" }; return render(); }
    if (d.aiclose) { S.aiModal = null; return render(); }
    if (d.aigen) return generateWithAI();
    if (d.aibg && e.target === t) { S.aiModal = null; return render(); }
    if (d.menu) { S.dd = S.dd === "m" + d.menu ? null : "m" + d.menu; return render(); }
    if (d.dd) { S.dd = S.dd === d.dd ? null : d.dd; return render(); }
    if (d.act) { S.dd = null; return rowAction(d.id, d.act); }
    if (d.bulk) { const ids = [...S.selected]; S.selected = []; S.dd = null; return Promise.all(ids.map((i) => rowAction(i, d.bulk))); }
    if (d.gact) { return Promise.all(d.ids.split(",").map((i) => rowAction(i, d.gact))); }
    if (d.group) { S.groupBy = d.group; S.dd = null; return render(); }
    if (d.clear) { S.search = ""; return render(); }
    if (d.fclear) { S.filters = { protocols: [], doctors: [], specialties: [], actions: [], statuses: [], patient: "", cid: "" }; return render(); }
    if (d.fapply) { S.dd = null; return render(); }
    if (d.goprot) { S.screen = "protocols"; return render(); }
    if (d.back) { S.screen = "report"; return render(); }
    if (d.new) { S.modal = { title: "", cids: [], actions: [] }; S.showActionEditor = false; S.editingAction = null; S._draft = null; return render(); }
    if (d.edit) { const p = S.protocols.find((x) => x.id === d.edit); S.modal = { id: p.id, title: p.title, cids: [...p.cids], actions: p.actions.map((a) => ({ ...a })) }; return render(); }
    if (d.toggle) return toggleActive(d.toggle);
    if (d.mbg && e.target === t) { S.modal = null; return render(); }
    if (d.mclose) { S.modal = null; S.showActionEditor = false; S.editingAction = null; return render(); }
    if (d.msave) { const m = { ...S.modal, title: document.getElementById("pt-m-title").value.trim() }; if (!m.title) return alert("Informe o nome do protocolo."); S.modal = null; render(); return saveProtocol(m); }
    if (d.cidadd) { const v = (document.getElementById("pt-m-cid").value || "").trim().toUpperCase(); if (v && !S.modal.cids.includes(v)) S.modal.cids.push(v); S.cidInput = ""; return render(); }
    if (d.cidrm) { S.modal.cids = S.modal.cids.filter((c) => c !== d.cidrm); return render(); }
    if (d.anew || d.tladd) { S.editingAction = null; S.showActionEditor = true; S._atype = "Exame"; S._draft = null; return render(); }
    if (d.aedit) { S.editingAction = d.aedit; S.showActionEditor = false; S._atype = (S.modal.actions.find((a) => a.id === d.aedit) || {}).type; return render(); }
    if (d.adel) { S.modal.actions = S.modal.actions.filter((a) => a.id !== d.adel); return render(); }
    if (d.acancel) { S.editingAction = null; S.showActionEditor = false; S._draft = null; return render(); }
    if (d.atype) { const cur = collectAction(); S._atype = d.atype; if (cur) { cur.type = d.atype; S._draft = cur; } return renderDraft(cur, d.atype); }
    if (d.afreq) { document.getElementById("pt-a-freq").value = d.afreq; return; }
    if (d.zoom) { S.zoom = +d.zoom; return render(); }
    if (d.asave) {
      const a = collectAction(); if (!a || !a.name) return alert("Informe o nome da ação.");
      const i = S.modal.actions.findIndex((x) => x.id === a.id);
      if (i >= 0) S.modal.actions[i] = a; else S.modal.actions.push(a);
      S.editingAction = null; S.showActionEditor = false; S._draft = null; return render();
    }
  });

  function renderDraft(cur, type) {
    if (!cur) return;
    if (S.editingAction) { const i = S.modal.actions.findIndex((x) => x.id === S.editingAction); if (i >= 0) S.modal.actions[i] = { ...cur, type }; }
    render();
    const box = document.getElementById("pt-aeditor");
    if (box && !S.editingAction) {
      document.getElementById("pt-a-name").value = cur.name;
      document.getElementById("pt-a-spec").value = cur.specialty;
      document.getElementById("pt-a-start").value = cur.startDay;
      document.getElementById("pt-a-freq").value = cur.frequency;
      document.getElementById("pt-a-rec").checked = cur.recurrent;
      document.getElementById("pt-a-auto").checked = cur.autoRestart;
      document.getElementById("pt-a-desc").value = cur.desc;
    }
  }

  document.addEventListener("input", (e) => {
    if (e.target.id === "pt-ai-obs" && S.aiModal) { S.aiModal.obs = e.target.value; return; }
    if (e.target.id === "pt-q") { S.search = e.target.value; const p = e.target.selectionStart; render(); const n = document.getElementById("pt-q"); if (n) { n.focus(); n.setSelectionRange(p, p); } }
    if (e.target.id === "pt-pq") { S.psearch = e.target.value; const p = e.target.selectionStart; render(); const n = document.getElementById("pt-pq"); if (n) { n.focus(); n.setSelectionRange(p, p); } }
    if (e.target.dataset && e.target.dataset.ftext) S.filters[e.target.dataset.ftext] = e.target.value;
  });

  document.addEventListener("change", (e) => {
    const d = e.target.dataset || {};
    if (d.sel) { S.selected = e.target.checked ? [...new Set([...S.selected, d.sel])] : S.selected.filter((x) => x !== d.sel); return render(); }
    if (d.gsel) { const ids = d.gsel.split(","); S.selected = e.target.checked ? [...new Set([...S.selected, ...ids])] : S.selected.filter((x) => !ids.includes(x)); return render(); }
    if (d.all) { S.selected = e.target.checked ? filteredRows().map((r) => r.id) : []; return render(); }
    if (d.fmulti) { const k = d.fmulti, v = e.target.value; S.filters[k] = e.target.checked ? [...S.filters[k], v] : S.filters[k].filter((x) => x !== v); }
  });

  /* tooltip */
  let tipEl = null;
  document.addEventListener("mouseover", (e) => {
    const t = e.target.closest("[data-tip]"); if (!t) return;
    const r = t.getBoundingClientRect();
    tipEl = document.createElement("div"); tipEl.className = "pt-tip";
    tipEl.innerHTML = `<div style="font-weight:700;color:#4338ca;margin-bottom:4px">${esc(t.dataset.tipt || "")}</div>
      <div style="color:#475569;line-height:1.5">${esc(t.dataset.tip || "")}</div>
      ${t.dataset.tipk ? `<div style="margin-top:6px;color:#94a3b8">${t.dataset.tipk === "auto" ? "📡 Automático" : "👤 Por usuário"}</div>` : ""}`;
    document.body.appendChild(tipEl);
    let left = Math.max(8, Math.min(r.left + r.width / 2 - 112, window.innerWidth - 232));
    let top = r.top - tipEl.offsetHeight - 8; if (top < 8) top = r.bottom + 8;
    tipEl.style.left = left + "px"; tipEl.style.top = top + "px";
  });
  document.addEventListener("mouseout", () => { if (tipEl) { tipEl.remove(); tipEl = null; } });

  window.initProtocolos = function () { render(); load(); };
})();
