// Registro de uso para o Zubler CRM: uma linha em uso_eventos quando o app
// abre com uma sessão ('acesso') e a cada troca de tela ('tela'). O banco
// completa o login, a clínica e a hora (trigger uso_eventos_preencher).
// Falha aqui nunca atrapalha o app: o registro é descartado em silêncio.
(function(){
  var ativo=false, ultimaTela=null, ultimaEm=0, acessoRegistrado=false;
  var TELA_OK=/^[a-z0-9-]{1,40}$/;

  function gravar(linha){
    try{
      var sb=window.sb;
      if(!ativo||!sb)return;
      sb.from('uso_eventos').insert(linha).then(function(r){
        if(r&&r.error)console.warn('[uso] não registrado:',r.error.message);
      },function(){});
    }catch(e){}
  }

  // Chamado ao entrar no app com uma sessão (login ou app reaberto).
  function entrar(){
    ativo=true;
    if(acessoRegistrado)return;
    acessoRegistrado=true;
    gravar({tipo:'acesso'});
  }

  // Chamado por goScreen. A mesma tela em menos de 30s conta uma vez só.
  function tela(nome){
    if(!ativo||typeof nome!=='string'||!TELA_OK.test(nome))return;
    var agora=Date.now();
    if(nome===ultimaTela&&agora-ultimaEm<30000)return;
    ultimaTela=nome;ultimaEm=agora;
    gravar({tipo:'tela',tela:nome});
  }

  window.MCUso={entrar:entrar,tela:tela};
})();
