/* ============================================================
   PRONTUÁRIO — exportação/impressão, histórico de versões e edição
   de atendimento finalizado.
   Nenhum registro clínico é excluído (triggers da migração
   20261029120000_prontuario_versoes.sql): toda alteração gera uma linha
   em prontuario_versoes, e tanto o histórico em tela quanto o PDF mostram
   a versão original e cada alteração (data, autor, motivo, antes/depois).
   O PDF usa _renderDocumentoPdf (mesmo modelo, QR de verificação e
   assinatura ICP-Brasil dos demais documentos).
   ============================================================ */
(function () {
  const db = () => window.sb;
  const toast = (m, t) => window.showToast && window.showToast(m, t);
  const $ = (id) => document.getElementById(id);
  const esc = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );

  // Trechos "[NOTA INTERNA hh:mm] …" que o médico insere no texto do prontuário.
  // Registros antigos trazem a indentação do código-fonte em volta da marca
  // (bug já corrigido em confirmNotaInterna); limparRecuo tira esse recuo.
  const NOTA_INTERNA_RE = /^[ \t]*\[NOTA INTERNA[^\]]*\][^\n]*\n?/gm;
  const limparRecuo = (txt) => String(txt || "").replace(/^[ \t]{20,}/gm, "");
  const semNotasInternas = (txt) =>
    limparRecuo(txt)
      .replace(NOTA_INTERNA_RE, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

  const ROTULO_TABELA = {
    consulta: "Atendimento",
    triagens: "Triagem",
    exames: "Exame",
    documentos_paciente: "Documento",
    pacientes: "Cadastro do paciente",
  };
  // Campos mostrados no histórico; os demais são técnicos (ids, caminhos, vínculos).
  // interna: true = anotação interna, omitida quando o toggle está desligado.
  const CAMPOS = {
    consulta: {
      started_at: { rotulo: "Início" },
      ended_at: { rotulo: "Término" },
      title: { rotulo: "Título" },
      notas: { rotulo: "Prontuário", texto: true },
      nota_personal: { rotulo: "Anotação interna", texto: true, interna: true },
      anamnese_ia: { rotulo: "Anamnese gerada por IA", texto: true },
      paciente_id: { rotulo: "Paciente (cadastro)" },
    },
    triagens: {
      realizado_em: { rotulo: "Realizada em" },
      risco: { rotulo: "Classificação de risco" },
      pa_sistolica: { rotulo: "PA sistólica" },
      pa_diastolica: { rotulo: "PA diastólica" },
      fc: { rotulo: "FC" },
      fr: { rotulo: "FR" },
      temperatura: { rotulo: "Temperatura" },
      spo2: { rotulo: "SpO₂" },
      glicemia: { rotulo: "Glicemia" },
      peso: { rotulo: "Peso" },
      altura: { rotulo: "Altura" },
      dor: { rotulo: "Dor" },
      queixa_principal: { rotulo: "Queixa principal", texto: true },
      alergias: { rotulo: "Alergias", texto: true },
      medicamentos: { rotulo: "Medicamentos", texto: true },
      observacoes: { rotulo: "Observações", texto: true },
      profissional_nome: { rotulo: "Profissional" },
      profissional_registro: { rotulo: "Registro profissional" },
      paciente_id: { rotulo: "Paciente (cadastro)" },
    },
    exames: {
      nome: { rotulo: "Exame" },
      tipo: { rotulo: "Tipo" },
      data: { rotulo: "Data do exame" },
      obs: { rotulo: "Observações", texto: true },
      resultado: { rotulo: "Resultado", texto: true },
      validade: { rotulo: "Validade" },
      file_name: { rotulo: "Arquivo" },
      paciente_id: { rotulo: "Paciente (cadastro)" },
    },
    documentos_paciente: {
      tipo: { rotulo: "Tipo" },
      status: { rotulo: "Situação" },
      arquivo_nome: { rotulo: "Arquivo" },
      enviado_em: { rotulo: "Enviado em" },
      canal_envio: { rotulo: "Canal de envio" },
      paciente_id: { rotulo: "Paciente (cadastro)" },
    },
    pacientes: {
      name: { rotulo: "Nome" },
      data_nascimento: { rotulo: "Data de nascimento" },
      cpf: { rotulo: "CPF" },
      sexo: { rotulo: "Sexo" },
      mae: { rotulo: "Mãe" },
      naturalidade: { rotulo: "Naturalidade" },
      dados_clinicos: { rotulo: "Dados clínicos", texto: true },
      cids: { rotulo: "CIDs" },
    },
  };
  const ROTULO_OPERACAO = {
    original: "Original",
    criacao: "Registro original",
    edicao: "Alteração",
  };

  const fmtDataHora = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return (
      d.toLocaleDateString("pt-BR") +
      " " +
      d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    );
  };
  const fmtData = (v) => {
    if (!v) return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split("-").reverse().join("/");
    const d = new Date(v);
    return isNaN(d) ? String(v) : d.toLocaleDateString("pt-BR");
  };
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

  // O PDF só sai com CPF válido: a verificação por QR (/v/<codigo>) usa os 4
  // últimos dígitos como senha e a reserva não acontece sem os 11 dígitos.
  function cpfValido(v) {
    const c = String(v || "").replace(/\D/g, "");
    if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
    for (let t = 9; t < 11; t++) {
      let s = 0;
      for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i);
      if (((s * 10) % 11) % 10 !== Number(c[t])) return false;
    }
    return true;
  }
  const AVISO_CPF =
    "Preencha um CPF válido no cadastro do paciente para exportar ou imprimir o prontuário";
  function fmtValor(campo, v) {
    if (v == null || v === "") return "";
    if (campo === "cids" && Array.isArray(v)) {
      return v
        .map((c) =>
          typeof c === "string" ? c : [c.code, c.description || c.desc].filter(Boolean).join(" — "),
        )
        .join("; ");
    }
    if (typeof v === "object") return JSON.stringify(v);
    if (typeof v === "string" && ISO_RE.test(v)) return fmtDataHora(v);
    if (campo === "data_nascimento") return fmtData(v);
    return String(v);
  }
  const valorCampo = (campo, def, dados, internas) => {
    const v = fmtValor(campo, dados ? dados[campo] : null);
    if (!def.texto) return v;
    return internas ? limparRecuo(v).trim() : semNotasInternas(v);
  };

  /* ---------- Histórico (HTML compartilhado entre o modal e o PDF) ---------- */

  // Cada alteração lista só os campos que mudaram, com o valor anterior e o
  // novo: o "antes" da primeira alteração é exatamente a versão original.
  function historicoHtml(tabela, versoes, { internas, pdf }) {
    const lista = (versoes || []).slice().sort((a, b) => a.versao - b.versao);
    if (!lista.length)
      return pdf ? "" : '<div class="phx-vazio">Nenhuma versão registrada para este item.</div>';
    const campos = CAMPOS[tabela] || {};
    const partes = [];
    for (let i = 0; i < lista.length; i++) {
      const v = lista[i];
      const cab =
        '<div class="phx-cab"><b>Versão ' +
        v.versao +
        " — " +
        esc(ROTULO_OPERACAO[v.operacao] || v.operacao) +
        "</b> · " +
        esc(fmtDataHora(v.alterado_em)) +
        (v.alterado_por_nome ? " · " + esc(v.alterado_por_nome) : "") +
        "</div>";
      if (i === 0) {
        partes.push('<div class="phx-v">' + cab + "</div>");
        continue;
      }
      const ant = lista[i - 1].dados || {};
      const mudancas = [];
      for (const [campo, def] of Object.entries(campos)) {
        if (def.interna && !internas) continue;
        const antes = valorCampo(campo, def, ant, internas);
        const depois = valorCampo(campo, def, v.dados, internas);
        if (antes === depois) continue;
        mudancas.push(
          '<div class="phx-campo"><div class="phx-rot">' +
            esc(def.rotulo) +
            "</div>" +
            '<div class="phx-antes"><span>Antes</span>' +
            (antes ? esc(antes) : "<i>(vazio)</i>") +
            "</div>" +
            '<div class="phx-depois"><span>Depois</span>' +
            (depois ? esc(depois) : "<i>(vazio)</i>") +
            "</div></div>",
        );
      }
      // Alteração só em campos técnicos ou internos omitidos: registra que houve, sem conteúdo.
      const corpo = mudancas.length
        ? mudancas.join("")
        : '<div class="phx-tec">Alteração sem mudança no conteúdo exibido.</div>';
      partes.push(
        '<div class="phx-v">' +
          cab +
          (v.motivo ? '<div class="phx-motivo">Motivo: ' + esc(v.motivo) + "</div>" : "") +
          corpo +
          "</div>",
      );
    }
    return '<div class="phx">' + partes.join("") + "</div>";
  }

  const ESTILO_HISTORICO = `
    .phx{display:flex;flex-direction:column;gap:8px}
    .phx-v{border-left:3px solid #cbd5e1;padding:2px 0 2px 10px}
    .phx-cab{font-size:11px;color:#475569}
    .phx-cab b{color:#0f172a}
    .phx-motivo{font-size:11px;color:#92400e;margin-top:2px}
    .phx-campo{margin-top:5px}
    .phx-rot{font-size:10.5px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:.03em}
    .phx-antes,.phx-depois{font-size:11.5px;line-height:1.45;white-space:pre-wrap;padding:4px 7px;border-radius:5px;margin-top:2px}
    .phx-antes{background:#fef2f2;color:#7f1d1d}
    .phx-depois{background:#f0fdf4;color:#14532d}
    .phx-antes span,.phx-depois span{display:block;font-size:9.5px;font-weight:700;text-transform:uppercase;opacity:.7}
    .phx-tec,.phx-vazio{font-size:11px;color:#64748b;font-style:italic}
  `;
  (function injetarEstilo() {
    const st = document.createElement("style");
    st.textContent = ESTILO_HISTORICO;
    document.head.appendChild(st);
  })();

  async function buscarVersoes(tabela, ids) {
    const unicos = [...new Set((ids || []).filter(Boolean))];
    const todas = [];
    for (let i = 0; i < unicos.length; i += 100) {
      const { data, error } = await db()
        .from("prontuario_versoes")
        .select("*")
        .eq("tabela", tabela)
        .in("registro_id", unicos.slice(i, i + 100))
        .order("versao", { ascending: true });
      if (error) throw error;
      todas.push(...(data || []));
    }
    const porId = {};
    for (const v of todas) (porId[v.registro_id] = porId[v.registro_id] || []).push(v);
    return porId;
  }

  async function historico(tabela, id) {
    if (!id) return;
    $("phist-titulo").textContent = "Histórico — " + (ROTULO_TABELA[tabela] || "registro");
    $("phist-corpo").innerHTML = '<div class="phx-vazio">Carregando…</div>';
    window.openModal("prontuario-historico");
    try {
      const porId = await buscarVersoes(tabela, [id]);
      const versoes = porId[id] || [];
      const intro =
        versoes.length > 1
          ? '<div style="font-size:12px;color:var(--n500);margin-bottom:10px">Cada alteração mostra o conteúdo anterior e o novo; o "Antes" da primeira alteração é a versão original.</div>'
          : '<div style="font-size:12px;color:var(--n500);margin-bottom:10px">Registro sem alterações desde que foi registrado.</div>';
      $("phist-corpo").innerHTML =
        intro + historicoHtml(tabela, versoes, { internas: true, pdf: false });
    } catch (e) {
      $("phist-corpo").innerHTML =
        '<div class="phx-vazio">Não foi possível carregar o histórico: ' +
        esc(e.message || e) +
        "</div>";
    }
  }

  /* ---------- Atendimento aberto (detalhe): selo, edição, impressão ---------- */

  const atendimentoAberto = () => {
    const id = window._atendAbertoId;
    return typeof atendimentos !== "undefined"
      ? atendimentos.find((a) => String(a.id) === String(id))
      : null;
  };

  async function marcarEdicoes(id) {
    const el = $("adv-editado");
    if (!el) return;
    el.style.display = "none";
    const { data, error } = await db()
      .from("prontuario_versoes")
      .select("versao,alterado_em")
      .eq("tabela", "consulta")
      .eq("registro_id", id)
      .eq("operacao", "edicao")
      .order("versao", { ascending: false });
    if (error || !data || !data.length || String(window._atendAbertoId) !== String(id)) return;
    el.innerHTML =
      '<i class="ti ti-history" style="font-size:11px"></i> Editado ' +
      data.length +
      (data.length === 1 ? " vez" : " vezes") +
      " · última em " +
      esc(fmtDataHora(data[0].alterado_em)) +
      " · ver histórico";
    el.style.display = "inline-flex";
  }

  function editarConsultaAberta() {
    const a = atendimentoAberto();
    if (!a) return;
    $("pedit-notas").value = a.notas === "Sem anotações." ? "" : limparRecuo(a.notas).trim();
    $("pedit-nota-interna").value = a.notaPersonal || "";
    $("pedit-motivo").value = "";
    window.openModal("prontuario-editar");
    setTimeout(() => $("pedit-notas").focus(), 60);
  }

  async function salvarEdicao() {
    const a = atendimentoAberto();
    if (!a) return;
    const notas = $("pedit-notas").value.trim();
    const notaInterna = $("pedit-nota-interna").value.trim();
    const motivo = $("pedit-motivo").value.trim();
    const notasAtuais = a.notas === "Sem anotações." ? "" : limparRecuo(a.notas).trim();
    if (notas === notasAtuais && notaInterna === (a.notaPersonal || "").trim()) {
      toast("Nada foi alterado", "warn");
      return;
    }
    if (!motivo) {
      toast("Informe o motivo da alteração", "warn");
      $("pedit-motivo").focus();
      return;
    }
    const btn = $("pedit-salvar");
    btn.disabled = true;
    try {
      const { data, error } = await db()
        .from("consulta")
        .update({
          notas: notas || "Sem anotações.",
          nota_personal: notaInterna,
          resumo: notas
            ? notas.substring(0, 200) + (notas.length > 200 ? "..." : "")
            : "Atendimento registrado.",
          motivo_alteracao: motivo,
        })
        .eq("id", a.id)
        .select("*")
        .single();
      if (error) throw error;
      const novo = window.mapConsultaRow(data);
      const i = atendimentos.findIndex((x) => String(x.id) === String(a.id));
      if (i >= 0) atendimentos[i] = novo;
      window.closeModal();
      window.renderAtendimentos();
      window.openAtend(a.id);
      if (typeof window.addTimelineEvent === "function") {
        await window.addTimelineEvent({
          date: new Date().toLocaleDateString("pt-BR"),
          type: "atend",
          icon: "ti-pencil",
          title: "Atendimento de " + a.date + " editado",
          sub: "Motivo: " + motivo,
        });
        if (typeof window.renderTimeline === "function") window.renderTimeline();
      }
      toast("Alteração salva — a versão anterior está no histórico", "success");
    } catch (e) {
      toast("Erro ao salvar alteração: " + (e.message || e), "error");
    } finally {
      btn.disabled = false;
    }
  }

  const dataLocalIso = (iso) => {
    const d = new Date(iso);
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  };

  function imprimirConsultaAberta() {
    const a = atendimentoAberto();
    if (!a) return;
    const dia = dataLocalIso(a.startedAt);
    abrir({ de: dia, ate: dia });
  }

  /* ---------- Exportação / impressão ---------- */

  function abrir(opts) {
    const p = window.getCurrentPatient && window.getCurrentPatient();
    if (!p) {
      toast("Abra um paciente para exportar o prontuário", "warn");
      return;
    }
    if (!cpfValido(p.cpf)) {
      toast(AVISO_CPF, "warn");
      return;
    }
    $("pexp-de").value = (opts && opts.de) || "";
    $("pexp-ate").value = (opts && opts.ate) || "";
    $("pexp-internas").checked = false;
    $("pexp-assinar").checked = false;
    status("");
    atualizarBotoes();
    window.openModal("prontuario-exportar");
  }

  function atualizarBotoes() {
    const assinar = $("pexp-assinar").checked;
    $("pexp-imprimir").style.display = assinar ? "none" : "";
    $("pexp-baixar").style.display = assinar ? "none" : "";
    $("pexp-enviar").style.display = assinar ? "" : "none";
  }

  function status(msg) {
    const el = $("pexp-status");
    el.style.display = msg ? "" : "none";
    el.innerHTML = msg
      ? '<i class="ti ti-loader-2" style="animation:spin 1s linear infinite"></i> ' + esc(msg)
      : "";
  }

  async function carregar(pacId, de, ate) {
    const ini = de ? new Date(de + "T00:00:00").toISOString() : null;
    const fim = ate ? new Date(ate + "T23:59:59.999").toISOString() : null;
    const periodo = (q, col) => {
      if (ini) q = q.gte(col, ini);
      if (fim) q = q.lte(col, fim);
      return q.order(col, { ascending: true });
    };
    const [pac, c, t, e, d] = await Promise.all([
      db().from("pacientes").select("*").eq("paciente_id", pacId).single(),
      periodo(
        db()
          .from("consulta")
          .select("*")
          .eq("paciente_id", pacId)
          .or("acao.is.null,acao.neq.Rascunho"),
        "started_at",
      ),
      periodo(db().from("triagens").select("*").eq("paciente_id", pacId), "realizado_em"),
      periodo(db().from("exames").select("*").eq("paciente_id", pacId), "created_at"),
      periodo(db().from("documentos_paciente").select("*").eq("paciente_id", pacId), "created_at"),
    ]);
    for (const r of [pac, c, t, e, d]) if (r.error) throw r.error;
    const [vc, vt, ve, vd, vp] = await Promise.all([
      buscarVersoes(
        "consulta",
        c.data.map((x) => x.id),
      ),
      buscarVersoes(
        "triagens",
        t.data.map((x) => x.id),
      ),
      buscarVersoes(
        "exames",
        e.data.map((x) => x.id),
      ),
      buscarVersoes(
        "documentos_paciente",
        d.data.map((x) => x.id),
      ),
      buscarVersoes("pacientes", [pacId]),
    ]);
    return {
      paciente: pac.data,
      consultas: c.data,
      triagens: t.data,
      exames: e.data,
      documentos: d.data,
      versoes: { consulta: vc, triagens: vt, exames: ve, documentos_paciente: vd, pacientes: vp },
    };
  }

  const linha = (rot, val) =>
    val ? '<div class="pex-l"><span>' + esc(rot) + ":</span> " + esc(val) + "</div>" : "";
  // Campos exigidos pela Res. CFM 1.638/2002: a ausência aparece no PDF em vez de sumir.
  const obrig = (rot, val) =>
    '<div class="pex-l"><span>' +
    esc(rot) +
    ":</span> " +
    (val ? esc(val) : '<i style="color:#b45309">não informado</i>') +
    "</div>";
  const blocoTexto = (rot, txt) =>
    txt
      ? '<div class="pex-t"><div class="pex-tr">' +
        esc(rot) +
        '</div><div class="pex-tt">' +
        esc(txt) +
        "</div></div>"
      : "";

  function autorOriginal(versoes) {
    const v = (versoes || [])[0];
    return v && v.alterado_por_nome && v.operacao !== "original" ? v.alterado_por_nome : "";
  }
  // Título preso ao primeiro item: o html2pdf só respeita break-inside: avoid,
  // então sem isso o título pode ficar sozinho no fim da página.
  const secao = (titulo, itens, vazio) => {
    const cab = '<div class="pex-st">' + esc(titulo) + "</div>";
    if (!itens.length)
      return vazio
        ? '<div class="pex-sec pex-keep">' +
            cab +
            '<div class="pex-vazio">' +
            esc(vazio) +
            "</div></div>"
        : "";
    return (
      '<div class="pex-sec"><div class="pex-keep">' +
      cab +
      itens[0] +
      "</div>" +
      itens.slice(1).join("") +
      "</div>"
    );
  };
  function blocoHistorico(tabela, versoes, internas) {
    if (!versoes || versoes.length < 2) return "";
    return (
      '<div class="pex-h"><div class="pex-hr">Histórico de alterações</div>' +
      historicoHtml(tabela, versoes, { internas, pdf: true }) +
      "</div>"
    );
  }

  // Estabelecimento e médico responsável, das mesmas fontes do cabeçalho do PDF
  // (Minha clínica em clinicaCfg e o perfil de Minha equipe).
  function responsavel() {
    let c = {};
    try {
      c = JSON.parse(localStorage.getItem("clinicaCfg") || "{}") || {};
    } catch (e) {}
    const u = (window.getCurrentUser && window.getCurrentUser()) || {};
    const m = u.user_metadata || {};
    const crm = window._medicoCrm ? window._medicoCrm(m) : m.crm || "";
    return {
      razao: c.razao || "",
      fantasia: c.fantasia || "",
      fiscal: c.fiscal || "",
      endereco: [
        [c.logradouro, c.numero].filter(Boolean).join(", "),
        c.complemento,
        c.bairro,
        [c.cidade, c.uf].filter(Boolean).join("/"),
        c.cep ? "CEP " + c.cep : "",
      ]
        .filter(Boolean)
        .join(" · "),
      telefone: c.telefone || "",
      medico: m.full_name || m.name || (u.email || "").split("@")[0] || "",
      crm,
      // Especialidade só com RQE (Res. CFM 2.336/2023), como no cabeçalho do PDF.
      especialidade: window._medicoEspecialidade ? window._medicoEspecialidade(m) : "",
    };
  }

  function montarHtml(dados, { de, ate, internas, responsavel: r }) {
    const p = dados.paciente;
    const V = dados.versoes;
    const periodo =
      de || ate
        ? (de ? fmtData(de) : "início") + " a " + (ate ? fmtData(ate) : "hoje")
        : "todo o prontuário";
    const endereco =
      [
        [p.logradouro, p.numero].filter(Boolean).join(", "),
        p.complemento,
        p.bairro,
        [p.cidade, p.uf].filter(Boolean).join("/"),
        p.cep ? "CEP " + p.cep : "",
      ]
        .filter(Boolean)
        .join(" · ") ||
      p.endereco ||
      "";
    const s = [];
    s.push(
      "<style>" +
        ESTILO_HISTORICO +
        `
      .pex{font-size:12px;color:#16201d;line-height:1.5}
      .pex-sec{margin-top:14px}
      .pex-keep{break-inside:avoid;page-break-inside:avoid}
      .pex-st{font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#0f172a;border-bottom:1px solid #e1e4e1;padding-bottom:3px;margin-bottom:8px}
      .pex-item{border:1px solid #e1e4e1;border-radius:8px;padding:9px 11px;margin-bottom:8px;break-inside:avoid;page-break-inside:avoid}
      .pex-it{font-weight:700;font-size:12.5px}
      .pex-meta{font-size:10.5px;color:#5b6660;margin-bottom:4px}
      .pex-l{font-size:11.5px}.pex-l span{color:#5b6660}
      .pex-t{margin-top:5px}.pex-tr{font-size:10px;font-weight:700;text-transform:uppercase;color:#5b6660}
      .pex-tt{white-space:pre-wrap;font-size:11.5px}
      .pex-ia{margin-top:5px;font-size:10.5px;color:#4338ca;background:#eef2ff;border-radius:5px;padding:4px 7px}
      .pex-h{margin-top:7px;border-top:1px dashed #cbd5e1;padding-top:6px}
      .pex-hr{font-size:10px;font-weight:700;text-transform:uppercase;color:#92400e;margin-bottom:4px}
      .pex-vazio{font-size:11.5px;color:#64748b;font-style:italic}
      </style>`,
    );
    s.push('<div class="pex">');
    s.push(
      '<div class="pex-item">' +
        linha("Período", periodo) +
        linha("Emitido em", fmtDataHora(new Date().toISOString())) +
        linha("Anotações internas", internas ? "incluídas" : "omitidas") +
        '<div class="pex-meta" style="margin-top:4px">Registros alterados após o registro original exibem a versão atual seguida do histórico: data, autor, motivo e o conteúdo antes e depois de cada alteração. Nenhum registro do prontuário pode ser excluído.</div>' +
        "</div>",
    );

    s.push(
      secao("Estabelecimento e profissional responsável", [
        '<div class="pex-item">' +
          obrig("Estabelecimento", r.razao || r.fantasia) +
          (r.razao && r.fantasia && r.fantasia !== r.razao
            ? linha("Nome fantasia", r.fantasia)
            : "") +
          obrig("CNPJ/CPF", r.fiscal) +
          obrig("Endereço", r.endereco) +
          linha("Telefone", r.telefone) +
          obrig("Médico responsável", r.medico) +
          obrig("CRM/UF", r.crm) +
          linha("Especialidade / RQE", r.especialidade) +
          "</div>",
      ]),
    );

    s.push(
      secao("Identificação do paciente", [
        '<div class="pex-item">' +
          obrig("Nome completo", p.name) +
          obrig("Data de nascimento", fmtData(p.data_nascimento)) +
          obrig("Sexo", p.sexo) +
          obrig("CPF", p.cpf) +
          linha("CNS", p.sus) +
          obrig("Nome da mãe", p.mae) +
          obrig("Naturalidade", p.naturalidade) +
          linha("Pai", p.pai) +
          obrig("Endereço", endereco) +
          linha("Telefone", p.telefone) +
          linha("Convênio", p.convenio) +
          linha("Ocupação", p.ocupacao) +
          blocoTexto(
            "Dados clínicos (situação atual)",
            internas ? limparRecuo(p.dados_clinicos).trim() : semNotasInternas(p.dados_clinicos),
          ) +
          (Array.isArray(p.cids) && p.cids.length
            ? blocoTexto("CIDs", fmtValor("cids", p.cids))
            : "") +
          blocoHistorico("pacientes", V.pacientes[p.paciente_id], internas) +
          "</div>",
      ]),
    );

    const atend = [];
    for (const c of dados.consultas) {
      const vs = V.consulta[c.id];
      const notas =
        c.notas === "Sem anotações."
          ? ""
          : internas
            ? limparRecuo(c.notas).trim()
            : semNotasInternas(c.notas);
      const fim = c.ended_at
        ? " – " +
          new Date(c.ended_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        : "";
      atend.push(
        '<div class="pex-item"><div class="pex-it">' +
          esc(c.title || "Atendimento") +
          "</div>" +
          '<div class="pex-meta">' +
          esc(fmtDataHora(c.started_at) + fim) +
          // A equipe não grava atendimentos (RLS): sem autor na versão, o registro é do médico da conta.
          " · Registrado por " +
          esc(
            autorOriginal(vs) ||
              [r.medico, r.crm ? "CRM " + r.crm : ""].filter(Boolean).join(" — "),
          ) +
          "</div>" +
          (notas
            ? '<div class="pex-tt">' + esc(notas) + "</div>"
            : '<div class="pex-vazio">Sem anotações.</div>') +
          (internas ? blocoTexto("Anotação interna", c.nota_personal) : "") +
          (c.anamnese_ia
            ? '<div class="pex-ia">Uso de inteligência artificial como apoio (Res. CFM 2.454/2026): anamnese gerada por IA a partir da consulta; o conteúdo do registro foi validado pelo médico ao finalizar o atendimento.</div>'
            : "") +
          blocoHistorico("consulta", vs, internas) +
          "</div>",
      );
    }
    s.push(secao("Atendimentos", atend, "Nenhum atendimento no período."));

    const triagens = [];
    for (const t of dados.triagens) {
      const vit = [
        t.pa_sistolica && t.pa_diastolica
          ? "PA " + t.pa_sistolica + "/" + t.pa_diastolica + " mmHg"
          : "",
        t.fc ? "FC " + t.fc + " bpm" : "",
        t.fr ? "FR " + t.fr + " irpm" : "",
        t.temperatura != null ? "Tax " + String(t.temperatura).replace(".", ",") + " °C" : "",
        t.spo2 ? "SpO₂ " + t.spo2 + "%" : "",
        t.glicemia ? "Glicemia " + t.glicemia + " mg/dL" : "",
        t.peso ? "Peso " + String(t.peso).replace(".", ",") + " kg" : "",
        t.altura ? "Altura " + String(t.altura).replace(".", ",") + " cm" : "",
        t.dor != null ? "Dor " + t.dor + "/10" : "",
      ]
        .filter(Boolean)
        .join(" · ");
      triagens.push(
        '<div class="pex-item"><div class="pex-it">Triagem — ' +
          esc(fmtDataHora(t.realizado_em)) +
          "</div>" +
          '<div class="pex-meta">' +
          esc([t.profissional_nome, t.profissional_registro].filter(Boolean).join(" · ")) +
          (t.risco ? " · Risco: " + esc(t.risco) : "") +
          "</div>" +
          (vit ? '<div class="pex-tt">' + esc(vit) + "</div>" : "") +
          blocoTexto("Queixa principal", t.queixa_principal) +
          blocoTexto("Alergias", t.alergias) +
          blocoTexto("Medicamentos em uso", t.medicamentos) +
          blocoTexto("Observações", t.observacoes) +
          blocoHistorico("triagens", V.triagens[t.id], internas) +
          "</div>",
      );
    }
    s.push(secao("Triagens", triagens));

    const exames = [];
    for (const e of dados.exames) {
      exames.push(
        '<div class="pex-item"><div class="pex-it">' +
          esc(e.nome) +
          "</div>" +
          '<div class="pex-meta">Registrado em ' +
          esc(fmtDataHora(e.created_at)) +
          (e.tipo ? " · " + esc(e.tipo) : "") +
          "</div>" +
          linha("Data do exame", e.data) +
          linha("Arquivo", e.file_name) +
          blocoTexto("Observações", e.obs) +
          blocoTexto("Resultado", e.resultado) +
          blocoHistorico("exames", V.exames[e.id], internas) +
          "</div>",
      );
    }
    s.push(secao("Exames", exames, "Nenhum exame registrado no período."));

    const documentos = [];
    for (const d of dados.documentos) {
      const situacao =
        d.status === "assinado"
          ? "assinado digitalmente"
          : d.status === "nao_assinado"
            ? "sem assinatura digital"
            : d.status;
      documentos.push(
        '<div class="pex-item"><div class="pex-it">' +
          esc((d.conteudo && d.conteudo.documento) || d.tipo) +
          "</div>" +
          '<div class="pex-meta">' +
          esc(fmtDataHora(d.created_at)) +
          " · " +
          esc(situacao || "") +
          (d.enviado_em
            ? " · enviado em " +
              esc(fmtDataHora(d.enviado_em)) +
              (d.canal_envio ? " (" + esc(d.canal_envio) + ")" : "")
            : "") +
          "</div>" +
          blocoHistorico("documentos_paciente", V.documentos_paciente[d.id], internas) +
          "</div>",
      );
    }
    s.push(secao("Documentos emitidos", documentos));
    s.push("</div>");
    return s.join("");
  }

  function imprimirBlob(blob) {
    const url = URL.createObjectURL(blob);
    const fr = document.createElement("iframe");
    fr.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    fr.src = url;
    fr.onload = () => {
      try {
        fr.contentWindow.focus();
        fr.contentWindow.print();
      } catch (e) {
        window.open(url, "_blank");
      }
      setTimeout(() => {
        fr.remove();
        URL.revokeObjectURL(url);
      }, 60000);
    };
    document.body.appendChild(fr);
  }

  async function enviarAoPaciente(documentoId) {
    const { data: sess } = await db().auth.getSession();
    const token = sess && sess.session && sess.session.access_token;
    if (!token) throw new Error("Sessão expirada");
    const resp = await fetch("/api/comunicacao/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ tipo: "documento", documento_id: documentoId }),
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(j.message || j.error || "Falha no envio");
    return j;
  }

  let gerando = false;
  async function gerar(acao) {
    if (gerando) return;
    const p = window.getCurrentPatient && window.getCurrentPatient();
    if (!p) return;
    const de = $("pexp-de").value;
    const ate = $("pexp-ate").value;
    if (de && ate && de > ate) {
      toast("A data inicial é posterior à final", "warn");
      return;
    }
    const internas = $("pexp-internas").checked;
    const assinar = acao === "enviar";
    gerando = true;
    const botoes = ["pexp-imprimir", "pexp-baixar", "pexp-enviar"].map($);
    botoes.forEach((b) => (b.disabled = true));
    try {
      status("Reunindo os registros do prontuário…");
      const dados = await carregar(p.id, de, ate);
      const pac = dados.paciente;
      // O cadastro em tela pode estar desatualizado: vale o CPF gravado no banco.
      if (!cpfValido(pac.cpf)) {
        toast(AVISO_CPF, "warn");
        return;
      }
      status(assinar ? "Gerando e assinando o PDF…" : "Gerando o PDF…");
      const result = await window._renderDocumentoPdf({
        docTitle: "Prontuário do Paciente",
        docMark: "",
        patientName: pac.name || "",
        patientAge: window._rxIdade(pac.data_nascimento || ""),
        patientCpf: pac.cpf || "",
        patientAddress: pac.endereco || "",
        patientSex: pac.sexo || "",
        bodyHtml: montarHtml(dados, { de, ate, internas, responsavel: responsavel() }),
        filenamePrefix: "prontuario",
        contentDescription: "Prontuário de " + (pac.name || "paciente"),
        assinar,
      });
      if (!result) return;
      if (!assinar) {
        if (acao === "imprimir") imprimirBlob(result.finalBlob);
        else window._baixarBlob(result.finalBlob, result.filename);
        window.closeModal();
        return;
      }
      if (!result.signedUrl) {
        window._baixarBlob(result.finalBlob, result.filename);
        toast(
          "Não foi possível assinar digitalmente: o PDF foi baixado sem assinatura e não foi enviado ao paciente",
          "error",
        );
        return;
      }
      status("Enviando ao paciente…");
      const doc = await window.salvarDocumentoGerado({
        tipo: "prontuario",
        pacienteNome: pac.name || "Paciente",
        pacienteCpf: pac.cpf || null,
        pacienteId: pac.paciente_id,
        conteudo: {
          documento: "Prontuário do Paciente",
          periodo: { de: de || null, ate: ate || null },
          anotacoes_internas: internas,
          verificacao: result.verificacao || null,
        },
        blob: result.finalBlob,
        filename: result.filename,
        assinado: true,
      });
      if (!doc) return;
      try {
        await enviarAoPaciente(doc.id);
        toast("Prontuário assinado e enviado ao paciente ✓", "success");
      } catch (e) {
        toast(
          "Prontuário assinado e salvo em Documentos, mas o envio falhou: " + (e.message || e),
          "error",
        );
      }
      window.closeModal();
    } catch (e) {
      console.error("Falha ao exportar prontuário:", e);
      toast("Falha ao exportar o prontuário: " + (e.message || e), "error");
    } finally {
      gerando = false;
      status("");
      botoes.forEach((b) => (b.disabled = false));
    }
  }

  window.ProntuarioExport = {
    abrir,
    atualizarBotoes,
    gerar,
    historico,
    marcarEdicoes,
    editarConsultaAberta,
    salvarEdicao,
    historicoConsultaAberta: () => historico("consulta", window._atendAbertoId),
    imprimirConsultaAberta,
  };
})();
