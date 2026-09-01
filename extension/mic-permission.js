// Página aberta em aba normal só para exibir o prompt de permissão do
// microfone: no painel lateral (side panel) o Chrome descarta o pedido
// automaticamente ("Permission dismissed"), então pedimos aqui uma vez e a
// permissão passa a valer para toda a extensão.
const st = document.getElementById("st");

async function ask() {
  st.className = "";
  st.textContent = "Aguardando sua confirmação no navegador…";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    st.className = "ok";
    st.textContent = "Microfone liberado! Pode fechar esta aba e voltar ao painel.";
    setTimeout(() => window.close(), 1500);
  } catch (e) {
    st.className = "err";
    st.textContent =
      "Não foi possível liberar: " +
      (e?.message || e) +
      ". Verifique o ícone de câmera/microfone na barra de endereço do Chrome.";
  }
}

document.getElementById("ask").addEventListener("click", ask);
ask();
