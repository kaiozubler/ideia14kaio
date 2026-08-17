// Sessão da extensão: login por e-mail/senha no backend do app, refresh automático
// e reautenticação obrigatória a cada 30 dias.
const MC_AUTH = (() => {
  const { SUPABASE_URL, SUPABASE_KEY, REAUTH_DAYS } = window.MC_CONFIG;
  const KEY = "mc_session";

  async function read() {
    const out = await chrome.storage.local.get(KEY);
    return out[KEY] || null;
  }
  async function write(s) {
    await chrome.storage.local.set({ [KEY]: s });
  }
  async function clear() {
    await chrome.storage.local.remove(KEY);
  }

  function expiredReauth(s) {
    const maxAge = REAUTH_DAYS * 24 * 60 * 60 * 1000;
    return !s.authAt || Date.now() - s.authAt > maxAge;
  }

  async function post(path, body, extraHeaders) {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_KEY, ...(extraHeaders || {}) },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error_description || data.msg || data.error || "Falha na autenticação");
    return data;
  }

  async function signIn(email, password) {
    const data = await post("token?grant_type=password", { email, password });
    const s = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      email: data.user?.email || email,
      user_metadata: data.user?.user_metadata || {},
      authAt: Date.now(),
    };
    await write(s);
    return s;
  }

  async function refresh(s) {
    const data = await post("token?grant_type=refresh_token", { refresh_token: s.refresh_token });
    const next = {
      ...s,
      access_token: data.access_token,
      refresh_token: data.refresh_token || s.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user_metadata: data.user?.user_metadata || s.user_metadata || {},
    };
    await write(next);
    return next;
  }

  // Devolve { email, user_metadata } da sessão salva (sem validar/renovar o token).
  async function profile() {
    const s = await read();
    if (!s) return null;
    return { email: s.email, user_metadata: s.user_metadata || {} };
  }

  // Devolve um access_token válido ou null (quando é preciso autenticar de novo).
  async function token() {
    let s = await read();
    if (!s || expiredReauth(s)) {
      if (s) await clear();
      return null;
    }
    if (s.expires_at - 60000 < Date.now()) {
      try {
        s = await refresh(s);
      } catch {
        await clear();
        return null;
      }
    }
    return s.access_token;
  }

  return { signIn, token, read, clear, profile };
})();