/* ABA "PROTOCOLOS" do Cadastro do Paciente — módulo standalone, no mesmo
   padrão de protocolos.js: IIFE, usa window.sb / window.showToast /
   window.currentPatient / window.currentUser já existentes no app. */
(function () {
  const ROOT_ID = "pat-protocolos-root";
  const TIPO_ICON = { Exame: "ti-flask-2", Consulta: "ti-stethoscope", Receita: "ti-pill" };

  const PP = {
    pacienteId: null,
    loading: false,
    loaded: false,
    vinculos: [],           // paciente_protocolos + { protocolo: {...} }
    acoesByProtocolo: {},   // protocolo_id -> [acao]
    regrasByProtocolo: {},  // protocolo_id -> [regra]
    tarefasByVinculo: {},   // paciente_protocolo_id -> [tarefa]
    lme: [],                // lme_processos
    docsPaciente: [],       // documentos_paciente (para "importar")
    openCards: new Set(),
    modal: null,            // {type, ...}
  };

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                          */
  /* ------------------------------------------------------------------ */
  async function renderPacienteProtocolosTab() {
    const pid = window.currentPatient && window.currentPatient.id;
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (!pid) { root.innerHTML = emptyState("Abra o cadastro de um paciente."); return; }

    if (PP.pacienteId !== pid) {
      PP.pacienteId = pid;
      PP.loaded = false;
      PP.openCards = new Set();
    }
    if (!PP.loaded) {
      PP.loading = true;
      paint();
      await loadAll();
      PP.loading = false;
      PP.loaded = true;
    }
    paint();
  }
  window.renderPacienteProtocolosTab = renderPacienteProtocolosTab;

  async function loadAll() {
    const pid = PP.pacienteId;
    try {
      const [vincRes, lmeRes, docsRes] = await Promise.all([
        sb.from("paciente_protocolos")
          .select("*, protocolos(id,titulo,ativo)")
          .eq("paciente_id", pid)
          .order("ativo", { ascending: false })
          .order("iniciado_em", { ascending: false }),
        sb.from("lme_processos")
          .select("*")
          .eq("paciente_id", pid)
          .order("ativo", { ascending: false })
          .order("data_solicitacao", { ascending: false }),
        sb.from("documentos_paciente")
          .select("id,tipo,arquivo_nome,arquivo_path,status,created_at,conteudo,texto")
          .eq("paciente_id", pid)
          .order("created_at", { ascending: false }),
      ]);
      PP.vinculos = vincRes.data || [];
      PP.lme = lmeRes.data || [];
      PP.docsPaciente = docsRes.data || [];

      const protocoloIds = [...new Set(PP.vinculos.map((v) => v.protocolo_id))];
      PP.acoesByProtocolo = {};
      PP.regrasByProtocolo = {};
      PP.tarefasByVinculo = {};
      if (protocoloIds.length) {
        const [acoesRes, regrasRes, tarefasRes] = await Promise.all([
          sb.from("protocolo_acoes").select("*").in("protocolo_id", protocoloIds),
          sb.from("protocolo_regras").select("*").in("protocolo_id", protocoloIds),
          sb.from("protocolo_tarefas").select("*").eq("paciente_id", pid),
        ]);
        (acoesRes.data || []).forEach((a) => {
          (PP.acoesByProtocolo[a.protocolo_id] = PP.acoesByProtocolo[a.protocolo_id] || []).push(a);
        });
        (regrasRes.data || []).forEach((r) => {
          (PP.regrasByProtocolo[r.protocolo_id] = PP.regrasByProtocolo[r.protocolo_id] || []).push(r);
        });
        (tarefasRes.data || []).forEach((t) => {
          (PP.tarefasByVinculo[t.paciente_protocolo_id] = PP.tarefasByVinculo[t.paciente_protocolo_id] || []).push(t);
        });
      }
    } catch (e) {
      console.error("Falha ao carregar protocolos do paciente:", e);
      window.showToast && showToast("Falha ao carregar protocolos do paciente", "error");
    }
  }

  async function refresh() { PP.loaded = false; await renderPacienteProtocolosTab(); }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function fmtDate(d) { if (!d) return "—"; try { return new Date(d + "T00:00:00").toLocaleDateString("pt-BR"); } catch (e) { return d; } }
  function fmtDateTime(d) { if (!d) return "—"; try { return new Date(d).toLocaleDateString("pt-BR"); } catch (e) { return d; } }
  function daysBetween(a, b) { return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000); }
  function emptyState(msg) { return `<div class="pp-empty"><i class="ti ti-mood-empty"></i>${esc(msg)}</div>`; }

  /* Mesma lógica de public.avaliar_condicao(), em JS, só para classificar
     visualmente qual regra bateu — a decisão real de ramificação continua
     100% no banco (avaliar_resultado_tarefa). */
  function avaliarCondicaoJs(cond, resultado) {
    if (!cond || !resultado) return false;
    const campo = cond.campo, op = cond.operador;
    try {
      if (campo === "numero") {
        if (resultado.numero == null) return false;
        const n = Number(resultado.numero);
        if (op === "maior_que") return n > Number(cond.numero);
        if (op === "menor_que") return n < Number(cond.numero);
        if (op === "entre") return n >= Number(cond.numero_min) && n <= Number(cond.numero_max);
        if (op === "igual") return n === Number(cond.numero);
        return false;
      }
      if (campo === "texto") {
        if (!resultado.texto) return false;
        const t = String(resultado.texto).toLowerCase().trim();
        if (op === "igual") return t === String(cond.texto || "").toLowerCase().trim();
        if (op === "contem") return t.includes(String(cond.texto || "").toLowerCase().trim());
        return false;
      }
    } catch (e) { return false; }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Pintura geral                                                      */
  /* ------------------------------------------------------------------ */
  function paint() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (PP.loading) { root.innerHTML = `<div class="pp-empty"><i class="ti ti-loader-2"></i>Carregando protocolos…</div>`; return; }
    root.innerHTML = sectionProtocolos() + sectionLme() + (PP.modal ? modalHtml() : "");
    wireEvents(root);
  }

  /* ------------------------------------------------------------------ */
  /* Seção: Protocolos vinculados                                       */
  /* ------------------------------------------------------------------ */
  function sectionProtocolos() {
    const ativos = PP.vinculos.filter((v) => v.ativo);
    const inativos = PP.vinculos.filter((v) => !v.ativo);
    const ordenados = [...ativos, ...inativos];

    const lista = ordenados.length
      ? ordenados.map(cardProtocolo).join("")
      : emptyState("Nenhum protocolo vinculado a este paciente ainda. Protocolos são vinculados automaticamente conforme os CIDs do cadastro.");

    return `
      <div class="pp-section">
        <div class="pp-section-h">
          <h3><i class="ti ti-git-branch"></i> Protocolos</h3>
          <button class="pp-btn ghost" data-act="sync-protocolos"><i class="ti ti-refresh"></i> Sincronizar com CIDs do cadastro</button>
        </div>
        <p style="font-size:11px;color:#94a3b8;margin:-4px 0 12px">Vinculados automaticamente pelos CIDs do paciente, ativos primeiro.</p>
        ${lista}
      </div>`;
  }

  function cardProtocolo(v) {
    const protocolo = v.protocolos || {};
    const tarefas = PP.tarefasByVinculo[v.id] || [];
    const hoje = todayStr();
    const atrasadas = tarefas.filter((t) => t.status !== "concluido" && t.due_date < hoje);
    const open = PP.openCards.has(v.id);

    return `
      <div class="pp-card ${v.ativo ? "" : "inativo"} ${open ? "open" : ""}" data-vinculo="${v.id}">
        <div class="pp-card-h" data-act="toggle-card" data-id="${v.id}">
          <i class="ti ti-chevron-right pp-chev"></i>
          <div class="pp-card-tt">
            <div class="nm">
              ${esc(protocolo.titulo || "Protocolo")}
              ${v.cid_code ? `<span class="pp-cid">${esc(v.cid_code)}</span>` : ""}
              <span class="pp-badge ${v.ativo ? "ativo" : "inativo"}">${v.ativo ? "Ativo" : "Desativado"}</span>
              ${atrasadas.length ? `<span class="pp-badge atraso"><i class="ti ti-alert-triangle"></i> ${atrasadas.length} pendência${atrasadas.length > 1 ? "s" : ""}</span>` : (v.ativo ? `<span class="pp-badge emdia"><i class="ti ti-check"></i> Em dia</span>` : "")}
            </div>
            <div class="sub">Iniciado em ${fmtDate(v.iniciado_em)}</div>
          </div>
          <div class="pp-card-actions">
            <button class="pp-icon-btn ${v.ativo ? "danger" : "ok"}" data-act="toggle-ativo" data-id="${v.id}" data-ativo="${v.ativo}"
              title="${v.ativo ? "Desativar protocolo para este paciente" : "Reativar protocolo"}">
              <i class="ti ${v.ativo ? "ti-power" : "ti-rotate-clockwise"}"></i>
            </button>
          </div>
        </div>
        <div class="pp-card-body">
          ${pendenciasHtml(v, tarefas)}
          ${fluxogramaHtml(v, protocolo)}
        </div>
      </div>`;
  }

  function pendenciasHtml(v, tarefas) {
    const hoje = todayStr();
    const pendentes = tarefas.filter((t) => t.status !== "concluido");
    pendentes.sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    const acoesById = {};
    (PP.acoesByProtocolo[v.protocolo_id] || []).forEach((a) => (acoesById[a.id] = a));

    if (!pendentes.length) {
      return `<div class="pp-section-h" style="margin-top:2px"><h3 style="font-size:12.5px"><i class="ti ti-list-check"></i> Pendências e próximos passos</h3></div>
        <div class="pp-doc-empty">Nenhuma pendência — todas as etapas em dia.</div>`;
    }

    const linhas = pendentes.slice(0, 12).map((t) => {
      const acao = acoesById[t.acao_id] || {};
      const late = t.due_date < hoje;
      const dot = late ? "red" : "blue";
      return `
        <div class="pp-pend ${late ? "late" : ""}">
          <span class="dot ${dot}"></span>
          <div class="tt"><b>${esc(acao.nome || "Etapa")}</b> <span style="color:#94a3b8">(${esc(acao.tipo || "")})</span></div>
          <div class="due">${late ? "Atrasado desde " : "Previsto para "}${fmtDate(t.due_date)}</div>
        </div>`;
    }).join("");

    return `
      <div class="pp-section-h" style="margin-top:2px"><h3 style="font-size:12.5px"><i class="ti ti-list-check"></i> Pendências e próximos passos</h3></div>
      <div class="pp-pend-list">${linhas}</div>`;
  }

  /* ---- Fluxograma: "raízes de árvore" ---- */
  function classificarAcao(acao, tarefas, regrasByGatilho) {
    const ts = (tarefas || []).filter((t) => t.acao_id === acao.id).sort((a, b) => (a.due_date < b.due_date ? -1 : 1));
    if (!ts.length) return { reached: false, color: "gray", tarefas: ts };
    const hoje = todayStr();
    const atrasada = ts.find((t) => t.status !== "concluido" && t.due_date < hoje);
    if (atrasada) return { reached: true, color: "red", tarefas: ts };

    const regras = regrasByGatilho[acao.id] || [];
    if (regras.length) {
      const anormal = ts.find((t) => {
        if (t.status !== "concluido" || !t.resultado_valor) return false;
        const naoDefault = regras.filter((r) => !r.is_default).sort((a, b) => a.ordem - b.ordem);
        return naoDefault.some((r) => avaliarCondicaoJs(r.condicao, t.resultado_valor));
      });
      if (anormal) return { reached: true, color: "amber", tarefas: ts };
    }
    return { reached: true, color: "ok", tarefas: ts };
  }

  function buildTree(protocoloId, vinculoId) {
    const acoes = PP.acoesByProtocolo[protocoloId] || [];
    const regras = PP.regrasByProtocolo[protocoloId] || [];
    const tarefas = PP.tarefasByVinculo[vinculoId] || [];

    const regrasByGatilho = {};
    regras.forEach((r) => { (regrasByGatilho[r.acao_gatilho_id] = regrasByGatilho[r.acao_gatilho_id] || []).push(r); });
    const acoesByRegra = {};
    acoes.forEach((a) => { if (a.regra_id) (acoesByRegra[a.regra_id] = acoesByRegra[a.regra_id] || []).push(a); });

    function buildActionNode(acao) {
      const status = classificarAcao(acao, tarefas, regrasByGatilho);
      const node = { type: "acao", acao, status, children: [] };
      const rs = (regrasByGatilho[acao.id] || []).slice().sort((a, b) => a.ordem - b.ordem);
      rs.forEach((r) => {
        const filhos = acoesByRegra[r.id] || [];
        const taken = filhos.some((fa) => tarefas.some((t) => t.acao_id === fa.id));
        node.children.push({ type: "regra", regra: r, taken, children: filhos.map(buildActionNode) });
      });
      return node;
    }

    const trunk = acoes.filter((a) => !a.regra_id).sort((a, b) => a.start_day - b.start_day);
    return { type: "root", children: trunk.map(buildActionNode) };
  }

  function fluxogramaHtml(v, protocolo) {
    const acoes = PP.acoesByProtocolo[v.protocolo_id] || [];
    if (!acoes.length) return "";
    const tree = buildTree(v.protocolo_id, v.id);
    const svg = renderFlowSvg(tree);
    return `
      <div class="pp-section-h" style="margin-top:16px"><h3 style="font-size:12.5px"><i class="ti ti-sitemap"></i> Fluxo do protocolo</h3></div>
      <div class="pp-flow-wrap">${svg}</div>
      <div class="pp-flow-legend">
        <span><i style="background:#6366f1"></i> Caminho seguido</span>
        <span><i style="background:#cbd5e1;opacity:.6"></i> Ramo não seguido</span>
        <span><i style="background:#ef4444"></i> Não realizado / atrasado</span>
        <span><i style="background:#f59e0b"></i> Resultado diferente do esperado</span>
      </div>`;
  }

  const COLORS = { ok: "#6366f1", red: "#ef4444", amber: "#f59e0b", gray: "#cbd5e1" };
  const COLORS_LIGHT = { ok: "#eef2ff", red: "#fee2e2", amber: "#fef3c7", gray: "#f1f5f9" };

  function renderFlowSvg(tree) {
    // Layout manual em níveis (BFS), sem depender de d3.hierarchy — evita
    // colisão com outros usos de d3 já existentes no app.
    const levels = [];
    (function walk(node, depth) {
      levels[depth] = levels[depth] || [];
      levels[depth].push(node);
      (node.children || []).forEach((c) => walk(c, depth + 1));
    })(tree, 0);

    const NODE_W = 168, NODE_H = 44, BRANCH_H = 26, ROW_GAP = 70, COL_GAP = 26;
    let leafCounter = 0;
    function assignX(node) {
      if (!node.children || !node.children.length) {
        node._x = leafCounter * (NODE_W + COL_GAP);
        leafCounter++;
        return node._x;
      }
      node.children.forEach(assignX);
      const xs = node.children.map((c) => c._x);
      node._x = (Math.min(...xs) + Math.max(...xs)) / 2;
      return node._x;
    }
    tree.children.forEach(assignX);
    if (tree.children.length) {
      const xs = tree.children.map((c) => c._x);
      tree._x = (Math.min(...xs) + Math.max(...xs)) / 2;
    } else tree._x = 0;

    const width = Math.max(leafCounter * (NODE_W + COL_GAP), NODE_W) + 40;
    const height = levels.length * ROW_GAP + 60;

    let links = "";
    let nodes = "";

    function nodeY(depth) { return 30 + depth * ROW_GAP; }

    function drawEdge(x1, y1, x2, y2, color, opacity, dashed) {
      const midY = (y1 + y2) / 2;
      links += `<path class="pp-flow-link" d="M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}"
        stroke="${color}" opacity="${opacity}" ${dashed ? 'stroke-dasharray="4,4"' : ""}/>`;
    }

    function drawActionNode(node, depth) {
      const x = node._x + 20, y = nodeY(depth);
      const st = node.status;
      const fill = COLORS_LIGHT[st.color];
      const stroke = COLORS[st.color];
      const opacity = st.reached ? 1 : 0.4;
      const nome = node.acao.nome.length > 20 ? node.acao.nome.slice(0, 19) + "…" : node.acao.nome;
      let sub = "";
      if (st.color === "red") sub = "Não realizado";
      else if (st.color === "amber") sub = "Resultado inesperado";
      else if (st.color === "ok") sub = st.tarefas.some((t) => t.status !== "concluido") ? "Previsto: " + fmtDate(st.tarefas[0].due_date) : "Concluído";
      else sub = "Não seguido";
      nodes += `
        <g class="pp-flow-node" opacity="${opacity}" transform="translate(${x - NODE_W / 2},${y - NODE_H / 2})">
          <rect width="${NODE_W}" height="${NODE_H}" rx="12" fill="${fill}" stroke="${stroke}" />
          <text x="14" y="18" font-size="11.5" font-weight="700" fill="#1e293b">${esc(nome)}</text>
          <text x="14" y="33" font-size="9.5" fill="#64748b">${esc(sub)}</text>
        </g>`;
      (node.children || []).forEach((child) => {
        const cx = child._x + 20, cy = nodeY(depth + 1);
        drawEdge(x, y + NODE_H / 2, cx, cy - BRANCH_H / 2, child.taken === false ? COLORS.gray : COLORS[st.reached ? "ok" : "gray"], child.taken === false ? 0.35 : 1, child.taken === false);
        drawBranchNode(child, depth + 1);
      });
    }

    function drawBranchNode(node, depth) {
      const x = node._x + 20, y = nodeY(depth);
      const color = node.taken ? "#8b5cf6" : "#cbd5e1";
      const opacity = node.taken ? 1 : 0.4;
      const label = (node.regra.descricao || (node.regra.is_default ? "Caso padrão" : "Se…")).slice(0, 22);
      nodes += `
        <g class="pp-flow-node" opacity="${opacity}" transform="translate(${x - NODE_W / 2},${y - BRANCH_H / 2})">
          <rect width="${NODE_W}" height="${BRANCH_H}" rx="13" fill="none" stroke="${color}" stroke-dasharray="${node.taken ? "0" : "3,3"}" />
          <text x="${NODE_W / 2}" y="${BRANCH_H / 2 + 4}" font-size="10" text-anchor="middle" fill="${node.taken ? "#6d28d9" : "#94a3b8"}">${esc(label)}</text>
        </g>`;
      (node.children || []).forEach((child) => {
        const cx = child._x + 20, cy = nodeY(depth + 1);
        drawEdge(x, y + BRANCH_H / 2, cx, cy - NODE_H / 2, color, opacity, !node.taken);
        drawActionNode(child, depth + 1);
      });
    }

    tree.children.forEach((c) => drawActionNode(c, 1));

    return `<svg class="pp-flow-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${links}${nodes}</svg>`;
  }

  /* ------------------------------------------------------------------ */
  /* Seção: Processos LME                                                */
  /* ------------------------------------------------------------------ */
  function sectionLme() {
    const lista = PP.lme.length
      ? PP.lme.map(cardLme).join("")
      : emptyState("Nenhum processo LME cadastrado para este paciente.");
    return `
      <div class="pp-section">
        <div class="pp-section-h">
          <h3><i class="ti ti-file-certificate"></i> Processos LME (medicamentos de alto custo)</h3>
          <button class="pp-btn primary" data-act="novo-lme"><i class="ti ti-plus"></i> Novo processo LME</button>
        </div>
        <p style="font-size:11px;color:#94a3b8;margin:-4px 0 12px">Cada processo vence 6 meses após a solicitação e precisa de renovação.</p>
        ${lista}
      </div>`;
  }

  function statusLabel(s) {
    return { rascunho: "Rascunho", protocolado: "Protocolado", em_analise: "Em análise", deferido: "Deferido", indeferido: "Indeferido", renovacao_solicitada: "Renovação solicitada" }[s] || s;
  }

  function cardLme(item) {
    const hoje = todayStr();
    const diasRestantes = daysBetween(hoje, item.data_validade);
    const vencido = diasRestantes < 0;
    const atencao = !vencido && diasRestantes <= 60;
    const pct = Math.max(0, Math.min(100, (diasRestantes / 183) * 100));
    const barColor = vencido ? "#ef4444" : atencao ? "#f59e0b" : "#10b981";
    const expClass = vencido ? "vencido" : atencao ? "atencao" : "ok";
    const expLabel = vencido ? `Vencido há ${Math.abs(diasRestantes)} dia${Math.abs(diasRestantes) === 1 ? "" : "s"}` : `${diasRestantes} dia${diasRestantes === 1 ? "" : "s"} até vencer (${fmtDate(item.data_validade)})`;

    const docs = Array.isArray(item.documentos) ? item.documentos : [];
    const docsHtml = docs.length
      ? docs.map((d, i) => {
          const ref = PP.docsPaciente.find((x) => x.id === d.documento_paciente_id);
          const nome = d.nome || (ref && (ref.arquivo_nome || ref.tipo)) || "Documento";
          return `<div class="pp-doc">
              <i class="ti ${ref && ref.arquivo_path ? "ti-file-text" : "ti-file"}"></i>
              <span class="nm">${esc(nome)}</span>
              <span class="origem">${esc(d.origem || "")}</span>
              <button data-act="remover-doc" data-id="${item.id}" data-idx="${i}" title="Remover"><i class="ti ti-x"></i></button>
            </div>`;
        }).join("")
      : `<div class="pp-doc-empty">Nenhum documento vinculado ainda.</div>`;

    return `
      <div class="pp-lme-card ${vencido ? "vencido" : ""}" data-lme="${item.id}">
        <div class="pp-lme-head">
          <div>
            <div class="pp-lme-tt">${esc(item.medicamento_nome)}</div>
            <div class="pp-lme-sub">${item.cid_code ? esc(item.cid_code) + " · " : ""}${item.orgao ? esc(item.orgao) + " · " : ""}Solicitado em ${fmtDate(item.data_solicitacao)}${item.numero_processo ? " · Nº " + esc(item.numero_processo) : ""}</div>
          </div>
          <select class="pp-lme-status ${item.status}" data-act="lme-status" data-id="${item.id}">
            ${["rascunho", "protocolado", "em_analise", "deferido", "indeferido", "renovacao_solicitada"].map((s) => `<option value="${s}" ${s === item.status ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}
          </select>
        </div>
        <div class="pp-lme-expira ${expClass}">
          <i class="ti ti-hourglass"></i>
          <div class="pp-lme-bar"><i style="width:${pct}%;background:${barColor}"></i></div>
          <span>${expLabel}</span>
        </div>
        <div class="pp-doc-list">${docsHtml}</div>
        <div class="pp-lme-actions">
          <button class="pp-btn" data-act="lme-gerar" data-id="${item.id}"><i class="ti ti-wand"></i> Gerar</button>
          <button class="pp-btn" data-act="lme-anexar" data-id="${item.id}"><i class="ti ti-paperclip"></i> Anexar</button>
          <button class="pp-btn" data-act="lme-importar" data-id="${item.id}"><i class="ti ti-folder-symlink"></i> Importar do cadastro</button>
          ${docs.length ? `<button class="pp-btn" data-act="lme-zip" data-id="${item.id}"><i class="ti ti-file-zip"></i> Baixar ZIP</button>` : ""}
          ${(vencido || atencao) ? `<button class="pp-btn warn" data-act="lme-renovar" data-id="${item.id}"><i class="ti ti-refresh"></i> Solicitar renovação</button>` : ""}
          <button class="pp-btn ghost" data-act="lme-desativar" data-id="${item.id}" data-ativo="${item.ativo}">${item.ativo ? "Desativar" : "Reativar"}</button>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Modais leves próprios do módulo                                    */
  /* ------------------------------------------------------------------ */
  function closeModal() { PP.modal = null; paint(); }

  function modalHtml() {
    if (!PP.modal) return "";
    if (PP.modal.type === "novo-lme") return modalNovoLme();
    if (PP.modal.type === "importar") return modalImportar();
    return "";
  }

  function modalNovoLme() {
    const protocolosOptions = PP.vinculos.map((v) => `<option value="${v.id}">${esc((v.protocolos || {}).titulo || "Protocolo")} (${esc(v.cid_code || "")})</option>`).join("");
    return `
      <div class="pp-modal-bg" data-act="close-modal-bg">
        <div class="pp-modal" onclick="event.stopPropagation()">
          <div class="pp-modal-h"><h2>Novo processo LME</h2><button data-act="close-modal"><i class="ti ti-x"></i></button></div>
          <div class="pp-modal-b">
            <div class="pp-field"><label>Medicamento *</label><input type="text" id="pp-lme-med" placeholder="Nome do medicamento" /></div>
            <div class="pp-field"><label>CID-10</label><input type="text" id="pp-lme-cid" placeholder="Ex.: E10" value="${esc((PP.vinculos[0] || {}).cid_code || "")}" /></div>
            <div class="pp-field"><label>Protocolo relacionado</label><select id="pp-lme-protocolo"><option value="">— nenhum —</option>${protocolosOptions}</select></div>
            <div class="pp-field"><label>Órgão / operadora</label><input type="text" id="pp-lme-orgao" placeholder="Ex.: SUS, Unimed…" /></div>
            <div class="pp-field"><label>Nº do processo</label><input type="text" id="pp-lme-numero" placeholder="Opcional" /></div>
            <div class="pp-field"><label>Data da solicitação</label><input type="date" id="pp-lme-data" value="${todayStr()}" /></div>
            <div class="pp-field"><label>Observações</label><textarea id="pp-lme-obs" rows="2"></textarea></div>
          </div>
          <div class="pp-modal-f">
            <button class="pp-btn ghost" data-act="close-modal">Cancelar</button>
            <button class="pp-btn primary" data-act="salvar-novo-lme"><i class="ti ti-check"></i> Criar processo</button>
          </div>
        </div>
      </div>`;
  }

  function modalImportar() {
    const lmeId = PP.modal.lmeId;
    const jaVinculados = new Set(((PP.lme.find((l) => l.id === lmeId) || {}).documentos || []).map((d) => d.documento_paciente_id));
    const rows = PP.docsPaciente.filter((d) => !jaVinculados.has(d.id));
    const body = rows.length
      ? rows.map((d) => `
          <label class="pp-import-row">
            <input type="checkbox" value="${d.id}" data-import-chk />
            <span class="nm">${esc(d.arquivo_nome || d.tipo || "Documento")}</span>
            <span class="dt">${fmtDateTime(d.created_at)}</span>
          </label>`).join("")
      : `<div class="pp-doc-empty">Nenhum outro documento no cadastro deste paciente.</div>`;
    return `
      <div class="pp-modal-bg" data-act="close-modal-bg">
        <div class="pp-modal" onclick="event.stopPropagation()">
          <div class="pp-modal-h"><h2>Importar documentos do cadastro</h2><button data-act="close-modal"><i class="ti ti-x"></i></button></div>
          <div class="pp-modal-b">${body}</div>
          <div class="pp-modal-f">
            <button class="pp-btn ghost" data-act="close-modal">Cancelar</button>
            <button class="pp-btn primary" data-act="confirmar-importar" data-id="${lmeId}"><i class="ti ti-check"></i> Vincular selecionados</button>
          </div>
        </div>
      </div>`;
  }

  /* ------------------------------------------------------------------ */
  /* Eventos                                                             */
  /* ------------------------------------------------------------------ */
  function wireEvents(root) {
    root.querySelectorAll("[data-act]").forEach((el) => {
      if (el.tagName === "SELECT") el.onchange = (ev) => handleAction(el.dataset.act, el, ev);
      else el.onclick = (ev) => handleAction(el.dataset.act, el, ev);
    });
  }

  async function handleAction(act, el) {
    const id = el.dataset.id;
    switch (act) {
      case "toggle-card":
        if (PP.openCards.has(id)) PP.openCards.delete(id); else PP.openCards.add(id);
        paint();
        break;
      case "toggle-ativo":
        await toggleAtivoProtocolo(id, el.dataset.ativo === "true");
        break;
      case "sync-protocolos":
        await sincronizarProtocolos();
        break;
      case "novo-lme":
        PP.modal = { type: "novo-lme" };
        paint();
        break;
      case "close-modal":
      case "close-modal-bg":
        closeModal();
        break;
      case "salvar-novo-lme":
        await salvarNovoLme();
        break;
      case "lme-desativar":
        await toggleAtivoLme(id, el.dataset.ativo === "true");
        break;
      case "lme-anexar":
        anexarDocumentoLme(id);
        break;
      case "lme-importar":
        PP.modal = { type: "importar", lmeId: id };
        paint();
        break;
      case "confirmar-importar":
        await confirmarImportar(id);
        break;
      case "remover-doc":
        await removerDocumento(el.dataset.id, Number(el.dataset.idx));
        break;
      case "lme-gerar":
        gerarLme(id);
        break;
      case "lme-zip":
        await baixarZip(id);
        break;
      case "lme-renovar":
        await renovarLme(id);
        break;
      case "lme-status":
        await atualizarStatusLme(id, el.value);
        break;
    }
  }

  async function atualizarStatusLme(id, status) {
    const { error } = await sb.from("lme_processos").update({ status }).eq("id", id);
    if (error) { showToast && showToast("Erro ao atualizar status: " + error.message, "error"); return; }
    showToast && showToast("Status do processo LME atualizado", "success");
    await refresh();
  }

  async function toggleAtivoProtocolo(vinculoId, ativoAtual) {
    const { error } = await sb.from("paciente_protocolos").update({ ativo: !ativoAtual }).eq("id", vinculoId);
    if (error) { showToast && showToast("Erro ao atualizar protocolo: " + error.message, "error"); return; }
    showToast && showToast(ativoAtual ? "Protocolo desativado para este paciente" : "Protocolo reativado", "success");
    await refresh();
  }

  async function sincronizarProtocolos() {
    const { error } = await sb.rpc("sincronizar_protocolos_paciente", { p_paciente_id: PP.pacienteId });
    if (error) { showToast && showToast("Erro ao sincronizar: " + error.message, "error"); return; }
    showToast && showToast("Protocolos sincronizados com os CIDs do cadastro", "success");
    await refresh();
  }

  async function salvarNovoLme() {
    const medicamento_nome = (document.getElementById("pp-lme-med").value || "").trim();
    if (!medicamento_nome) { showToast && showToast("Informe o medicamento", "error"); return; }
    const payload = {
      paciente_id: PP.pacienteId,
      medicamento_nome,
      cid_code: (document.getElementById("pp-lme-cid").value || "").trim() || null,
      protocolo_id: document.getElementById("pp-lme-protocolo").value || null,
      orgao: (document.getElementById("pp-lme-orgao").value || "").trim() || null,
      numero_processo: (document.getElementById("pp-lme-numero").value || "").trim() || null,
      data_solicitacao: document.getElementById("pp-lme-data").value || todayStr(),
      observacoes: (document.getElementById("pp-lme-obs").value || "").trim() || null,
      status: "rascunho",
    };
    const { error } = await sb.from("lme_processos").insert(payload);
    if (error) { showToast && showToast("Erro ao criar processo LME: " + error.message, "error"); return; }
    showToast && showToast("Processo LME criado", "success");
    closeModal();
    await refresh();
  }

  async function toggleAtivoLme(id, ativoAtual) {
    const { error } = await sb.from("lme_processos").update({ ativo: !ativoAtual }).eq("id", id);
    if (error) { showToast && showToast("Erro: " + error.message, "error"); return; }
    await refresh();
  }

  async function renovarLme(id) {
    const anterior = PP.lme.find((l) => l.id === id);
    if (!anterior) return;
    const payload = {
      paciente_id: PP.pacienteId,
      protocolo_id: anterior.protocolo_id,
      paciente_protocolo_id: anterior.paciente_protocolo_id,
      processo_anterior_id: anterior.id,
      medicamento_id: anterior.medicamento_id,
      medicamento_nome: anterior.medicamento_nome,
      cid_code: anterior.cid_code,
      orgao: anterior.orgao,
      data_solicitacao: todayStr(),
      status: "renovacao_solicitada",
      observacoes: "Renovação do processo de " + fmtDate(anterior.data_solicitacao) + ".",
    };
    const { error } = await sb.from("lme_processos").insert(payload);
    if (error) { showToast && showToast("Erro ao solicitar renovação: " + error.message, "error"); return; }
    showToast && showToast("Renovação solicitada — novo processo criado", "success");
    await refresh();
  }

  async function removerDocumento(lmeId, idx) {
    const item = PP.lme.find((l) => l.id === lmeId);
    if (!item) return;
    const docs = (Array.isArray(item.documentos) ? item.documentos : []).slice();
    docs.splice(idx, 1);
    const { error } = await sb.from("lme_processos").update({ documentos: docs }).eq("id", lmeId);
    if (error) { showToast && showToast("Erro ao remover documento: " + error.message, "error"); return; }
    await refresh();
  }

  async function confirmarImportar(lmeId) {
    const checked = Array.from(document.querySelectorAll("[data-import-chk]:checked")).map((c) => c.value);
    if (!checked.length) { closeModal(); return; }
    const item = PP.lme.find((l) => l.id === lmeId);
    if (!item) return;
    const docs = (Array.isArray(item.documentos) ? item.documentos : []).slice();
    checked.forEach((docId) => {
      const ref = PP.docsPaciente.find((d) => d.id === docId);
      docs.push({ documento_paciente_id: docId, nome: (ref && (ref.arquivo_nome || ref.tipo)) || "Documento", origem: "importado", criado_em: new Date().toISOString() });
    });
    const { error } = await sb.from("lme_processos").update({ documentos: docs }).eq("id", lmeId);
    if (error) { showToast && showToast("Erro ao importar: " + error.message, "error"); return; }
    showToast && showToast("Documento(s) vinculado(s) ao processo LME", "success");
    closeModal();
    await refresh();
  }

  function anexarDocumentoLme(lmeId) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,image/*";
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (!window.currentUser) { showToast && showToast("Sessão expirada, recarregue a página", "error"); return; }
      const path = window.currentUser.id + "/" + Date.now() + "_" + file.name.replace(/[^\w.\-]+/g, "_");
      const { error: upErr } = await sb.storage.from("documentos-arquivos").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) { showToast && showToast("Erro ao enviar arquivo: " + upErr.message, "error"); return; }
      const { data: docRow, error: insErr } = await sb.from("documentos_paciente").insert({
        paciente_id: PP.pacienteId,
        paciente_nome: window.currentPatient && window.currentPatient.name,
        id_medico: window.currentUser.id,
        tipo: "lme_anexo",
        conteudo: {},
        arquivo_path: path,
        arquivo_nome: file.name,
        status: "nao_assinado",
      }).select("*").single();
      if (insErr) { showToast && showToast("Erro ao registrar documento: " + insErr.message, "error"); return; }
      await vincularDocumentoAoLme(lmeId, docRow, "anexo");
    };
    input.click();
  }

  async function vincularDocumentoAoLme(lmeId, docRow, origem) {
    const item = PP.lme.find((l) => l.id === lmeId);
    if (!item) return;
    const docs = (Array.isArray(item.documentos) ? item.documentos : []).slice();
    docs.push({ documento_paciente_id: docRow.id, nome: docRow.arquivo_nome || docRow.tipo, origem, criado_em: new Date().toISOString() });
    const { error } = await sb.from("lme_processos").update({ documentos: docs }).eq("id", lmeId);
    if (error) { showToast && showToast("Erro ao vincular documento: " + error.message, "error"); return; }
    showToast && showToast("Documento vinculado ao processo LME", "success");
    await refresh();
  }
  window.vincularDocumentoAoLmeProcesso = vincularDocumentoAoLme;

  function gerarLme(lmeId) {
    const item = PP.lme.find((l) => l.id === lmeId);
    if (!item) return;
    if (typeof window.openLmeModal !== "function") { showToast && showToast("Emissão de LME indisponível nesta tela", "error"); return; }
    window.__lmeProcessoAlvo = lmeId;
    window.openLmeModal();
    setTimeout(() => {
      if (item.cid_code && typeof window.lmeCidPick === "function") window.lmeCidPick(item.cid_code, "");
      if (item.medicamento_nome && typeof window.lmeAddMed === "function") window.lmeAddMed(item.medicamento_nome);
    }, 50);
  }

  async function baixarZip(lmeId) {
    const item = PP.lme.find((l) => l.id === lmeId);
    if (!item) return;
    if (typeof JSZip === "undefined") { showToast && showToast("Biblioteca de compactação não carregada", "error"); return; }
    const docs = Array.isArray(item.documentos) ? item.documentos : [];
    if (!docs.length) { showToast && showToast("Nenhum documento para compactar", "warn"); return; }
    showToast && showToast("Preparando ZIP…", "info");
    const zip = new JSZip();
    let algumArquivo = false;
    for (const d of docs) {
      const ref = PP.docsPaciente.find((x) => x.id === d.documento_paciente_id);
      const nomeBase = (d.nome || (ref && ref.arquivo_nome) || "documento").replace(/[^\w.\- ]+/g, "_");
      if (ref && ref.arquivo_path) {
        try {
          const { data: signed, error } = await sb.storage.from("documentos-arquivos").createSignedUrl(ref.arquivo_path, 120);
          if (!error && signed && signed.signedUrl) {
            const resp = await fetch(signed.signedUrl);
            const blob = await resp.blob();
            zip.file(nomeBase.match(/\.\w+$/) ? nomeBase : nomeBase + ".pdf", blob);
            algumArquivo = true;
            continue;
          }
        } catch (e) { console.warn("Falha ao baixar documento para o ZIP:", e); }
      }
      const texto = (ref && (ref.texto || JSON.stringify(ref.conteudo || {}, null, 2))) || "Documento pendente de anexação.";
      zip.file(nomeBase + ".txt", texto);
      algumArquivo = true;
    }
    if (!algumArquivo) { showToast && showToast("Nenhum arquivo pôde ser incluído no ZIP", "error"); return; }
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "LME_" + item.medicamento_nome.replace(/[^\w.\- ]+/g, "_") + ".zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
})();
