/**
 * Fluxo de conexão com certificado de outra certificadora (A3 externo, via
 * Integra Bry). Compartilhado entre a tela de equipe (conectar/gerenciar) e
 * qualquer tela que precise assinar um documento (receita, atestado etc.) e
 * reconecte na hora, sem perder o que o médico já preencheu.
 *
 * window.IntegraBryConnect.listPscs(token)
 * window.IntegraBryConnect.connect(token, { pscName, cpf, onStatus }) -> Promise<{ok, ...}>
 *
 * connect() abre a autenticação numa nova aba e resolve sozinho assim que o
 * médico concluir por lá — não é preciso nenhum clique de confirmação manual
 * na aba original. Detecta a volta de duas formas, para não depender de só
 * uma: (1) postMessage da aba nova pra aba que abriu; (2) checagem periódica
 * (polling) do status da sessão, como reforço caso o postMessage falhe (ex.:
 * bloqueador de pop-up abrindo em nova janela sem referência de opener).
 */
(function () {
  // A própria Bry/PSC devolve "?state=<valor que enviamos>" anexado ao
  // redirectUri quando redireciona de volta (padrão OAuth) — não somos nós
  // que montamos essa URL, só lemos o que voltar.
  const STATE_PARAM = "state";
  const MESSAGE_TYPE = "integra_bry_linked";

  async function listPscs(token) {
    const res = await fetch("/api/signature/integra-bry/pscs", {
      headers: { Authorization: "Bearer " + token },
    });
    const j = await res.json().catch(() => ({ pscs: [] }));
    return j.pscs || [];
  }

  async function confirmCallback(token, state) {
    const res = await fetch("/api/signature/integra-bry/callback", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ state }),
    });
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok, ...j };
  }

  /**
   * Chamado uma única vez, no carregamento da página: se a URL tiver
   * ?integra_bry_state=..., esta aba É o retorno da certificadora. Confirma
   * sozinha, avisa a aba que abriu (se houver) e se fecha.
   */
  async function handleReturnIfAny() {
    const params = new URLSearchParams(location.search);
    const state = params.get(STATE_PARAM);
    if (!state) return;

    // Limpa a URL imediatamente, pra um F5 não tentar confirmar de novo.
    params.delete(STATE_PARAM);
    const cleanUrl = location.pathname + (params.toString() ? "?" + params.toString() : "") + location.hash;
    history.replaceState(null, "", cleanUrl);

    const showMessage = (html) => {
      document.body.innerHTML =
        '<div style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center;color:#0f172a">' +
        '<div>' + html + '</div></div>';
    };

    try {
      const { data } = await window.sb.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) {
        showMessage("<p>Sessão expirada. Feche esta aba e tente novamente.</p>");
        return;
      }
      const result = await confirmCallback(token, state);
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage({ type: MESSAGE_TYPE, state, result }, location.origin);
      }
      if (result.ok) {
        showMessage("<p>Certificado conectado com sucesso. Pode fechar esta aba.</p>");
        setTimeout(() => window.close(), 1200);
      } else {
        showMessage(
          "<p>Não foi possível confirmar o vínculo: " +
            (result.message || result.error || "erro desconhecido") +
            "</p><p>Feche esta aba e tente novamente.</p>",
        );
      }
    } catch (e) {
      showMessage("<p>Falha ao confirmar o vínculo: " + String(e) + "</p>");
    }
  }

  /**
   * Inicia o link com o PSC escolhido e resolve automaticamente assim que o
   * médico concluir a autenticação — sem precisar de clique de confirmação.
   * onStatus(text) é chamado com mensagens de progresso pra exibir na UI.
   */
  function connect(token, { pscName, cpf, onStatus }) {
    const notify = (msg) => {
      if (onStatus) onStatus(msg);
    };
    return new Promise((resolve, reject) => {
      (async () => {
        notify("Gerando link de autenticação…");
        let link;
        try {
          const redirectUri = location.origin + location.pathname;
          const res = await fetch("/api/signature/integra-bry/link", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
            body: JSON.stringify({ pscName, redirectUri, cpf: cpf || undefined }),
          });
          const j = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(j.message || j.error || "Falha ao gerar o link.");
          link = j;
        } catch (e) {
          reject(e);
          return;
        }

        const state = link.state;
        // O PSC/Bry devolve "?state=<valor>" anexado ao redirectUri quando
        // redireciona de volta (padrão OAuth) — handleReturnIfAny() lê isso
        // na aba nova. O polling abaixo é reforço caso isso falhe por algum
        // motivo (ex.: PSC que não preserva a query string do jeito esperado).
        notify("Abrindo autenticação em nova aba…");
        // Importante: NÃO usar "noopener" aqui — precisamos de window.opener
        // na aba nova pra ela avisar esta aba quando terminar.
        const popup = window.open(link.authorizationUrl, "_blank");
        if (!popup) {
          reject(new Error("O navegador bloqueou a nova aba. Permita pop-ups para este site e tente de novo."));
          return;
        }

        let done = false;
        const finish = (result, err) => {
          if (done) return;
          done = true;
          window.removeEventListener("message", onMessage);
          clearInterval(pollTimer);
          if (err) reject(err);
          else resolve(result);
        };

        const onMessage = (event) => {
          if (event.origin !== location.origin) return;
          if (event.data?.type !== MESSAGE_TYPE || event.data.state !== state) return;
          if (event.data.result?.ok) {
            notify("Certificado conectado.");
            finish(event.data.result);
          } else {
            finish(null, new Error(event.data.result?.message || event.data.result?.error || "Falha ao vincular."));
          }
        };
        window.addEventListener("message", onMessage);

        // Reforço: caso o postMessage não chegue (ex.: pop-up bloqueado e
        // aberto sem referência de opener), pergunta periodicamente se a
        // sessão já foi linkada, chamando o mesmo endpoint de callback com o
        // state que já temos aqui.
        let attempts = 0;
        const pollTimer = setInterval(async () => {
          attempts += 1;
          if (attempts > 150) {
            // ~10 min a 4s por tentativa
            finish(null, new Error("Tempo esgotado aguardando a confirmação."));
            return;
          }
          if (popup && popup.closed && attempts > 2) {
            // Deu tempo de pelo menos uma tentativa; se a aba já foi fechada
            // e ainda não confirmou, tenta uma última vez antes de desistir.
            try {
              const result = await confirmCallback(token, state);
              if (result.ok) {
                notify("Certificado conectado.");
                finish(result);
              } else {
                finish(null, new Error("Autenticação não concluída (aba fechada antes de autorizar)."));
              }
            } catch (e) {
              finish(null, e);
            }
            return;
          }
          try {
            const result = await confirmCallback(token, state);
            if (result.ok) {
              notify("Certificado conectado.");
              finish(result);
            }
            // Se não deu ok ainda, sessão pode simplesmente estar "pending"
            // (usuário ainda autenticando) — continua tentando em silêncio.
          } catch (e) {
            /* ignora erro de polling isolado, tenta de novo no próximo tick */
          }
        }, 4000);
      })();
    });
  }

  /**
   * Overlay autônomo (não depende de nenhum sistema de modal existente):
   * lista os PSCs, deixa o médico escolher, conecta e resolve. Pensado pra
   * ser chamado de QUALQUER tela (ex.: no meio da criação de uma receita,
   * quando a assinatura falha por falta de certificado ativo) sem navegar
   * pra lugar nenhum — o que estiver sendo editado na tela de trás continua
   * intacto. Rejeita se o médico clicar em "Cancelar".
   */
  function promptAndConnect(token, { cpf, title } = {}) {
    return new Promise((resolve, reject) => {
      const wrap = document.createElement("div");
      wrap.style.cssText =
        "position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif";
      wrap.innerHTML =
        '<div style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:18px;box-shadow:0 20px 50px rgba(0,0,0,.25)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
        '<b style="font-size:15px">' +
        (title || "Reconectar certificado digital") +
        "</b>" +
        '<button type="button" id="ibc-close" style="border:0;background:transparent;font-size:18px;cursor:pointer">×</button>' +
        "</div>" +
        '<div id="ibc-body" style="font-size:13px;color:#475569">Carregando certificadoras…</div>' +
        "</div>";
      document.body.appendChild(wrap);

      let settled = false;
      const finish = (ok, value) => {
        if (settled) return;
        settled = true;
        wrap.remove();
        if (ok) resolve(value);
        else reject(value);
      };
      wrap.addEventListener("click", (e) => {
        if (e.target === wrap) finish(false, new Error("Cancelado pelo usuário."));
      });
      wrap.querySelector("#ibc-close").onclick = () => finish(false, new Error("Cancelado pelo usuário."));

      const body = wrap.querySelector("#ibc-body");
      let pscsCache = null;

      function renderPscList() {
        body.innerHTML =
          '<div style="margin-bottom:8px">Escolha a certificadora onde seu certificado está hospedado:</div>' +
          '<div style="display:grid;gap:8px">' +
          pscsCache
            .map(
              (psc, i) =>
                '<button type="button" class="ibc-psc-opt" data-i="' +
                i +
                '" style="text-align:left;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;cursor:pointer;font-size:13px">' +
                (psc.provider ? psc.provider + " (" + psc.name + ")" : psc.name) +
                "</button>",
            )
            .join("") +
          "</div>";
        body.querySelectorAll(".ibc-psc-opt").forEach((btn, i) => {
          btn.onclick = () => connectToPsc(pscsCache[i]);
        });
      }

      async function connectToPsc(psc) {
        body.innerHTML = '<div id="ibc-status">Gerando link de autenticação…</div>';
        const statusEl = body.querySelector("#ibc-status");
        try {
          const result = await connect(token, {
            pscName: psc.name,
            cpf,
            onStatus: (text) => {
              statusEl.textContent = text;
            },
          });
          finish(true, result);
        } catch (e) {
          body.innerHTML =
            '<div style="color:#dc2626;margin-bottom:8px">' +
            (e && e.message ? e.message : String(e)) +
            "</div>" +
            '<button type="button" id="ibc-retry" style="padding:8px 12px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;margin-right:8px">Tentar de novo</button>' +
            '<button type="button" id="ibc-back" style="padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer">Escolher outra certificadora</button>';
          body.querySelector("#ibc-retry").onclick = () => connectToPsc(psc);
          body.querySelector("#ibc-back").onclick = () => renderPscList();
        }
      }

      (async () => {
        try {
          pscsCache = await listPscs(token);
          if (!pscsCache || pscsCache.length === 0) {
            body.innerHTML = '<div style="color:#dc2626">Não foi possível carregar a lista de certificadoras.</div>';
            return;
          }
          renderPscList();
        } catch (e) {
          body.innerHTML = '<div style="color:#dc2626">' + String(e) + "</div>";
        }
      })();
    });
  }

  window.IntegraBryConnect = { listPscs, connect, promptAndConnect };

  // Roda a checagem de retorno assim que o script carrega, em qualquer
  // página que o inclua.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", handleReturnIfAny);
  } else {
    handleReturnIfAny();
  }
})();
