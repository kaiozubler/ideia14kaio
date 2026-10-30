/* Modo escuro do MediCopilot.
   Os tokens ficam em tema-escuro.css; este script converte as cores fixas (hex,
   rgb, gradientes, sombras) das folhas de estilo e dos style="" gerados em JS,
   guardando o valor original de cada propriedade para voltar ao claro sem reload.
   A preferência é do usuário (user_metadata.tema), com cópia em localStorage só
   para aplicar o tema antes do login terminar e evitar o clarão inicial.
   Documentos (prévias e holders do html2pdf) ficam de fora: são papel branco. */
(function(){
  var ATTR='data-tema';
  var CACHE_KEY='mcTema';
  var ZONAS_PAPEL='.ia-prev-sheet,[id^="rx-scope-"],[id^="lme-scope-"],[id^="ex-scope-"],[id^="ia-rx-"],[id^="ia-ex-"],.html2pdf__overlay,[data-tema-ignorar]';
  // Seletores e <style> dos modelos de documento, que são injetados no <head>
  // com o id do holder no reset (ver _renderDocumentoPdf).
  var SELETOR_PAPEL_RX=/ia-prev-sheet|html2pdf__/;
  var FOLHA_PAPEL_RX=/#(?:ia-(?:rx|ex)-(?:preview|dl)|rx-scope|lme-scope|ex-scope)-\d/;

  var PAPEIS={
    'color':'fg','caret-color':'fg','text-decoration-color':'fg','-webkit-text-fill-color':'fg',
    'background-color':'bg','background-image':'bg','background':'bg',
    'border-top-color':'bd','border-right-color':'bd','border-bottom-color':'bd','border-left-color':'bd',
    'border-color':'bd','border':'bd','border-top':'bd','border-right':'bd','border-bottom':'bd','border-left':'bd',
    'outline-color':'bd','outline':'bd','column-rule-color':'bd',
    'box-shadow':'sh','text-shadow':'sh'
  };
  var ABREVIADAS=['background','border','border-top','border-right','border-bottom','border-left','border-color','outline'];
  var COR_RX=/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/g;

  /* ---------- cores ---------- */
  function parse(c){
    var m,r,g,b,a=1;
    if(c==='white')return [255,255,255,1];
    if(c==='black')return [0,0,0,1];
    if(c[0]==='#'){
      var h=c.slice(1);
      if(h.length===3||h.length===4)h=h.split('').map(function(x){return x+x;}).join('');
      if(h.length!==6&&h.length!==8)return null;
      r=parseInt(h.slice(0,2),16);g=parseInt(h.slice(2,4),16);b=parseInt(h.slice(4,6),16);
      if(h.length===8)a=parseInt(h.slice(6,8),16)/255;
      return [r,g,b,a];
    }
    if((m=c.match(/^rgba?\(([^)]*)\)$/))){
      var p=m[1].split(/[\s,\/]+/).filter(Boolean);
      if(p.length<3)return null;
      var n=function(v){return /%$/.test(v)?parseFloat(v)*2.55:parseFloat(v);};
      r=n(p[0]);g=n(p[1]);b=n(p[2]);
      if(p[3]!=null)a=/%$/.test(p[3])?parseFloat(p[3])/100:parseFloat(p[3]);
      return isNaN(r+g+b+a)?null:[r,g,b,a];
    }
    if((m=c.match(/^hsla?\(([^)]*)\)$/))){
      var q=m[1].split(/[\s,\/]+/).filter(Boolean);
      if(q.length<3)return null;
      var rgb=hsl2rgb(parseFloat(q[0])/360,parseFloat(q[1])/100,parseFloat(q[2])/100);
      if(q[3]!=null)a=/%$/.test(q[3])?parseFloat(q[3])/100:parseFloat(q[3]);
      return [rgb[0],rgb[1],rgb[2],a];
    }
    return null;
  }
  function rgb2hsl(r,g,b){
    r/=255;g/=255;b/=255;
    var mx=Math.max(r,g,b),mn=Math.min(r,g,b),l=(mx+mn)/2,h=0,s=0,d=mx-mn;
    if(d){
      s=l>.5?d/(2-mx-mn):d/(mx+mn);
      h=mx===r?(g-b)/d+(g<b?6:0):mx===g?(b-r)/d+2:(r-g)/d+4;h/=6;
    }
    return [h,s,l];
  }
  function hsl2rgb(h,s,l){
    if(!s)return [l*255,l*255,l*255];
    var q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;
    function f(t){t<0&&(t+=1);t>1&&(t-=1);return t<1/6?p+(q-p)*6*t:t<1/2?q:t<2/3?p+(q-p)*(2/3-t)*6:p;}
    return [f(h+1/3)*255,f(h)*255,f(h-1/3)*255];
  }
  function fmt(h,s,l,a){
    var c=hsl2rgb(h,Math.max(0,Math.min(1,s)),Math.max(0,Math.min(1,l))).map(Math.round);
    return a>=1?'rgb('+c.join(', ')+')':'rgba('+c.join(', ')+', '+(+a.toFixed(3))+')';
  }
  // Neutros sem matiz ganham o mesmo azul-acinzentado discreto dos tokens.
  function neutro(h,s){return s<.08?[215/360,.12]:[h,s];}

  function converter(papel,cor){
    var p=parse(cor);if(!p)return cor;
    var a=p[3],hsl=rgb2hsl(p[0],p[1],p[2]),h=hsl[0],s=hsl[1],l=hsl[2],n;
    if(papel==='bg'){
      if(l>=.7){n=neutro(h,s*.45);return fmt(n[0],Math.min(n[1],.5),.115+(1-l)*.55,a);}
      if(l>=.55&&s<.25)return fmt(h,s,.2+(.82-l)*.45,a);
      if(l<.3&&s<.4)return fmt(h,s,.24+l*.3,a);
      return cor;
    }
    if(papel==='fg'){
      if(l>=.6)return cor;
      if(s<.3)return fmt(h,s,.97-l*.55,a);
      return fmt(h,Math.min(s,.85),Math.max(l,.55+(.6-l)*.35),a);
    }
    if(papel==='bd'){
      if(l>=.6){n=neutro(h,s*.5);return fmt(n[0],n[1],.29+(1-l)*.35,a);}
      if(l<.3&&s<.3)return fmt(h,s,.45,a);
      return cor;
    }
    // Sombra: brilho branco vira um reflexo sutil, sombra escura fica mais densa.
    if(l>.7)return 'rgba(255, 255, 255, '+(+(a*.06).toFixed(3))+')';
    return 'rgba(0, 0, 0, '+(+Math.min(.7,a*1.8).toFixed(3))+')';
  }
  function converterValor(papel,v){
    if(papel==='fg'&&v.trim()==='var(--white)')return '#fff';
    return v.replace(COR_RX,function(c){return converter(papel,c);});
  }

  /* ---------- declarações ---------- */
  // decl -> { prop: {orig, prio, escuro} }
  var salvos=new WeakMap();
  var inlineVistos=new Set();
  var ativo=false;

  function escurecerDecl(decl){
    var mapa=salvos.get(decl)||{};
    var props=[],i,prop;
    for(i=0;i<decl.length;i++)props.push(decl[i]);
    ABREVIADAS.forEach(function(sh){
      var v=decl.getPropertyValue(sh);
      if(v&&v.indexOf('var(')>=0)props.push(sh);
    });
    props.forEach(function(prop){
      var papel=PAPEIS[prop];if(!papel)return;
      var atual=decl.getPropertyValue(prop);if(!atual)return;
      var reg=mapa[prop];
      if(reg&&reg.escuro===atual)return;
      var prio=decl.getPropertyPriority(prop);
      var novo=converterValor(papel,atual);
      if(novo===atual){delete mapa[prop];return;}
      decl.setProperty(prop,novo,prio);
      mapa[prop]={orig:atual,prio:prio,escuro:decl.getPropertyValue(prop)};
    });
    salvos.set(decl,mapa);
  }
  function restaurarDecl(decl){
    var mapa=salvos.get(decl);if(!mapa)return;
    Object.keys(mapa).forEach(function(prop){
      var r=mapa[prop];
      if(decl.getPropertyValue(prop)===r.escuro)decl.setProperty(prop,r.orig,r.prio);
    });
    salvos.delete(decl);
  }

  /* ---------- folhas de estilo ---------- */
  var folhasVistas=new WeakSet();
  var folhasConvertidas=[];

  function folhaIgnorada(sh){
    var no=sh.ownerNode;
    if(no&&no.hasAttribute&&no.hasAttribute('data-tema-ignorar'))return true;
    if(sh.href&&/tema-escuro\.css/.test(sh.href))return true;
    if(no&&no.tagName==='STYLE'&&FOLHA_PAPEL_RX.test(no.textContent||''))return true;
    return false;
  }
  function percorrerRegras(regras,fn){
    for(var i=0;i<regras.length;i++){
      var r=regras[i];
      if(r.selectorText&&SELETOR_PAPEL_RX.test(r.selectorText))continue;
      if(r.style)fn(r.style);
      if(r.cssRules)percorrerRegras(r.cssRules,fn);
    }
  }
  function regrasDe(sh){try{return sh.cssRules;}catch(e){return null;}} // CDN: cross-origin
  function escurecerFolha(sh){
    if(folhasVistas.has(sh)||folhaIgnorada(sh))return;
    var regras=regrasDe(sh);if(!regras)return;
    folhasVistas.add(sh);folhasConvertidas.push(sh);
    percorrerRegras(regras,escurecerDecl);
  }
  function escurecerFolhas(){for(var i=0;i<document.styleSheets.length;i++)escurecerFolha(document.styleSheets[i]);}

  /* ---------- style="" ---------- */
  function escurecerElemento(el){
    if(!el.getAttribute||!el.hasAttribute('style'))return;
    if(el.closest(ZONAS_PAPEL))return;
    escurecerDecl(el.style);inlineVistos.add(el);
  }
  function escurecerArvore(raiz){
    if(raiz.nodeType!==1)return;
    if(raiz.closest(ZONAS_PAPEL))return;
    escurecerElemento(raiz);
    raiz.querySelectorAll('[style]').forEach(escurecerElemento);
  }

  var observador=new MutationObserver(function(muts){
    if(!ativo)return;
    var folhasNovas=false;
    muts.forEach(function(m){
      if(m.type==='attributes'){escurecerElemento(m.target);return;}
      var alvo=m.target;
      if(alvo.nodeName==='STYLE'||(alvo.parentNode&&alvo.parentNode.nodeName==='STYLE'))folhasNovas=true;
      m.addedNodes.forEach(function(no){
        if(no.nodeName==='STYLE')folhasNovas=true;
        else if(no.nodeName==='LINK')no.addEventListener('load',escurecerFolhas,{once:true});
        else escurecerArvore(no);
      });
    });
    if(folhasNovas)escurecerFolhas();
  });

  /* ---------- liga/desliga ---------- */
  function ligar(){
    if(ativo)return;
    ativo=true;
    document.documentElement.setAttribute(ATTR,'escuro');
    escurecerFolhas();
    escurecerArvore(document.documentElement);
    observador.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['style']});
  }
  function desligar(){
    if(!ativo)return;
    ativo=false;
    observador.disconnect();
    folhasConvertidas.forEach(function(sh){var r=regrasDe(sh);if(r)percorrerRegras(r,restaurarDecl);});
    folhasConvertidas=[];folhasVistas=new WeakSet();
    inlineVistos.forEach(function(el){restaurarDecl(el.style);});
    inlineVistos.clear();
    document.documentElement.removeAttribute(ATTR);
  }
  function aplicar(tema){
    tema=tema==='escuro'?'escuro':'claro';
    // Sem isso cada componente com transition anima a troca de cor em tempos diferentes.
    var raiz=document.documentElement;
    raiz.classList.add('tema-trocando');
    if(tema==='escuro')ligar();else desligar();
    requestAnimationFrame(function(){requestAnimationFrame(function(){raiz.classList.remove('tema-trocando');});});
    try{localStorage.setItem(CACHE_KEY,tema);}catch(e){}
    atualizarBotao();
  }
  function atual(){return ativo?'escuro':'claro';}

  function atualizarBotao(){
    var lbl=document.getElementById('nav-tema-lbl');
    if(lbl)lbl.textContent=ativo?'Modo claro':'Modo escuro';
  }

  async function alternar(){
    var novo=ativo?'claro':'escuro';
    aplicar(novo);
    var sb=window.sb;if(!sb)return;
    var r=await sb.auth.updateUser({data:{tema:novo}});
    if(r.error){
      console.warn('[tema] não foi possível salvar a preferência:',r.error.message);
      if(typeof window.showToast==='function')window.showToast('Não foi possível salvar o tema na sua conta.','error');
    }
  }

  // Chamado no login com o usuário da sessão: a preferência salva na conta vence o cache local.
  function doUsuario(user){
    var t=user&&user.user_metadata&&user.user_metadata.tema;
    if(t==='escuro'||t==='claro')aplicar(t);
  }

  // Impressão sempre em papel claro.
  var antesDeImprimir=null;
  window.addEventListener('beforeprint',function(){antesDeImprimir=atual();if(ativo)desligar();});
  window.addEventListener('afterprint',function(){if(antesDeImprimir==='escuro')ligar();antesDeImprimir=null;});

  window.MCTema={aplicar:aplicar,alternar:alternar,doUsuario:doUsuario,atual:atual};

  var cache=null;try{cache=localStorage.getItem(CACHE_KEY);}catch(e){}
  if(cache==='escuro')ligar();
  document.addEventListener('DOMContentLoaded',atualizarBotao);
})();
