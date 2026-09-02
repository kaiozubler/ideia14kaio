/* Painel lateral: captura o conteúdo da tela ativa (somente leitura) e conversa
   com o assistente de IA do MediCopilot, que acessa o banco do sistema. */
(() => {
  const { APP_URL, SUPABASE_URL, SUPABASE_KEY } = window.MC_CONFIG;
  const $ = (id) => document.getElementById(id);
  let history = [];
  let conversaId = null;
  let localConvId = null; // id da conversa no histórico local (chrome.storage)
  let contexto = "";

  /* ---------- captura da tela ---------- */
  function extractFromPage() {
    const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
    const campos = [];
    document.querySelectorAll("input, textarea, select").forEach((el) => {
      if (el.type === "password" || el.type === "hidden") return;
      const val = el.tagName === "SELECT" ? el.options[el.selectedIndex]?.text : el.value;
      if (!clean(val)) return;
      const label =
        el.labels?.[0]?.innerText || el.getAttribute("aria-label") || el.placeholder || el.name || el.id || "campo";
      campos.push(`${clean(label)}: ${clean(val)}`);
    });
    return {
      url: location.href,
      titulo: document.title,
      texto: clean(document.body?.innerText).slice(0, 12000),
      campos: campos.slice(0, 120),
    };
  }

  async function lerTela() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return "";
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractFromPage });
      const d = res?.result;
      if (!d) return "";
      $("ctx-info").textContent = d.titulo || d.url;
      return [
        `URL: ${d.url}`,
        `Título: ${d.titulo}`,
        d.campos.length ? `Campos preenchidos na tela:\n- ${d.campos.join("\n- ")}` : "",
        `Texto visível da página:\n${d.texto}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    } catch {
      $("ctx-info").textContent = "não disponível nesta aba";
      return "";
    }
  }

  /* ---------- render ---------- */
  // Converte o markdown simples que a IA às vezes devolve (negrito/itálico/código)
  // em HTML seguro — antes os asteriscos apareciam literalmente na bolha.
  function mdToHtml(text) {
    const esc = (text || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
    return esc
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/__([^_]+)__/g, "<strong>$1</strong>")
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
      .replace(/^\s*[-*]\s+/gm, "• ")
      .replace(/\n/g, "<br>");
  }

  function setBubbleText(el, text) {
    el.innerHTML = mdToHtml(text);
  }

  function bubble(role, text) {
    const div = document.createElement("div");
    div.className = "bubble " + (role === "user" ? "me" : "ia");
    setBubbleText(div, text);
    $("msgs").appendChild(div);
    $("msgs").scrollTop = $("msgs").scrollHeight;
    return div;
  }

  function reset() {
    history = [];
    conversaId = null;
    localConvId = null;
    $("msgs").innerHTML = "";
    if (dgMic.active || dgMic.starting) dgMic.stop();
    bubble("assistant", "Como posso ajudar? Posso analisar o que está na tela e agir no seu MediCopilot.");
  }

  /* ---------- textarea expansível (até 5 linhas, depois rola/corta) ---------- */
  const MAX_TEXTAREA_LINES = 5;
  function autoResizeComposer() {
    const el = $("ch-inp");
    if (!el) return;
    const cs = getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 18;
    const paddingV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    // box-sizing é border-box: a altura definida via style.height precisa incluir a borda,
    // mas scrollHeight NUNCA inclui a borda — por isso somamos borderV de volta, senão o
    // texto da última linha visível fica cortado por ~2px.
    const borderV = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const minHeight = Math.round(lineHeight + paddingV + borderV);
    const maxHeight = Math.round(lineHeight * MAX_TEXTAREA_LINES + paddingV + borderV);
    el.style.height = "auto";
    const contentHeight = el.scrollHeight + borderV;
    const next = Math.max(minHeight, Math.min(contentHeight, maxHeight));
    el.style.height = next + "px";
    el.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }

  // Envia o conteúdo atual do campo (usado pelo submit do form e pelo atalho Enter).
  function submitComposer() {
    const el = $("ch-inp");
    const v = el.value.trim();
    if (!v) return;
    el.value = "";
    autoResizeComposer();
    send(v);
  }

  // Botões flutuantes de sugestão (iguais aos do Assistente IA do app principal):
  // preenchem o campo com o prompt e enviam direto, sem exigir digitação.
  function quickPrompt(text) {
    $("ch-inp").value = text;
    autoResizeComposer();
    submitComposer();
  }

  /* ---------- anexos gerados pela IA (receita, exames, anamnese) ---------- */
  function escHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  }

  function attachmentCard(kind, title, subtitle, buttons) {
    const div = document.createElement("div");
    div.className = "bubble ia attachment";
    const head = document.createElement("div");
    head.className = "attachment-head";
    head.innerHTML = `<span class="attachment-icon">${kind}</span><div><div class="attachment-title">${escHtml(title)}</div><div class="attachment-sub">${escHtml(subtitle)}</div></div>`;
    div.appendChild(head);
    const row = document.createElement("div");
    row.className = "attachment-actions";
    buttons.forEach((b) => {
      const btn = document.createElement("button");
      btn.className = "attachment-btn";
      btn.textContent = b.label;
      btn.onclick = b.onClick;
      row.appendChild(btn);
    });
    div.appendChild(row);
    $("msgs").appendChild(div);
    $("msgs").scrollTop = $("msgs").scrollHeight;
    return div;
  }

  function openHtmlDoc(html) {
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Como openHtmlDoc, mas devolve a URL em vez de abrir — usado como alternativa
  // (fallback client-side) quando ainda não há um PDF real anexado ao documento.
  async function urlFor(buildHtml) {
    const html = await buildHtml();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return url;
  }

  async function docHeader(titulo) {
    const perfil = await MC_AUTH.profile();
    const meta = perfil?.user_metadata || {};
    const doctorName = meta.full_name || meta.name || (perfil?.email || "").split("@")[0] || "Médico responsável";
    const doctorCrm = meta.crm || meta.CRM || "";
    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0369a1;padding-bottom:10px;margin-bottom:18px;">
        <div>
          <div style="font-size:19px;font-weight:700;color:#0f172a;">${escHtml(titulo)}</div>
          <div style="font-size:12px;color:#64748b;">Emitido em ${escHtml(new Date().toLocaleString("pt-BR"))}</div>
        </div>
        <div style="text-align:right;font-size:12px;color:#334155;">
          <div style="font-weight:600;">${escHtml(doctorName)}</div>
          ${doctorCrm ? `<div>CRM ${escHtml(doctorCrm)}</div>` : ""}
        </div>
      </div>`;
  }

  function docBase(bodyHtml) {
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Documento — MediCopilot</title>
      <style>
        body{font:14px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif;color:#0f172a;max-width:720px;margin:32px auto;padding:0 20px;}
        .field{margin-bottom:14px;}
        .field b{display:block;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.03em;}
        .rx-item{border-bottom:1px solid #e2e8f0;padding:10px 0;}
        .rx-item b{font-size:15px;color:#0f172a;text-transform:none;letter-spacing:0;}
        .muted{color:#64748b;}
        @media print{body{margin:0;}}
      </style></head><body>${bodyHtml}
      <p class="muted" style="margin-top:28px;font-size:11px;">Documento gerado pelo assistente do MediCopilot a partir da extensão de navegador.</p>
      </body></html>`;
  }

  async function buildReceitaDoc(a) {
    const itens = (a.medicamentos || [])
      .map(
        (m, i) =>
          `<div class="rx-item"><b>${i + 1}. ${escHtml(m.nome)}${m.apresentacao ? " — " + escHtml(m.apresentacao) : ""}</b>` +
          `<div>${escHtml([m.quantidade, m.posologia].filter(Boolean).join(" — ") || "—")}</div></div>`,
      )
      .join("");
    const header = await docHeader("Receita médica");
    return docBase(
      header +
        `<div class="field"><b>Paciente</b>${escHtml(a.paciente_nome || "—")}</div>` +
        `<div class="field"><b>CPF</b>${escHtml(a.paciente_cpf || "—")} &nbsp; <b style="display:inline">Idade</b> ${escHtml(a.paciente_idade ?? "—")}</div>` +
        `<div class="field"><b>Prescrição</b>${itens || "<i>Nenhum medicamento informado.</i>"}</div>`,
    );
  }

  async function buildExameDoc(a) {
    const itens = (a.exames || [])
      .map((e, i) => `<div class="rx-item"><b>${i + 1}. ${escHtml(e.nome)}</b>${e.instrucoes ? `<div>${escHtml(e.instrucoes)}</div>` : ""}</div>`)
      .join("");
    const header = await docHeader("Solicitação de exames");
    return docBase(
      header +
        `<div class="field"><b>Paciente</b>${escHtml(a.paciente_nome || "—")}</div>` +
        `<div class="field"><b>CPF</b>${escHtml(a.paciente_cpf || "—")} &nbsp; <b style="display:inline">Idade</b> ${escHtml(a.paciente_idade ?? "—")}</div>` +
        `<div class="field"><b>Caráter</b>${a.carater === "urgente" ? "Urgente" : "Eletivo"}${a.jejum ? " · Jejum necessário" : ""}</div>` +
        (a.indicacao_clinica ? `<div class="field"><b>Indicação clínica</b>${escHtml(a.indicacao_clinica)}</div>` : "") +
        (a.cid ? `<div class="field"><b>CID</b>${escHtml(a.cid)} ${escHtml(a.cid_descricao || "")}</div>` : "") +
        `<div class="field"><b>Exames solicitados</b>${itens || "<i>Nenhum exame informado.</i>"}</div>` +
        (a.preparo ? `<div class="field"><b>Preparo</b>${escHtml(a.preparo)}</div>` : "") +
        (a.observacoes ? `<div class="field"><b>Observações</b>${escHtml(a.observacoes)}</div>` : ""),
    );
  }

  async function buildAnamneseDoc(a) {
    const header = await docHeader("Anamnese — " + (a.modelo_usado || ""));
    return docBase(header + `<div class="field" style="white-space:pre-wrap;">${escHtml(a.texto || "")}</div>`);
  }

  async function buildAtestadoDoc(a) {
    const label = a.tipo === "declaracao" ? "Declaração de comparecimento" : "Atestado médico";
    const header = await docHeader(label);
    const corpo =
      a.tipo === "declaracao"
        ? `Declaro, para os devidos fins, que o(a) paciente <b>${escHtml(a.paciente_nome || "—")}</b> esteve sob meus cuidados profissionais nesta data.`
        : `Atesto que o(a) paciente <b>${escHtml(a.paciente_nome || "—")}</b> necessita de afastamento de suas atividades por <b>${escHtml(a.dias ?? "—")}</b> dia(s)${a.cid ? ", CID " + escHtml(a.cid) : ""}.`;
    return docBase(
      header +
        `<div class="field" style="font-size:15px;line-height:1.7;">${corpo}</div>` +
        (a.observacao ? `<div class="field"><b>Observações</b>${escHtml(a.observacao)}</div>` : ""),
    );
  }

  async function getSignedFileUrl(path) {
    if (!path) return null;
    try {
      const token = await MC_AUTH.token();
      if (!token) return null;
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documentos-arquivos/${encodeURIComponent(path)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ expiresIn: 300 }),
      });
      if (!r.ok) return null;
      const data = await r.json();
      if (!data.signedURL) return null;
      return `${SUPABASE_URL}/storage/v1${data.signedURL}`;
    } catch {
      return null;
    }
  }

  async function handleAction(action) {
    if (!action || !action.type) return;
    if (action.type === "gerar_receita") {
      const nome = "Receita — " + (action.paciente_nome || "paciente");
      const signed = await getSignedFileUrl(action.arquivo_path);
      attachmentCard("💊", nome, signed ? "PDF pronto — toque para abrir" : "Toque para abrir e imprimir/salvar como PDF", [
        { label: signed ? "Abrir PDF" : "Abrir receita", onClick: async () => window.open(signed || (await urlFor(() => buildReceitaDoc(action))), "_blank") },
      ]);
    } else if (action.type === "gerar_solicitacao_exame") {
      const nome = "Solicitação de exames — " + (action.paciente_nome || "paciente");
      const signed = await getSignedFileUrl(action.arquivo_path);
      attachmentCard("🧪", nome, signed ? "PDF pronto — toque para abrir" : "Toque para abrir e imprimir/salvar como PDF", [
        { label: signed ? "Abrir PDF" : "Abrir solicitação", onClick: async () => window.open(signed || (await urlFor(() => buildExameDoc(action))), "_blank") },
      ]);
    } else if (action.type === "gerar_atestado") {
      const label = action.tipo === "declaracao" ? "Declaração" : "Atestado";
      const nome = label + " — " + (action.paciente_nome || "paciente");
      const signed = await getSignedFileUrl(action.arquivo_path);
      attachmentCard(action.tipo === "declaracao" ? "📄" : "🩹", nome, signed ? "PDF pronto — toque para abrir" : "Toque para abrir e imprimir/salvar como PDF", [
        { label: signed ? "Abrir PDF" : "Abrir " + label.toLowerCase(), onClick: async () => window.open(signed || (await urlFor(() => buildAtestadoDoc(action))), "_blank") },
      ]);
    } else if (action.type === "gerar_anamnese") {
      attachmentCard("📋", "Anamnese — " + (action.modelo_usado || ""), "Toque para abrir/imprimir ou copiar o texto", [
        { label: "Abrir", onClick: async () => openHtmlDoc(await buildAnamneseDoc(action)) },
        {
          label: "Copiar texto",
          onClick: async (ev) => {
            try {
              await navigator.clipboard.writeText(action.texto || "");
              const btn = ev.target;
              const old = btn.textContent;
              btn.textContent = "Copiado!";
              setTimeout(() => (btn.textContent = old), 1500);
            } catch {}
          },
        },
      ]);
    } else if (action.type === "criar_atendimento") {
      attachmentCard("🩺", "Novo atendimento criado", (action.paciente_nome || "paciente") + " — rascunho pronto no MediCopilot.", []);
    } else if (action.type === "salvar_anamnese_atendimento") {
      attachmentCard("✅", "Anamnese salva no cadastro", (action.paciente_nome || "paciente") + " — atendimento concluído registrado.", []);
    }
  }

  /* ---------- microfone (transcrição ao vivo via Deepgram) ----------
     Usa exatamente o mesmo fluxo de token/websocket do app principal
     (endpoint /api/deepgram-token), só que pela rota espelho pública da
     extensão (/api/public/extensao/deepgram-token), que exige o Bearer
     token da sessão por rodar em outra origem. */
    /* O Chrome não exibe o pedido de permissão de microfone dentro do painel
     lateral — ele descarta na hora ("Permission dismissed"). Quando isso
     acontece, abrimos uma aba da própria extensão só para o médico conceder
     a permissão uma vez; depois o painel passa a capturar normalmente. */
  async function getMicStream() {
    const constraints = { audio: { echoCancellation: true, noiseSuppression: true } };
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      const name = e?.name || "";
      const msg = String(e?.message || e);
      const needsPrompt =
        name === "NotAllowedError" || /dismissed|denied|permission/i.test(msg);
      if (!needsPrompt) throw e;
      try {
        chrome.tabs.create({ url: chrome.runtime.getURL("mic-permission.html") });
      } catch {}
      throw new Error(
        "Abrimos uma aba para você autorizar o microfone. Clique em Permitir e depois toque no microfone novamente.",
      );
    }
  }

  const dgMic = {
    ws: null,
    mediaRecorder: null,
    stream: null,
    keepAliveTimer: null,
    starting: false,
    active: false,
    baseText: "",

    async fetchToken() {
      const token = await MC_AUTH.token();
      if (!token) throw new Error("Sessão expirada. Entre novamente.");
      const r = await fetch(`${APP_URL}/api/public/extensao/deepgram-token`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error("Token error " + r.status + ": " + (await r.text()));
      return r.json();
    },

    async start() {
      if (this.starting || this.active) return;
      this.starting = true;
      const btn = $("ch-mic");
      const status = $("ch-mic-status");
      try {
        const inp = $("ch-inp");
        this.baseText = inp.value ? inp.value.trim() + " " : "";
        const tk = await this.fetchToken();
        const access_token = tk.access_token;
        const subproto = tk.mode === "grant" ? "bearer" : "token";
        const stream = await getMicStream();
        this.stream = stream;
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "audio/mp4";
        const rec = new MediaRecorder(stream, { mimeType: mime });
        this.mediaRecorder = rec;
        const params = new URLSearchParams({
          model: "nova-2",
          language: "pt-BR",
          smart_format: "true",
          interim_results: "true",
          punctuate: "true",
          endpointing: "300",
          vad_events: "true",
        });
        const ws = new WebSocket("wss://api.deepgram.com/v1/listen?" + params.toString(), [subproto, access_token]);
        this.ws = ws;
        await new Promise((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = () => reject(new Error("WebSocket erro (" + subproto + ")"));
          setTimeout(() => reject(new Error("WebSocket timeout")), 7000);
        });
        ws.onmessage = (ev) => {
          let msg;
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (msg.type !== "Results") return;
          const alt = msg.channel && msg.channel.alternatives && msg.channel.alternatives[0];
          const text = (alt && alt.transcript) || "";
          if (!text.trim()) return;
          if (msg.is_final) {
            this.baseText = (this.baseText + text).trim() + " ";
            inp.value = this.baseText;
          } else {
            inp.value = (this.baseText + text).trim();
          }
          autoResizeComposer();
        };
        ws.onclose = () => this.cleanup();
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0 && ws.readyState === 1) ws.send(e.data);
        };
        rec.start(250);
        this.keepAliveTimer = setInterval(() => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: "KeepAlive" }));
        }, 8000);
        this.active = true;
        if (btn) btn.classList.add("recording");
        if (status) {
          status.textContent = "Gravando… criando novo atendimento.";
          status.classList.remove("hidden");
        }
        // Clicar no microfone também inicia um novo Atendimento: pedimos isso
        // ao assistente de IA, que identifica o paciente pelo contexto da tela
        // (ou pergunta, se necessário) e chama a tool criar_atendimento.
        send("Inicie um novo atendimento agora para o paciente desta tela.");
      } catch (e) {
        this.cleanup();
        if (status) {
          status.textContent = "Erro no microfone: " + (e?.message || e);
          status.classList.remove("hidden");
        }
      } finally {
        this.starting = false;
      }
    },

    async stop() {
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      try {
        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop();
      } catch {}
      try {
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ type: "CloseStream" }));
          await new Promise((r) => setTimeout(r, 250));
          this.ws.close();
        }
      } catch {}
      this.cleanup();
    },

    cleanup() {
      if (this.stream) {
        this.stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
        this.stream = null;
      }
      this.mediaRecorder = null;
      this.ws = null;
      this.active = false;
      const btn = $("ch-mic");
      if (btn) btn.classList.remove("recording");
      const status = $("ch-mic-status");
      if (status) status.classList.add("hidden");
    },

    toggle() {
      if (this.active || this.starting) this.stop();
      else this.start();
    },
  };

  /* ---------- envio ---------- */
  async function send(text) {
    const token = await MC_AUTH.token();
    if (!token) return showAuth("Sessão expirada. Entre novamente.");
    bubble("user", text);
    history.push({ role: "user", content: text });
    const pending = bubble("assistant", "Analisando…");
    await persistirHistorico();
    contexto = await lerTela();
    try {
      const res = await fetch(`${APP_URL}/api/public/extensao/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: history, conversa_id: conversaId, contexto_tela: contexto }),
      });
      if (res.status === 401) {
        await MC_AUTH.clear();
        return showAuth("Sessão expirada. Entre novamente.");
      }
      const ctype = res.headers.get("content-type") || "";
      if (!ctype.includes("application/json")) {
        setBubbleText(
          pending,
          "O endpoint do assistente ainda não está disponível na versão publicada do app (" +
            APP_URL +
            "). Publique a última versão do MediCopilot e tente novamente.",
        );
        history.pop();
        return;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha na requisição");
      conversaId = data.conversa_id || conversaId;
      const reply = (data.reply || "").trim() || "Não consegui responder agora.";
      setBubbleText(pending, reply);
      history.push({ role: "assistant", content: reply });
      await persistirHistorico();
      await handleAction(data.action);
    } catch (e) {
      setBubbleText(pending, "Erro ao falar com o assistente: " + (e?.message || e));
    }
  }

  /* ---------- histórico de conversas ---------- */
  async function persistirHistorico() {
    try {
      localConvId = await MC_HISTORY.salvar(localConvId, history, conversaId);
    } catch {}
  }

  function tempoRelativo(ts) {
    const d = Date.now() - (ts || 0);
    const min = Math.floor(d / 60000);
    if (min < 1) return "agora mesmo";
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(d / 3600000);
    if (h < 24) return `há ${h}h`;
    return `há ${Math.floor(d / 86400000)}d`;
  }

  function abrirConversa(conv) {
    if (dgMic.active || dgMic.starting) dgMic.stop();
    localConvId = conv.id;
    conversaId = conv.conversaId || null;
    history = (conv.messages || []).map((m) => ({ role: m.role, content: m.content }));
    $("msgs").innerHTML = "";
    history.forEach((m) => bubble(m.role, m.content));
    fecharHistorico();
  }

  function renderHistorico(lista) {
    const ul = $("hist-list");
    ul.innerHTML = "";
    $("hist-empty").classList.toggle("hidden", lista.length > 0);
    lista.forEach((conv) => {
      const li = document.createElement("li");
      li.className = "hist-item" + (conv.id === localConvId ? " atual" : "");

      const main = document.createElement("div");
      main.className = "hist-item-main";
      const t = document.createElement("div");
      t.className = "hist-item-title";
      t.textContent = conv.titulo || "Conversa";
      const meta = document.createElement("div");
      meta.className = "hist-item-meta";
      meta.textContent = tempoRelativo(conv.updatedAt) + (conv.favorito ? " • favorita" : "");
      main.appendChild(t);
      main.appendChild(meta);
      main.onclick = () => abrirConversa(conv);

      const fav = document.createElement("button");
      fav.className = "hist-act" + (conv.favorito ? " fav" : "");
      fav.title = conv.favorito ? "Remover dos favoritos" : "Favoritar (não expira)";
      fav.textContent = conv.favorito ? "★" : "☆";
      fav.onclick = async (e) => {
        e.stopPropagation();
        await MC_HISTORY.favoritar(conv.id, !conv.favorito);
        abrirHistorico();
      };

      const del = document.createElement("button");
      del.className = "hist-act";
      del.title = "Excluir conversa";
      del.textContent = "🗑";
      del.onclick = async (e) => {
        e.stopPropagation();
        await MC_HISTORY.excluir(conv.id);
        if (conv.id === localConvId) reset();
        abrirHistorico();
      };

      li.appendChild(main);
      li.appendChild(fav);
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  async function abrirHistorico() {
    renderHistorico(await MC_HISTORY.listar());
    $("hist").classList.remove("hidden");
  }

  function fecharHistorico() {
    $("hist").classList.add("hidden");
  }

  /* ---------- telas ---------- */
  function showAuth(msg) {
    fecharHistorico();
    $("chat").classList.add("hidden");
    $("auth").classList.remove("hidden");
    $("au-msg").textContent = msg || "";
  }
  async function showChat() {
    $("auth").classList.add("hidden");
    $("chat").classList.remove("hidden");
    try {
      await MC_HISTORY.expurgar();
    } catch {}
    reset();
    contexto = await lerTela();
  }

  /* ---------- eventos ---------- */
  $("au-btn").onclick = async () => {
    const email = $("au-email").value.trim();
    const pass = $("au-pass").value;
    if (!email || !pass) return ($("au-msg").textContent = "Informe e-mail e senha.");
    $("au-btn").disabled = true;
    $("au-msg").textContent = "";
    try {
      await MC_AUTH.signIn(email, pass);
      $("au-pass").value = "";
      await showChat();
    } catch (e) {
      $("au-msg").textContent = e?.message || "Não foi possível entrar.";
    } finally {
      $("au-btn").disabled = false;
    }
  };
  $("au-pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("au-btn").click();
  });
  $("ch-hist").onclick = abrirHistorico;
  $("hist-close").onclick = fecharHistorico;
  $("hist-clear").onclick = async () => {
    if (!confirm("Apagar todo o histórico de conversas?")) return;
    await MC_HISTORY.limparTudo();
    renderHistorico([]);
  };
  $("ch-new").onclick = () => {
    fecharHistorico();
    reset();
  };
  $("ch-out").onclick = async () => {
    if (dgMic.active || dgMic.starting) await dgMic.stop();
    await MC_AUTH.clear();
    showAuth("Você saiu da extensão.");
  };
  $("ch-mic").onclick = () => dgMic.toggle();
  $("ch-chips").querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => quickPrompt(btn.dataset.prompt));
  });
  $("ch-inp").addEventListener("input", autoResizeComposer);
  $("ch-inp").addEventListener("keydown", (e) => {
    // Enter envia; Shift+Enter quebra linha — comportamento usual de chat.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitComposer();
    }
  });
  $("ch-form").addEventListener("submit", (e) => {
    e.preventDefault();
    submitComposer();
  });
  chrome.tabs.onActivated.addListener(() => lerTela());

  autoResizeComposer();

  (async () => {
    const token = await MC_AUTH.token();
    if (token) await showChat();
    else showAuth();
  })();
})();