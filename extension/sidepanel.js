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
  function bubble(role, text) {
    const div = document.createElement("div");
    div.className = "bubble " + (role === "user" ? "me" : "ia");
    div.textContent = text;
    $("msgs").appendChild(div);
    $("msgs").scrollTop = $("msgs").scrollHeight;
    return div;
  }

  function reset() {
    history = [];
    conversaId = null;
    $("msgs").innerHTML = "";
    bubble("assistant", "Como posso ajudar? Posso analisar o que está na tela e agir no seu MediCopilot.");
  }

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
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      conversaId = data.conversa_id || conversaId;
      const reply = (data.reply || "").trim() || "Não consegui responder agora.";
      pending.textContent = reply;
      history.push({ role: "assistant", content: reply });
    } catch (e) {
      pending.textContent = "Erro ao falar com o assistente: " + (e?.message || e);
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
    await MC_AUTH.clear();
    showAuth("Você saiu da extensão.");
  };
  $("ch-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("ch-inp").value.trim();
    if (!v) return;
    $("ch-inp").value = "";
    send(v);
  });
  chrome.tabs.onActivated.addListener(() => lerTela());

  (async () => {
    const token = await MC_AUTH.token();
    if (token) await showChat();
    else showAuth();
  })();
})();