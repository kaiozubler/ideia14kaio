// PLANO GATE — bloqueia telas fora do escopo do plano Free, mostrando um
// convite pra upgrade em vez de simplesmente deixar entrar.
//
// Escopo liberado no Free: "Receitas e Atestados" (emissão e consulta) +
// as telas de conta (Configurações, Meu plano), pra sempre dar pra ver o
// plano e fazer upgrade. Todo o resto exige plano pago.
//
// Design de segurança: em caso de qualquer dúvida (consulta falhou, tabela
// ainda não migrada, ainda carregando) o gate FALHA ABERTO -- ou seja,
// libera o acesso -- pra nunca travar por engano quem já paga. Só bloqueia
// quando confirma, com certeza, que não há assinatura paga vinculada à
// conta.
(function () {
  var TELAS_LIVRES_NO_FREE = ["receitas", "configuracoes", "meu-plano"];
  var estado = { carregado: false, ehFree: false };

  function sbClient() {
    return window.sb || window.__sb;
  }

  async function carregarPlano() {
    try {
      var sb = sbClient();
      if (!sb) return;
      var userRes = await sb.auth.getUser();
      var uid = userRes.data && userRes.data.user ? userRes.data.user.id : null;
      if (!uid) return;

      // Aplica downgrade/cancelamento agendados que já venceram (ver migration
      // meu_plano_gestao). Falha aqui (função ainda não migrada) não bloqueia.
      try { await sb.rpc("aplicar_agendamentos_assinatura"); } catch (e) {}

      var res = await sb.from("assinaturas").select("status").eq("medico_id", uid).neq("status", "cancelada").maybeSingle();
      // Só assume Free quando a consulta funcionou E não achou nenhuma linha.
      // Qualquer erro (tabela ausente, rede, etc.) mantém ehFree=false (fail-open).
      if (!res.error) estado.ehFree = !res.data;
    } catch (e) {
      // fail-open: mantém ehFree=false
    } finally {
      estado.carregado = true;
    }
  }
  carregarPlano();

  function mostrarConviteUpgrade() {
    var bg = document.createElement("div");
    bg.className = "mp-modal-bg";
    bg.innerHTML =
      '<div class="mp-modal">' +
      "<h3>Recurso do plano pago</h3>" +
      "<p>Essa área faz parte dos planos Basic, Pro ou Enterprise. Seu plano atual é o Free, com acesso a Receitas e Atestados.</p>" +
      '<div class="mp-modal-actions">' +
      '<button class="mp-btn primary" id="pg-ver-planos">Ver planos e fazer upgrade</button>' +
      '<button class="mp-btn" id="pg-fechar">Fechar</button>' +
      "</div></div>";
    document.body.appendChild(bg);
    bg.addEventListener("click", function (e) {
      if (e.target === bg) document.body.removeChild(bg);
    });
    bg.querySelector("#pg-fechar").onclick = function () {
      document.body.removeChild(bg);
    };
    bg.querySelector("#pg-ver-planos").onclick = function () {
      document.body.removeChild(bg);
      if (typeof window.goScreenOriginal === "function") window.goScreenOriginal("meu-plano");
    };
  }

  // goScreen é definido por um <script> inline mais acima no HTML, que roda
  // antes de scripts com defer -- mas por segurança, espera até 2s por ele
  // existir antes de "envolvê-lo", em vez de assumir a ordem de execução.
  var tentativas = 0;
  var esperar = setInterval(function () {
    tentativas++;
    if (typeof window.goScreen === "function" || tentativas > 40) {
      clearInterval(esperar);
      if (typeof window.goScreen !== "function") return;

      var original = window.goScreen;
      window.goScreenOriginal = original;
      window.goScreen = function (name) {
        if (estado.carregado && estado.ehFree && TELAS_LIVRES_NO_FREE.indexOf(name) === -1) {
          mostrarConviteUpgrade();
          return;
        }
        return original(name);
      };
    }
  }, 50);
})();
