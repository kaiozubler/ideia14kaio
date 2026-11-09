// AGENDAMENTO ONLINE — link público em que o paciente marca a consulta
// (Configurações -> Agendamento online). Segue o contrato dos outros módulos:
// IIFE, usa window.sb, expõe window.initAgendamentoOnline() e escreve em
// #s-agendamento-online. A página do paciente é src/routes/agendar.$token.tsx;
// o horário oferecido é o cruzamento da grade da clínica com a do médico.
(function () {
  var DIAS = [
    { id: "1", nome: "Segunda" },
    { id: "2", nome: "Terça" },
    { id: "3", nome: "Quarta" },
    { id: "4", nome: "Quinta" },
    { id: "5", nome: "Sexta" },
    { id: "6", nome: "Sábado" },
    { id: "0", nome: "Domingo" },
  ];
  var DURACOES = [15, 20, 30, 40, 45, 60, 90];

  var cfg = null;
  var medicos = [];
  var removidos = [];
  var salvando = false;
  var carregando = false;

  function raiz() {
    return document.getElementById("s-agendamento-online");
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg, tipo) {
    if (typeof window.showToast === "function") window.showToast(msg, tipo);
  }
  // O link vai para pacientes sem conta: aponta sempre para o site publicado,
  // porque os domínios de edição/preview do Lovable exigem login (mesma regra
  // de publicOrigin em questionarios.js).
  var SITE_PUBLICO = "https://medicopilot.lovable.app";
  function origemPublica() {
    var o = location.origin || "";
    return /lovableproject\.com|lovable\.dev|id-preview--|--?dev\.lovable\.app|localhost|127\.0\.0\.1/i.test(o) ? SITE_PUBLICO : o;
  }
  function linkPublico() {
    return cfg ? origemPublica() + "/agendar/" + cfg.token : "";
  }
  function copiaGrade(g) {
    return JSON.parse(JSON.stringify(g || {}));
  }

  function grupoGrade(grade, alvo) {
    return DIAS.map(function (d) {
      var faixas = grade[d.id] || [];
      var aberta = faixas.length > 0;
      return (
        '<div class="ao-dia' + (aberta ? "" : " fechado") + '">' +
        '<label class="ao-dia-nome"><input type="checkbox" data-a="dia" data-alvo="' + alvo + '" data-dia="' + d.id + '"' + (aberta ? " checked" : "") + " /> " + d.nome + "</label>" +
        '<div class="ao-faixas">' +
        (aberta
          ? faixas
              .map(function (f, i) {
                return (
                  '<span class="ao-faixa">' +
                  '<input type="time" aria-label="Início" value="' + esc(f.ini) + '" data-a="hora" data-campo="ini" data-alvo="' + alvo + '" data-dia="' + d.id + '" data-i="' + i + '" />' +
                  "<small>às</small>" +
                  '<input type="time" aria-label="Fim" value="' + esc(f.fim) + '" data-a="hora" data-campo="fim" data-alvo="' + alvo + '" data-dia="' + d.id + '" data-i="' + i + '" />' +
                  '<button type="button" class="ao-icone" title="Remover faixa" data-a="tirar-faixa" data-alvo="' + alvo + '" data-dia="' + d.id + '" data-i="' + i + '"><i class="ti ti-x"></i></button>' +
                  "</span>"
                );
              })
              .join("") +
            '<button type="button" class="ao-link" data-a="por-faixa" data-alvo="' + alvo + '" data-dia="' + d.id + '"><i class="ti ti-plus"></i> Faixa</button>'
          : "<small>Fechado</small>") +
        "</div></div>"
      );
    }).join("");
  }

  function cartaoMedico(m) {
    var propria = !!m.horarios;
    return (
      '<div class="ao-medico">' +
      '<div class="ao-medico-campos">' +
      '<label>Nome<input class="ao-input" data-a="med" data-campo="nome" data-id="' + m.id + '" value="' + esc(m.nome) + '" /></label>' +
      '<label>Especialidade<input class="ao-input" data-a="med" data-campo="especialidade" data-id="' + m.id + '" value="' + esc(m.especialidade) + '" /></label>' +
      '<label>RQE<input class="ao-input" data-a="med" data-campo="rqe" data-id="' + m.id + '" value="' + esc(m.rqe) + '" /></label>' +
      '<label>Duração da consulta<select class="ao-input" data-a="med" data-campo="duracao_min" data-id="' + m.id + '">' +
      DURACOES.concat(DURACOES.indexOf(m.duracao_min) < 0 ? [m.duracao_min] : [])
        .map(function (d) {
          return '<option value="' + d + '"' + (d === m.duracao_min ? " selected" : "") + ">" + d + " min</option>";
        })
        .join("") +
      "</select></label>" +
      "</div>" +
      '<p class="ao-aviso" data-aviso="' + m.id + '"' + (m.especialidade && !m.rqe ? "" : " hidden") + '><i class="ti ti-info-circle"></i> Sem RQE, a especialidade não aparece para o paciente (Res. CFM 2.336/2023).</p>' +
      '<div class="ao-medico-rodape">' +
      '<label class="ao-check"><input type="checkbox" data-a="med-ativo" data-id="' + m.id + '"' + (m.ativo ? " checked" : "") + " /> Aparece no link</label>" +
      '<label class="ao-check"><input type="checkbox" data-a="med-grade" data-id="' + m.id + '"' + (propria ? " checked" : "") + " /> Atende em horário próprio</label>" +
      (m.responsavel ? "" : '<button type="button" class="ao-link perigo" data-a="med-remover" data-id="' + m.id + '"><i class="ti ti-trash"></i> Remover</button>') +
      "</div>" +
      (propria
        ? '<div class="ao-grade-medico"><p class="ao-ajuda">Horários fora do funcionamento da clínica nunca são oferecidos.</p>' + grupoGrade(m.horarios, m.id) + "</div>"
        : "") +
      "</div>"
    );
  }

  function render() {
    var r = raiz();
    if (!r) return;
    if (!cfg) {
      r.innerHTML = '<div class="ao-panel ao-vazio"><i class="ti ti-loader-2"></i> Carregando…</div>';
      return;
    }
    r.innerHTML =
      '<div class="ao-head"><div>' +
      '<button class="btn ghost sm" onclick="goScreen(\'configuracoes\')"><i class="ti ti-arrow-left"></i> Voltar</button>' +
      "<h1>Agendamento online</h1>" +
      "<p>O paciente escolhe o médico e marca a consulta em um link da sua clínica.</p>" +
      '</div><button class="ao-btn primary" id="ao-salvar"' + (salvando ? " disabled" : "") + '><i class="ti ti-device-floppy"></i> ' + (salvando ? "Salvando…" : "Salvar") + "</button></div>" +
      '<section class="ao-panel">' +
      '<div class="ao-titulo"><div><h2>Link do paciente</h2><p>Compartilhe no WhatsApp, no Instagram ou no site da clínica.</p></div>' +
      '<label class="ao-switch"><input type="checkbox" id="ao-ativo"' + (cfg.ativo ? " checked" : "") + " /><span></span> " + (cfg.ativo ? "Ativo" : "Desligado") + "</label></div>" +
      '<div class="ao-link-linha"><input class="ao-input" readonly id="ao-url" value="' + esc(linkPublico()) + '" />' +
      '<button class="ao-btn" id="ao-copiar"><i class="ti ti-copy"></i> Copiar</button>' +
      '<button class="ao-btn" id="ao-novo"><i class="ti ti-refresh"></i> Gerar novo link</button></div>' +
      (cfg.ativo ? "" : '<p class="ao-aviso"><i class="ti ti-info-circle"></i> Enquanto estiver desligado, o link mostra que o agendamento está indisponível.</p>') +
      "</section>" +
      '<section class="ao-panel"><div class="ao-titulo"><div><h2>Horário de funcionamento</h2><p>Nenhuma consulta é oferecida fora destes horários. Considera o horário de Brasília.</p></div></div>' +
      grupoGrade(cfg.horarios, "clinica") +
      "</section>" +
      '<section class="ao-panel"><div class="ao-titulo"><div><h2>Médicos da clínica</h2><p>Somente estes médicos aparecem no link e na Agenda.</p></div>' +
      '<button class="ao-btn" id="ao-add-medico"><i class="ti ti-plus"></i> Adicionar médico</button></div>' +
      medicos.map(cartaoMedico).join("") +
      "</section>" +
      '<section class="ao-panel"><div class="ao-titulo"><div><h2>Regras</h2></div></div><div class="ao-regras">' +
      '<label>Antecedência mínima (horas)<input class="ao-input" type="number" min="0" max="720" id="ao-antecedencia" value="' + esc(cfg.antecedencia_horas) + '" /></label>' +
      '<label>Agenda aberta para os próximos (dias)<input class="ao-input" type="number" min="1" max="180" id="ao-janela" value="' + esc(cfg.janela_dias) + '" /></label>' +
      "</div></section>";
    ligar(r);
  }

  function gradeDoAlvo(alvo) {
    if (alvo === "clinica") return cfg.horarios;
    var m = medicos.find(function (x) {
      return x.id === alvo;
    });
    return m ? m.horarios : null;
  }

  function aoMudar(el) {
    var d = el.dataset;
    var grade = d.alvo ? gradeDoAlvo(d.alvo) : null;
    var m = d.id
      ? medicos.find(function (x) {
          return x.id === d.id;
        })
      : null;
    if (d.a === "dia") {
      grade[d.dia] = el.checked ? [{ ini: "08:00", fim: "18:00" }] : [];
      render();
    } else if (d.a === "hora") {
      grade[d.dia][Number(d.i)][d.campo] = el.value;
    } else if (d.a === "med") {
      m[d.campo] = d.campo === "duracao_min" ? Number(el.value) : el.value;
      var aviso = raiz().querySelector('[data-aviso="' + m.id + '"]');
      if (aviso) aviso.hidden = !(m.especialidade && !m.rqe);
    } else if (d.a === "med-ativo") {
      m.ativo = el.checked;
    } else if (d.a === "med-grade") {
      m.horarios = el.checked ? copiaGrade(cfg.horarios) : null;
      render();
    }
  }

  function aoClicar(el) {
    var d = el.dataset;
    if (d.a === "tirar-faixa") {
      gradeDoAlvo(d.alvo)[d.dia].splice(Number(d.i), 1);
      render();
    } else if (d.a === "por-faixa") {
      gradeDoAlvo(d.alvo)[d.dia].push({ ini: "13:00", fim: "18:00" });
      render();
    } else if (d.a === "med-remover") {
      var m = medicos.find(function (x) {
        return x.id === d.id;
      });
      if (!confirm("Remover " + (m.nome || "este médico") + "? As consultas já marcadas continuam na Agenda.")) return;
      if (!m.novo) removidos.push(m.id);
      medicos = medicos.filter(function (x) {
        return x.id !== d.id;
      });
      render();
    }
  }

  function ligar(r) {
    r.querySelectorAll("[data-a]").forEach(function (el) {
      el.addEventListener(el.tagName === "BUTTON" ? "click" : "change", function () {
        (el.tagName === "BUTTON" ? aoClicar : aoMudar)(el);
      });
    });
    r.querySelector("#ao-ativo").addEventListener("change", function (e) {
      cfg.ativo = e.target.checked;
      render();
    });
    r.querySelector("#ao-antecedencia").addEventListener("change", function (e) {
      cfg.antecedencia_horas = Number(e.target.value);
    });
    r.querySelector("#ao-janela").addEventListener("change", function (e) {
      cfg.janela_dias = Number(e.target.value);
    });
    r.querySelector("#ao-copiar").addEventListener("click", copiar);
    r.querySelector("#ao-novo").addEventListener("click", novoLink);
    r.querySelector("#ao-salvar").addEventListener("click", salvar);
    r.querySelector("#ao-add-medico").addEventListener("click", function () {
      medicos.push({
        id: crypto.randomUUID(),
        novo: true,
        nome: "",
        especialidade: "",
        rqe: "",
        duracao_min: 30,
        horarios: null,
        ativo: true,
        responsavel: false,
      });
      render();
    });
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(linkPublico());
      toast("Link copiado", "success");
    } catch (e) {
      raiz().querySelector("#ao-url").select();
      toast("Copie o link selecionado", "error");
    }
  }

  var FRASE_TROCA = "TROCAR LINK";
  var ERROS_TROCA = {
    senha_incorreta: "Senha incorreta.",
    senha_obrigatoria: "Informe sua senha.",
    email_incorreto: "O e-mail não é o desta conta.",
    confirmacao_invalida: "Digite " + FRASE_TROCA + " para confirmar.",
    somente_medico: "Só o médico responsável pode gerar um novo link.",
  };

  // Troca do link: aviso de que todos os links anteriores param, frase de
  // confirmação e senha (ou e-mail, em conta só do Google). A senha é
  // conferida no servidor, em /api/agendamento/novo-link.
  async function novoLink() {
    var sess = await window.sb.auth.getSession();
    var user = sess.data && sess.data.session ? sess.data.session.user : null;
    if (!user) return toast("Sessão expirada. Entre de novo.", "error");
    var temSenha =
      (user.identities || []).some(function (i) {
        return i.provider === "email";
      }) || ((user.app_metadata || {}).providers || []).indexOf("email") >= 0;

    var fundo = document.createElement("div");
    fundo.className = "ao-modal-fundo";
    fundo.innerHTML =
      '<div class="ao-modal" role="dialog" aria-modal="true" aria-labelledby="ao-troca-titulo">' +
      '<h2 id="ao-troca-titulo"><i class="ti ti-alert-triangle"></i> Gerar um novo link?</h2>' +
      '<div class="ao-alerta"><b>Todos os links anteriores param de funcionar na hora.</b> ' +
      "Quem abrir o link antigo — no site da clínica, no Instagram, em mensagens já enviadas — verá que o agendamento está indisponível. " +
      "Você vai precisar trocar o link em todos esses lugares. As consultas já marcadas continuam valendo.</div>" +
      '<p class="ao-ajuda">Para só pausar o agendamento, desligue a chave <b>Ativo</b> em vez de trocar o link.</p>' +
      '<label class="ao-check"><input type="checkbox" id="ao-troca-ciente" /> Entendo que o link atual vai parar de funcionar.</label>' +
      '<label class="ao-campo"><span>Digite <b>' + FRASE_TROCA + '</b> para confirmar</span><input class="ao-input" id="ao-troca-frase" autocomplete="off" /></label>' +
      (temSenha
        ? '<label class="ao-campo">Sua senha<input class="ao-input" type="password" id="ao-troca-senha" autocomplete="current-password" /></label>'
        : '<label class="ao-campo">Sua conta entra pelo Google. Digite o e-mail da conta<input class="ao-input" type="email" id="ao-troca-email" autocomplete="off" /></label>') +
      '<p class="ao-erro" id="ao-troca-erro" hidden></p>' +
      '<div class="ao-modal-acoes"><button class="ao-btn" id="ao-troca-cancelar">Cancelar</button>' +
      '<button class="ao-btn perigo" id="ao-troca-ok" disabled><i class="ti ti-refresh"></i> Gerar novo link</button></div>' +
      "</div>";
    document.body.appendChild(fundo);

    var $ = function (id) {
      return fundo.querySelector("#" + id);
    };
    var segredo = temSenha ? $("ao-troca-senha") : $("ao-troca-email");
    function fechar() {
      fundo.remove();
      document.removeEventListener("keydown", aoTeclar);
    }
    function aoTeclar(e) {
      if (e.key === "Escape") fechar();
    }
    function pronto() {
      return $("ao-troca-ciente").checked && $("ao-troca-frase").value.trim().toUpperCase() === FRASE_TROCA && segredo.value.trim() !== "";
    }
    function atualizar() {
      $("ao-troca-ok").disabled = !pronto();
    }
    ["ao-troca-ciente", "ao-troca-frase"].forEach(function (id) {
      $(id).addEventListener("input", atualizar);
      $(id).addEventListener("change", atualizar);
    });
    segredo.addEventListener("input", atualizar);
    document.addEventListener("keydown", aoTeclar);
    fundo.addEventListener("click", function (e) {
      if (e.target === fundo) fechar();
    });
    $("ao-troca-cancelar").addEventListener("click", fechar);
    $("ao-troca-ciente").focus();

    $("ao-troca-ok").addEventListener("click", async function () {
      if (!pronto()) return;
      var botao = $("ao-troca-ok");
      var erro = $("ao-troca-erro");
      botao.disabled = true;
      botao.innerHTML = '<i class="ti ti-loader-2"></i> Gerando…';
      erro.hidden = true;
      try {
        var r = await fetch("/api/agendamento/novo-link", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + sess.data.session.access_token },
          body: JSON.stringify({
            confirmacao: $("ao-troca-frase").value,
            senha: temSenha ? segredo.value : undefined,
            email: temSenha ? undefined : segredo.value,
          }),
        });
        var json = await r.json().catch(function () {
          return {};
        });
        if (!r.ok) throw new Error(ERROS_TROCA[json.error] || "Não foi possível gerar o link. Tente de novo.");
        cfg.token = json.token;
        fechar();
        render();
        toast("Novo link gerado. Atualize o link onde ele estiver divulgado.", "success");
      } catch (e) {
        erro.textContent = e.message;
        erro.hidden = false;
        botao.innerHTML = '<i class="ti ti-refresh"></i> Gerar novo link';
        atualizar();
        if (temSenha) segredo.select();
      }
    });
  }


  // Devolve a mensagem do primeiro problema, ou null se a grade pode ser gravada.
  function erroNaGrade(grade, rotulo) {
    for (var i = 0; i < DIAS.length; i++) {
      var faixas = (grade[DIAS[i].id] || []).slice().sort(function (a, b) {
        return a.ini < b.ini ? -1 : 1;
      });
      for (var j = 0; j < faixas.length; j++) {
        if (!faixas[j].ini || !faixas[j].fim || faixas[j].ini >= faixas[j].fim) {
          return rotulo + ", " + DIAS[i].nome + ": o início precisa ser antes do fim.";
        }
        if (j > 0 && faixas[j].ini < faixas[j - 1].fim) {
          return rotulo + ", " + DIAS[i].nome + ": as faixas se sobrepõem.";
        }
      }
    }
    return null;
  }

  async function salvar() {
    var erro = erroNaGrade(cfg.horarios, "Funcionamento");
    medicos.forEach(function (m) {
      if (!erro && !String(m.nome).trim()) erro = "Informe o nome de todos os médicos.";
      if (!erro && m.horarios) erro = erroNaGrade(m.horarios, m.nome);
    });
    var antecedencia = Number(cfg.antecedencia_horas);
    var janela = Number(cfg.janela_dias);
    if (!erro && !(antecedencia >= 0 && antecedencia <= 720)) erro = "A antecedência mínima vai de 0 a 720 horas.";
    if (!erro && !(janela >= 1 && janela <= 180)) erro = "A agenda pode abrir de 1 a 180 dias.";
    if (erro) return toast(erro, "error");

    salvando = true;
    render();
    try {
      for (var i = 0; i < removidos.length; i++) {
        var del = await window.sb.from("agenda_medicos").delete().eq("id", removidos[i]);
        if (del.error) throw del.error;
      }
      removidos = [];
      // Desativados primeiro: trocar um médico por outro não pode esbarrar na
      // licença do plano no meio do salvamento.
      var ordem = medicos.slice().sort(function (a, b) {
        return Number(a.ativo) - Number(b.ativo);
      });
      for (var k = 0; k < ordem.length; k++) {
        var m = ordem[k];
        var linha = {
          clinica_id: cfg.clinica_id,
          nome: m.nome.trim(),
          especialidade: String(m.especialidade || "").trim() || null,
          rqe: String(m.rqe || "").trim() || null,
          duracao_min: m.duracao_min,
          horarios: m.horarios,
          ativo: m.ativo,
        };
        var res = m.novo
          ? await window.sb.from("agenda_medicos").insert(Object.assign({ id: m.id }, linha))
          : await window.sb.from("agenda_medicos").update(linha).eq("id", m.id);
        if (res.error) throw res.error;
        m.novo = false;
      }
      var up = await window.sb
        .from("agenda_online_config")
        .update({ ativo: cfg.ativo, horarios: cfg.horarios, antecedencia_horas: antecedencia, janela_dias: janela })
        .eq("clinica_id", cfg.clinica_id);
      if (up.error) throw up.error;
      toast("Agendamento online salvo", "success");
    } catch (e) {
      toast("Não foi possível salvar: " + (e.message || e), "error");
    }
    salvando = false;
    render();
  }

  window.initAgendamentoOnline = async function () {
    if (carregando) return;
    carregando = true;
    cfg = null;
    removidos = [];
    render();
    try {
      var prep = await window.sb.rpc("agenda_online_preparar");
      if (prep.error) throw prep.error;
      var cid = typeof window.clinicaId === "function" ? window.clinicaId() : null;
      var resCfg = await window.sb.from("agenda_online_config").select("*").eq("clinica_id", cid).single();
      if (resCfg.error) throw resCfg.error;
      var resMed = await window.sb
        .from("agenda_medicos")
        .select("*")
        .eq("clinica_id", cid)
        .order("responsavel", { ascending: false })
        .order("nome");
      if (resMed.error) throw resMed.error;
      cfg = resCfg.data;
      medicos = resMed.data || [];
      render();
    } catch (e) {
      console.error("agendamento-online", e);
      var r = raiz();
      if (r) r.innerHTML = '<div class="ao-panel ao-vazio"><i class="ti ti-alert-triangle"></i> Não foi possível carregar o agendamento online.</div>';
    }
    carregando = false;
  };
})();
