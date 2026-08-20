/* Histórico de conversas da extensão.
   Espelha o comportamento do Assistente IA do app: conversas ficam 7 dias e
   as favoritadas não expiram. Aqui o armazenamento é chrome.storage.local,
   guardando também o conversa_id do backend para continuar a mesma thread. */
const MC_HISTORY = (() => {
  const KEY = "mc_conversas";
  const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
  const MAX_CONVERSAS = 60;

  function novoId() {
    return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function derivarTitulo(mensagens) {
    const primeira = (mensagens || []).find((m) => m.role === "user");
    if (!primeira) return "Nova conversa";
    const t = (primeira.content || "").trim().replace(/\s+/g, " ");
    return t.length > 60 ? t.slice(0, 60) + "…" : t || "Nova conversa";
  }

  function limpar(lista) {
    const agora = Date.now();
    return (lista || [])
      .filter((c) => c && Array.isArray(c.messages) && c.messages.length)
      .filter((c) => c.favorito || agora - (c.updatedAt || 0) < RETENTION_MS)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, MAX_CONVERSAS);
  }

  async function gravar(lista) {
    await chrome.storage.local.set({ [KEY]: lista });
  }

  async function listar() {
    const out = await chrome.storage.local.get(KEY);
    return limpar(out[KEY] || []);
  }

  // Cria ou atualiza a conversa e devolve o id local.
  async function salvar(localId, mensagens, conversaId) {
    if (!mensagens || !mensagens.length) return localId || null;
    const lista = await listar();
    const agora = Date.now();
    const idx = localId ? lista.findIndex((c) => c.id === localId) : -1;
    if (idx !== -1) {
      lista[idx] = {
        ...lista[idx],
        messages: mensagens,
        conversaId: conversaId || lista[idx].conversaId || null,
        titulo: derivarTitulo(mensagens),
        updatedAt: agora,
      };
      await gravar(limpar(lista));
      return lista[idx].id;
    }
    const nova = {
      id: novoId(),
      titulo: derivarTitulo(mensagens),
      createdAt: agora,
      updatedAt: agora,
      favorito: false,
      conversaId: conversaId || null,
      messages: mensagens,
    };
    await gravar(limpar([nova, ...lista]));
    return nova.id;
  }

  async function favoritar(localId, favorito) {
    const lista = await listar();
    const idx = lista.findIndex((c) => c.id === localId);
    if (idx === -1) return;
    lista[idx].favorito = !!favorito;
    await gravar(limpar(lista));
  }

  async function excluir(localId) {
    const lista = await listar();
    await gravar(lista.filter((c) => c.id !== localId));
  }

  async function limparTudo() {
    await chrome.storage.local.set({ [KEY]: [] });
  }

  // Regrava a lista já filtrada, removendo o que expirou.
  async function expurgar() {
    await gravar(await listar());
  }

  return { listar, salvar, favoritar, excluir, limparTudo, expurgar };
})();
