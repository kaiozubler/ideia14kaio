/* QUESTIONÁRIOS — módulo standalone (espelha a arquitetura de protocolos.js) */
(function () {
  const TIPOS = {
    texto: { label: "Texto", icon: "✏️" },
    unica: { label: "Escolha única", icon: "🔘" },
    multipla: { label: "Múltipla escolha", icon: "☑️" },
    escala: { label: "Escala de valores", icon: "📊" },
  };
  const ESCALA_PRESETS = [
    { label: "1 a 5", min: 1, max: 5 },
    { label: "1 a 10", min: 1, max: 10 },
    { label: "0 a 10", min: 0, max: 10 },
  ];

  // Catálogo de campos do cadastro do paciente disponíveis pro formulário.
  // Fica fora das tabelas com busca/lookup (CID, vínculos de parentesco,
  // médico preferencial, grupo) — só campos que o próprio paciente preenche.
  const CAMPOS_CADASTRO_OBRIGATORIOS = ["name", "cpf", "telefone", "email"];
  const CAMPOS_CADASTRO = [
    { id: "name", label: "Nome", grupo: "Dados pessoais" },
    { id: "cpf", label: "CPF", grupo: "Dados pessoais" },
    { id: "telefone", label: "Telefone", grupo: "Dados pessoais" },
    { id: "email", label: "Email", grupo: "Dados pessoais" },
    { id: "data_nascimento", label: "Data de nascimento", grupo: "Dados pessoais" },
    { id: "sexo", label: "Sexo", grupo: "Dados pessoais" },
    { id: "sus", label: "Cartão SUS", grupo: "Dados pessoais" },
    { id: "mae", label: "Nome da mãe", grupo: "Dados pessoais" },
    { id: "pai", label: "Nome do pai", grupo: "Dados pessoais" },
    { id: "ocupacao", label: "Ocupação", grupo: "Dados pessoais" },
    { id: "convenio", label: "Convênio", grupo: "Dados pessoais" },
    { id: "cep", label: "CEP", grupo: "Endereço" },
    { id: "logradouro", label: "Logradouro", grupo: "Endereço" },
    { id: "numero", label: "Número", grupo: "Endereço" },
    { id: "complemento", label: "Complemento", grupo: "Endereço" },
    { id: "bairro", label: "Bairro", grupo: "Endereço" },
    { id: "cidade", label: "Cidade", grupo: "Endereço" },
    { id: "uf", label: "UF", grupo: "Endereço" },
    { id: "dados_clinicos", label: "Dados clínicos (observações gerais)", grupo: "Dados clínicos" },
    { id: "ic_peso", label: "Peso (kg)", grupo: "Dados clínicos" },
    { id: "ic_altura", label: "Altura (cm)", grupo: "Dados clínicos" },
    { id: "ic_sangue", label: "Tipo sanguíneo", grupo: "Dados clínicos" },
    { id: "ic_sedent", label: "Nível de atividade física", grupo: "Dados clínicos" },
    { id: "ic_tab", label: "Tabagismo", grupo: "Dados clínicos" },
    { id: "ic_eti", label: "Etilismo", grupo: "Dados clínicos" },
    { id: "ic_sono", label: "Sono", grupo: "Dados clínicos" },
    { id: "ic_meds", label: "Medicações em uso", grupo: "Dados clínicos" },
    { id: "ic_alerg", label: "Alergias", grupo: "Dados clínicos" },
    { id: "ic_fam", label: "Histórico familiar (doenças)", grupo: "Dados clínicos" },
    { id: "ic_outros", label: "Outras informações", grupo: "Dados clínicos" },
  ];
  const CAMPO_CADASTRO_BY_ID = Object.fromEntries(CAMPOS_CADASTRO.map((c) => [c.id, c]));

  // Variáveis disponíveis no corpo dos Termos de Ciência — substituídas na
  // hora da assinatura (ver renderCorpo() em src/routes/t.$termoId.tsx e
  // src/routes/api/public/termos/assinar.ts, que mantêm a MESMA lista).
  const TERMO_VARS = [
    { k: "paciente_nome", label: "Nome do paciente" },
    { k: "paciente_cpf", label: "CPF do paciente" },
    { k: "paciente_email", label: "Email do paciente" },
    { k: "medico_nome", label: "Nome do médico" },
    { k: "data_assinatura", label: "Data da assinatura" },
  ];
  const TERMO_CORPO_PADRAO = "Eu, {paciente_nome}, portador(a) do CPF {paciente_cpf}, declaro estar ciente e de acordo com os termos abaixo, apresentados pelo(a) médico(a) {medico_nome} em {data_assinatura}.\n\n[Descreva aqui o conteúdo do termo de ciência...]";

  const S = {
    screen: "respostas", // 'respostas' | 'formularios' | 'termos' | 'termoassinaturas'
    loading: true,
    forms: [], responses: [],
    search: "", fsearch: "",
    filterForm: "",
    modal: null,           // construtor de formulário (novo/editar)
    aiModal: null,          // { obs, loading, error }
    shareModal: null,      // { formId, mode:'individual'|'massa', query, patients:[], selected:[], sending:false }
    viewResponse: null,    // resposta aberta em detalhe
    dd: null,
    toastMsg: null,
    // ---- Termos de ciência ----
    termos: [], termoAssinaturas: [],
    tsearch: "",
    termoModal: null,          // construtor de termo (novo/editar)
    termoAssinaturasView: null, // { termoId, termoTitulo }
    viewAssinatura: null,       // assinatura de termo aberta em detalhe
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => "q" + Math.random().toString(36).slice(2, 9);
  // IDs vindos do banco são UUID de verdade; perguntas novas (ainda não salvas)
  // usam o formato local gerado por uid() ("q" + 7 chars). É assim que
  // diferenciamos "atualizar" de "inserir" ao salvar uma edição.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isUuid = (v) => UUID_RE.test(String(v || ""));
  const sbc = () => window.sb || window.__sb;
  const brDateTime = (iso) => { if (!iso) return "—"; const d = new Date(iso); return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };

  function toast(msg) {
    if (typeof window.toast === "function") return window.toast(msg);
    if (typeof window.showToast === "function") return window.showToast(msg, "success");
    S.toastMsg = msg; render();
    setTimeout(() => { S.toastMsg = null; render(); }, 2600);
  }

  /* O link enviado ao paciente precisa apontar para o site publicado.
     Os domínios de edição/preview exigem login, então nunca são usados no link. */
  const SITE_PUBLICO = "https://ideia14kaio.lovable.app";
  function publicOrigin() {
    const o = window.location.origin || "";
    const privado = /lovableproject\.com|lovable\.dev|id-preview--|--?dev\.lovable\.app|localhost|127\.0\.0\.1/i.test(o);
    return privado ? SITE_PUBLICO : o;
  }
  function publicLink(formId, pacienteId) {
    const base = publicOrigin() + "/f/" + formId;
    return pacienteId ? base + "?p=" + pacienteId : base;
  }
  function publicLinkTermo(termoId) {
    return publicOrigin() + "/t/" + termoId;
  }

  /* ---------- DATA ---------- */
  async function load() {
    const sb = sbc(); if (!sb) { S.loading = false; return render(); }
    S.loading = true; render();
    const [{ data: forms, error: e1 }, { data: resp, error: e2 }, { data: termos, error: e3 }, { data: assinaturas, error: e4 }] = await Promise.all([
      sb.from("questionarios")
        .select("id,titulo,descricao,anonimo,ativo,exigir_auth_email,created_at,campos_cadastro,questionario_perguntas(id,ordem,tipo,enunciado,longa,opcoes,escala_min,escala_max,escala_label_min,escala_label_max,obrigatoria)")
        .order("created_at", { ascending: false }),
      sb.from("questionario_respostas")
        .select("id,questionario_id,paciente_nome,paciente_telefone,paciente_email,paciente_cpf,email_verificado,respondido_em,questionarios(titulo,anonimo),questionario_resposta_itens(id,valor_texto,valor_opcoes,valor_escala,questionario_perguntas(enunciado,tipo))")
        .order("respondido_em", { ascending: false }),
      sb.from("termos")
        .select("id,titulo,corpo,checkbox_label,ativo,created_at")
        .order("created_at", { ascending: false }),
      sb.from("termo_assinaturas")
        .select("id,termo_id,paciente_nome,paciente_cpf,paciente_email,texto_final,checkbox_aceito,email_verificado,assinado_em")
        .order("assinado_em", { ascending: false }),
    ]);
    if (e1) console.error("load questionarios", e1);
    if (e2) console.error("load questionario_respostas", e2);
    if (e3) console.error("load termos", e3);
    if (e4) console.error("load termo_assinaturas", e4);
    S.forms = (forms || []).map((f) => ({
      id: f.id, titulo: f.titulo, descricao: f.descricao || "", anonimo: !!f.anonimo, ativo: f.ativo !== false,
      exigirAuthEmail: !!f.exigir_auth_email,
      createdAt: f.created_at,
      camposCadastro: Array.isArray(f.campos_cadastro) && f.campos_cadastro.length ? f.campos_cadastro : [...CAMPOS_CADASTRO_OBRIGATORIOS],
      perguntas: (f.questionario_perguntas || []).sort((a, b) => (a.ordem || 0) - (b.ordem || 0)).map((p) => ({
        id: p.id, ordem: p.ordem || 0, tipo: p.tipo, enunciado: p.enunciado, longa: !!p.longa,
        opcoes: p.opcoes || [], escalaMin: p.escala_min, escalaMax: p.escala_max,
        escalaLabelMin: p.escala_label_min || "", escalaLabelMax: p.escala_label_max || "",
        obrigatoria: p.obrigatoria !== false,
      })),
    }));
    S.responses = (resp || []).map((r) => ({
      id: r.id, questionarioId: r.questionario_id,
      questionarioTitulo: (r.questionarios && r.questionarios.titulo) || "—",
      anonimo: !!(r.questionarios && r.questionarios.anonimo),
      pacienteNome: r.paciente_nome || "", pacienteTelefone: r.paciente_telefone || "",
      pacienteEmail: r.paciente_email || "", pacienteCpf: r.paciente_cpf || "",
      emailVerificado: !!r.email_verificado,
      respondidoEm: r.respondido_em,
      itens: (r.questionario_resposta_itens || []).map((it) => ({
        enunciado: (it.questionario_perguntas && it.questionario_perguntas.enunciado) || "",
        tipo: (it.questionario_perguntas && it.questionario_perguntas.tipo) || "texto",
        valorTexto: it.valor_texto || "", valorOpcoes: it.valor_opcoes || null, valorEscala: it.valor_escala,
      })),
    }));
    S.forms.forEach((f) => { f.respostasCount = S.responses.filter((r) => r.questionarioId === f.id).length; });

    S.termos = (termos || []).map((t) => ({
      id: t.id, titulo: t.titulo, corpo: t.corpo || "", checkboxLabel: t.checkbox_label || "", ativo: t.ativo !== false, createdAt: t.created_at,
    }));
    S.termoAssinaturas = (assinaturas || []).map((a) => ({
      id: a.id, termoId: a.termo_id, pacienteNome: a.paciente_nome || "", pacienteCpf: a.paciente_cpf || "",
      pacienteEmail: a.paciente_email || "", textoFinal: a.texto_final || "", checkboxAceito: !!a.checkbox_aceito,
      emailVerificado: !!a.email_verificado, assinadoEm: a.assinado_em,
    }));
    S.termos.forEach((t) => { t.assinaturasCount = S.termoAssinaturas.filter((a) => a.termoId === t.id).length; });

    S.loading = false; render();
  }

  /* ---------- SALVAR / ATIVAR ---------- */
  async function saveForm() {
    const sb = sbc(); const m = S.modal; if (!sb || !m) return;
    if (!m.titulo.trim()) return alert("Dê um nome ao formulário.");
    if (!m.perguntas.length) return alert("Adicione ao menos uma pergunta.");
    for (const p of m.perguntas) {
      if (!p.enunciado.trim()) return alert("Toda pergunta precisa de um enunciado.");
      if ((p.tipo === "unica" || p.tipo === "multipla") && p.opcoes.filter((o) => o.trim()).length < 2) return alert('A pergunta "' + p.enunciado + '" precisa de ao menos 2 opções.');
    }
    m.saving = true; render();
    let id = m.id;
    const isEdit = !!id;
    const camposCadastro = Array.from(new Set([...CAMPOS_CADASTRO_OBRIGATORIOS, ...(m.anonimo ? [] : m.camposCadastro || [])]));
    const payload = { titulo: m.titulo.trim(), descricao: m.descricao.trim() || null, anonimo: m.anonimo, ativo: m.ativo !== false, campos_cadastro: m.anonimo ? [] : camposCadastro, exigir_auth_email: m.anonimo ? false : !!m.exigirAuthEmail };
    if (isEdit) {
      const { error } = await sb.from("questionarios").update(payload).eq("id", id);
      if (error) { m.saving = false; render(); return toast("Falha ao salvar: " + error.message); }
    } else {
      const { data, error } = await sb.from("questionarios").insert(payload).select("id").single();
      if (error) { m.saving = false; render(); return toast("Falha ao criar: " + error.message); }
      id = data.id;
    }

    const linhaDe = (p, i) => ({
      questionario_id: id, ordem: i, tipo: p.tipo, enunciado: p.enunciado.trim(),
      longa: p.tipo === "texto" ? !!p.longa : false,
      opcoes: (p.tipo === "unica" || p.tipo === "multipla") ? p.opcoes.filter((o) => o.trim()) : null,
      escala_min: p.tipo === "escala" ? p.escalaMin : null, escala_max: p.tipo === "escala" ? p.escalaMax : null,
      escala_label_min: p.tipo === "escala" ? (p.escalaLabelMin || null) : null,
      escala_label_max: p.tipo === "escala" ? (p.escalaLabelMax || null) : null,
      obrigatoria: !!p.obrigatoria,
    });

    if (isEdit) {
      // IMPORTANTE: não apagamos e recriamos todas as perguntas — isso deixava
      // o link público exibindo perguntas antigas "fantasma" quando o DELETE
      // não batia com todas as linhas (RLS), e apagava em cascata o histórico
      // de respostas já recebidas (questionario_resposta_itens -> ON DELETE
      // CASCADE) mesmo numa edição simples de texto. Em vez disso:
      // - pergunta com id de banco (UUID) -> UPDATE (preserva id e respostas)
      // - pergunta nova (id local, "qXXXXXXX") -> INSERT
      // - pergunta removida pelo usuário -> DELETE só dela
      const existentes = m.perguntas.filter((p) => isUuid(p.id));
      const novas = m.perguntas.filter((p) => !isUuid(p.id));
      const idsManter = existentes.map((p) => p.id);

      const delQuery = sb.from("questionario_perguntas").delete().eq("questionario_id", id);
      const { error: delErr } = idsManter.length ? await delQuery.not("id", "in", `(${idsManter.join(",")})`) : await delQuery;
      if (delErr) { m.saving = false; render(); return toast("Falha ao remover perguntas antigas: " + delErr.message); }

      for (let i = 0; i < m.perguntas.length; i++) {
        const p = m.perguntas[i];
        if (isUuid(p.id)) {
          const { error: upErr } = await sb.from("questionario_perguntas").update(linhaDe(p, i)).eq("id", p.id);
          if (upErr) { m.saving = false; render(); return toast("Falha ao atualizar pergunta: " + upErr.message); }
        }
      }
      if (novas.length) {
        const rows = m.perguntas.map((p, i) => ({ p, i })).filter(({ p }) => !isUuid(p.id)).map(({ p, i }) => linhaDe(p, i));
        const { error: insErr } = await sb.from("questionario_perguntas").insert(rows);
        if (insErr) { m.saving = false; render(); return toast("Falha ao salvar novas perguntas: " + insErr.message); }
      }
    } else {
      const rows = m.perguntas.map((p, i) => linhaDe(p, i));
      const { error: insErr } = await sb.from("questionario_perguntas").insert(rows);
      if (insErr) { m.saving = false; render(); return toast("Falha ao salvar perguntas: " + insErr.message); }
    }

    S.modal = null;
    await load();
    toast("Formulário salvo com sucesso.");
  }

  async function toggleFormActive(id) {
    const sb = sbc(); const f = S.forms.find((x) => x.id === id); if (!sb || !f) return;
    await sb.from("questionarios").update({ ativo: !f.ativo }).eq("id", id);
    await load();
  }

  /* ---------- TERMOS DE CIÊNCIA: SALVAR / ATIVAR / EXCLUIR ---------- */
  async function saveTermo() {
    const sb = sbc(); const m = S.termoModal; if (!sb || !m) return;
    if (!m.titulo.trim()) return alert("Dê um nome ao termo.");
    if (!m.corpo.trim()) return alert("Escreva o texto do termo.");
    if (!m.checkboxLabel.trim()) return alert("Descreva o texto do checkbox de aceite.");
    m.saving = true; render();
    const payload = { titulo: m.titulo.trim(), corpo: m.corpo, checkbox_label: m.checkboxLabel.trim(), ativo: m.ativo !== false };
    const { error } = m.id
      ? await sb.from("termos").update(payload).eq("id", m.id)
      : await sb.from("termos").insert(payload);
    if (error) { m.saving = false; render(); return toast("Falha ao salvar: " + error.message); }
    S.termoModal = null;
    await load();
    toast("Termo salvo com sucesso.");
  }

  async function toggleTermoActive(id) {
    const sb = sbc(); const t = S.termos.find((x) => x.id === id); if (!sb || !t) return;
    await sb.from("termos").update({ ativo: !t.ativo }).eq("id", id);
    await load();
  }

  async function deleteTermo(id) {
    const t = S.termos.find((x) => x.id === id); if (!t) return;
    if (!confirm('Excluir o termo "' + t.titulo + '"? As assinaturas já registradas também serão apagadas. Essa ação não pode ser desfeita.')) return;
    const sb = sbc(); if (!sb) return;
    const { error } = await sb.from("termos").delete().eq("id", id);
    if (error) return toast("Falha ao excluir: " + error.message);
    await load();
    toast("Termo excluído.");
  }

  /* ---------- COMPARTILHAR ---------- */
  async function searchPatients(term) {
    const sb = sbc(); if (!sb || !S.shareModal) return;
    const q = (term || "").trim();
    if (q.length < 2) { S.shareModal.patients = []; return render(); }
    const { data, error } = await sb.from("pacientes").select("paciente_id,name,telefone,email").ilike("name", "%" + q + "%").limit(20);
    if (error) { console.error("searchPatients", error); return; }
    S.shareModal.patients = (data || []).map((p) => ({ id: p.paciente_id, nome: p.name, telefone: p.telefone || "", email: p.email || "" }));
    render();
  }

  async function registerShare(formId, patientIds) {
    const sb = sbc(); if (!sb || !patientIds.length) return;
    const rows = patientIds.map((pid) => ({ questionario_id: formId, paciente_id: pid, enviado_em: new Date().toISOString() }));
    const { error } = await sb.from("questionario_envios").insert(rows);
    if (error) console.error("registerShare", error);
  }

  function waLink(telefone, texto) {
    const num = String(telefone || "").replace(/\D/g, "");
    return "https://wa.me/" + (num.startsWith("55") ? num : "55" + num) + "?text=" + encodeURIComponent(texto);
  }
  function mailLink(email, formTitulo, link) {
    return "mailto:" + encodeURIComponent(email) + "?subject=" + encodeURIComponent("Formulário: " + formTitulo) + "&body=" + encodeURIComponent("Olá! Por favor responda o formulário no link: " + link);
  }

  /* ---------- FILTROS ---------- */
  function filteredResponses() {
    const q = S.search.toLowerCase();
    return S.responses.filter((r) => {
      if (S.filterForm && r.questionarioId !== S.filterForm) return false;
      if (q && !((r.pacienteNome || "Anônimo").toLowerCase().includes(q) || r.questionarioTitulo.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  /* ---------- RENDER: TELA PRINCIPAL (RESPOSTAS) ---------- */
  function statsHtml() {
    const now = Date.now(), sevenD = 7 * 24 * 3600 * 1000;
    const items = [
      ["📥", "Respostas recebidas", S.responses.length, "linear-gradient(135deg,rgba(52,211,153,.25),rgba(45,212,191,.2))", "#047857"],
      ["📋", "Formulários ativos", S.forms.filter((f) => f.ativo).length, "linear-gradient(135deg,rgba(96,165,250,.25),rgba(129,140,248,.2))", "#1d4ed8"],
      ["👤", "Pacientes que responderam", new Set(S.responses.map((r) => r.pacienteNome || r.id)).size, "linear-gradient(135deg,rgba(167,139,250,.25),rgba(139,92,246,.2))", "#6d28d9"],
      ["🗓️", "Últimos 7 dias", S.responses.filter((r) => r.respondidoEm && now - new Date(r.respondidoEm).getTime() < sevenD).length, "linear-gradient(135deg,rgba(251,191,36,.25),rgba(249,115,22,.2))", "#b45309"],
    ];
    return `<div class="qz-stats">${items.map(([i, l, v, bg, c]) => `<div class="qz-stat" style="background:${bg}">
      <div class="r"><span style="font-size:18px">${i}</span><span class="lbl">${l}</span></div>
      <div class="val" style="color:${c}">${v}</div></div>`).join("")}</div>`;
  }

  function toolbarHtml() {
    return `<div class="qz-toolbar">
      <div class="qz-search qz-pill"><span>🔍</span><input id="qz-q" placeholder="Buscar por paciente ou formulário..." value="${esc(S.search)}">${S.search ? '<button class="qz-btn ghost" style="padding:0 6px" data-clear="q">×</button>' : ""}</div>
      <select class="qz-in" id="qz-filter-form" style="max-width:220px">
        <option value="">Todos os formulários</option>
        ${S.forms.map((f) => `<option value="${f.id}" ${S.filterForm === f.id ? "selected" : ""}>${esc(f.titulo)}</option>`).join("")}
      </select>
    </div>`;
  }

  function tableHtml(rows) {
    if (!rows.length) return `<div class="qz-empty">📭 Nenhuma resposta encontrada.</div>`;
    return `<div class="qz-card" style="padding:0;overflow:auto"><table class="qz-table">
      <thead><tr><th>Paciente</th><th>Formulário</th><th>Data</th><th>Identificação</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${r.anonimo ? '<span style="color:#94a3b8">Anônimo</span>' : `${esc(r.pacienteNome || "—")}${r.emailVerificado ? ' <span title="Email verificado" style="color:#16a34a">✅</span>' : ""}`}</td>
        <td>${esc(r.questionarioTitulo)}</td>
        <td style="white-space:nowrap;color:#64748b">${brDateTime(r.respondidoEm)}</td>
        <td><span class="qz-tag ${r.anonimo ? "anon" : "nom"}">${r.anonimo ? "Anônimo" : "Nominal"}</span></td>
        <td><button class="qz-btn ghost" style="padding:4px 10px;font-size:12px" data-viewresp="${r.id}">Ver respostas →</button></td>
      </tr>`).join("")}</tbody>
    </table></div>`;
  }

  function respostaModalHtml() {
    const r = S.viewResponse; if (!r) return "";
    return `<div class="qz-modal-bg" data-vbg="1"><div class="qz-modal sm">
      <div class="qz-modal-h"><h2>${esc(r.questionarioTitulo)}</h2><button class="qz-btn ghost" data-vclose="1" style="padding:2px 10px">×</button></div>
      <div class="qz-modal-b">
        ${r.anonimo ? '<div class="qz-nom-note">Esta resposta é anônima — nenhum dado de identificação foi coletado.</div>' : `
        <div class="qz-card" style="padding:12px 14px;margin-bottom:14px">
          <div style="font-size:12.5px;color:#1e293b"><b>${esc(r.pacienteNome || "—")}</b></div>
          <div style="font-size:11.5px;color:#64748b;margin-top:4px">📞 ${esc(r.pacienteTelefone || "—")} · ✉️ ${esc(r.pacienteEmail || "—")} · CPF ${esc(r.pacienteCpf || "—")}</div>
          ${r.emailVerificado ? `<div style="font-size:11px;color:#16a34a;margin-top:8px;display:flex;align-items:center;gap:5px">✅ Assinado por ${esc(r.pacienteEmail)} (email verificado)</div>` : ""}
        </div>`}
        <div style="font-size:11px;color:#94a3b8;margin-bottom:10px">Respondido em ${brDateTime(r.respondidoEm)}</div>
        ${r.itens.map((it) => `<div class="qz-answer">
          <div class="q">${esc(it.enunciado)}</div>
          <div class="a">${it.tipo === "escala" ? (it.valorEscala ?? "—") : it.tipo === "multipla" || it.tipo === "unica" ? esc((it.valorOpcoes || []).join(", ") || "—") : esc(it.valorTexto || "—")}</div>
        </div>`).join("") || '<div class="qz-empty" style="padding:24px">Sem respostas registradas.</div>'}
      </div>
    </div></div>`;
  }

  function respostasHtml() {
    const rows = filteredResponses();
    return `<div class="qz-head">
        <div style="display:flex;gap:12px;align-items:center">
          <div class="qz-pill" style="width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:18px">📝</div>
          <div><h1>Questionários</h1><p>Respostas de formulários enviados aos pacientes</p></div></div>
        <div style="display:flex;gap:8px">
          <button class="qz-btn qz-pill" data-gomeus="1">📋 Meus formulários</button>
          <button class="qz-btn qz-pill" data-gotermos="1">📄 Meus termos</button>
        </div></div>
      ${statsHtml()}${toolbarHtml()}${tableHtml(rows)}`;
  }

  /* ---------- RENDER: MEUS FORMULÁRIOS ---------- */
  function myFormsHtml() {
    const q = S.fsearch.toLowerCase();
    const list = S.forms.filter((f) => f.titulo.toLowerCase().includes(q));
    return `<div class="qz-head">
        <div style="display:flex;gap:12px;align-items:center">
          <button class="qz-btn qz-pill ghost" data-back="1">←</button>
          <div><h1>Meus formulários</h1><p>${S.forms.length} formulário(s) criado(s)</p></div></div>
        <button class="qz-btn primary" data-new="1">+ Novo formulário</button></div>
      <div class="qz-search qz-pill" style="margin-bottom:18px"><span>🔍</span><input id="qz-fq" placeholder="Buscar formulário..." value="${esc(S.fsearch)}"></div>
      ${list.length ? list.map((f) => `<div class="qz-card qz-flist-card ${f.ativo ? "" : "inactive"}">
        <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <h3 style="margin:0;font-size:15px;font-weight:700;color:#1e293b">${esc(f.titulo)}</h3>
              <span class="qz-tag ${f.anonimo ? "anon" : "nom"}">${f.anonimo ? "Anônimo" : "Nominal"}</span>
              <span class="qz-tag ${f.ativo ? "on" : "off"}">${f.ativo ? "Ativo" : "Inativo"}</span>
            </div>
            ${f.descricao ? `<div style="font-size:12px;color:#64748b;margin-top:6px">${esc(f.descricao)}</div>` : ""}
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button class="qz-btn qz-pill" data-toggle="${f.id}" title="${f.ativo ? "Inativar" : "Ativar"}">${f.ativo ? "🟢" : "⭕"}</button>
            <button class="qz-btn qz-pill" data-edit="${f.id}">✏️ Editar</button></div></div>
        <div class="qz-metrics">
          <div class="qz-metric emerald"><div class="n">${f.perguntas.length}</div><div class="t">Perguntas</div></div>
          <div class="qz-metric violet"><div class="n">${f.respostasCount || 0}</div><div class="t">Respostas</div></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,.5);padding-top:10px">
          <button class="qz-btn ghost" style="font-size:12px" data-copylink="${f.id}">🔗 Copiar link</button>
          <button class="qz-btn ghost" style="font-size:12px" data-share="${f.id}">📤 Compartilhar</button>
        </div></div>`).join("") : `<div class="qz-empty">🔍 Nenhum formulário encontrado${S.fsearch ? ' para "' + esc(S.fsearch) + '"' : ""}</div>`}`;
  }

  /* ---------- RENDER: MEUS TERMOS ---------- */
  function termosListHtml() {
    const q = S.tsearch.toLowerCase();
    const list = S.termos.filter((t) => t.titulo.toLowerCase().includes(q));
    return `<div class="qz-head">
        <div style="display:flex;gap:12px;align-items:center">
          <button class="qz-btn qz-pill ghost" data-back="1">←</button>
          <div><h1>Meus termos</h1><p>${S.termos.length} termo(s) de ciência criado(s)</p></div></div>
        <button class="qz-btn primary" data-newtermo="1">+ Novo termo</button></div>
      <div class="qz-search qz-pill" style="margin-bottom:18px"><span>🔍</span><input id="qz-tq" placeholder="Buscar termo..." value="${esc(S.tsearch)}"></div>
      ${list.length ? list.map((t) => `<div class="qz-card qz-flist-card ${t.ativo ? "" : "inactive"}">
        <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <h3 style="margin:0;font-size:15px;font-weight:700;color:#1e293b">${esc(t.titulo)}</h3>
              <span class="qz-tag nom">✉️ Email obrigatório</span>
              <span class="qz-tag ${t.ativo ? "on" : "off"}">${t.ativo ? "Ativo" : "Inativo"}</span>
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button class="qz-btn qz-pill" data-toggletermo="${t.id}" title="${t.ativo ? "Inativar" : "Ativar"}">${t.ativo ? "🟢" : "⭕"}</button>
            <button class="qz-btn qz-pill" data-edittermo="${t.id}">✏️ Editar</button></div></div>
        <div class="qz-metrics">
          <div class="qz-metric violet"><div class="n">${t.assinaturasCount || 0}</div><div class="t">Assinaturas</div></div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,.5);padding-top:10px">
          <button class="qz-btn ghost" style="font-size:12px" data-copylinktermo="${t.id}">🔗 Copiar link</button>
          <button class="qz-btn ghost" style="font-size:12px" data-viewassinaturas="${t.id}">📄 Ver assinaturas</button>
          <button class="qz-btn ghost" style="font-size:12px;color:#b91c1c" data-deltermo="${t.id}">🗑️ Excluir</button>
        </div></div>`).join("") : `<div class="qz-empty">🔍 Nenhum termo encontrado${S.tsearch ? ' para "' + esc(S.tsearch) + '"' : ""}</div>`}`;
  }

  function termoModalHtml() {
    const m = S.termoModal; if (!m) return "";
    return `<div class="qz-modal-bg" data-mtbg="1"><div class="qz-modal">
      <div class="qz-modal-h"><h2>${m.id ? "Editar termo" : "Novo termo"}</h2>
        <button class="qz-btn ghost" data-mtclose="1" style="padding:2px 10px">×</button></div>
      <div class="qz-modal-b">
        <div style="margin-bottom:14px"><span class="qz-lbl">Nome do termo</span>
          <input class="qz-in" id="tz-m-titulo" value="${esc(m.titulo)}" placeholder="Ex: Termo de consentimento — procedimento X"></div>
        <div class="qz-nom-note">Este termo sempre exige autenticação por email: o paciente só assina depois de confirmar um código de 4 dígitos enviado ao email informado.</div>
        <div style="margin:14px 0 8px"><span class="qz-lbl">Texto do termo</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          ${TERMO_VARS.map((v) => `<button class="qz-btn ghost" style="font-size:11px;padding:4px 9px" data-varinsert="${v.k}" title="Inserir no texto">+ {${v.k}} <span style="color:#94a3b8">(${v.label})</span></button>`).join("")}
        </div>
        <textarea class="qz-in" id="tz-m-corpo" rows="10" style="font-family:inherit;line-height:1.55">${esc(m.corpo)}</textarea>
        <div style="margin:16px 0 8px"><span class="qz-lbl">Texto do checkbox de aceite</span></div>
        <input class="qz-in" id="tz-m-checkbox" value="${esc(m.checkboxLabel)}" placeholder="Ex: Li e estou de acordo com os termos acima.">
      </div>
      <div class="qz-modal-f"><button class="qz-btn ghost" data-mtclose="1">Cancelar</button>
      <button class="qz-btn primary" data-mtsave="1" ${m.saving ? "disabled" : ""}>${m.saving ? "Salvando…" : "Salvar termo"}</button></div>
    </div></div>`;
  }

  /* ---------- RENDER: ASSINATURAS DE UM TERMO ---------- */
  function termoAssinaturasHtml() {
    const v = S.termoAssinaturasView; if (!v) return "";
    const rows = S.termoAssinaturas.filter((a) => a.termoId === v.termoId);
    return `<div class="qz-head">
        <div style="display:flex;gap:12px;align-items:center">
          <button class="qz-btn qz-pill ghost" data-backtermos="1">←</button>
          <div><h1>${esc(v.termoTitulo)}</h1><p>${rows.length} assinatura(s) registrada(s)</p></div></div></div>
      ${rows.length ? `<div class="qz-card" style="padding:0;overflow:auto"><table class="qz-table">
        <thead><tr><th>Paciente</th><th>CPF</th><th>Data</th><th></th></tr></thead>
        <tbody>${rows.map((a) => `<tr>
          <td>${esc(a.pacienteNome || "—")}${a.emailVerificado ? ' <span title="Email verificado" style="color:#16a34a">✅</span>' : ""}</td>
          <td>${esc(a.pacienteCpf || "—")}</td>
          <td style="white-space:nowrap;color:#64748b">${brDateTime(a.assinadoEm)}</td>
          <td><button class="qz-btn ghost" style="padding:4px 10px;font-size:12px" data-viewassin="${a.id}">Ver termo assinado →</button></td>
        </tr>`).join("")}</tbody>
      </table></div>` : `<div class="qz-empty">📭 Nenhuma assinatura registrada ainda.</div>`}`;
  }

  function viewAssinaturaModalHtml() {
    const a = S.viewAssinatura; if (!a) return "";
    return `<div class="qz-modal-bg" data-vabg="1"><div class="qz-modal sm">
      <div class="qz-modal-h"><h2>Termo assinado</h2><button class="qz-btn ghost" data-vaclose="1" style="padding:2px 10px">×</button></div>
      <div class="qz-modal-b">
        <div class="qz-card" style="padding:12px 14px;margin-bottom:14px">
          <div style="font-size:12.5px;color:#1e293b"><b>${esc(a.pacienteNome || "—")}</b></div>
          <div style="font-size:11.5px;color:#64748b;margin-top:4px">✉️ ${esc(a.pacienteEmail || "—")} · CPF ${esc(a.pacienteCpf || "—")}</div>
          ${a.emailVerificado ? `<div style="font-size:11px;color:#16a34a;margin-top:8px;display:flex;align-items:center;gap:5px">✅ Assinado por ${esc(a.pacienteEmail)} (email verificado)</div>` : ""}
        </div>
        <div style="font-size:11px;color:#94a3b8;margin-bottom:10px">Assinado em ${brDateTime(a.assinadoEm)}</div>
        <div style="padding:14px 16px;border-radius:14px;background:rgba(255,255,255,.6);border:1px solid rgba(255,255,255,.85);border-left:3px solid #99f6e4;font-size:13.5px;line-height:1.6;color:#1e293b;white-space:pre-wrap">${esc(a.textoFinal || "—")}</div>
      </div>
    </div></div>`;
  }

  /* ---------- CONSTRUTOR DE PERGUNTAS ---------- */
  function questionCardHtml(p, idx) {
    return `<div class="qz-card qz-qcard" data-qid="${esc(p.id)}">
      <div class="qhdr"><div class="qnum">${idx + 1}</div>
        <input class="qz-in" style="flex:1" data-qfield="enunciado" data-qid="${esc(p.id)}" value="${esc(p.enunciado)}" placeholder="Digite a pergunta...">
        <button class="qz-btn ghost" style="padding:2px 8px" data-qdel="${esc(p.id)}">×</button></div>
      <div class="qz-qtype">${Object.entries(TIPOS).map(([k, v]) => `<button data-qtype="${k}" data-qid="${esc(p.id)}" class="${p.tipo === k ? "sel" : ""}">${v.icon} ${v.label}</button>`).join("")}</div>
      ${p.tipo === "texto" ? `<label style="display:flex;gap:6px;align-items:center;font-size:12px;color:#475569">
          <input type="checkbox" class="qz-check" data-qfield="longa" data-qid="${esc(p.id)}" ${p.longa ? "checked" : ""}> Resposta longa (parágrafo)</label>` : ""}
      ${(p.tipo === "unica" || p.tipo === "multipla") ? `<div>
          ${p.opcoes.map((o, oi) => `<div class="qz-opt-row">
            <span style="font-size:12px;color:#94a3b8">${p.tipo === "unica" ? "🔘" : "☑️"}</span>
            <input class="qz-in" data-optfield="1" data-qid="${esc(p.id)}" data-oi="${oi}" value="${esc(o)}" placeholder="Opção ${oi + 1}">
            <button class="rm" data-optdel="${oi}" data-qid="${esc(p.id)}">×</button></div>`).join("")}
          <button class="qz-btn ghost" style="font-size:11.5px;padding:4px 10px" data-optadd="${esc(p.id)}">+ Adicionar opção</button>
        </div>` : ""}
      ${p.tipo === "escala" ? `<div>
          <div class="qz-scale-presets">${ESCALA_PRESETS.map((pr) => `<button data-scalepreset="${pr.min}-${pr.max}" data-qid="${esc(p.id)}" class="${p.escalaMin === pr.min && p.escalaMax === pr.max ? "sel" : ""}">${pr.label}</button>`).join("")}</div>
          <div style="display:flex;gap:8px;margin-bottom:8px">
            <input class="qz-in" type="number" data-qfield="escalaLabelMin" data-qid="${esc(p.id)}" value="${esc(p.escalaLabelMin || "")}" placeholder="Rótulo do menor valor (opcional)">
            <input class="qz-in" type="number" data-qfield="escalaLabelMax" data-qid="${esc(p.id)}" value="${esc(p.escalaLabelMax || "")}" placeholder="Rótulo do maior valor (opcional)"></div>
          <div class="qz-scale-preview">${Array.from({ length: (p.escalaMax - p.escalaMin + 1) || 0 }, (_, i) => p.escalaMin + i).map((n) => `<div class="qz-scale-dot">${n}</div>`).join("")}</div>
        </div>` : ""}
      <label style="display:flex;gap:6px;align-items:center;font-size:12px;color:#475569;margin-top:10px">
        <input type="checkbox" class="qz-check" data-qfield="obrigatoria" data-qid="${esc(p.id)}" ${p.obrigatoria ? "checked" : ""}> Resposta obrigatória</label>
    </div>`;
  }

  function builderModalHtml() {
    const m = S.modal; if (!m) return "";
    return `<div class="qz-modal-bg" data-mbg="1"><div class="qz-modal">
      <div class="qz-modal-h"><h2>${m.id ? "Editar formulário" : "Novo formulário"}</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="qz-btn violet" data-aiopen="1">✨ Criar com IA</button>
          <button class="qz-btn ghost" data-mclose="1" style="padding:2px 10px">×</button>
        </div></div>
      <div class="qz-modal-b">
        <div style="margin-bottom:14px"><span class="qz-lbl">Nome do formulário</span>
          <input class="qz-in" id="qz-m-titulo" value="${esc(m.titulo)}" placeholder="Ex: Avaliação pós-consulta"></div>
        <div style="margin-bottom:16px"><span class="qz-lbl">Descrição (opcional)</span>
          <textarea class="qz-in" rows="2" id="qz-m-desc" style="resize:none">${esc(m.descricao || "")}</textarea></div>
        <div style="margin-bottom:8px"><span class="qz-lbl">Identificação do respondente</span></div>
        <div class="qz-idbox">
          <div class="qz-idopt ${!m.anonimo ? "sel" : ""}" data-idset="0"><b>👤 Nominal</b><span>Coleta os campos do cadastro selecionados abaixo</span></div>
          <div class="qz-idopt ${m.anonimo ? "sel" : ""}" data-idset="1"><b>🙈 Anônimo</b><span>Nenhum dado de identificação é coletado</span></div>
        </div>
        ${!m.anonimo ? `<div class="qz-nom-note">Formulários nominais exibem automaticamente a logo e o nome da clínica antes das perguntas.</div>` : ""}
        ${!m.anonimo ? camposCadastroHtml(m) : ""}
        ${!m.anonimo ? authEmailHtml(m) : ""}
        <div style="display:flex;align-items:center;justify-content:space-between;margin:18px 0 10px">
          <span class="qz-lbl" style="text-transform:uppercase;letter-spacing:.08em;margin:0">Perguntas (${m.perguntas.length})</span>
        </div>
        ${m.perguntas.map((p, i) => questionCardHtml(p, i)).join("") || '<div class="qz-empty" style="padding:24px">Nenhuma pergunta ainda.</div>'}
        <button class="qz-btn violet" style="width:100%" data-qadd="1">+ Adicionar pergunta</button>
      </div>
      <div class="qz-modal-f"><button class="qz-btn ghost" data-mclose="1">Cancelar</button>
      <button class="qz-btn primary" data-msave="1" ${m.saving ? "disabled" : ""}>${m.saving ? "Salvando…" : "Salvar formulário"}</button></div>
    </div></div>`;
  }

  function authEmailHtml(m) {
    const on = !!m.exigirAuthEmail;
    return `<div class="qz-authbox ${on ? "on" : ""}" data-authemail="1">
      <span class="qz-check ${on ? "on" : ""}">${on ? "✓" : ""}</span>
      <div><b>Exigir autenticação por email</b>
        <span>Antes de finalizar, o paciente recebe um código de 4 dígitos no email informado e precisa confirmá-lo. Ao concluir, uma cópia das respostas é enviada para o mesmo email.</span>
      </div></div>`;
  }

  function camposCadastroHtml(m) {
    const selecionados = m.camposCadastro && m.camposCadastro.length ? m.camposCadastro : [...CAMPOS_CADASTRO_OBRIGATORIOS];
    const disponiveis = CAMPOS_CADASTRO.filter((c) => !selecionados.includes(c.id));
    const grupos = ["Dados pessoais", "Endereço", "Dados clínicos"];
    return `<div style="margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span class="qz-lbl" style="text-transform:uppercase;letter-spacing:.08em;margin:0">Campos do cadastro</span>
      </div>
      <div class="qz-card" style="padding:12px 14px;position:relative;z-index:${m.campoPickerOpen ? 40 : 1}">
        <div style="font-size:11.5px;color:#64748b;margin-bottom:10px">O paciente confirma/preenche estes dados antes das perguntas. Nome, CPF, telefone e e-mail são sempre pedidos.</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${selecionados.map((id) => {
            const c = CAMPO_CADASTRO_BY_ID[id]; if (!c) return "";
            const obrig = CAMPOS_CADASTRO_OBRIGATORIOS.includes(id);
            return `<span class="qz-tag ${obrig ? "nom" : "on"}" style="display:inline-flex;align-items:center;gap:6px;padding:5px 10px">${esc(c.label)}${obrig ? "" : ` <button data-campo-remove="${id}" style="background:none;border:none;cursor:pointer;color:inherit;font-size:13px;line-height:1;padding:0">×</button>`}</span>`;
          }).join("")}
          <button class="qz-btn ghost" style="padding:4px 12px;font-size:12px;position:relative" data-campo-add-toggle="1">+ Adicionar campo</button>
        </div>
        ${m.campoPickerOpen ? `<div class="qz-dd" style="position:absolute;top:100%;left:14px;right:14px;margin-top:6px;max-height:280px;overflow:auto">
          ${disponiveis.length ? grupos.map((g) => {
            const itens = disponiveis.filter((c) => c.grupo === g);
            if (!itens.length) return "";
            return `<div style="padding:8px 14px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8">${g}</div>
              ${itens.map((c) => `<button data-campo-add="${c.id}">${esc(c.label)}</button>`).join("")}`;
          }).join("") : `<div style="padding:10px 14px;font-size:12px;color:#94a3b8">Todos os campos disponíveis já foram adicionados.</div>`}
        </div>` : ""}
      </div>
    </div>`;
  }

  /* ---------- COMPARTILHAR ---------- */
  function shareModalHtml() {
    const sh = S.shareModal; if (!sh) return "";
    const f = S.forms.find((x) => x.id === sh.formId); if (!f) return "";
    const link = publicLink(f.id);
    return `<div class="qz-modal-bg" data-sbg="1"><div class="qz-modal sm">
      <div class="qz-modal-h"><h2>Compartilhar: ${esc(f.titulo)}</h2><button class="qz-btn ghost" data-sclose="1" style="padding:2px 10px">×</button></div>
      <div class="qz-modal-b">
        <div class="qz-linkbox"><code>${esc(link)}</code><button class="qz-btn" style="padding:4px 10px;font-size:11.5px" data-copylink="${f.id}">Copiar</button></div>
        <div class="qz-share-tabs">
          <button class="${sh.mode === "individual" ? "sel" : ""}" data-smode="individual">Individual</button>
          <button class="${sh.mode === "massa" ? "sel" : ""}" data-smode="massa">Em massa</button>
        </div>
        <div class="qz-search qz-pill" style="margin-bottom:10px"><span>🔍</span><input id="qz-s-q" placeholder="Buscar paciente pelo nome..." value="${esc(sh.query)}"></div>
        <div class="qz-plist">
          ${sh.patients.length ? sh.patients.map((p) => {
            const checked = sh.selected.includes(p.id);
            const pLink = publicLink(f.id, p.id);
            return `<div class="qz-prow">
              ${sh.mode === "massa" ? `<input type="checkbox" class="qz-check" data-psel="${p.id}" ${checked ? "checked" : ""}>` : ""}
              <div class="nm"><div>${esc(p.nome)}</div><div class="sub">📞 ${esc(p.telefone || "—")} · ✉️ ${esc(p.email || "—")}</div></div>
              ${sh.mode === "individual" ? `
                <button class="qz-btn ghost" style="padding:3px 8px;font-size:11px" data-wasend="${p.id}" data-tel="${esc(p.telefone)}">WhatsApp</button>
                ${p.email ? `<a class="qz-btn ghost" style="padding:3px 8px;font-size:11px;text-decoration:none" href="${mailLink(p.email, f.titulo, pLink)}" data-emailsend="${p.id}">E-mail</a>` : ""}
              ` : ""}
            </div>`;
          }).join("") : `<div class="qz-empty" style="padding:20px">${sh.query.length < 2 ? "Digite ao menos 2 letras para buscar pacientes." : "Nenhum paciente encontrado."}</div>`}
        </div>
      </div>
      ${sh.mode === "massa" ? `<div class="qz-modal-f"><button class="qz-btn ghost" data-sclose="1">Cancelar</button>
        <button class="qz-btn primary" data-sbulk="1" ${!sh.selected.length ? "disabled" : ""}>${sh.sending ? "Enviando…" : "Compartilhar com " + sh.selected.length + " paciente(s)"}</button></div>` : ""}
    </div></div>`;
  }

  /* ---------- CRIAR COM IA ---------- */
  function aiModalHtml() {
    const a = S.aiModal; if (!a) return "";
    return `<div class="qz-modal-bg" data-aibg="1" style="z-index:2200"><div class="qz-modal sm">
      <div class="qz-modal-h"><h2>✨ Criar formulário com IA</h2>
        <button class="qz-btn ghost" data-aiclose="1" style="padding:2px 10px">×</button></div>
      <div class="qz-modal-b">
        <p style="font-size:12px;color:#64748b;margin:0 0 14px">Descreva o formulário que você quer (público, objetivo, o que perguntar). A IA monta o título, a descrição e as perguntas já estruturadas.</p>
        <div><span class="qz-lbl">Instruções para a IA</span>
          <textarea class="qz-in" rows="7" id="qz-ai-obs" style="resize:vertical" placeholder="Ex: formulário de avaliação pós-consulta de hipertensão, perguntando se está tomando a medicação corretamente, se sentiu efeitos colaterais, nível de dor de 0 a 10 e satisfação com o atendimento de 1 a 5...">${esc(a.obs || "")}</textarea></div>
        ${a.error ? `<div style="margin-top:12px;font-size:12px;color:#b91c1c">${esc(a.error)}</div>` : ""}
        ${a.loading ? `<div style="margin-top:12px;font-size:12px;color:#7c3aed">Gerando formulário…</div>` : ""}
      </div>
      <div class="qz-modal-f"><button class="qz-btn ghost" data-aiclose="1">Cancelar</button>
      <button class="qz-btn violet" data-aigen="1" ${a.loading ? "disabled" : ""}>${a.loading ? "Gerando…" : "Gerar formulário"}</button></div>
    </div></div>`;
  }

  async function generateWithAI() {
    const a = S.aiModal; if (!a || a.loading) return;
    a.obs = (document.getElementById("qz-ai-obs") || {}).value || a.obs || "";
    if (!a.obs.trim()) { a.error = "Escreva uma instrução descrevendo o formulário."; return render(); }
    a.loading = true; a.error = ""; render();
    try {
      const res = await fetch("/api/questionarios/gerar-ia", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observacao: a.obs }),
      });
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json();

      if (!S.modal) S.modal = { id: null, titulo: "", descricao: "", anonimo: false, ativo: true, perguntas: [], saving: false };
      if (d.titulo) S.modal.titulo = d.titulo;
      if (d.descricao) S.modal.descricao = d.descricao;
      if (typeof d.anonimo === "boolean") S.modal.anonimo = d.anonimo;

      const geradas = (Array.isArray(d.perguntas) ? d.perguntas : []).map((p) => ({
        id: uid(), tipo: TIPOS[p.tipo] ? p.tipo : "texto", enunciado: String(p.enunciado || ""),
        longa: !!p.longa,
        opcoes: (p.tipo === "unica" || p.tipo === "multipla") ? (Array.isArray(p.opcoes) && p.opcoes.length >= 2 ? p.opcoes.map(String) : ["", ""]) : ["", ""],
        escalaMin: Number.isFinite(+p.escala_min) ? +p.escala_min : 1,
        escalaMax: Number.isFinite(+p.escala_max) ? +p.escala_max : 5,
        escalaLabelMin: p.escala_label_min || "", escalaLabelMax: p.escala_label_max || "",
        obrigatoria: p.obrigatoria !== false,
      }));
      // se só existe a pergunta em branco padrão (usuário ainda não mexeu), substitui; senão, acrescenta
      const soPlaceholder = S.modal.perguntas.length === 1 && !S.modal.perguntas[0].enunciado.trim();
      S.modal.perguntas = soPlaceholder ? geradas : [...S.modal.perguntas, ...geradas];
      if (!S.modal.perguntas.length) S.modal.perguntas = [newQuestion()];

      S.aiModal = null; render();
    } catch (err) {
      a.loading = false; a.error = String((err && err.message) || err); render();
    }
  }

  /* ---------- RENDER PRINCIPAL ---------- */
  function render() {
    const el = document.getElementById("s-questionarios"); if (!el) return;
    const modalScrolls = Array.from(document.querySelectorAll(".qz-modal-b")).map((n) => n.scrollTop);
    const pageY = window.scrollY;
    const screenHtml = S.screen === "formularios" ? myFormsHtml()
      : S.screen === "termos" ? termosListHtml()
      : S.screen === "termoassinaturas" ? termoAssinaturasHtml()
      : respostasHtml();
    el.innerHTML = `<div class="qz-wrap">${S.loading ? '<div class="qz-empty">Carregando questionários…</div>' : screenHtml}${builderModalHtml()}${aiModalHtml()}${shareModalHtml()}${respostaModalHtml()}${termoModalHtml()}${viewAssinaturaModalHtml()}
      ${S.toastMsg ? `<div class="qz-pill" style="position:fixed;bottom:20px;right:20px;padding:10px 16px;background:#1e293b;color:#fff;font-size:12.5px;z-index:3000">${esc(S.toastMsg)}</div>` : ""}
    </div>`;
    const newModalBodies = document.querySelectorAll(".qz-modal-b");
    if (newModalBodies.length) newModalBodies.forEach((n, i) => { n.scrollTop = modalScrolls[i] || 0; });
    else if (pageY) window.scrollTo(0, pageY);
  }

  /* ---------- HELPERS DE ESTADO DO CONSTRUTOR ---------- */
  function newQuestion() { return { id: uid(), tipo: "texto", enunciado: "", longa: false, opcoes: ["", ""], escalaMin: 1, escalaMax: 5, escalaLabelMin: "", escalaLabelMax: "", obrigatoria: true }; }
  function openNewForm() { S.modal = { id: null, titulo: "", descricao: "", anonimo: false, ativo: true, exigirAuthEmail: false, camposCadastro: [...CAMPOS_CADASTRO_OBRIGATORIOS], campoPickerOpen: false, perguntas: [newQuestion()], saving: false }; render(); }
  function openEditForm(id) {
    const f = S.forms.find((x) => x.id === id); if (!f) return;
    S.modal = { id: f.id, titulo: f.titulo, descricao: f.descricao, anonimo: f.anonimo, ativo: f.ativo, saving: false, exigirAuthEmail: !!f.exigirAuthEmail,
      camposCadastro: f.camposCadastro && f.camposCadastro.length ? [...f.camposCadastro] : [...CAMPOS_CADASTRO_OBRIGATORIOS], campoPickerOpen: false,
      perguntas: f.perguntas.map((p) => ({ ...p, opcoes: p.opcoes && p.opcoes.length ? [...p.opcoes] : ["", ""] })) };
    render();
  }

  function openNewTermo() {
    S.termoModal = { id: null, titulo: "", corpo: TERMO_CORPO_PADRAO, checkboxLabel: "Li e estou de acordo com os termos acima.", ativo: true, saving: false };
    render();
  }
  function openEditTermo(id) {
    const t = S.termos.find((x) => x.id === id); if (!t) return;
    S.termoModal = { id: t.id, titulo: t.titulo, corpo: t.corpo, checkboxLabel: t.checkboxLabel, ativo: t.ativo, saving: false };
    render();
  }

  /* ---------- EVENTOS ---------- */
  document.addEventListener("click", (e) => {
    const root = document.getElementById("s-questionarios");
    if (!root || root.style.display === "none") return;
    // Fecha o modal correspondente SOMENTE quando o clique acontece
    // exatamente no fundo (fora da caixa do modal) — checagem isolada,
    // não depende do closest() combinado abaixo.
    if (e.target.classList && e.target.classList.contains("qz-modal-bg")) {
      const bd = e.target.dataset;
      if (bd.mbg) { S.modal = null; return render(); }
      if (bd.vbg) { S.viewResponse = null; return render(); }
      if (bd.sbg) { S.shareModal = null; return render(); }
      if (bd.aibg) { S.aiModal = null; return render(); }
      if (bd.mtbg) { S.termoModal = null; return render(); }
      if (bd.vabg) { S.viewAssinatura = null; return render(); }
    }
    const t = e.target.closest("[data-gomeus],[data-back],[data-new],[data-edit],[data-toggle],[data-clear],[data-viewresp],[data-vclose],[data-mclose],[data-msave],[data-idset],[data-qadd],[data-qdel],[data-qtype],[data-optadd],[data-optdel],[data-scalepreset],[data-copylink],[data-share],[data-sclose],[data-smode],[data-psel],[data-sbulk],[data-wasend],[data-aiopen],[data-aiclose],[data-aigen],[data-campo-add-toggle],[data-campo-add],[data-campo-remove],[data-authemail],[data-gotermos],[data-backtermos],[data-newtermo],[data-edittermo],[data-toggletermo],[data-deltermo],[data-copylinktermo],[data-viewassinaturas],[data-viewassin],[data-vaclose],[data-mtclose],[data-mtsave],[data-varinsert]");
    if (!t) return;
    const d = t.dataset;
    if (d.gomeus) { S.screen = "formularios"; return render(); }
    if (d.back) { S.screen = "respostas"; return render(); }
    if (d.gotermos) { S.screen = "termos"; return render(); }
    if (d.backtermos) { S.screen = "termos"; S.termoAssinaturasView = null; return render(); }
    if (d.newtermo) { return openNewTermo(); }
    if (d.edittermo) { return openEditTermo(d.edittermo); }
    if (d.toggletermo) { return toggleTermoActive(d.toggletermo); }
    if (d.deltermo) { return deleteTermo(d.deltermo); }
    if (d.copylinktermo) {
      const link = publicLinkTermo(d.copylinktermo);
      navigator.clipboard && navigator.clipboard.writeText(link).then(() => toast("Link copiado!")).catch(() => toast(link));
      return;
    }
    if (d.viewassinaturas) {
      const tm = S.termos.find((x) => x.id === d.viewassinaturas); if (!tm) return;
      S.termoAssinaturasView = { termoId: tm.id, termoTitulo: tm.titulo };
      S.screen = "termoassinaturas"; return render();
    }
    if (d.viewassin) { S.viewAssinatura = S.termoAssinaturas.find((a) => a.id === d.viewassin) || null; return render(); }
    if (d.vaclose) { S.viewAssinatura = null; return render(); }
    if (d.mtclose) { S.termoModal = null; return render(); }
    if (d.mtsave) return saveTermo();
    if (d.varinsert && S.termoModal) {
      const token = "{" + d.varinsert + "}";
      const ta = document.getElementById("tz-m-corpo");
      const start = ta ? ta.selectionStart : S.termoModal.corpo.length;
      const end = ta ? ta.selectionEnd : S.termoModal.corpo.length;
      const val = S.termoModal.corpo;
      S.termoModal.corpo = val.slice(0, start) + token + val.slice(end);
      render();
      requestAnimationFrame(() => { const n = document.getElementById("tz-m-corpo"); if (n) { n.focus(); const pos = start + token.length; n.setSelectionRange(pos, pos); } });
      return;
    }
    if (d.new) { return openNewForm(); }
    if (d.edit) { return openEditForm(d.edit); }
    if (d.toggle) { return toggleFormActive(d.toggle); }
    if (d.clear) { S.search = ""; return render(); }
    if (d.viewresp) { S.viewResponse = S.responses.find((r) => r.id === d.viewresp) || null; return render(); }
    if (d.vclose) { S.viewResponse = null; return render(); }
    if (d.mclose) { S.modal = null; return render(); }
    if (d.msave) return saveForm();
    if (d.aiopen) { S.aiModal = { obs: "", loading: false, error: "" }; return render(); }
    if (d.aiclose) { S.aiModal = null; return render(); }
    if (d.aigen) return generateWithAI();
    if (d.idset !== undefined && S.modal) { S.modal.anonimo = d.idset === "1"; return render(); }
    if (d.authemail !== undefined && S.modal) { S.modal.exigirAuthEmail = !S.modal.exigirAuthEmail; return render(); }
    if (d.campoAddToggle && S.modal) { S.modal.campoPickerOpen = !S.modal.campoPickerOpen; return render(); }
    if (d.campoAdd && S.modal) {
      if (!S.modal.camposCadastro.includes(d.campoAdd)) S.modal.camposCadastro.push(d.campoAdd);
      S.modal.campoPickerOpen = false; return render();
    }
    if (d.campoRemove && S.modal) {
      S.modal.camposCadastro = S.modal.camposCadastro.filter((x) => x !== d.campoRemove || CAMPOS_CADASTRO_OBRIGATORIOS.includes(x));
      return render();
    }
    if (d.qadd && S.modal) { S.modal.perguntas.push(newQuestion()); return render(); }
    if (d.qdel && S.modal) { S.modal.perguntas = S.modal.perguntas.filter((p) => p.id !== d.qdel); return render(); }
    if (d.qtype && S.modal) {
      const p = S.modal.perguntas.find((x) => x.id === d.qid); if (!p) return;
      p.tipo = d.qtype; if ((p.tipo === "unica" || p.tipo === "multipla") && p.opcoes.length < 2) p.opcoes = ["", ""];
      return render();
    }
    if (d.optadd && S.modal) { const p = S.modal.perguntas.find((x) => x.id === d.optadd); if (p) p.opcoes.push(""); return render(); }
    if (d.optdel !== undefined && d.qid && S.modal) { const p = S.modal.perguntas.find((x) => x.id === d.qid); if (p) p.opcoes.splice(+d.optdel, 1); return render(); }
    if (d.scalepreset && S.modal) {
      const p = S.modal.perguntas.find((x) => x.id === d.qid); if (!p) return;
      const [mn, mx] = d.scalepreset.split("-").map(Number); p.escalaMin = mn; p.escalaMax = mx; return render();
    }
    if (d.copylink) {
      const link = publicLink(d.copylink);
      navigator.clipboard && navigator.clipboard.writeText(link).then(() => toast("Link copiado!")).catch(() => toast(link));
      return;
    }
    if (d.share) { S.shareModal = { formId: d.share, mode: "individual", query: "", patients: [], selected: [], sending: false }; return render(); }
    if (d.sclose) { S.shareModal = null; return render(); }
    if (d.smode && S.shareModal) { S.shareModal.mode = d.smode; S.shareModal.selected = []; return render(); }
    if (d.psel && S.shareModal) {
      const id = d.psel; const sel = S.shareModal.selected;
      S.shareModal.selected = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
      return render();
    }
    if (d.wasend && S.shareModal) {
      const f = S.forms.find((x) => x.id === S.shareModal.formId);
      const link = publicLink(f.id, d.wasend);
      registerShare(f.id, [d.wasend]);
      window.open(waLink(d.tel, "Olá! Por favor responda o formulário \"" + f.titulo + "\": " + link), "_blank");
      return;
    }
    if (d.emailsend && S.shareModal) { registerShare(S.shareModal.formId, [d.emailsend]); return; }
    if (d.sbulk && S.shareModal) {
      const ids = [...S.shareModal.selected];
      S.shareModal.sending = true; render();
      registerShare(S.shareModal.formId, ids).then(() => {
        S.shareModal.sending = false; S.shareModal.selected = [];
        toast("Formulário compartilhado com " + ids.length + " paciente(s).");
        render();
      });
    }
  });

  document.addEventListener("input", (e) => {
    const root = document.getElementById("s-questionarios");
    if (!root || root.style.display === "none") return;
    if (e.target.id === "qz-q") { S.search = e.target.value; const p = e.target.selectionStart; render(); const n = document.getElementById("qz-q"); if (n) { n.focus(); n.setSelectionRange(p, p); } return; }
    if (e.target.id === "qz-fq") { S.fsearch = e.target.value; const p = e.target.selectionStart; render(); const n = document.getElementById("qz-fq"); if (n) { n.focus(); n.setSelectionRange(p, p); } return; }
    if (e.target.id === "qz-tq") { S.tsearch = e.target.value; const p = e.target.selectionStart; render(); const n = document.getElementById("qz-tq"); if (n) { n.focus(); n.setSelectionRange(p, p); } return; }
    if (e.target.id === "tz-m-titulo" && S.termoModal) { S.termoModal.titulo = e.target.value; return; }
    if (e.target.id === "tz-m-checkbox" && S.termoModal) { S.termoModal.checkboxLabel = e.target.value; return; }
    if (e.target.id === "tz-m-corpo" && S.termoModal) { S.termoModal.corpo = e.target.value; const p = e.target.selectionStart; render(); const n = document.getElementById("tz-m-corpo"); if (n) { n.focus(); n.setSelectionRange(p, p); } return; }
    if (e.target.id === "qz-m-titulo" && S.modal) { S.modal.titulo = e.target.value; return; }
    if (e.target.id === "qz-m-desc" && S.modal) { S.modal.descricao = e.target.value; return; }
    if (e.target.id === "qz-ai-obs" && S.aiModal) { S.aiModal.obs = e.target.value; return; }
    if (e.target.dataset && e.target.dataset.qfield && S.modal) {
      const p = S.modal.perguntas.find((x) => x.id === e.target.dataset.qid); if (!p) return;
      const f = e.target.dataset.qfield;
      if (f === "longa" || f === "obrigatoria") p[f] = e.target.checked;
      else if (f === "escalaLabelMin" || f === "escalaLabelMax") p[f] = e.target.value;
      else { p[f] = e.target.value; const el2 = e.target, pos = el2.selectionStart; render(); const n = document.querySelector(`[data-qfield="${f}"][data-qid="${p.id}"]`); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }
      return;
    }
    if (e.target.dataset && e.target.dataset.optfield !== undefined && S.modal) {
      const p = S.modal.perguntas.find((x) => x.id === e.target.dataset.qid); if (!p) return;
      p.opcoes[+e.target.dataset.oi] = e.target.value;
      return;
    }
    if (e.target.id === "qz-filter-form") { S.filterForm = e.target.value; return render(); }
    if (e.target.id === "qz-s-q" && S.shareModal) {
      S.shareModal.query = e.target.value;
      clearTimeout(window.__qzSearchTmr);
      window.__qzSearchTmr = setTimeout(() => searchPatients(S.shareModal.query), 300);
      return;
    }
  });

  document.addEventListener("change", (e) => {
    const root = document.getElementById("s-questionarios");
    if (!root || root.style.display === "none") return;
    if (e.target.id === "qz-filter-form") { S.filterForm = e.target.value; return render(); }
  });

  /* ---------- MODAL STANDALONE: "Ver resposta" (chamado de fora, ex.: timeline do paciente) ---------- */
  window.mostrarRespostaQuestionario = async function (respostaId) {
    const sb = sbc(); if (!sb || !respostaId) return;
    const holderId = "qz-standalone-resp";
    let holder = document.getElementById(holderId);
    if (!holder) { holder = document.createElement("div"); holder.id = holderId; document.body.appendChild(holder); }
    holder.innerHTML = `<div class="qz-modal-bg" data-standalone-bg="1" style="z-index:5000"><div class="qz-modal sm">
      <div class="qz-modal-h"><h2>Carregando…</h2><button class="qz-btn ghost" data-standalone-close="1" style="padding:2px 10px">×</button></div>
      <div class="qz-modal-b"><div class="qz-empty">Carregando resposta…</div></div>
    </div></div>`;
    const closeStandalone = () => { holder.innerHTML = ""; };
    holder.querySelector("[data-standalone-close]").onclick = closeStandalone;
    holder.querySelector("[data-standalone-bg]").onclick = (e) => { if (e.target === e.currentTarget) closeStandalone(); };

    const { data, error } = await sb.from("questionario_respostas")
      .select("id,paciente_nome,paciente_telefone,paciente_email,paciente_cpf,email_verificado,respondido_em,questionarios(titulo,anonimo),questionario_resposta_itens(valor_texto,valor_opcoes,valor_escala,questionario_perguntas(enunciado,tipo))")
      .eq("id", respostaId).maybeSingle();
    if (error || !data) { holder.innerHTML = ""; return toast("Não foi possível carregar essa resposta."); }
    const r = {
      questionarioTitulo: (data.questionarios && data.questionarios.titulo) || "—",
      anonimo: !!(data.questionarios && data.questionarios.anonimo),
      pacienteNome: data.paciente_nome || "", pacienteTelefone: data.paciente_telefone || "",
      pacienteEmail: data.paciente_email || "", pacienteCpf: data.paciente_cpf || "",
      emailVerificado: !!data.email_verificado,
      respondidoEm: data.respondido_em,
      itens: (data.questionario_resposta_itens || []).map((it) => ({
        enunciado: (it.questionario_perguntas && it.questionario_perguntas.enunciado) || "",
        tipo: (it.questionario_perguntas && it.questionario_perguntas.tipo) || "texto",
        valorTexto: it.valor_texto || "", valorOpcoes: it.valor_opcoes || null, valorEscala: it.valor_escala,
      })),
    };
    holder.innerHTML = `<div class="qz-modal-bg" data-standalone-bg="1" style="z-index:5000"><div class="qz-modal sm">
      <div class="qz-modal-h"><h2>${esc(r.questionarioTitulo)}</h2><button class="qz-btn ghost" data-standalone-close="1" style="padding:2px 10px">×</button></div>
      <div class="qz-modal-b">
        ${r.anonimo ? '<div class="qz-nom-note">Esta resposta é anônima — nenhum dado de identificação foi coletado.</div>' : `
        <div class="qz-card" style="padding:12px 14px;margin-bottom:14px">
          <div style="font-size:12.5px;color:#1e293b"><b>${esc(r.pacienteNome || "—")}</b></div>
          <div style="font-size:11.5px;color:#64748b;margin-top:4px">📞 ${esc(r.pacienteTelefone || "—")} · ✉️ ${esc(r.pacienteEmail || "—")} · CPF ${esc(r.pacienteCpf || "—")}</div>
          ${r.emailVerificado ? `<div style="font-size:11px;color:#16a34a;margin-top:8px;display:flex;align-items:center;gap:5px">✅ Assinado por ${esc(r.pacienteEmail)} (email verificado)</div>` : ""}
        </div>`}
        <div style="font-size:11px;color:#94a3b8;margin-bottom:10px">Respondido em ${brDateTime(r.respondidoEm)}</div>
        ${r.itens.map((it) => `<div class="qz-answer">
          <div class="q">${esc(it.enunciado)}</div>
          <div class="a">${it.tipo === "escala" ? (it.valorEscala ?? "—") : it.tipo === "multipla" || it.tipo === "unica" ? esc((it.valorOpcoes || []).join(", ") || "—") : esc(it.valorTexto || "—")}</div>
        </div>`).join("") || '<div class="qz-empty" style="padding:24px">Sem respostas registradas.</div>'}
      </div>
    </div></div>`;
    holder.querySelector("[data-standalone-close]").onclick = closeStandalone;
    holder.querySelector("[data-standalone-bg]").onclick = (e) => { if (e.target === e.currentTarget) closeStandalone(); };
  };

  window.initQuestionarios = function () { render(); load(); };
})();
