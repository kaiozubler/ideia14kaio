/* Tour guiado do MediCopilot: um passo a passo por tela, com destaque no
   elemento explicado. Abre sozinho na primeira visita de cada tela por usuário
   (user_metadata.tours_vistos) e pode ser aberto ou reiniciado a qualquer
   momento pelo botão "?" do topo, que sempre usa a tela visível.
   Passos sem `alvo` aparecem centralizados; passos cujo alvo não está visível
   (aba fechada, botão só do médico, lista vazia) são pulados. */
(function(){
  var TOURS={
    atendimentos:{nome:'Atendimentos',pronto:'#ak-board .ak-col',passos:[
      {titulo:'Bem-vindo(a) ao MediCopilot',texto:'Esta é a tela inicial: o quadro do dia da clínica, da chegada do paciente até o fim da consulta.'},
      {alvo:'#ak-board',titulo:'Quadro de etapas',texto:'Cada coluna é uma etapa (agendado, espera, triagem, consultório, concluído). Arraste o cartão para mover o paciente. Recepção, triagem e consultório veem o mesmo quadro em tempo real.'},
      {alvo:'#ak-board .ak-col-cfg',medico:true,titulo:'Configure as etapas',texto:'Renomeie, mude a cor ou defina para onde cada etapa encaminha o paciente.'},
      {alvo:'#ak-resumo',titulo:'Resumo do período',texto:'Quem está aguardando, a maior espera, quem está no consultório, atendidos e faltas.'},
      {alvo:'#atd-search-input',titulo:'Buscar no quadro',texto:'Filtre os cartões pelo nome do paciente.'},
      {alvo:'#atd-period-select',titulo:'Período',texto:'Veja hoje, a semana, o mês ou um intervalo personalizado.'},
      {alvo:'#s-atendimentos .atd-bar button[onclick*="encaixe"]',titulo:'Encaixe',texto:'Para o paciente que chegou sem agendamento: ele entra direto no quadro.'},
      {alvo:'#s-atendimentos .atd-bar button[onclick*="iniciarNovoAtendimento"]',medico:true,titulo:'Iniciar atendimento',texto:'Escolha o paciente e abra a consulta com o copiloto de IA.'},
      {alvo:'.ia-assist-launcher',titulo:'Assistente IA',texto:'Peça em linguagem natural, por exemplo "agende a Maria amanhã às 14h".'},
      {alvo:'#nav-tour',titulo:'Reveja quando quiser',texto:'Cada tela tem seu próprio tour. Clique aqui para abri-lo de novo ou recomeçar do início.'}
    ]},
    patients:{nome:'Pacientes',pronto:'#search-input',passos:[
      {titulo:'Pacientes',texto:'Cadastro de todos os pacientes da clínica, com busca e ações em massa.'},
      {alvo:'#search-input',titulo:'Busca rápida',texto:'Procure por nome, CPF, telefone ou cartão SUS.'},
      {alvo:'#adv-toggle-btn',titulo:'Filtros avançados',texto:'Combine convênio, cidade, sexo, grupo e data do último atendimento.'},
      {alvo:'#results-card',titulo:'Lista de pacientes',texto:'Clique em um paciente para abrir a ficha. Marque as caixas para enviar mensagem, agendar, dar entrada ou exportar vários de uma vez.'},
      {alvo:'#pt-sort',titulo:'Ordenação',texto:'Ordene por nome ou pelo atendimento mais recente/antigo.'},
      {alvo:'#s-patients .results-hd .btn.primary',titulo:'Novo paciente',texto:'Cadastre um paciente. O CEP preenche o endereço sozinho.'}
    ]},
    'patient-detail':{nome:'Ficha do paciente',pronto:'#pt-hdr-card',passos:[
      {alvo:'#pt-hdr-card',titulo:'Cabeçalho do paciente',texto:'Idade, convênio, profissional responsável e data da última consulta.'},
      {alvo:'#tabs-row',medico:true,titulo:'Abas da ficha',texto:'Cadastro, Atendimentos, Exames, Protocolos, Financeiro, Agenda, Timeline e Prontuário completo.'},
      {alvo:'#tb-cadastro',titulo:'Cadastro',texto:'Edite os dados pessoais e salve no botão flutuante no rodapé.'},
      {alvo:'#s-patient-detail .pth-actions',medico:true,titulo:'Ações do prontuário',texto:'Exporte ou imprima o prontuário, veja a memória do paciente alimentada pelas IAs e outras ações.'},
      {medico:true,titulo:'Nova consulta',texto:'Na aba Atendimentos, clique em "Novo atendimento" para abrir a consulta com o copiloto.'},
      {medico:true,titulo:'Nada se perde',texto:'Registros clínicos não são excluídos. Cada edição guarda a versão anterior no histórico, visível na tela e na impressão.'}
    ]},
    consulta:{nome:'Consulta',pronto:'#atend-novo-view #pront-area',passos:[
      {titulo:'Consulta em andamento',texto:'À esquerda, o prontuário; à direita, o copiloto de IA. Tudo é salvo como rascunho automaticamente.'},
      {alvo:'#atd-triagem-box',titulo:'Triagem do dia',texto:'Se houve triagem, ela aparece aqui para inserir no prontuário.'},
      {alvo:'#pront-area',titulo:'Prontuário',texto:'Escreva a evolução. Use a barra para negrito, itálico e nota interna (grifada em amarelo).'},
      {alvo:'#listen-btn',titulo:'Escutar',texto:'Grava e transcreve a consulta em tempo real para a IA acompanhar.'},
      {alvo:'#trans-bar',titulo:'Transcrição',texto:'Acompanhe o que está sendo captado. Expanda para ler tudo.'},
      {alvo:'#ai-stage',titulo:'Copiloto',texto:'A IA mostra perguntas, alertas e pendências de protocolo. Fixe as mais importantes.'},
      {alvo:'#sug-grp',titulo:'Sugestões',texto:'Peça uma sugestão de conduta ou de pergunta para guiar a consulta.'},
      {alvo:'#executar-btn',titulo:'Comando de voz',texto:'Execute o que você ditou, como "agendar retorno em 30 dias". As tarefas ficam na bandeja do topo.'},
      {alvo:'#ai-inp',titulo:'Conversa com a IA',texto:'Pergunte ao copiloto ou anexe um exame em PDF/imagem para análise.'},
      {alvo:'#actions-dropdown',titulo:'Documentos',texto:'Emita receita, atestado, pedido de exames, LME, anexe arquivos ou agende.'},
      {alvo:'#global-save-chip',titulo:'Salvar e finalizar',texto:'Conclui a consulta e move o paciente para "Concluído" no quadro.'}
    ]},
    receitas:{nome:'Receitas e Atestados',pronto:'#rx-doc-search',passos:[
      {titulo:'Receitas e Atestados',texto:'Todos os documentos emitidos, com status de assinatura digital.'},
      {alvo:'#rx-doc-search',titulo:'Buscar',texto:'Encontre documentos pelo paciente ou tipo.'},
      {alvo:'#rx-doc-periodo',titulo:'Período',texto:'Filtre por hoje, semana, mês ou ano.'},
      {alvo:'#s-receitas .rx-doc-toolbar .btn.primary',titulo:'Gerar documento',texto:'Crie receita, atestado ou pedido de exame avulso, fora da consulta.'},
      {alvo:'#s-receitas .rx-doc-card',titulo:'Lista',texto:'Veja, baixe ou reenvie cada documento ao paciente.'}
    ]},
    agenda:{nome:'Agenda',pronto:'#ag-body',passos:[
      {titulo:'Agenda',texto:'Consultas da clínica por dia, semana ou mês.'},
      {alvo:'#s-agenda .ag-new-btn',titulo:'Novo agendamento',texto:'Marque presencial ou por vídeo. A confirmação pode ir pelo WhatsApp.'},
      {alvo:'#s-agenda .ag-views',titulo:'Visualização',texto:'Alterne entre diário, semanal e mensal.'},
      {alvo:'#ag-doctor',titulo:'Profissional',texto:'Veja a agenda de um médico ou de todos.'},
      {alvo:'#ag-fbtn',titulo:'Filtros',texto:'Filtre por especialidade e status: confirmado, faltoso, compareceu…'},
      {alvo:'#ag-body',titulo:'Calendário',texto:'Clique em uma consulta para confirmar, remarcar ou dar entrada no quadro.'}
    ]},
    conversas:{nome:'Conversas',pronto:'#cv-list',passos:[
      {titulo:'Conversas',texto:'WhatsApp da clínica com os pacientes, em um só lugar.'},
      {alvo:'#cv-tabs',titulo:'Filas',texto:'Separe conversas abertas, não lidas e finalizadas.'},
      {alvo:'#cv-search',titulo:'Buscar',texto:'Encontre a conversa pelo nome ou telefone.'},
      {alvo:'#s-conversas .cv-newbtn',titulo:'Nova conversa',texto:'Inicie uma conversa com um paciente usando um modelo aprovado.'},
      {alvo:'#cv-list',titulo:'Atendimentos',texto:'Abra uma conversa e clique em "Assumir" para responder.'},
      {alvo:'#s-conversas .cv-input-row',titulo:'Responder',texto:'Envie texto, respostas rápidas e documentos. Fora da janela de 24h, use um modelo.'}
    ]},
    protocolos:{nome:'Protocolos',pronto:'#s-protocolos .pt-head',passos:[
      {titulo:'Protocolos assistenciais',texto:'Acompanhamento contínuo por CID: o sistema gera tarefas de consulta, exame e alerta para cada paciente.'},
      {alvo:'#s-protocolos [data-goprot]',titulo:'Meus protocolos',texto:'Crie, edite ou gere protocolos com IA e desenhe o fluxo no Studio.'},
      {alvo:'#s-protocolos .pt-toolbar',titulo:'Buscar e agrupar',texto:'Procure por paciente, CID ou ação e agrupe por paciente ou protocolo.'},
      {alvo:'#s-protocolos .pt-table',titulo:'Tarefas',texto:'Para cada pendência: avise o paciente, adie ou ignore. Marque várias para agir em massa.'},
      {alvo:'#s-protocolos .pt-legend',titulo:'Status',texto:'As cores indicam a situação de cada tarefa.'}
    ]},
    questionarios:{nome:'Questionário',pronto:'#s-questionarios .qz-head',passos:[
      {titulo:'Questionários',texto:'Formulários e termos enviados aos pacientes e suas respostas.'},
      {alvo:'#s-questionarios [data-gomeus]',titulo:'Meus formulários',texto:'Crie formulários (nominais ou anônimos), manualmente ou com IA, e compartilhe o link.'},
      {alvo:'#s-questionarios [data-gotermos]',titulo:'Meus termos',texto:'Termos de consentimento para o paciente assinar online.'},
      {alvo:'#s-questionarios .qz-toolbar',titulo:'Filtrar respostas',texto:'Busque por paciente ou formulário.'},
      {alvo:'#s-questionarios .qz-table',titulo:'Respostas',texto:'Abra cada resposta para ler o que o paciente preencheu.'}
    ]},
    faturamento:{nome:'Faturamento',pronto:'#s-faturamento .fa-head',passos:[
      {titulo:'Faturamento',texto:'Recebimentos, serviços, notas fiscais, contas e comissões em um só lugar.'},
      {alvo:'#s-faturamento .fa-head',titulo:'Lançar',texto:'Registre entradas (recebimentos) e saídas (pagamentos).'},
      {alvo:'#s-faturamento .fa-cards',titulo:'Indicadores',texto:'Totais do período: recebido, a receber, atrasado e a pagar.'},
      {alvo:'#s-faturamento .fa-views',titulo:'Visões',texto:'Lançamentos, Trabalhos (serviços recorrentes), Clientes e Notas fiscais.'},
      {alvo:'#s-faturamento .fa-tabsrow',titulo:'Situação',texto:'Filtre por a receber, recebidos, atrasados, a pagar e comissões.'}
    ]},
    indicadores:{nome:'Indicadores',pronto:'#s-indicadores .kpi-grid',passos:[
      {alvo:'#s-indicadores .kpi-grid',titulo:'Indicadores',texto:'Números do mês: atendimentos, novos pacientes, documentos e tempo médio de consulta.'},
      {alvo:'#chart-bars',titulo:'Evolução',texto:'Acompanhe o volume de atendimentos ao longo do tempo.'}
    ]},
    'mapa-familiar':{nome:'Mapa Familiar',pronto:'#mf-busca-nome',passos:[
      {titulo:'Mapa Familiar',texto:'Famílias montadas a partir dos parentescos cadastrados, para ver doenças que se repetem.'},
      {alvo:'#mf-busca-nome',titulo:'Buscar família',texto:'Procure por paciente ou sobrenome.'},
      {alvo:'#mf-busca-cid',titulo:'Buscar por CID',texto:'Encontre famílias com um diagnóstico em comum.'},
      {alvo:'#mf-somente-consang',titulo:'Consanguíneos',texto:'Considere só parentes de sangue na análise de CID.'},
      {alvo:'#mf-familias-list',titulo:'Famílias',texto:'Abra uma família para ver a árvore e os CIDs de cada membro.'}
    ]},
    secretaria:{nome:'Secretária digital',passos:[
      {titulo:'Secretária digital',texto:'Em breve: agendamentos, confirmações e triagem automatizados por IA.'}
    ]},
    anamnese:{nome:'Gerador de Anamnese',pronto:'#anamnese-list',passos:[
      {titulo:'Gerador de Anamnese',texto:'Modelos (prompts) que a IA usa para transformar a consulta em anamnese no seu formato.'},
      {alvo:'#s-anamnese .btn.primary',titulo:'Novo prompt',texto:'Crie um modelo com a estrutura e o tom que você prefere.'},
      {alvo:'#anamnese-list',titulo:'Seus modelos',texto:'Edite, ative ou remova modelos existentes.'}
    ]},
    copiloto:{nome:'Copiloto de consulta',pronto:'#cop-enabled',passos:[
      {titulo:'Copiloto de consulta',texto:'Ajuste como a IA se comporta durante o atendimento.'},
      {alvo:'#cop-voz',titulo:'Gravação de voz',texto:'Permita a gravação e, se quiser, que ela comece sozinha ao abrir a consulta.'},
      {alvo:'#cop-tipo',titulo:'Tipo de copiloto',texto:'Ativo: a IA sugere por conta própria. Reativo: só responde quando você pede.'},
      {alvo:'#cop-freq',titulo:'Frequência',texto:'De quanto em quanto tempo a IA analisa a conversa.'},
      {alvo:'#cop-perguntas',titulo:'Recursos inteligentes',texto:'Perguntas iniciais, memória do paciente, pendências de protocolo e insight final.'},
      {alvo:'#s-copiloto button[onclick*="saveCopilotoCfg"]',titulo:'Salvar',texto:'Salve para aplicar nas próximas consultas.'}
    ]},
    'base-conhecimento':{nome:'Base de conhecimento',pronto:'#s-base-conhecimento .bk-tabs',passos:[
      {titulo:'Base de conhecimento',texto:'Materiais próprios que as IAs consultam ao responder.'},
      {alvo:'#s-base-conhecimento .bk-tabs',titulo:'Bases e atalhos',texto:'Bases guardam documentos; atalhos são comandos de voz personalizados.'},
      {alvo:'#s-base-conhecimento [data-newbase]',titulo:'Nova base',texto:'Envie PDF, TXT ou cole texto e escolha quais IAs podem usá-la.'}
    ]},
    configuracoes:{nome:'Configurações',passos:[
      {alvo:'#s-configuracoes .cfg-group:has([onclick*="equipe"])',titulo:'Organização',texto:'Minha equipe: convide secretárias e enfermagem. Minha clínica: dados, logo e triagem.'},
      {alvo:'#s-configuracoes .cfg-group:has([onclick*="whatsapp-pacientes"])',titulo:'Comunicação',texto:'Conecte o WhatsApp da clínica para conversar com os pacientes.'},
      {alvo:'#s-configuracoes .cfg-group:has([onclick*="meu-plano"])',titulo:'Assinatura',texto:'Plano, consumo, créditos e pagamentos.'}
    ]},
    equipe:{nome:'Minha equipe',pronto:'#s-equipe .eq-head',passos:[
      {titulo:'Usuários e permissões',texto:'Cada membro entra com login próprio e só vê o que o papel permite. O prontuário é exclusivo do médico.'},
      {alvo:'#eq-open-invite',titulo:'Convidar usuário',texto:'Gere um link de convite (válido por 7 dias) para o e-mail da pessoa.'},
      {alvo:'#eq-open-groups',titulo:'Grupos de acesso',texto:'Defina permissões por grupo.'},
      {alvo:'#eq-search-input',titulo:'Buscar membro',texto:'Encontre por nome ou e-mail para editar, bloquear ou ajustar a agenda.'}
    ]},
    clinica:{nome:'Minha clínica',pronto:'#cli-fantasia',passos:[
      {titulo:'Minha clínica',texto:'Dados que aparecem no cabeçalho de receitas, atestados e documentos.'},
      {alvo:'#cli-logo-preview',titulo:'Logo',texto:'Envie a logo da clínica (até 2 MB).'},
      {alvo:'#cli-fantasia',titulo:'Dados cadastrais',texto:'Nome, CNPJ/CPF e endereço. O CEP preenche o restante.'},
      {alvo:'#cli-triagem',titulo:'Triagem',texto:'Ligue se a clínica faz triagem antes do médico. Desligada, o paciente vai direto ao consultório.'}
    ]},
    'meu-plano':{nome:'Meu plano',pronto:'#s-meu-plano .mp-tabs',passos:[
      {titulo:'Meu plano',texto:'Sua assinatura do MediCopilot.'},
      {alvo:'#s-meu-plano .mp-tabs',titulo:'Abas',texto:'Visão geral, troca de plano, consumo de IA, carteira de créditos e histórico de pagamentos.'}
    ]},
    'whatsapp-pacientes':{nome:'WhatsApp dos pacientes',pronto:'#s-whatsapp-pacientes .wp-tabs',passos:[
      {alvo:'#s-whatsapp-pacientes .wp-head',titulo:'WhatsApp dos pacientes',texto:'Conecte o WhatsApp Business da clínica (API oficial da Meta). É diferente do WhatsApp do assistente.'},
      {alvo:'#s-whatsapp-pacientes .wp-tabs',titulo:'Configuração',texto:'Conexão: credenciais da Meta. Modelos: mensagens aprovadas. Automações: lembretes e envio de documentos.'}
    ]}
  };
  var TELAS=Object.keys(TOURS);

  var vistos=null;      // Set das telas cujo tour já abriu sozinho; null antes do login
  var aberto=null;      // {tela, passos, i}
  var esperaAuto=null;  // timer da abertura automática pendente
  var els={};

  /* ---------- utilidades ---------- */
  function visivel(el){
    if(!el||!el.getClientRects().length)return false;
    var r=el.getBoundingClientRect();
    return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden';
  }
  function achar(sel){
    var lista=document.querySelectorAll(sel);
    for(var i=0;i<lista.length;i++)if(visivel(lista[i]))return lista[i];
    return null;
  }
  function ehEquipe(){return typeof window.ehMembroEquipe==='function'&&window.ehMembroEquipe();}

  function telaAtual(){
    if(visivel(document.getElementById('atend-novo-view')))return 'consulta';
    for(var i=0;i<TELAS.length;i++){
      if(visivel(document.getElementById('s-'+TELAS[i])))return TELAS[i];
    }
    return null;
  }

  /* ---------- DOM do tour ---------- */
  function montar(){
    if(els.balao)return;
    els.bloqueio=document.createElement('div');els.bloqueio.className='tour-bloqueio';
    els.recorte=document.createElement('div');els.recorte.className='tour-recorte';
    els.balao=document.createElement('div');els.balao.className='tour-balao';
    els.balao.setAttribute('role','dialog');els.balao.setAttribute('aria-modal','true');
    els.balao.innerHTML=
      '<div class="tour-topo"><span class="tour-tela"></span><span class="tour-passo"></span>'+
      '<button class="tour-fechar" data-tour="fechar" title="Fechar tour" aria-label="Fechar tour"><i class="ti ti-x"></i></button></div>'+
      '<h3 class="tour-titulo"></h3><p class="tour-texto"></p><div class="tour-pontos"></div>'+
      '<div class="tour-acoes">'+
      '<button class="tour-btn leve tour-reiniciar" data-tour="reiniciar" title="Recomeçar do primeiro passo"><i class="ti ti-rotate"></i> Reiniciar</button>'+
      '<button class="tour-btn" data-tour="voltar"><i class="ti ti-chevron-left"></i> Anterior</button>'+
      '<button class="tour-btn primario" data-tour="avancar"></button></div>';
    els.balao.addEventListener('click',function(ev){
      var b=ev.target.closest('[data-tour]');if(!b)return;
      var a=b.getAttribute('data-tour');
      if(a==='fechar')fechar();
      else if(a==='reiniciar')ir(0,1);
      else if(a==='voltar')ir(aberto.i-1,-1);
      else if(a==='avancar')ir(aberto.i+1,1);
    });
  }

  function abrir(tela){
    var t=TOURS[tela];if(!t)return false;
    var equipe=ehEquipe();
    var passos=t.passos.filter(function(p){return !(p.medico&&equipe);});
    if(!passos.length)return false;
    if(aberto)fechar();
    montar();
    aberto={tela:tela,passos:passos,i:-1};
    document.body.appendChild(els.bloqueio);document.body.appendChild(els.recorte);document.body.appendChild(els.balao);
    document.addEventListener('keydown',teclado,true);
    window.addEventListener('resize',posicionar);
    window.addEventListener('scroll',posicionar,true);
    ir(0,1);
    return true;
  }

  function fechar(){
    if(!aberto)return;
    aberto=null;
    [els.bloqueio,els.recorte,els.balao].forEach(function(e){if(e&&e.parentNode)e.parentNode.removeChild(e);});
    document.removeEventListener('keydown',teclado,true);
    window.removeEventListener('resize',posicionar);
    window.removeEventListener('scroll',posicionar,true);
  }

  // Vai ao passo i; se o alvo dele não estiver visível, segue na direção `dir`.
  function ir(i,dir){
    if(!aberto)return;
    var n=aberto.passos.length;
    while(i>=0&&i<n){
      var p=aberto.passos[i];
      if(!p.alvo||achar(p.alvo))break;
      i+=dir;
    }
    if(i>=n){fechar();return;}
    if(i<0)return;
    aberto.i=i;
    var p=aberto.passos[i];
    var b=els.balao;
    // Contagem só dos passos que existem agora, para não "pular" números.
    var disp=aberto.passos.filter(function(q,k){return k===i||!q.alvo||achar(q.alvo);});
    var pos=disp.indexOf(p);
    b.querySelector('.tour-tela').textContent=TOURS[aberto.tela].nome;
    b.querySelector('.tour-passo').textContent=(pos+1)+' de '+disp.length;
    b.querySelector('.tour-titulo').textContent=p.titulo;
    b.querySelector('.tour-texto').textContent=p.texto;
    var pontos='';for(var k=0;k<disp.length;k++)pontos+='<span'+(k===pos?' class="on"':'')+'></span>';
    b.querySelector('.tour-pontos').innerHTML=pontos;
    b.querySelector('[data-tour="voltar"]').disabled=!temPasso(i-1,-1);
    b.querySelector('[data-tour="reiniciar"]').style.visibility=i>0?'visible':'hidden';
    var fim=!temPasso(i+1,1);
    b.querySelector('[data-tour="avancar"]').innerHTML=fim?'Concluir <i class="ti ti-check"></i>':'Próximo <i class="ti ti-chevron-right"></i>';
    var alvo=p.alvo&&achar(p.alvo);
    if(alvo){
      var r=alvo.getBoundingClientRect();
      if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth)alvo.scrollIntoView({block:'center',inline:'nearest'});
    }
    posicionar();
    b.querySelector('[data-tour="avancar"]').focus({preventScroll:true});
  }
  function temPasso(i,dir){
    if(!aberto)return false;
    for(;i>=0&&i<aberto.passos.length;i+=dir){
      var p=aberto.passos[i];
      if(!p.alvo||achar(p.alvo))return true;
    }
    return false;
  }

  function posicionar(){
    if(!aberto||aberto.i<0)return;
    var p=aberto.passos[aberto.i];
    var alvo=p.alvo&&achar(p.alvo);
    var b=els.balao,rc=els.recorte;
    if(!alvo){
      rc.style.display='none';
      els.bloqueio.classList.add('sem-alvo');
      b.classList.add('centro');
      return;
    }
    els.bloqueio.classList.remove('sem-alvo');
    b.classList.remove('centro');
    var M=6,G=12,W=innerWidth,H=innerHeight;
    var r=alvo.getBoundingClientRect();
    var top=Math.max(r.top-M,4),left=Math.max(r.left-M,4);
    var bottom=Math.min(r.bottom+M,H-4),right=Math.min(r.right+M,W-4);
    rc.style.display='block';
    rc.style.top=top+'px';rc.style.left=left+'px';
    rc.style.width=Math.max(right-left,0)+'px';rc.style.height=Math.max(bottom-top,0)+'px';

    var bw=b.offsetWidth,bh=b.offsetHeight,x,y;
    if(H-bottom>=bh+G){y=bottom+G;x=left;}
    else if(top>=bh+G){y=top-G-bh;x=left;}
    else if(W-right>=bw+G){x=right+G;y=top;}
    else if(left>=bw+G){x=left-G-bw;y=top;}
    else{x=W-bw-G;y=H-bh-G;} // alvo ocupa a tela toda: balão no canto, por cima
    b.style.left=Math.min(Math.max(x,G),W-bw-G)+'px';
    b.style.top=Math.min(Math.max(y,G),H-bh-G)+'px';
  }

  function teclado(ev){
    if(!aberto)return;
    if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();fechar();}
    else if(ev.key==='ArrowRight'){ev.preventDefault();ir(aberto.i+1,1);}
    else if(ev.key==='ArrowLeft'){ev.preventDefault();if(temPasso(aberto.i-1,-1))ir(aberto.i-1,-1);}
  }

  /* ---------- abertura automática ---------- */
  function marcarVisto(tela){
    vistos.add(tela);
    var sb=window.sb;if(!sb)return;
    sb.auth.updateUser({data:{tours_vistos:Array.from(vistos)}}).then(function(r){
      if(r.error)console.warn('[tour] não foi possível salvar os tours vistos:',r.error.message);
    });
  }

  // Chamado ao entrar em uma tela: na primeira visita do usuário, espera a tela
  // terminar de carregar (seletor `pronto`) e abre o tour dela.
  function aoEntrarNaTela(tela){
    clearTimeout(esperaAuto);
    if(!vistos||!TOURS[tela]||vistos.has(tela)||aberto)return;
    var t=TOURS[tela],inicio=Date.now();
    (function tentar(){
      esperaAuto=setTimeout(function(){
        if(aberto||vistos.has(tela)||telaAtual()!==tela)return;
        // Espera a tela carregar e nenhum modal estar aberto (até 6s).
        var ocupado=(t.pronto&&!achar(t.pronto))||visivel(document.getElementById('modal-overlay'));
        if(ocupado&&Date.now()-inicio<6000){tentar();return;}
        if(abrir(tela))marcarVisto(tela);
      },400);
    })();
  }

  // Chamado no login com o usuário da sessão.
  function doUsuario(user){
    var v=user&&user.user_metadata&&user.user_metadata.tours_vistos;
    vistos=new Set(Array.isArray(v)?v:[]);
  }

  // Botão "?" do topo: abre o tour da tela visível, do primeiro passo.
  function abrirTelaAtual(){
    clearTimeout(esperaAuto);
    var tela=telaAtual();
    if(!tela||!abrir(tela)){
      if(typeof window.showToast==='function')window.showToast('Esta tela ainda não tem tour guiado.','error');
      return;
    }
    if(vistos&&!vistos.has(tela))marcarVisto(tela);
  }

  window.MCTour={doUsuario:doUsuario,aoEntrarNaTela:aoEntrarNaTela,abrir:abrir,abrirTelaAtual:abrirTelaAtual,fechar:fechar,telaAtual:telaAtual,TOURS:TOURS};
})();
