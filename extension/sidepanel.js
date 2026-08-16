/* Painel lateral: captura o conteúdo da tela ativa (somente leitura) e conversa
   com o assistente de IA do MediCopilot, que acessa o banco do sistema. */
(() => {
  const { APP_URL } = window.MC_CONFIG;
  const $ = (id) => document.getElementById(id);
  let history = [];
  let conversaId = null;
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
    const borderV = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const maxHeight = Math.round(lineHeight * MAX_TEXTAREA_LINES + paddingV + borderV);
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = next + "px";
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  /* ---------- microfone (transcrição ao vivo via Deepgram) ----------
     Usa exatamente o mesmo fluxo de token/websocket do app principal
     (endpoint /api/deepgram-token), só que pela rota espelho pública da
     extensão (/api/public/extensao/deepgram-token), que exige o Bearer
     token da sessão por rodar em outra origem. */
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
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
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
    } catch (e) {
      setBubbleText(pending, "Erro ao falar com o assistente: " + (e?.message || e));
    }
  }

  /* ---------- telas ---------- */
  function showAuth(msg) {
    $("chat").classList.add("hidden");
    $("auth").classList.remove("hidden");
    $("au-msg").textContent = msg || "";
  }
  async function showChat() {
    $("auth").classList.add("hidden");
    $("chat").classList.remove("hidden");
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
  $("ch-new").onclick = reset;
  $("ch-out").onclick = async () => {
    if (dgMic.active || dgMic.starting) await dgMic.stop();
    await MC_AUTH.clear();
    showAuth("Você saiu da extensão.");
  };
  $("ch-mic").onclick = () => dgMic.toggle();
  $("ch-inp").addEventListener("input", autoResizeComposer);
  $("ch-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("ch-inp").value.trim();
    if (!v) return;
    $("ch-inp").value = "";
    autoResizeComposer();
    send(v);
  });
  chrome.tabs.onActivated.addListener(() => lerTela());

  autoResizeComposer();

  (async () => {
    const token = await MC_AUTH.token();
    if (token) await showChat();
    else showAuth();
  })();
})();