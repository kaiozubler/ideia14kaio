/* Estabelecimentos CNES do LME (Minha clínica › Estabelecimentos para LME).
   O campo 1 do LME pede o CNES do estabelecimento solicitante; consultório sem
   CNES próprio emite pelo estabelecimento público onde o médico atende. Fica um
   cadastro por clínica (`lme_estabelecimentos`) com um padrão, que o modal do
   LME lê em vez de pedir o número a cada emissão. A consulta ao CNES passa por
   /api/cnes (dados abertos do Ministério da Saúde) e só sugere — o médico salva. */
(function () {
  "use strict";

  let cache = null;
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const so7 = (v) => String(v || "").replace(/\D/g, "").slice(0, 7);
  const toast = (m, t) => {
    if (typeof window.showToast === "function") window.showToast(m, t);
  };
  // currentUser é um `let` do medicopilot.html (não fica em window): lê da sessão.
  async function uid() {
    try {
      const { data } = await window.sb.auth.getSession();
      return (data && data.session && data.session.user && data.session.user.id) || null;
    } catch (e) {
      return null;
    }
  }

  async function listar(force) {
    if (cache && !force) return cache;
    if (!window.sb || !(await uid())) return [];
    const { data, error } = await window.sb
      .from("lme_estabelecimentos")
      .select("id,cnes,nome,municipio,uf,tipo,padrao")
      .order("padrao", { ascending: false })
      .order("nome");
    if (error) {
      console.warn("[lme-estab] listar", error.message);
      return cache || [];
    }
    cache = data || [];
    return cache;
  }

  async function padrao() {
    const rows = await listar();
    return rows.find((r) => r.padrao) || (rows.length === 1 ? rows[0] : null);
  }

  async function consultar(cnes) {
    const c = so7(cnes);
    if (c.length !== 7) return null;
    try {
      const f = typeof window.iaAuthFetch === "function" ? window.iaAuthFetch : fetch;
      const r = await f("/api/cnes?codigo=" + c);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  async function salvar(dados) {
    const cnes = so7(dados.cnes);
    const nome = String(dados.nome || "").trim();
    if (cnes.length !== 7) throw new Error("O CNES tem 7 dígitos.");
    if (!nome) throw new Error("Informe o nome do estabelecimento.");
    const user_id = await uid();
    if (!user_id) throw new Error("Sessão expirada.");
    const atuais = await listar();
    const marcarPadrao = !!dados.padrao || !atuais.length;
    if (marcarPadrao) {
      // Índice único parcial: só um padrão por clínica, então limpa antes.
      const { error } = await window.sb.from("lme_estabelecimentos").update({ padrao: false }).eq("user_id", user_id).eq("padrao", true);
      if (error) throw new Error(error.message);
    }
    const uf = String(dados.uf || "").trim().toUpperCase().slice(0, 2);
    const { data, error } = await window.sb
      .from("lme_estabelecimentos")
      .upsert(
        {
          user_id,
          cnes,
          nome,
          municipio: String(dados.municipio || "").trim() || null,
          uf: /^[A-Z]{2}$/.test(uf) ? uf : null,
          tipo: dados.tipo === "proprio" ? "proprio" : "publico",
          padrao: marcarPadrao,
        },
        { onConflict: "user_id,cnes" },
      )
      .select("id,cnes,nome,municipio,uf,tipo,padrao")
      .single();
    if (error) throw new Error(error.message);
    await listar(true);
    return data;
  }

  async function definirPadrao(id) {
    const user_id = await uid();
    await window.sb.from("lme_estabelecimentos").update({ padrao: false }).eq("user_id", user_id).eq("padrao", true);
    const { error } = await window.sb.from("lme_estabelecimentos").update({ padrao: true }).eq("id", id);
    if (error) toast("Não foi possível definir o padrão: " + error.message, "error");
    await listar(true);
    renderMinhaClinica();
  }

  async function remover(id) {
    if (!confirm("Remover este estabelecimento do cadastro? LMEs já emitidos não mudam.")) return;
    const { error } = await window.sb.from("lme_estabelecimentos").delete().eq("id", id);
    if (error) return toast("Não foi possível remover: " + error.message, "error");
    await listar(true);
    renderMinhaClinica();
  }

  /* ---------- Minha clínica ---------- */
  async function renderMinhaClinica() {
    const box = document.getElementById("cli-lme-estab-list");
    if (!box) return;
    const rows = await listar(true);
    if (!rows.length) {
      box.innerHTML =
        '<div style="border:1px dashed var(--n200);border-radius:10px;padding:12px;font-size:12px;color:var(--n400);text-align:center">Nenhum estabelecimento cadastrado. O LME vai pedir o CNES na hora da emissão.</div>';
      return;
    }
    box.innerHTML = rows
      .map(
        (r) => `
      <div style="display:flex;align-items:center;gap:10px;border:0.5px solid var(--n200);border-radius:10px;padding:8px 10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:600;color:var(--n700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.nome)}</div>
          <div style="font-size:11px;color:var(--n400)">CNES ${esc(r.cnes)}${r.municipio || r.uf ? " · " + esc([r.municipio, r.uf].filter(Boolean).join("/")) : ""} · ${r.tipo === "proprio" ? "Próprio da clínica" : "Público (SUS)"}</div>
        </div>
        ${
          r.padrao
            ? '<span style="font-size:10.5px;font-weight:600;padding:3px 8px;border-radius:999px;background:#ecfdf5;color:#047857">Padrão</span>'
            : `<button class="btn sm ghost" onclick="LmeEstab.definirPadrao('${r.id}')">Tornar padrão</button>`
        }
        <button class="btn sm" onclick="LmeEstab.remover('${r.id}')" title="Remover"><i class="ti ti-trash"></i></button>
      </div>`,
      )
      .join("");
  }

  async function buscarNoFormulario(prefixo) {
    const cnesEl = document.getElementById(prefixo + "-cnes");
    const st = document.getElementById(prefixo + "-status");
    if (!cnesEl) return;
    cnesEl.value = so7(cnesEl.value);
    if (cnesEl.value.length !== 7) {
      if (st) st.textContent = "";
      return;
    }
    if (st) st.textContent = "Consultando o CNES…";
    const d = await consultar(cnesEl.value);
    if (!d) {
      if (st) st.textContent = "Não encontrado no CNES — preencha o nome manualmente.";
      return;
    }
    const set = (id, v) => {
      const el = document.getElementById(prefixo + "-" + id);
      if (el && v && !String(el.value || "").trim()) el.value = v;
    };
    set("nome", d.nome);
    set("uf", d.uf);
    const tipo = document.getElementById(prefixo + "-tipo");
    if (tipo) tipo.value = d.publico ? "publico" : "proprio";
    if (st)
      st.textContent =
        "Encontrado no CNES" + (d.esfera ? " · esfera " + d.esfera.toLowerCase() : "") + (d.atende_sus ? " · atende SUS" : " · sem atendimento ambulatorial SUS") + ". Confira e salve.";
  }

  async function adicionarDoFormulario() {
    const g = (id) => {
      const el = document.getElementById("cli-lme-" + id);
      return el ? (el.type === "checkbox" ? el.checked : el.value) : "";
    };
    try {
      await salvar({ cnes: g("cnes"), nome: g("nome"), municipio: g("municipio"), uf: g("uf"), tipo: g("tipo"), padrao: g("padrao") });
      ["cnes", "nome", "municipio", "uf"].forEach((k) => {
        const el = document.getElementById("cli-lme-" + k);
        if (el) el.value = "";
      });
      const p = document.getElementById("cli-lme-padrao");
      if (p) p.checked = false;
      const st = document.getElementById("cli-lme-status");
      if (st) st.textContent = "";
      toast("Estabelecimento salvo", "success");
      renderMinhaClinica();
    } catch (e) {
      toast(e.message || "Falha ao salvar o estabelecimento", "error");
    }
  }

  window.LmeEstab = { listar, padrao, consultar, salvar, definirPadrao, remover, renderMinhaClinica, buscarNoFormulario, adicionarDoFormulario };
})();
