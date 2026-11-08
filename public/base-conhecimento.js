/* BASE DE CONHECIMENTO — módulo standalone (mesmo padrão de protocolos.js/questionarios.js) */
(function () {
  const S = {
    tab: "bases",
    loading: true,
    bases: [],
    atalhos: [],
    expandedBaseId: null,
    creatingBase: false,
    creatingAtalho: false,
    addingTextFor: null, // base_id com o form "colar texto" aberto
    novaBaseAnexos: [], // {id, tipo, nome, conteudo} — conteúdo já lido, aguardando a base ser criada
    novaBaseAddingText: false,
    // Nome/descrição/tags do formulário de nova base ficam aqui (não só no
    // DOM) porque qualquer render() no meio do preenchimento — como o que
    // acontece ao anexar um arquivo — reconstrói o formulário inteiro, e sem
    // isso os valores digitados eram perdidos.
    novaBaseCampos: { nome: "", descricao: "", tags: "", ias: ["chat_ai", "assistente_ai"] },
  };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sbc = () => window.sb || window.__sb;
  const estimarTokens = (txt) => Math.max(1, Math.round((txt || "").length / 4));
  const uid = () => "t" + Math.random().toString(36).slice(2, 9);

  // O app usa window.showToast(msg,type) (ver medicopilot.html) — não existe
  // nenhuma função global chamada "toast". As versões anteriores deste
  // arquivo chamavam "toast(...)", que nunca existiu, então qualquer erro
  // (ex.: falha ao salvar uma base) ficava só no console, invisível pro
  // usuário. notify() sempre mostra algo, com fallback pra alert().
  function notify(msg, tipo) {
    if (typeof window.showToast === "function") return window.showToast(msg, tipo);
    if (typeof window.toast === "function") return window.toast(msg);
    alert(msg);
  }

  const IA_LABEL = { chat_ai: "Chat IA", assistente_ai: "Assistente IA" };
  const IA_ICON = { chat_ai: "ti-message-circle", assistente_ai: "ti-robot" };
  const IA_CLASS = { chat_ai: "emerald", assistente_ai: "violet" };

  async function medicoId() {
    const sb = sbc(); if (!sb) return null;
    const { data, error } = await sb.auth.getUser();
    if (error) console.error("[base-conhecimento] erro ao obter usuário:", error.message);
    return data && data.user ? data.user.id : null;
  }

  /* ---------- DATA ---------- */
  async function load(opts) {
    const silent = opts && opts.silent;
    const sb = sbc(); if (!sb) return;
    if (!silent) { S.loading = true; render(); }
    const [{ data: bases, error: e1 }, { data: atalhos, error: e2 }] = await Promise.all([
      sb.from("base_conhecimento")
        .select("id,nome,descricao,tags,ias,ativo,created_at,base_conhecimento_itens(id,tipo,nome_original,status,created_at)")
        .order("created_at", { ascending: false }),
      sb.from("prompt_comandos").select("id,atalho,texto_completo,ias,created_at").order("created_at", { ascending: false }),
    ]);
    if (e1) console.error("[base-conhecimento] erro ao carregar bases:", e1.message);
    if (e2) console.error("[base-conhecimento] erro ao carregar atalhos:", e2.message);
    S.bases = bases || [];
    S.atalhos = atalhos || [];
    S.loading = false;
    render();
  }

  async function criarBase(payload) {
    const sb = sbc();
    if (!sb) { notify("Erro interno: cliente Supabase não encontrado"); return null; }
    const mid = await medicoId();
    if (!mid) { notify("Não consegui identificar seu usuário — tente recarregar a página e logar de novo"); return null; }
    const { data, error } = await sb.from("base_conhecimento").insert({ ...payload, medico_id: mid }).select("id").single();
    if (error) { console.error("[base-conhecimento] erro ao criar base:", error); notify("Erro ao criar base: " + error.message); return null; }
    notify("Base de conhecimento criada");
    return data.id;
  }

  async function atualizarBase(id, patch) {
    const sb = sbc(); if (!sb) return;
    const { error } = await sb.from("base_conhecimento").update(patch).eq("id", id);
    if (error) { console.error(error.message); notify("Erro ao atualizar"); return; }
    await load();
  }

  async function excluirBase(id) {
    const sb = sbc(); if (!sb) return;
    const { error } = await sb.from("base_conhecimento").delete().eq("id", id);
    if (error) { console.error(error.message); notify("Erro ao excluir"); return; }
    notify("Base removida");
    await load();
  }

  function dividirEmChunks(texto, tamanho) {
    tamanho = tamanho || 1600;
    const partes = []; let restante = (texto || "").trim();
    while (restante.length > tamanho) {
      let corte = restante.lastIndexOf("\n\n", tamanho);
      if (corte < tamanho * 0.5) corte = tamanho;
      partes.push(restante.slice(0, corte).trim());
      restante = restante.slice(corte).trim();
    }
    if (restante) partes.push(restante);
    return partes;
  }

  async function adicionarItemTexto(baseId, tipo, nomeOriginal, conteudo) {
    const sb = sbc(); const mid = await medicoId(); if (!sb || !mid) return;
    const chunks = dividirEmChunks(conteudo);
    // Os itens já entram "prontos": a busca do chat usa direto o `conteudo`
    // (similaridade de texto), sem nenhum pré-processamento por IA por chunk.
    // Só a descrição da base (abaixo) ainda passa por IA, e só quando falta.
    const linhas = chunks.map((c, ordem) => ({
      base_id: baseId, medico_id: mid, tipo, nome_original: nomeOriginal || null,
      conteudo: c, tokens_estimados: estimarTokens(c), ordem, status: "pronto",
    }));
    const { data: inseridos, error } = await sb.from("base_conhecimento_itens").insert(linhas).select("id, conteudo");
    if (error) { console.error(error.message); notify("Erro ao adicionar conteúdo"); return; }
    S.addingTextFor = null;
    notify("Conteúdo adicionado");
    await load();
    // Só chama a IA se a base ainda não tem descrição — não roda mais a cada
    // chunk. Roda em segundo plano, não bloqueia a tela nem o load acima.
    const base = S.bases.find((b) => b.id === baseId);
    if ((!base || !(base.descricao || "").trim()) && inseridos && inseridos.length) {
      sugerirDescricaoBase(baseId, inseridos);
    }
  }

  async function sugerirDescricaoBase(baseId, itensInseridos) {
    const sb = sbc(); if (!sb) return;
    try {
      const res = await fetch("/api/base-conhecimento/gerar-metadados", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chunks: itensInseridos.slice(0, 6).map((it) => ({ id: it.id, conteudo: it.conteudo })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const dados = await res.json();
      if (!dados.descricao_sugerida) return;
      // Checa de novo antes de gravar — o médico pode ter editado a
      // descrição enquanto a IA processava.
      const { data: atual } = await sb.from("base_conhecimento").select("descricao").eq("id", baseId).single();
      if (atual && !(atual.descricao || "").trim()) {
        await sb.from("base_conhecimento").update({ descricao: dados.descricao_sugerida }).eq("id", baseId);
        await load({ silent: true });
      }
    } catch (err) {
      console.error("[base-conhecimento] erro ao gerar descrição sugerida:", err);
    }
  }

  // Um arquivo/texto vira vários itens (trechos) no banco; a tela mostra e
  // exclui o envio inteiro.
  async function excluirItem(idsCsv) {
    const sb = sbc(); if (!sb) return;
    const ids = String(idsCsv || "").split(",").filter(Boolean);
    if (!ids.length) return;
    const { error } = await sb.from("base_conhecimento_itens").delete().in("id", ids);
    if (error) { console.error(error.message); return; }
    await load();
  }

  async function criarAtalho(payload) {
    const sb = sbc(); const mid = await medicoId(); if (!sb || !mid) return;
    const { error } = await sb.from("prompt_comandos").insert({ ...payload, medico_id: mid });
    if (error) {
      if (error.code === "23505") { notify("Você já tem um atalho com esse nome"); return; }
      console.error(error.message); notify("Erro ao criar atalho"); return;
    }
    S.creatingAtalho = false;
    notify("Atalho criado");
    if (typeof window.iaAssistInvalidarCacheAtalhos === "function") window.iaAssistInvalidarCacheAtalhos();
    await load();
  }

  async function excluirAtalho(id) {
    const sb = sbc(); if (!sb) return;
    const { error } = await sb.from("prompt_comandos").delete().eq("id", id);
    if (error) { console.error(error.message); return; }
    notify("Atalho removido");
    if (typeof window.iaAssistInvalidarCacheAtalhos === "function") window.iaAssistInvalidarCacheAtalhos();
    await load();
  }

  /* ---------- RENDER ---------- */
  function iaChips(ias, selecionadas) {
    const sel = selecionadas || [];
    return (ias || []).map((id) => {
      const isActive = sel.includes(id);
      const cls = isActive ? "active " + (id === "chat_ai" ? "chat" : "assist") : "";
      return `<button class="bk-chip ${cls}" data-selia="${id}"><i class="ti ${IA_ICON[id]}"></i> ${IA_LABEL[id]}</button>`;
    }).join("");
  }

  function tagPill(t) { return `<span class="bk-tag">#${esc(t)}</span>`; }
  function iaPill(id) { return `<span class="bk-tag ${IA_CLASS[id]}"><i class="ti ${IA_ICON[id]}"></i> ${IA_LABEL[id]}</span>`; }

  // Agrupa os trechos de um mesmo envio (mesmo tipo, nome e horário de
  // inserção — todos entram num único insert) num só arquivo/texto. Tokens e
  // a divisão em trechos são detalhes internos da busca, não do médico.
  function agruparEnvios(itens) {
    const grupos = new Map();
    for (const i of itens) {
      const chave = [i.tipo, i.nome_original || "", i.created_at || i.id].join("|");
      const g = grupos.get(chave);
      if (g) {
        g.ids.push(i.id);
        if (i.status === "processando" || (i.status === "erro" && g.status !== "processando")) g.status = i.status;
      } else {
        grupos.set(chave, { ids: [i.id], tipo: i.tipo, nome: i.nome_original, status: i.status });
      }
    }
    return Array.from(grupos.values());
  }

  function baseCardHtml(b) {
    const itens = agruparEnvios(b.base_conhecimento_itens || []);
    const open = S.expandedBaseId === b.id;
    return `
      <div class="cop-card">
        <div class="bk-base-row">
          <div class="bk-base-main" data-toggle-base="${b.id}">
            <div class="cop-ico-box sm" style="background:linear-gradient(135deg,${b.ativo ? "#34d399,#059669" : "#cbd5e1,#94a3b8"})">
              <i class="ti ti-book-2"></i>
            </div>
            <div>
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span class="bk-base-name">${esc(b.nome)}</span>
                ${!b.ativo ? '<span class="bk-inactive">inativa</span>' : ""}
              </div>
              <div class="bk-base-desc">${esc(b.descricao || "")}</div>
              <div class="bk-tags">
                ${(b.tags || []).map(tagPill).join("")}
                ${(b.ias || []).map(iaPill).join("")}
                <span class="bk-tag">${itens.length} ${itens.length === 1 ? "conteúdo" : "conteúdos"}</span>
              </div>
            </div>
          </div>
          <div class="bk-base-actions">
            <input type="checkbox" class="cop-switch" ${b.ativo ? "checked" : ""} data-toggle-ativo="${b.id}" role="switch" />
            <button class="bk-icon-btn" data-del-base="${b.id}"><i class="ti ti-trash"></i></button>
            <i class="ti ti-chevron-down bk-chev ${open ? "open" : ""}" data-toggle-base="${b.id}"></i>
          </div>
        </div>
        ${open ? baseExpandedHtml(b, itens) : ""}
      </div>`;
  }

  function baseExpandedHtml(b, itens) {
    return `
      <div class="cop-sep" style="margin-top:14px"></div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">
        ${itens.length === 0 ? '<div class="bk-empty">Nenhum arquivo ou texto ainda.</div>' : itens.map((i) => `
          <div class="bk-item-row">
            <div style="display:flex;align-items:center;gap:8px;min-width:0">
              <i class="ti ${i.tipo === "arquivo" ? "ti-file-text" : "ti-align-left"}"></i>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.nome || "Sem título")}</span>
              ${i.status === "processando" ? '<span class="bk-tag" style="white-space:nowrap"><i class="ti ti-loader-2"></i> processando…</span>' : ""}
              ${i.status === "erro" ? '<span class="bk-tag" style="white-space:nowrap;color:#b45309">erro ao processar</span>' : ""}
            </div>
            <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
              <button class="bk-icon-btn" data-del-item="${i.ids.join(",")}" title="Excluir"><i class="ti ti-trash" style="font-size:13px"></i></button>
            </div>
          </div>`).join("")}
      </div>
      <div class="bk-add-row">
        <button class="bk-btn-ghost" data-upload-for="${b.id}"><i class="ti ti-upload"></i> Enviar arquivo (.pdf, .txt, .md)</button>
        <input type="file" accept=".txt,.md,.pdf" style="display:none" id="bk-file-${b.id}" data-fileinput-for="${b.id}" />
        <button class="bk-btn-ghost" data-addtext-for="${b.id}"><i class="ti ti-file-plus"></i> Colar texto</button>
      </div>
      ${S.addingTextFor === b.id ? `
        <div class="cop-card" style="margin-top:10px;background:rgba(255,255,255,.55)">
          <div class="bk-field"><label>Título</label>
            <input class="bk-input" id="bk-newtext-nome" placeholder="Ex: Observações sobre dose" />
          </div>
          <div class="bk-field"><label>Conteúdo</label>
            <textarea class="bk-textarea" id="bk-newtext-conteudo" rows="5" placeholder="Cole aqui..."></textarea>
          </div>
          <div class="bk-form-actions">
            <button class="bk-btn-ghost" data-canceltext="1">Cancelar</button>
            <button class="btn primary sm" data-savetext-for="${b.id}"><i class="ti ti-check"></i> Adicionar</button>
          </div>
        </div>` : ""}
    `;
  }

  function novaBaseFormHtml() {
    return `
      <div class="cop-card bk-wrap-full">
        <div class="cop-card-title" style="margin-bottom:12px"><i class="ti ti-plus" style="color:#7c3aed"></i> Nova base de conhecimento</div>
        <div class="bk-field"><label>Nome do tópico</label>
          <input class="bk-input" id="bk-nb-nome" placeholder="Ex: Protocolo de enxaqueca da clínica" value="${esc(S.novaBaseCampos.nome)}" />
          <div class="bk-hint">Curto e específico — ajuda a IA a reconhecer o assunto.</div>
        </div>
        <div class="bk-field"><label>Descrição</label>
          <textarea class="bk-textarea" id="bk-nb-desc" rows="2" placeholder="Do que se trata... (deixe em branco pra IA sugerir a partir do 1º arquivo)">${esc(S.novaBaseCampos.descricao)}</textarea>
          <div class="bk-hint">Sempre enviada à IA pra ela saber que essa base existe.</div>
        </div>
        <div class="bk-field"><label>Tags (separadas por vírgula)</label>
          <input class="bk-input" id="bk-nb-tags" placeholder="cardiologia, protocolo" value="${esc(S.novaBaseCampos.tags)}" />
        </div>
        <div class="bk-field"><label>Usar em</label>
          <div class="bk-chip-row" id="bk-nb-ias">${iaChips(["chat_ai", "assistente_ai"], S.novaBaseCampos.ias)}</div>
        </div>
        <div class="bk-field"><label>Conteúdo (opcional — dá pra adicionar depois também)</label>
          ${S.novaBaseAnexos.length === 0 ? '' : `
            <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
              ${S.novaBaseAnexos.map((a) => `
                <div class="bk-item-row">
                  <div style="display:flex;align-items:center;gap:8px;min-width:0">
                    <i class="ti ${a.tipo === "arquivo" ? "ti-file-text" : "ti-align-left"}"></i>
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.nome)}</span>
                  </div>
                  <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
                    <button class="bk-icon-btn" data-del-newbase-anexo="${a.id}"><i class="ti ti-trash" style="font-size:13px"></i></button>
                  </div>
                </div>`).join("")}
            </div>`}
          <div class="bk-add-row" style="margin-top:0">
            <button class="bk-btn-ghost" data-newbase-upload="1"><i class="ti ti-upload"></i> Enviar arquivo (.pdf, .txt, .md)</button>
            <input type="file" accept=".txt,.md,.pdf" style="display:none" id="bk-newbase-file" data-newbase-fileinput="1" />
            <button class="bk-btn-ghost" data-newbase-addtext="1"><i class="ti ti-file-plus"></i> Colar texto</button>
          </div>
          ${S.novaBaseAddingText ? `
            <div class="cop-card" style="margin-top:10px;background:rgba(255,255,255,.55)">
              <div class="bk-field"><label>Título</label>
                <input class="bk-input" id="bk-nbtext-nome" placeholder="Ex: Observações sobre dose" />
              </div>
              <div class="bk-field"><label>Conteúdo</label>
                <textarea class="bk-textarea" id="bk-nbtext-conteudo" rows="5" placeholder="Cole aqui..."></textarea>
              </div>
              <div class="bk-form-actions">
                <button class="bk-btn-ghost" data-newbase-canceltext="1">Cancelar</button>
                <button class="btn primary sm" data-newbase-savetext="1"><i class="ti ti-check"></i> Adicionar</button>
              </div>
            </div>` : ""}
        </div>
        <div class="bk-form-actions">
          <button class="bk-btn-ghost" data-cancelbase="1">Cancelar</button>
          <button class="btn primary sm" data-savebase="1"><i class="ti ti-check"></i> Criar base</button>
        </div>
      </div>`;
  }

  function atalhoCardHtml(a) {
    return `
      <div class="cop-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:flex-start;gap:12px;min-width:0">
            <div class="cop-ico-box sm" style="background:linear-gradient(135deg,#fbbf24,#f59e0b)"><i class="ti ti-bolt"></i></div>
            <div style="min-width:0">
              <span class="bk-atalho-code">${esc(a.atalho)}</span>
              <div class="bk-atalho-text">${esc(a.texto_completo)}</div>
              <div class="bk-tags">${(a.ias || []).map(iaPill).join("")}</div>
            </div>
          </div>
          <button class="bk-icon-btn" data-del-atalho="${a.id}"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
  }

  function novoAtalhoFormHtml() {
    return `
      <div class="cop-card bk-wrap-full">
        <div class="cop-card-title" style="margin-bottom:12px"><i class="ti ti-plus" style="color:#f59e0b"></i> Novo atalho</div>
        <div class="bk-field"><label>Atalho</label>
          <input class="bk-input" id="bk-na-atalho" placeholder="/resumo-retorno" value="/" />
          <div class="bk-hint">Precisa começar com "/" — é o que você digita no chat.</div>
        </div>
        <div class="bk-field"><label>Comando completo</label>
          <textarea class="bk-textarea" id="bk-na-texto" rows="3" placeholder="Texto que substitui o atalho ao enviar..."></textarea>
        </div>
        <div class="bk-field"><label>Disponível em</label>
          <div class="bk-chip-row" id="bk-na-ias">${iaChips(["chat_ai", "assistente_ai"], ["chat_ai", "assistente_ai"])}</div>
        </div>
        <div class="bk-form-actions">
          <button class="bk-btn-ghost" data-cancelatalho="1">Cancelar</button>
          <button class="btn primary sm" data-saveatalho="1"><i class="ti ti-check"></i> Criar atalho</button>
        </div>
      </div>`;
  }

  /* ---------- PESQUISA ---------- */
  // Cada fonte é buscada e desenhada no seu próprio bloco (#bk-res-<id>), então
  // um bloco que demora (IA, PubMed) não segura os outros nem a tela.
  const FONTES = [
    { id: "ia", nome: "Conhecimento da IA", icon: "ti-sparkles" },
    { id: "base", nome: "Base de conhecimento", icon: "ti-book-2" },
    { id: "pubmed", nome: "PubMed", icon: "ti-microscope", idioma: "en" },
  ];
  const FONTES_KEY = "bk-pesquisa-fontes";
  function fontesSalvas() {
    try {
      const v = JSON.parse(localStorage.getItem(FONTES_KEY) || "null");
      if (Array.isArray(v)) return v.filter((f) => FONTES.some((x) => x.id === f));
    } catch (_) { /* sem storage: usa o padrão */ }
    return FONTES.map((f) => f.id);
  }
  const P = { q: "", fontes: fontesSalvas(), ativa: false, blocos: {}, tok: {}, n: 0, iaExpandida: false };

  async function authFetch(url, init) {
    if (typeof window.iaAuthFetch === "function") return window.iaAuthFetch(url, init);
    const sb = sbc();
    const { data } = sb ? await sb.auth.getSession() : { data: null };
    const token = data && data.session ? data.session.access_token : null;
    const opts = Object.assign({}, init || {});
    opts.headers = Object.assign({}, opts.headers || {}, token ? { Authorization: "Bearer " + token } : {});
    return fetch(url, opts);
  }

  async function buscarFonte(f) {
    const tok = (P.tok[f] = ++P.n);
    P.blocos[f] = { estado: "carregando" };
    renderBloco(f);
    const url = { ia: "/api/pesquisa/ia", base: "/api/pesquisa/base", pubmed: "/api/pesquisa/pubmed" }[f];
    const body = f === "ia" ? { q: P.q, usar_base: P.fontes.includes("base") } : { q: P.q };
    let bloco;
    try {
      const res = await authFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const dados = await res.json().catch(() => ({}));
      bloco = res.ok ? { estado: "ok", dados } : { estado: "erro", erro: dados.error || "HTTP " + res.status };
    } catch (err) {
      bloco = { estado: "erro", erro: err && err.message ? err.message : "falha de rede" };
    }
    // Resposta de uma busca antiga, ou de uma fonte desmarcada no meio do caminho.
    if (P.tok[f] !== tok || !P.fontes.includes(f)) return;
    P.blocos[f] = bloco;
    renderBloco(f);
  }

  function pesquisar() {
    const inp = document.getElementById("bk-search-input");
    const q = ((inp && inp.value) || "").trim();
    if (q.length < 2) { notify("Digite ao menos 2 caracteres para pesquisar"); return; }
    if (!P.fontes.length) { abrirOpcoes(true); notify("Selecione ao menos uma fonte de dados"); return; }
    P.q = q; P.ativa = true; P.blocos = {}; P.iaExpandida = false;
    abrirOpcoes(false);
    if (inp) inp.blur();
    render();
    for (const f of P.fontes) buscarFonte(f);
  }

  function alternarFonte(f, marcada) {
    P.fontes = FONTES.map((x) => x.id).filter((id) => (id === f ? marcada : P.fontes.includes(id)));
    try { localStorage.setItem(FONTES_KEY, JSON.stringify(P.fontes)); } catch (_) { /* opcional */ }
    if (!marcada) { delete P.blocos[f]; P.tok[f] = ++P.n; }
    if (P.ativa) {
      renderPesquisa();
      if (marcada) buscarFonte(f);
    }
  }

  function abrirOpcoes(abrir) {
    const o = document.getElementById("bk-search-opts");
    if (o) o.hidden = !abrir;
    const s = document.getElementById("bk-search");
    if (s) s.classList.toggle("open", !!abrir);
  }

  function pesquisaShellHtml() {
    return `
      <div class="bk-search" id="bk-search">
        <div class="bk-search-bar">
          <i class="ti ti-search bk-search-ico"></i>
          <input id="bk-search-input" class="bk-search-input" type="search" autocomplete="off"
            placeholder="Pesquise na IA, nas suas bases e no PubMed" aria-label="Pesquisar" />
          <button class="bk-search-btn" data-pesq-buscar="1" title="Pesquisar"><i class="ti ti-arrow-right"></i></button>
        </div>
        <div class="bk-search-opts" id="bk-search-opts" hidden>
          <div class="bk-search-opts-label">Fonte dos dados</div>
          <div class="bk-fontes" id="bk-fontes"></div>
          <div class="bk-hint" style="margin-top:8px">Os resultados aparecem agrupados por fonte. A visão geral da IA usa também a sua base de conhecimento quando ela está marcada.</div>
        </div>
      </div>
      <div id="bk-search-voltar"></div>`;
  }

  function fontesHtml() {
    return FONTES.map((f) => {
      const on = P.fontes.includes(f.id);
      return `<label class="bk-fonte ${on ? "on" : ""}">
        <input type="checkbox" data-pesq-fonte="${f.id}" ${on ? "checked" : ""} />
        <i class="ti ${on ? "ti-square-check-filled" : "ti-square"} bk-fonte-check"></i>
        <i class="ti ${f.icon}"></i> ${f.nome}
      </label>`;
    }).join("");
  }

  function renderPesquisa() {
    const fontesEl = document.getElementById("bk-fontes");
    if (fontesEl) fontesEl.innerHTML = fontesHtml();
    const voltar = document.getElementById("bk-search-voltar");
    if (voltar) {
      voltar.innerHTML = !P.ativa && P.q
        ? `<button class="bk-btn-ghost bk-voltar" data-pesq-voltar="1"><i class="ti ti-arrow-left"></i> Voltar aos resultados de “${esc(P.q)}”</button>`
        : "";
    }
    const res = document.getElementById("bk-res");
    const main = document.getElementById("bk-main");
    if (main) main.style.display = P.ativa ? "none" : "";
    if (!res) return;
    if (!P.ativa) { res.innerHTML = ""; return; }
    const ordem = FONTES.filter((f) => P.fontes.includes(f.id));
    res.innerHTML = `
      <div class="bk-res-hd">
        <span>Resultados para <strong>“${esc(P.q)}”</strong></span>
        <button class="bk-btn-ghost" data-pesq-fechar="1"><i class="ti ti-x"></i> Fechar pesquisa</button>
      </div>
      ${ordem.length ? ordem.map((f) => `<section class="bk-res-bloco" id="bk-res-${f.id}"></section>`).join("")
        : '<div class="bk-empty">Nenhuma fonte selecionada. Clique no campo de pesquisa e marque ao menos uma fonte.</div>'}`;
    for (const f of ordem) renderBloco(f.id);
  }

  function skeleton(linhas) {
    return `<div class="bk-skel">${Array.from({ length: linhas }, (_, i) => `<span style="width:${[92, 78, 85, 64, 70][i % 5]}%"></span>`).join("")}</div>`;
  }

  function erroHtml(f, msg) {
    return `<div class="bk-res-erro"><i class="ti ti-alert-triangle"></i> ${esc(msg)}
      <button class="bk-btn-ghost" data-pesq-retry="${f}"><i class="ti ti-refresh"></i> Tentar de novo</button></div>`;
  }

  function md(t) {
    if (typeof window.mdToHtml === "function") return window.mdToHtml(t);
    return "<p>" + esc(t).replace(/\n/g, "<br>") + "</p>";
  }

  function renderBloco(f) {
    const el = document.getElementById("bk-res-" + f);
    if (!el) return;
    const b = P.blocos[f] || { estado: "carregando" };
    const fonte = FONTES.find((x) => x.id === f);

    if (f === "ia") {
      let corpo;
      if (b.estado === "carregando") corpo = skeleton(4);
      else if (b.estado === "erro") corpo = erroHtml(f, "Não foi possível gerar a visão geral da IA agora.");
      else if (!(b.dados.resumo || "").trim()) corpo = '<div class="bk-empty">A IA não retornou uma resposta para esta pesquisa.</div>';
      else {
        const bases = (b.dados.bases || []).map((n) =>
          `<span class="bk-fonte-badge bk-fonte-badge-click" data-pesq-base-nome="${esc(n)}"><i class="ti ti-book-2"></i> ${esc(n)}</span>`).join(" ");
        corpo = `
          <div class="bk-ia-txt ${P.iaExpandida ? "" : "clamp"}">${md(b.dados.resumo)}</div>
          <button class="bk-ia-mais" data-pesq-ia-mais="1" hidden>${P.iaExpandida ? "Mostrar menos" : "Mostrar mais"} <i class="ti ti-chevron-${P.iaExpandida ? "up" : "down"}"></i></button>
          ${bases ? `<div class="bk-ia-bases">Com base em: ${bases}</div>` : ""}
          <div class="bk-ia-aviso">A IA pode cometer erros. Confira as fontes antes de usar na conduta.</div>`;
      }
      el.className = "bk-res-bloco bk-ia";
      el.innerHTML = `<div class="bk-ia-hd"><i class="ti ti-sparkles"></i> Visão geral criada por IA</div>${corpo}`;
      // "Mostrar mais" só quando o texto realmente passa do limite.
      const txt = el.querySelector(".bk-ia-txt"); const mais = el.querySelector(".bk-ia-mais");
      const corta = !!txt && txt.scrollHeight > txt.clientHeight + 4;
      if (txt) txt.classList.toggle("corta", corta);
      if (mais && (P.iaExpandida || corta)) mais.hidden = false;
      return;
    }

    const d = b.dados || {};
    const itens = d.resultados || [];
    let corpo;
    if (b.estado === "carregando") corpo = [0, 1, 2].map(() => `<div class="bk-res-item">${skeleton(3)}</div>`).join("");
    else if (b.estado === "erro") corpo = erroHtml(f, f === "pubmed" ? "O PubMed não respondeu agora." : "Não foi possível pesquisar nas suas bases.");
    else if (!itens.length) corpo = `<div class="bk-empty">Nada encontrado ${f === "base" ? "nas suas bases" : "no PubMed"} para esta pesquisa.</div>`;
    else if (f === "base") {
      corpo = itens.map((r) => `
        <div class="bk-res-item">
          <div class="bk-res-src"><i class="ti ${r.tipo === "base" ? "ti-book-2" : r.tipo === "arquivo" ? "ti-file-text" : "ti-align-left"}"></i> ${esc(r.base_nome)}</div>
          <a class="bk-res-tit" href="#" data-pesq-abrir-base="${esc(r.base_id)}">${esc(r.titulo)}</a>
          <div class="bk-res-desc">${esc(r.descricao)}</div>
        </div>`).join("");
    } else {
      const mapa = b.traduzido && b.traducao && b.traducao.mapa ? b.traducao.mapa : null;
      corpo = itens.map((r) => {
        const t = mapa && mapa[idDoItem(r)];
        const ext = (href, txt) => href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${txt}</a>` : "";
        return `
        <div class="bk-res-item">
          <div class="bk-res-src"><i class="ti ti-microscope"></i> ${esc([r.revista, r.ano].filter(Boolean).join(" · ") || "PubMed")} <span class="bk-res-pmid">PMID ${esc(r.pmid)}</span></div>
          <a class="bk-res-tit" href="${esc(r.url)}" target="_blank" rel="noopener" ${t ? `title="${esc(r.titulo)}"` : ""}>${esc(t ? t.titulo : r.titulo)}</a>
          ${r.autores ? `<div class="bk-res-aut">${esc(r.autores)}</div>` : ""}
          <div class="bk-res-desc">${esc(t ? t.descricao : r.descricao)}</div>
          <div class="bk-res-links">${[ext(r.url, "PubMed"), ext(r.doi, "Artigo (DOI)"), ext(r.europepmc, "Europe PMC")].filter(Boolean).join('<span aria-hidden="true">·</span>')}</div>
        </div>`;
      }).join("");
    }
    let rodape = "";
    if (f === "pubmed" && b.estado === "ok" && d.consulta) {
      const link = "https://pubmed.ncbi.nlm.nih.gov/?term=" + encodeURIComponent(d.consulta);
      rodape = `<div class="bk-res-rod">
        ${d.consulta !== P.q ? `<span>Pesquisado em inglês como: <em>${esc(d.consulta)}</em></span>` : "<span></span>"}
        ${itens.length ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Ver ${d.total > itens.length ? "todos os " + Number(d.total).toLocaleString("pt-BR") + " resultados" : "no PubMed"} <i class="ti ti-external-link"></i></a>` : ""}
      </div>`;
    }
    const contagem = b.estado === "ok" && itens.length ? `<span class="bk-res-n">${itens.length}</span>` : "";
    const carregando = b.estado === "carregando" ? '<i class="ti ti-loader-2 bk-spin"></i>' : "";
    let traduzir = "";
    if (fonte.idioma === "en" && b.estado === "ok" && itens.length) {
      const tr = b.traducao && b.traducao.estado;
      traduzir = tr === "carregando"
        ? '<span class="bk-traduzir carregando"><i class="ti ti-loader-2 bk-spin"></i> Traduzindo…</span>'
        : `<button class="bk-traduzir" data-pesq-traduzir="${f}"><i class="ti ti-language"></i> ${b.traduzido ? "Ver original em inglês" : "Traduzir para português"}</button>`;
      if (b.traduzido) traduzir = '<span class="bk-traduzido-tag">Tradução automática</span>' + traduzir;
    }
    el.className = "bk-res-bloco";
    el.innerHTML = `
      <div class="bk-res-fonte"><i class="ti ${fonte.icon}"></i> ${fonte.nome} ${contagem} ${carregando}<span class="bk-res-fonte-acoes">${traduzir}</span></div>
      <div class="bk-res-lista">${corpo}</div>${rodape}`;
  }

  // Tradução dos resultados de portais em inglês: uma chamada para o bloco
  // inteiro; o original fica guardado para alternar sem nova chamada.
  const idDoItem = (r) => String(r.id || r.pmid);
  async function traduzirBloco(f) {
    const b = P.blocos[f];
    if (!b || b.estado !== "ok") return;
    if (b.traducao && b.traducao.estado === "ok") { b.traduzido = !b.traduzido; renderBloco(f); return; }
    if (b.traducao && b.traducao.estado === "carregando") return;
    b.traducao = { estado: "carregando" };
    renderBloco(f);
    const itens = (b.dados.resultados || []).slice(0, 10).map((r) => ({
      id: idDoItem(r), titulo: String(r.titulo || "").slice(0, 600), descricao: String(r.descricao || "").slice(0, 1200),
    }));
    let traducao;
    try {
      const res = await authFetch("/api/pesquisa/traduzir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itens }) });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(dados.traducoes)) throw new Error(dados.error || "HTTP " + res.status);
      const mapa = {};
      for (const t of dados.traducoes) mapa[t.id] = t;
      traducao = { estado: "ok", mapa };
    } catch (err) {
      console.error("[base-conhecimento] erro ao traduzir:", err);
      traducao = { estado: "erro" };
      notify("Não foi possível traduzir agora. Tente de novo.");
    }
    if (P.blocos[f] !== b) return; // nova busca ou fonte desmarcada
    b.traducao = traducao;
    b.traduzido = traducao.estado === "ok";
    renderBloco(f);
  }

  function focarBase(id) {
    const alvo = S.bases.find((b) => b.id === id);
    if (!alvo) { notify("Base não encontrada"); return; }
    P.ativa = false;
    S.tab = "bases";
    S.expandedBaseId = alvo.id;
    render();
    requestAnimationFrame(() => {
      const toggle = document.querySelector(`[data-toggle-base="${alvo.id}"]`);
      const card = toggle && toggle.closest(".cop-card");
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.add("bk-highlight");
      setTimeout(() => card.classList.remove("bk-highlight"), 1600);
    });
  }

  function render() {
    const el = document.getElementById("s-base-conhecimento"); if (!el) return;
    // O topo (com o campo de pesquisa e os blocos de resultado) é montado uma
    // vez só; render() redesenha apenas #bk-main, para não apagar o que o
    // médico está digitando nem os blocos que ainda estão carregando.
    if (!document.getElementById("bk-main")) {
      el.innerHTML = `${headerHtml()}${pesquisaShellHtml()}<div id="bk-res"></div><div id="bk-main"></div>`;
    }
    renderPesquisa();
    renderMain();
  }

  function headerHtml() {
    return `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:18px">
        <div class="cop-ico-box" style="background:linear-gradient(135deg,#a78bfa,#7c3aed)"><i class="ti ti-database"></i></div>
        <div>
          <div style="font-size:19px;font-weight:700;color:var(--n700);letter-spacing:-.3px">Base de conhecimento</div>
          <div style="font-size:12px;color:var(--n400);margin-top:2px">Alimente o Chat IA e o Assistente IA com seus próprios arquivos, textos e atalhos.</div>
        </div>
      </div>
      <div class="cop-card" style="margin-bottom:16px">
        <div class="cop-card-hd">
          <div class="cop-ico-box sm" style="background:linear-gradient(135deg,#38bdf8,#0284c7)"><i class="ti ti-info-circle"></i></div>
          <div class="cop-card-desc" style="margin-top:0">
            <strong style="color:var(--n700)">Como a IA usa isso:</strong> quando o tópico da pergunta bate com uma base ativa,
            a IA prioriza esse conteúdo e avisa que a resposta veio da sua <strong>base local</strong>. Sem base suficiente,
            ela usa conhecimento geral e avisa que <strong>não é uma base local</strong>.
          </div>
        </div>
      </div>`;
  }

  function renderMain() {
    const main = document.getElementById("bk-main"); if (!main) return;
    const header = `
      <div class="bk-tabs">
        <button class="bk-tab ${S.tab === "bases" ? "active" : ""}" data-tab="bases"><i class="ti ti-book-2"></i> Bases de conhecimento</button>
        <button class="bk-tab ${S.tab === "atalhos" ? "active" : ""}" data-tab="atalhos"><i class="ti ti-bolt"></i> Atalhos de comando</button>
      </div>`;

    let body;
    if (S.loading) {
      body = `<div class="bk-empty" style="margin-top:16px">Carregando…</div>`;
    } else if (S.tab === "bases") {
      body = `<div class="bk-wrap" style="margin-top:14px">
        ${S.bases.map(baseCardHtml).join("")}
        ${S.creatingBase ? novaBaseFormHtml() : '<button class="bk-dashed bk-wrap-full" data-newbase="1"><i class="ti ti-plus"></i> Nova base de conhecimento</button>'}
      </div>`;
    } else {
      body = `<div class="bk-wrap" style="margin-top:14px">
        ${S.atalhos.map(atalhoCardHtml).join("")}
        ${S.creatingAtalho ? novoAtalhoFormHtml() : '<button class="bk-dashed bk-wrap-full" data-newatalho="1"><i class="ti ti-plus"></i> Novo atalho de comando</button>'}
      </div>`;
    }
    main.innerHTML = header + body;
  }

  /* ---------- EVENTS ---------- */
  // Mantém S.novaBaseCampos em dia enquanto o médico digita — sem isso, um
  // render() disparado por outra ação (ex.: anexar um arquivo) reconstruiria
  // o formulário com os valores antigos do estado, perdendo o que foi digitado
  // depois. Não chama render() aqui: isso evitaria o cursor pular a cada tecla.
  document.addEventListener("input", (e) => {
    if (e.target.id === "bk-nb-nome") S.novaBaseCampos.nome = e.target.value;
    else if (e.target.id === "bk-nb-desc") S.novaBaseCampos.descricao = e.target.value;
    else if (e.target.id === "bk-nb-tags") S.novaBaseCampos.tags = e.target.value;
  });

  document.addEventListener("click", (e) => {
    const root = document.getElementById("s-base-conhecimento");
    if (!root || root.style.display === "none") return;

    if (e.target.closest("#bk-search-input")) { abrirOpcoes(true); return; }
    if (!e.target.closest("#bk-search")) abrirOpcoes(false);
    if (e.target.closest("[data-pesq-buscar]")) { pesquisar(); return; }
    if (e.target.closest("[data-pesq-fechar]")) { P.ativa = false; return render(); }
    if (e.target.closest("[data-pesq-voltar]")) {
      P.ativa = true;
      const inp = document.getElementById("bk-search-input");
      if (inp) inp.value = P.q;
      render();
      return;
    }
    const trad = e.target.closest("[data-pesq-traduzir]");
    if (trad) { traduzirBloco(trad.dataset.pesqTraduzir); return; }
    const retry = e.target.closest("[data-pesq-retry]");
    if (retry) { buscarFonte(retry.dataset.pesqRetry); return; }
    if (e.target.closest("[data-pesq-ia-mais]")) { P.iaExpandida = !P.iaExpandida; renderBloco("ia"); return; }
    const abrirBase = e.target.closest("[data-pesq-abrir-base]");
    if (abrirBase) { e.preventDefault(); focarBase(abrirBase.dataset.pesqAbrirBase); return; }
    const baseNome = e.target.closest("[data-pesq-base-nome]");
    if (baseNome) {
      const nome = baseNome.dataset.pesqBaseNome.trim().toLowerCase();
      const alvo = S.bases.find((b) => (b.nome || "").trim().toLowerCase() === nome);
      if (alvo) focarBase(alvo.id);
      return;
    }

    const tabBtn = e.target.closest("[data-tab]");
    if (tabBtn) { S.tab = tabBtn.dataset.tab; return render(); }

    const toggleBase = e.target.closest("[data-toggle-base]");
    if (toggleBase) {
      const id = toggleBase.dataset.toggleBase;
      S.expandedBaseId = S.expandedBaseId === id ? null : id;
      S.addingTextFor = null;
      return render();
    }

    const toggleAtivo = e.target.closest("[data-toggle-ativo]");
    if (toggleAtivo) { return atualizarBase(toggleAtivo.dataset.toggleAtivo, { ativo: toggleAtivo.checked }); }

    const delBase = e.target.closest("[data-del-base]");
    if (delBase) { if (confirm("Excluir esta base de conhecimento e todo o conteúdo dela?")) excluirBase(delBase.dataset.delBase); return; }

    const delItem = e.target.closest("[data-del-item]");
    if (delItem) { return excluirItem(delItem.dataset.delItem); }

    const delAtalho = e.target.closest("[data-del-atalho]");
    if (delAtalho) { if (confirm("Excluir este atalho?")) excluirAtalho(delAtalho.dataset.delAtalho); return; }

    const selIa = e.target.closest("[data-selia]");
    if (selIa) {
      selIa.classList.toggle("active");
      selIa.classList.toggle(selIa.dataset.selia === "chat_ai" ? "chat" : "assist");
      if (selIa.closest("#bk-nb-ias")) {
        S.novaBaseCampos.ias = Array.from(document.querySelectorAll("#bk-nb-ias [data-selia].active")).map((b) => b.dataset.selia);
      }
      return;
    }

    const newBase = e.target.closest("[data-newbase]");
    if (newBase) {
      S.creatingBase = true; S.novaBaseAnexos = []; S.novaBaseAddingText = false;
      S.novaBaseCampos = { nome: "", descricao: "", tags: "", ias: ["chat_ai", "assistente_ai"] };
      return render();
    }
    const cancelBase = e.target.closest("[data-cancelbase]");
    if (cancelBase) {
      S.creatingBase = false; S.novaBaseAnexos = []; S.novaBaseAddingText = false;
      S.novaBaseCampos = { nome: "", descricao: "", tags: "", ias: ["chat_ai", "assistente_ai"] };
      return render();
    }
    const saveBase = e.target.closest("[data-savebase]");
    if (saveBase) {
      const nome = S.novaBaseCampos.nome || "";
      if (!nome.trim()) { notify("Dê um nome para a base"); return; }
      const descricao = S.novaBaseCampos.descricao || "";
      const tags = (S.novaBaseCampos.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
      const ias = S.novaBaseCampos.ias && S.novaBaseCampos.ias.length ? S.novaBaseCampos.ias : ["chat_ai", "assistente_ai"];
      const anexosPendentes = S.novaBaseAnexos.slice();
      (async () => {
        let novoId;
        try {
          novoId = await criarBase({ nome: nome.trim(), descricao: descricao.trim(), tags, ias });
        } catch (err) {
          console.error("[base-conhecimento] exceção ao criar base:", err);
          notify("Erro ao criar base: " + (err && err.message ? err.message : "erro inesperado"));
          return;
        }
        if (!novoId) return; // erro já mostrado por criarBase()
        S.creatingBase = false;
        S.novaBaseAnexos = [];
        S.novaBaseAddingText = false;
        S.novaBaseCampos = { nome: "", descricao: "", tags: "", ias: ["chat_ai", "assistente_ai"] };
        await load();
        // Anexa o conteúdo que o médico já preparou antes de salvar a base —
        // cada anexo entra no mesmo fluxo de chunking de sempre
        // (adicionarItemTexto), só que agora já sabendo o base_id.
        for (const a of anexosPendentes) {
          try {
            await adicionarItemTexto(novoId, a.tipo, a.nome, a.conteudo);
          } catch (err) {
            console.error("[base-conhecimento] erro ao anexar item pendente:", err);
            notify(`Base criada, mas houve erro ao anexar "${a.nome}": ` + (err && err.message ? err.message : "erro inesperado"));
          }
        }
      })();
      return;
    }

    const delNewbaseAnexo = e.target.closest("[data-del-newbase-anexo]");
    if (delNewbaseAnexo) {
      S.novaBaseAnexos = S.novaBaseAnexos.filter((a) => a.id !== delNewbaseAnexo.dataset.delNewbaseAnexo);
      return render();
    }
    const newbaseUpload = e.target.closest("[data-newbase-upload]");
    if (newbaseUpload) { const inp = document.getElementById("bk-newbase-file"); if (inp) inp.click(); return; }
    const newbaseAddText = e.target.closest("[data-newbase-addtext]");
    if (newbaseAddText) { S.novaBaseAddingText = true; return render(); }
    const newbaseCancelText = e.target.closest("[data-newbase-canceltext]");
    if (newbaseCancelText) { S.novaBaseAddingText = false; return render(); }
    const newbaseSaveText = e.target.closest("[data-newbase-savetext]");
    if (newbaseSaveText) {
      const nome = (document.getElementById("bk-nbtext-nome") || {}).value || "";
      const conteudo = (document.getElementById("bk-nbtext-conteudo") || {}).value || "";
      if (!nome.trim() || !conteudo.trim()) { notify("Preencha título e conteúdo"); return; }
      S.novaBaseAnexos.push({ id: uid(), tipo: "texto", nome: nome.trim(), conteudo: conteudo.trim() });
      S.novaBaseAddingText = false;
      return render();
    }

    const uploadFor = e.target.closest("[data-upload-for]");
    if (uploadFor) { const inp = document.getElementById("bk-file-" + uploadFor.dataset.uploadFor); if (inp) inp.click(); return; }

    const addTextFor = e.target.closest("[data-addtext-for]");
    if (addTextFor) { S.addingTextFor = addTextFor.dataset.addtextFor; return render(); }
    const cancelText = e.target.closest("[data-canceltext]");
    if (cancelText) { S.addingTextFor = null; return render(); }
    const saveText = e.target.closest("[data-savetext-for]");
    if (saveText) {
      const nome = (document.getElementById("bk-newtext-nome") || {}).value || "";
      const conteudo = (document.getElementById("bk-newtext-conteudo") || {}).value || "";
      if (!nome.trim() || !conteudo.trim()) { notify("Preencha título e conteúdo"); return; }
      adicionarItemTexto(saveText.dataset.savetextFor, "texto", nome.trim(), conteudo.trim());
      return;
    }

    const newAtalho = e.target.closest("[data-newatalho]");
    if (newAtalho) { S.creatingAtalho = true; return render(); }
    const cancelAtalho = e.target.closest("[data-cancelatalho]");
    if (cancelAtalho) { S.creatingAtalho = false; return render(); }
    const saveAtalho = e.target.closest("[data-saveatalho]");
    if (saveAtalho) {
      const atalho = (document.getElementById("bk-na-atalho") || {}).value || "";
      const texto = (document.getElementById("bk-na-texto") || {}).value || "";
      if (!/^\/\S+$/.test(atalho.trim())) { notify("Atalho precisa começar com '/' e não ter espaços"); return; }
      if (!texto.trim()) { notify("Escreva o comando completo"); return; }
      const iasEls = document.querySelectorAll("#bk-na-ias [data-selia].active");
      const ias = Array.from(iasEls).map((b) => b.dataset.selia);
      criarAtalho({ atalho: atalho.trim(), texto_completo: texto.trim(), ias: ias.length ? ias : ["chat_ai", "assistente_ai"] });
      return;
    }
  });

  async function extrairTextoPDF(file) {
    const pdfjsLib = window.__pdfjsLib;
    if (!pdfjsLib) {
      throw new Error(
        window.__pdfjsLibErro
          ? "Leitor de PDF não carregou: " + window.__pdfjsLibErro
          : "Leitor de PDF ainda carregando, tente de novo em alguns segundos."
      );
    }
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    let texto = "";
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const linha = content.items.map((it) => it.str).join(" ");
      texto += linha + "\n\n";
    }
    return texto.trim();
  }

  // Lê um arquivo (.pdf via pdf.js, .txt/.md como texto puro) e retorna o
  // conteúdo extraído. Lança erro para formato não suportado ou PDF sem
  // texto selecionável — quem chama decide como avisar o usuário.
  async function lerArquivoComoTexto(file) {
    if (/\.pdf$/i.test(file.name)) {
      notify("Lendo PDF… isso pode levar alguns segundos");
      const texto = await extrairTextoPDF(file);
      if (!texto) throw new Error("Não consegui extrair texto desse PDF (pode ser um PDF escaneado/sem texto selecionável)");
      return texto;
    }
    if (/\.(txt|md)$/i.test(file.name)) {
      return await file.text();
    }
    throw new Error("Formatos aceitos hoje: .pdf, .txt, .md");
  }

  document.addEventListener("keydown", (e) => {
    if (e.target && e.target.id === "bk-search-input") {
      if (e.key === "Enter") { e.preventDefault(); pesquisar(); }
      else if (e.key === "Escape") abrirOpcoes(false);
    }
  });
  document.addEventListener("focusin", (e) => {
    if (e.target && e.target.id === "bk-search-input") abrirOpcoes(true);
  });

  document.addEventListener("change", (e) => {
    const fonte = e.target.closest && e.target.closest("[data-pesq-fonte]");
    if (fonte) { alternarFonte(fonte.dataset.pesqFonte, fonte.checked); if (!P.ativa) renderPesquisa(); return; }

    const nfi = e.target.closest("[data-newbase-fileinput]");
    if (nfi) {
      const file = nfi.files && nfi.files[0];
      if (!file) return;
      lerArquivoComoTexto(file)
        .then((texto) => { S.novaBaseAnexos.push({ id: uid(), tipo: "arquivo", nome: file.name, conteudo: texto }); render(); })
        .catch((err) => { console.error(err); notify(err.message || "Erro ao ler o arquivo"); })
        .finally(() => { nfi.value = ""; });
      return;
    }

    const fi = e.target.closest("[data-fileinput-for]");
    if (!fi) return;
    const baseId = fi.dataset.fileinputFor;
    const file = fi.files && fi.files[0];
    if (!file) return;
    lerArquivoComoTexto(file)
      .then((texto) => adicionarItemTexto(baseId, "arquivo", file.name, texto))
      .catch((err) => { console.error(err); notify(err.message || "Erro ao ler o arquivo"); })
      .finally(() => { fi.value = ""; });
  });

  window.initBaseConhecimento = function (focoNome) {
    if (focoNome) { S.tab = "bases"; S.pendingFocusNome = focoNome; }
    render();
    load().then(aplicarFocoPendente);
  };

  // Chamado depois que a IA (Assistente IA ou Chat IA) mostra o selo "Base
  // de conhecimento local: X" e o médico clica nele — expande e centraliza
  // a base correspondente, com um destaque rápido, pra ele achar fácil.
  function aplicarFocoPendente() {
    const nome = S.pendingFocusNome;
    if (!nome) return;
    S.pendingFocusNome = null;
    const alvo = S.bases.find((b) => (b.nome || "").trim().toLowerCase() === String(nome).trim().toLowerCase());
    if (!alvo) return;
    focarBase(alvo.id);
  }
})();
