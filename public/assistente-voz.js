/* Voz no Assistente IA (modal #ia-assist-modal de medicopilot.html).

   - Microfone da barra de digitação: grava e transcreve com o reconhecimento
     de voz do navegador; ao tocar de novo, envia o texto e a resposta é falada.
   - "Conversar ao vivo": escuta, envia sozinho quando o médico para de falar,
     fala a resposta e volta a escutar. Um de cada vez (o microfone fica
     desligado enquanto a IA fala), porque o eco da caixa de som seria
     transcrito como fala do médico; tocar no botão interrompe a fala.

   A transcrição é a do navegador (sem custo; a IA tolera erros). A voz vem de
   /api/ia/fala, que devolve um WAV inteiro por trecho e demora alguns
   segundos: por isso a resposta é cortada em frases, pedidas em paralelo e
   tocadas em ordem, e o texto aparece na tela antes da voz. */
(function () {
  "use strict";

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const SILENCIO_MS = 1300;
  const SILENCIO_INCOMPLETO_MS = 2400;
  const OCIOSO_MS = 45000;
  const MAX_DITADO_MS = 120000;
  const MAX_FALA = 520;
  const MAX_TRECHO = 220;
  const FRASE_ESPERA = "Um momento.";
  // (?:^|\s) em vez de \b: em JS o \b não reconhece acentos ("terça" terminaria em "a").
  const FINAL_INCOMPLETO =
    /(?:^|\s)(de|da|do|das|dos|para|pra|com|e|ou|que|o|a|os|as|em|no|na|um|uma|às|mais|por)$/iu;
  const ENCERRAR = /^(encerrar|encerra|encerre|sair|parar|pare)( a)?( conversa)?[.!]?$/i;

  let modo = null; // null | 'ditado' | 'vivo'
  let estado = "parado"; // 'ouvindo' | 'pensando' | 'falando'
  let rec = null;
  let textoFinal = "";
  let textoParcial = "";
  let baseDitado = "";
  let falarProxima = false;
  let tSilencio = 0,
    tOcioso = 0,
    tMax = 0,
    tEspera = 0;
  let ctx = null,
    saida = null,
    entrada = null,
    micStream = null,
    raf = 0,
    nivel = 0;
  let fala = null; // sessão de fala em andamento
  const fixas = new Map(); // frases curtas já geradas (AudioBuffer)

  const $ = (id) => document.getElementById(id);
  function aviso(msg, tipo) {
    if (typeof showToast === "function") showToast(msg, tipo || "error");
    else alert(msg);
  }
  function consultaGravando() {
    try {
      return typeof dgLive !== "undefined" && !!dgLive.active;
    } catch (e) {
      return false;
    }
  }
  function podeComecar() {
    if (!SR) {
      aviso("Este navegador não tem reconhecimento de voz. Use Chrome, Edge ou Safari.");
      return false;
    }
    if (consultaGravando()) {
      aviso("A gravação da consulta está ligada. Pause-a para falar com o assistente.");
      return false;
    }
    return true;
  }

  /* ---------------- Áudio ---------------- */
  function garantirAudio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      saida = ctx.createAnalyser();
      saida.fftSize = 512;
      saida.connect(ctx.destination);
      entrada = ctx.createAnalyser();
      entrada.fftSize = 512;
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  async function abrirMedidorMic() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      ctx.createMediaStreamSource(micStream).connect(entrada);
    } catch (e) {
      micStream = null; // sem medidor a esfera só gira; a escuta continua
    }
  }
  function fecharMedidorMic() {
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }

  function animarEsfera() {
    cancelAnimationFrame(raf);
    const orb = document.querySelector("#ia-voz-vivo .ia-voz-orb");
    if (!orb) return;
    const dados = new Uint8Array(512);
    const passo = () => {
      if (modo !== "vivo") {
        orb.style.setProperty("--nivel", "0");
        return;
      }
      const a = estado === "falando" ? saida : estado === "ouvindo" && micStream ? entrada : null;
      let n = 0;
      if (a) {
        a.getByteTimeDomainData(dados);
        let s = 0;
        for (let i = 0; i < dados.length; i++) {
          const x = (dados[i] - 128) / 128;
          s += x * x;
        }
        n = Math.min(1, Math.sqrt(s / dados.length) * 5);
      }
      nivel = nivel * 0.75 + n * 0.25;
      orb.style.setProperty("--nivel", nivel.toFixed(3));
      raf = requestAnimationFrame(passo);
    };
    passo();
  }

  async function gerarAudio(texto) {
    const r = await iaAuthFetch("/api/ia/fala", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
    });
    if (!r.ok) throw new Error("voz " + r.status);
    return ctx.decodeAudioData(await r.arrayBuffer());
  }

  function tocar(buffer, sessao) {
    return new Promise((resolve) => {
      const fonte = ctx.createBufferSource();
      fonte.buffer = buffer;
      fonte.connect(saida);
      fonte.onended = () => resolve();
      sessao.fonte = fonte;
      fonte.start();
    });
  }

  function pararFala() {
    const s = fala;
    fala = null;
    if (s) {
      s.cancelada = true;
      try {
        if (s.fonte) s.fonte.stop();
      } catch (e) {}
    }
    return s;
  }

  // Frase curta já pronta para cobrir a espera da resposta.
  function prepararFixa(texto) {
    if (fixas.has(texto)) return;
    fixas.set(texto, null);
    gerarAudio(texto)
      .then((b) => fixas.set(texto, b))
      .catch(() => fixas.delete(texto));
  }
  function tocarFixa(texto) {
    const buffer = fixas.get(texto);
    if (!buffer || fala) return;
    const sessao = { cancelada: false, fixa: true };
    sessao.fim = tocar(buffer, sessao).then(() => {
      if (fala === sessao) fala = null;
    });
    fala = sessao;
  }

  /* ---------------- Texto → trechos ---------------- */
  function limitar(texto) {
    const t = String(texto || "")
      .replace(/\s+/g, " ")
      .trim();
    if (t.length <= MAX_FALA) return t;
    const corte = t.slice(0, MAX_FALA);
    const fim = Math.max(corte.lastIndexOf(". "), corte.lastIndexOf("? "), corte.lastIndexOf("! "));
    return (fim > 120 ? corte.slice(0, fim + 1) : corte) + " Os detalhes estão na tela.";
  }

  function dividir(texto) {
    const protegido = texto.replace(/\b(Dr|Dra|Sr|Sra|nº|n)\./g, "$1§");
    const frases = protegido
      .split(/(?<=[.!?…;:])\s+/)
      .map((f) => f.replace(/§/g, ".").trim())
      .filter((f) => /[\p{L}\d]/u.test(f));
    // Sem pontuação, corta por palavras para nenhum trecho passar do limite.
    const porPalavras = (p) => {
      const out = [];
      let atual = "";
      for (const w of p.split(" ")) {
        if (atual && (atual + " " + w).length > MAX_TRECHO) {
          out.push(atual);
          atual = w;
        } else atual = atual ? atual + " " + w : w;
      }
      if (atual) out.push(atual);
      return out;
    };
    const trechos = [];
    for (const f of frases) {
      // A primeira frase fica curta (a voz demora mais quanto maior o texto,
      // e ela é a que o médico espera); frases longas cortam nas vírgulas.
      const limite = trechos.length ? MAX_TRECHO : 100;
      const partes = (f.length > limite ? f.split(/(?<=,)\s+/) : [f]).flatMap(porPalavras);
      for (const p of partes) {
        const ultimo = trechos[trechos.length - 1];
        if (ultimo && trechos.length > 1 && (ultimo + " " + p).length <= MAX_TRECHO)
          trechos[trechos.length - 1] = ultimo + " " + p;
        else trechos.push(p);
      }
    }
    return trechos;
  }

  async function falar(texto) {
    if (fala && fala.fixa) await fala.fim;
    pararFala();
    const trechos = dividir(limitar(texto));
    if (!trechos.length) return depoisDeFalar();
    const sessao = { cancelada: false, fonte: null };
    fala = sessao;
    if (modo === "vivo") definirEstado("falando");

    const pedidos = [];
    let proximo = 0;
    const pedir = () => {
      if (proximo < trechos.length) pedidos[proximo] = gerarAudio(trechos[proximo++]);
    };
    for (let i = 0; i < 3; i++) pedir();
    pedidos.forEach((p) => p.catch(() => {})); // evita aviso de promessa sem tratamento

    for (let i = 0; i < trechos.length; i++) {
      let buffer;
      try {
        buffer = await pedidos[i];
      } catch (e) {
        console.warn("[voz] falha ao gerar a voz:", e && e.message);
        if (i === 0) aviso("Não consegui gerar a voz agora. A resposta está na tela.", "info");
        break;
      }
      pedir();
      if (pedidos[proximo - 1]) pedidos[proximo - 1].catch(() => {});
      if (sessao.cancelada) return;
      await tocar(buffer, sessao);
      if (sessao.cancelada) return;
    }
    if (fala === sessao) fala = null;
    depoisDeFalar();
  }

  function depoisDeFalar() {
    if (modo === "vivo") ouvir();
    else definirEstado("parado");
  }

  /* ---------------- Reconhecimento ---------------- */
  function deveEscutar() {
    return modo === "ditado" || (modo === "vivo" && estado === "ouvindo");
  }

  function iniciarReconhecimento() {
    textoFinal = "";
    textoParcial = "";
    const r = new SR();
    r.lang = "pt-BR";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (ev) => {
      let parcial = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const t = ((res[0] && res[0].transcript) || "").trim();
        if (!t) continue;
        if (res.isFinal) textoFinal = (textoFinal + " " + t).trim();
        else parcial = (parcial + " " + t).trim();
      }
      textoParcial = parcial;
      aoOuvir();
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        aviso("O microfone está bloqueado para o reconhecimento de voz do navegador.");
        parar();
      }
    };
    // O navegador encerra o reconhecimento de tempos em tempos: enquanto a
    // escuta estiver ativa, ele é religado sem perder o texto já reconhecido.
    r.onend = () => {
      if (rec === r && deveEscutar()) {
        setTimeout(() => {
          if (rec === r && deveEscutar()) {
            try {
              r.start();
            } catch (e) {}
          }
        }, 200);
      }
    };
    rec = r;
    try {
      r.start();
    } catch (e) {
      aviso("Não foi possível ligar o microfone.");
      parar();
    }
  }

  function pararReconhecimento() {
    const r = rec;
    rec = null;
    clearTimeout(tSilencio);
    if (r) {
      try {
        r.abort();
      } catch (e) {}
    }
  }

  function textoOuvido() {
    return (textoFinal + " " + textoParcial).replace(/\s+/g, " ").trim();
  }

  function aoOuvir() {
    const inp = $("ia-assist-inp");
    const ouvido = textoOuvido();
    if (modo === "ditado") {
      if (inp) inp.value = [baseDitado, ouvido].filter(Boolean).join(" ");
      return;
    }
    if (modo !== "vivo" || estado !== "ouvindo") return;
    if (inp) inp.value = ouvido;
    reiniciarOcioso();
    clearTimeout(tSilencio);
    if (ouvido)
      tSilencio = setTimeout(
        fecharTurno,
        FINAL_INCOMPLETO.test(ouvido) ? SILENCIO_INCOMPLETO_MS : SILENCIO_MS,
      );
  }

  /* ---------------- Microfone: gravar e transcrever ---------------- */
  function alternarDitado() {
    if (modo === "ditado") return concluirDitado();
    if (modo === "vivo") return aviso("Encerre a conversa ao vivo antes de gravar.", "info");
    if (!podeComecar()) return;
    garantirAudio(); // precisa nascer no clique (Safari)
    pararFala();
    const inp = $("ia-assist-inp");
    baseDitado = inp ? inp.value.trim() : "";
    modo = "ditado";
    definirEstado("ouvindo");
    iniciarReconhecimento();
    tMax = setTimeout(concluirDitado, MAX_DITADO_MS);
  }

  function concluirDitado() {
    if (modo !== "ditado") return;
    const texto = [baseDitado, textoOuvido()].filter(Boolean).join(" ");
    encerrarDitado();
    const inp = $("ia-assist-inp");
    if (inp) inp.value = texto;
    if (texto && typeof sendIaAssistMsg === "function") {
      falarProxima = true;
      sendIaAssistMsg();
    }
  }

  function encerrarDitado() {
    clearTimeout(tMax);
    pararReconhecimento();
    modo = null;
    definirEstado("parado");
  }

  /* ---------------- Conversa ao vivo ---------------- */
  async function alternarVivo() {
    if (modo === "vivo") {
      if (estado === "falando") return interromper();
      return encerrarVivo();
    }
    if (!podeComecar()) return;
    if (modo === "ditado") encerrarDitado();
    garantirAudio();
    pararFala();
    modo = "vivo";
    ouvir();
    animarEsfera();
    prepararFixa(FRASE_ESPERA);
    await abrirMedidorMic();
  }

  function ouvir() {
    if (modo !== "vivo") return;
    definirEstado("ouvindo");
    iniciarReconhecimento();
    reiniciarOcioso();
  }

  function reiniciarOcioso() {
    clearTimeout(tOcioso);
    tOcioso = setTimeout(() => {
      if (modo === "vivo" && estado === "ouvindo") {
        encerrarVivo();
        aviso("Conversa ao vivo encerrada por falta de fala.", "info");
      }
    }, OCIOSO_MS);
  }

  function fecharTurno() {
    if (modo !== "vivo" || estado !== "ouvindo") return;
    const texto = textoOuvido();
    if (!texto) return;
    if (ENCERRAR.test(texto)) {
      const inp = $("ia-assist-inp");
      if (inp) inp.value = "";
      return encerrarVivo();
    }
    if (typeof iaAssistBusy !== "undefined" && iaAssistBusy) {
      tSilencio = setTimeout(fecharTurno, 400);
      return;
    }
    pararReconhecimento();
    clearTimeout(tOcioso);
    definirEstado("pensando");
    const inp = $("ia-assist-inp");
    if (inp) inp.value = texto;
    falarProxima = true;
    tEspera = setTimeout(() => {
      if (modo === "vivo" && estado === "pensando") tocarFixa(FRASE_ESPERA);
    }, 1800);
    sendIaAssistMsg();
  }

  function interromper() {
    pararFala();
    ouvir();
  }

  function encerrarVivo() {
    // O que estava sendo ouvido e não foi enviado não fica no campo.
    const inp = $("ia-assist-inp");
    if (inp && estado === "ouvindo" && inp.value === textoOuvido()) inp.value = "";
    clearTimeout(tOcioso);
    clearTimeout(tEspera);
    pararReconhecimento();
    pararFala();
    fecharMedidorMic();
    modo = null;
    falarProxima = false;
    definirEstado("parado");
  }

  /* ---------------- Tela ---------------- */
  const ROTULOS = {
    parado: "Conversar ao vivo",
    ouvindo: "Ouvindo… toque para encerrar",
    pensando: "Pensando…",
    falando: "Falando… toque para interromper",
  };

  function definirEstado(novo) {
    estado = novo;
    const mic = $("ia-voz-mic");
    if (mic) {
      const gravando = modo === "ditado";
      mic.classList.toggle("gravando", gravando);
      mic.title = gravando ? "Parar e enviar" : "Gravar e transcrever";
      mic.innerHTML = gravando
        ? '<i class="ti ti-player-stop-filled"></i>'
        : '<i class="ti ti-microphone"></i>';
    }
    const vivo = $("ia-voz-vivo");
    if (vivo) {
      const ativo = modo === "vivo";
      vivo.classList.toggle("ativo", ativo);
      vivo.dataset.estado = ativo ? novo : "parado";
      const rotulo = $("ia-voz-rotulo");
      if (rotulo) rotulo.textContent = ROTULOS[ativo ? novo : "parado"];
    }
  }

  /* ---------------- Ganchos chamados por sendIaAssistMsg ---------------- */
  // Antes de ler o campo: se o médico apertou Enter durante a gravação, o
  // texto vai como está e a resposta também é falada.
  function aoEnviar() {
    if (modo === "ditado") {
      const texto = [baseDitado, textoOuvido()].filter(Boolean).join(" ");
      encerrarDitado();
      const inp = $("ia-assist-inp");
      if (inp && texto) inp.value = texto;
      falarProxima = true;
    }
  }

  function aoResponder(resposta) {
    clearTimeout(tEspera);
    if (!falarProxima) return;
    falarProxima = false;
    falar(resposta);
  }

  // Fim da chamada (sucesso ou erro): se nada foi falado, volta a escutar.
  function aoTerminar() {
    clearTimeout(tEspera);
    if (falarProxima) {
      falarProxima = false;
      if (modo === "vivo" && estado === "pensando") ouvir();
    }
  }

  function parar() {
    if (modo === "ditado") encerrarDitado();
    if (modo === "vivo") encerrarVivo();
    pararFala();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && modo) parar();
  });

  window.IaVoz = {
    alternarDitado,
    alternarVivo,
    aoEnviar,
    aoResponder,
    aoTerminar,
    parar,
    // Só para conferência: como uma resposta seria cortada para a voz.
    trechos: (texto) => dividir(limitar(texto)),
  };
})();
