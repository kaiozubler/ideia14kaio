/* ============================================================
   MINHA EQUIPE — módulo standalone (adaptação de GestaoUsuarios.jsx)
   Renderiza dentro de #s-equipe. Estado em memória (mock).
   ============================================================ */
(function(){
const WEEKDAYS=["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];
const PERMISSIONS_CATALOG=[
  {id:"agenda_ver",label:"Visualizar agendas da equipe"},
  {id:"agenda_editar",label:"Editar agenda de outros usuários"},
  {id:"prontuario",label:"Acessar prontuário dos pacientes"},
  {id:"financeiro_proprio",label:"Ver financeiro próprio (comissões)"},
  {id:"financeiro_total",label:"Ver financeiro completo da clínica"},
  {id:"usuarios",label:"Gerenciar usuários e grupos"},
  {id:"cadastro_paciente",label:"Cadastrar e editar pacientes"},
];
const SPECIALTIES=["Consulta","Retorno","Cirurgia","Procedimento","Renovação de receita"];
const GROUP_COLORS={emerald:"eq-grad-emerald",sky:"eq-grad-sky",amber:"eq-grad-amber",violet:"eq-grad-violet",rose:"eq-grad-rose"};
const BR_STATES=["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

const S={
  profile:{id:"me",name:"Dra. Camila Andrade",email:"camila.andrade@clinicasaude.com",role:"Administradora",
    phone:"(47) 99999-1234",crm:{uf:"SC",number:""},
    notifications:{novoPaciente:true,agendaAlterada:true,mensagens:false,faturamento:true},
    scheduleRules:[{id:"rme1",kind:"recorrente",days:[0,1,2,3,4],startTime:"08:00",duration:9,intervalWeeks:1}]},
  users:[
    {id:"u1",name:"Ana Costa",email:"ana.costa@clinicasaude.com",role:"Médica",group:"g1",phone:"(47) 98888-1111",status:"active",weeklyHours:30,crm:{uf:"SC",number:"123456"},services:[{id:1,name:"Consulta",percent:60},{id:2,name:"Retorno",percent:40}],scheduleRules:[{id:"r1",kind:"recorrente",days:[4],startTime:"08:00",duration:24,intervalWeeks:1}]},
    {id:"u2",name:"João Pereira",email:"joao.pereira@clinicasaude.com",role:"Recepcionista",group:"g2",phone:"(47) 97777-2222",status:"active",weeklyHours:40,services:[],scheduleRules:[{id:"r2",kind:"recorrente",days:[0,1,2,3,4],startTime:"08:00",duration:10,intervalWeeks:1}]},
    {id:"u3",name:"Rafael Mendes",email:"rafael.mendes@clinicasaude.com",role:"Médico",group:"g1",phone:"(47) 96666-3333",status:"inactive",weeklyHours:20,crm:{uf:"SC",number:"654321"},services:[{id:3,name:"Cirurgia",percent:55}],scheduleRules:[]},
    {id:"u4",name:"Beatriz Melo",email:"beatriz.melo@clinicasaude.com",role:"Médica",group:"g1",phone:"(47) 95555-4444",status:"active",weeklyHours:24,crm:{uf:"SC",number:"987654"},services:[{id:4,name:"Procedimento",percent:45}],scheduleRules:[{id:"r3",kind:"recorrente",days:[1],startTime:"07:00",duration:12,intervalWeeks:2}]},
  ],
  groups:[
    {id:"g1",name:"Médicos",color:"emerald",permissions:["agenda_ver","prontuario","financeiro_proprio"],members:["u1","u3","u4"]},
    {id:"g2",name:"Recepção",color:"sky",permissions:["agenda_ver","cadastro_paciente"],members:["u2"]},
    {id:"g3",name:"Administração",color:"amber",permissions:["financeiro_total","usuarios","agenda_ver","agenda_editar"],members:[]},
  ],
  search:"",
  profileOpen:false,
  canEditRestricted:true,
};

/* ---------- helpers ---------- */
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const initials=n=>n.split(" ").slice(0,2).map(x=>x[0]||"").join("").toUpperCase();
const isDoctor=r=>(r||"").toLowerCase().includes("médic");
function roleTone(r){r=(r||"").toLowerCase();if(r.includes("médic"))return"emerald";if(r.includes("recep"))return"sky";if(r.includes("admin"))return"amber";return"slate";}
function describeRule(r){
  if(r.kind==="pontual")return `Em ${r.date?new Date(r.date+"T00:00:00").toLocaleDateString("pt-BR"):"—"} às ${r.startTime}, por ${r.duration}h`;
  const dt=r.days.length===7?"Todos os dias":r.days.slice().sort().map(d=>WEEKDAYS[d]).join(", ");
  return `${dt} às ${r.startTime}, ${r.duration}h (a cada ${r.intervalWeeks} sem.)`;
}
function avatar(name,color,size){const g=GROUP_COLORS[color]||"eq-grad-emerald";return `<div class="eq-avatar sz${size||10} ${g}">${esc(initials(name))}</div>`;}
function badge(text,tone){return `<span class="eq-badge ${tone||"slate"}">${text}</span>`;}
function iconBadge(icon,variant){return `<div class="eq-icon-badge ${variant||""}"><i class="ti ti-${icon}"></i></div>`;}

/* ---------- root render ---------- */
function render(){
  const root=document.getElementById('s-equipe');
  if(!root)return;
  root.innerHTML=`
    <div class="eq-root">
      <div class="eq-blob b1"></div><div class="eq-blob b2"></div>
      <div class="eq-blob b3"></div><div class="eq-blob b4"></div>
      <div class="eq-wrap">
        <div style="margin-bottom:16px"><button class="btn ghost sm" onclick="goScreen('configuracoes')"><i class="ti ti-arrow-left"></i> Voltar</button></div>
        <div class="eq-head">
          ${iconBadge('users')}
          <div>
            <h1 class="eq-title">Usuários e permissões</h1>
            <p class="eq-sub">Gerencie sua equipe, grupos de acesso e agendas.</p>
          </div>
        </div>
        <div id="eq-profile-slot"></div>
        <div class="eq-toolbar">
          <div class="eq-search"><i class="ti ti-search"></i>
            <input id="eq-search-input" type="text" placeholder="Buscar por nome ou e-mail…" value="${esc(S.search)}">
          </div>
          <div class="eq-toolbar-actions">
            <button class="eq-btn eq-btn-ghost" id="eq-open-groups"><i class="ti ti-shield-check"></i> Gestão de grupos</button>
            <button class="eq-btn eq-btn-primary" id="eq-open-invite"><i class="ti ti-user-plus"></i> Convidar usuário</button>
          </div>
        </div>
        <div class="eq-glass eq-table" id="eq-users-table"></div>
      </div>
      <div id="eq-modals"></div>
    </div>`;
  renderProfile();
  renderUsers();
  document.getElementById('eq-search-input').addEventListener('input',e=>{S.search=e.target.value;renderUsers();});
  document.getElementById('eq-open-groups').onclick=()=>openGroupsModal();
  document.getElementById('eq-open-invite').onclick=()=>openInviteModal();
}

/* ---------- profile card ---------- */
function renderProfile(){
  const p=S.profile;const slot=document.getElementById('eq-profile-slot');
  const anyNotif=Object.values(p.notifications).some(Boolean);
  slot.innerHTML=`
    <div class="eq-glass eq-profile ${S.profileOpen?'open':''}" id="eq-profile">
      <div class="eq-profile-head">
        <button class="eq-main" id="eq-profile-toggle">
          ${avatar(p.name,'emerald',12)}
          <div style="min-width:0;flex:1">
            <div class="eq-name"><b>${esc(p.name)}</b> ${badge(p.role,'emerald')}</div>
            <div class="eq-email">${esc(p.email)}</div>
          </div>
          <i class="ti ti-chevron-down eq-chev" style="font-size:20px"></i>
        </button>
        <button class="eq-round-icon" title="Configurar agenda" id="eq-profile-schedule"><i class="ti ti-calendar"></i></button>
        <button class="eq-round-icon violet" title="Notificações" id="eq-profile-notif"><i class="ti ti-bell"></i>${anyNotif?'<span class="eq-dot"></span>':''}</button>
      </div>
      <div class="eq-divider"></div>
      <div class="eq-profile-body">
        <div class="eq-grid2">
          <div><label class="eq-label">Nome completo</label><input class="eq-input" id="eq-p-name" value="${esc(p.name)}"></div>
          <div><label class="eq-label">Telefone</label><input class="eq-input" id="eq-p-phone" value="${esc(p.phone)}"></div>
          <div><label class="eq-label">E-mail</label><input class="eq-input disabled" value="${esc(p.email)}" disabled></div>
          <div>
            <label class="eq-label"><i class="ti ti-stethoscope"></i> CRM</label>
            <div class="eq-crm">
              <div class="eq-crm-pref">CRM/</div>
              <select id="eq-p-crm-uf">${BR_STATES.map(s=>`<option ${p.crm?.uf===s?'selected':''}>${s}</option>`).join('')}</select>
              <input class="eq-input eq-crm-num" id="eq-p-crm-num" maxlength="6" placeholder="000000" value="${esc(p.crm?.number||'')}">
              ${p.crm?.uf&&p.crm?.number?.length===6?`<span class="eq-crm-ok">CRM/${esc(p.crm.uf)} ${esc(p.crm.number)}</span>`:''}
            </div>
          </div>
        </div>
        <div class="eq-reset-row">
          <div class="eq-info"><i class="ti ti-key"></i> <span id="eq-p-reset-msg">Redefina sua senha por e-mail.</span></div>
          <button class="eq-btn eq-btn-ghost" id="eq-p-reset"><i class="ti ti-key"></i> Redefinir senha</button>
        </div>
        <div class="eq-actions-end">
          <span class="eq-saved" id="eq-p-saved" style="display:none">Salvo ✓</span>
          <button class="eq-btn eq-btn-primary" id="eq-p-save"><i class="ti ti-check"></i> Salvar alterações</button>
        </div>
      </div>
    </div>`;
  document.getElementById('eq-profile-toggle').onclick=()=>{S.profileOpen=!S.profileOpen;renderProfile();};
  document.getElementById('eq-profile-schedule').onclick=e=>{e.stopPropagation();openScheduleModal(S.profile,true);};
  document.getElementById('eq-profile-notif').onclick=e=>{e.stopPropagation();openNotifModal();};
  if(S.profileOpen){
    const bind=(id,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener('input',fn);};
    bind('eq-p-name',e=>{p.name=e.target.value;});
    bind('eq-p-phone',e=>{p.phone=e.target.value;});
    bind('eq-p-crm-uf',e=>{p.crm={...p.crm,uf:e.target.value};});
    bind('eq-p-crm-num',e=>{p.crm={...p.crm,number:e.target.value.replace(/\D/g,'').slice(0,6)};});
    document.getElementById('eq-p-save').onclick=()=>{
      const s=document.getElementById('eq-p-saved');s.style.display='';setTimeout(()=>s.style.display='none',1600);renderProfile();
    };
    document.getElementById('eq-p-reset').onclick=()=>{
      document.getElementById('eq-p-reset-msg').innerHTML='<b style="color:#059669">Link enviado para o seu e-mail ✓</b>';
      setTimeout(()=>{const m=document.getElementById('eq-p-reset-msg');if(m)m.textContent='Redefina sua senha por e-mail.';},2400);
    };
  }
}

/* ---------- users table ---------- */
function renderUsers(){
  const q=S.search.toLowerCase();
  const list=S.users.filter(u=>u.name.toLowerCase().includes(q)||u.email.toLowerCase().includes(q));
  const t=document.getElementById('eq-users-table');
  if(!t)return;
  t.innerHTML=`
    <div class="eq-thead"><div>Nome</div><div>Email</div><div>Função</div><div>Grupo</div><div>Ações</div></div>
    ${list.length===0?`<div class="eq-empty">Nenhum usuário encontrado.</div>`:list.map(u=>{
      const g=S.groups.find(x=>x.id===u.group);
      return `<div class="eq-row ${u.status==='inactive'?'inactive':''}" data-uid="${u.id}">
        <div class="eq-uname">${avatar(u.name,g?g.color:'slate',10)}<div class="txt"><b>${esc(u.name)}</b><span>${u.status==='inactive'?'Inativo':'Ativo'}</span></div></div>
        <div class="eq-uemail">${esc(u.email)}</div>
        <div>${badge(u.role,roleTone(u.role))}</div>
        <div><select data-uid="${u.id}" class="eq-change-group">${S.groups.map(gg=>`<option value="${gg.id}" ${gg.id===u.group?'selected':''}>${esc(gg.name)}</option>`).join('')}</select></div>
        <div class="eq-row-act">
          <button title="Configurar agenda" data-act="sched" data-uid="${u.id}"><i class="ti ti-calendar"></i></button>
          <button class="eq-power" title="${u.status==='inactive'?'Ativar':'Inativar'}" data-act="toggle" data-uid="${u.id}"><i class="ti ti-power"></i></button>
        </div>
      </div>`;
    }).join('')}
  `;
  t.querySelectorAll('.eq-row').forEach(r=>{
    r.addEventListener('click',e=>{
      if(e.target.closest('.eq-row-act')||e.target.closest('select'))return;
      const u=S.users.find(x=>x.id===r.dataset.uid);if(u)openDetailPanel(u);
    });
  });
  t.querySelectorAll('.eq-change-group').forEach(sel=>{
    sel.addEventListener('click',e=>e.stopPropagation());
    sel.addEventListener('change',e=>{
      const uid=sel.dataset.uid;const gid=sel.value;
      const u=S.users.find(x=>x.id===uid);if(u){u.group=gid;renderUsers();}
    });
  });
  t.querySelectorAll('button[data-act]').forEach(b=>{
    b.addEventListener('click',e=>{
      e.stopPropagation();const uid=b.dataset.uid;const u=S.users.find(x=>x.id===uid);if(!u)return;
      if(b.dataset.act==='sched')openScheduleModal(u,false);
      else if(b.dataset.act==='toggle'){u.status=u.status==='active'?'inactive':'active';renderUsers();}
    });
  });
}

/* ---------- modal shell ---------- */
function modal({title,subtitle,icon,variant,width,body,footer}){
  const host=document.getElementById('eq-modals');
  const w=width==='wide'?'wide':width==='xwide'?'xwide':'';
  const html=`<div class="eq-modal-overlay" id="eq-current-modal">
    <div class="eq-modal ${w}">
      <div class="eq-modal-head">
        <div class="eq-tt">${icon?`<div class="eq-icon-badge ${variant||''}"><i class="ti ti-${icon}"></i></div>`:''}
          <div><h2>${esc(title)}</h2>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div></div>
        <button class="eq-close" data-close="1"><i class="ti ti-x"></i></button>
      </div>
      <div class="eq-modal-body">${body}</div>
      ${footer?`<div class="eq-modal-foot">${footer}</div>`:''}
    </div></div>`;
  host.insertAdjacentHTML('beforeend',html);
  const el=host.lastElementChild;
  el.addEventListener('click',e=>{if(e.target===el||e.target.closest('[data-close]'))closeModal(el);});
  return el;
}
function closeModal(el){el&&el.remove();}
function closeAllModals(){document.querySelectorAll('#eq-modals > .eq-modal-overlay, #eq-modals > .eq-slide-over').forEach(x=>x.remove());}

/* ---------- Notif modal ---------- */
function openNotifModal(){
  const prefs=[
    {key:"novoPaciente",label:"Novo paciente agendado"},
    {key:"agendaAlterada",label:"Alterações na minha agenda"},
    {key:"mensagens",label:"Novas mensagens de pacientes"},
    {key:"faturamento",label:"Resumo financeiro semanal"},
  ];
  const body=`<div class="eq-prefs">${prefs.map(pr=>`
    <div><span style="font-size:13px;color:#334155">${esc(pr.label)}</span>
      <button class="eq-toggle ${S.profile.notifications[pr.key]?'on':''}" data-k="${pr.key}"></button></div>`).join('')}</div>`;
  const footer=`<span class="eq-foot-left eq-saved" id="eq-nf-saved" style="display:none">Salvo ✓</span>
    <button class="eq-btn eq-btn-ghost" data-close="1">Fechar</button>
    <button class="eq-btn eq-btn-primary" id="eq-nf-save"><i class="ti ti-check"></i> Salvar</button>`;
  const el=modal({title:"Notificações",subtitle:"Escolha o que você quer ser avisado.",icon:"bell",variant:"violet",body,footer});
  el.querySelectorAll('.eq-toggle').forEach(t=>t.onclick=()=>{
    const k=t.dataset.k;S.profile.notifications[k]=!S.profile.notifications[k];t.classList.toggle('on');renderProfile();
  });
  el.querySelector('#eq-nf-save').onclick=()=>{const s=el.querySelector('#eq-nf-saved');s.style.display='';setTimeout(()=>s.style.display='none',1600);};
}

/* ---------- Schedule modal ---------- */
function openScheduleModal(user,isProfile){
  const st={rules:JSON.parse(JSON.stringify(user.scheduleRules||[])),tab:"recorrente",
    days:[],startTime:"08:00",duration:24,intervalWeeks:1,date:"",pStart:"08:00",pDuration:24};
  const body=`<div id="eq-sched-content"></div>`;
  const footer=`<button class="eq-btn eq-btn-ghost" data-close="1">Cancelar</button>
    <button class="eq-btn eq-btn-primary" id="eq-sched-save"><i class="ti ti-check"></i> Salvar agenda</button>`;
  const el=modal({title:`Agenda de ${user.name}`,subtitle:"Configure quando a agenda deve estar aberta para pacientes.",
    icon:"calendar-week",variant:"emerald",width:"wide",body,footer});
  const cont=el.querySelector('#eq-sched-content');
  function draw(){
    const preview=st.days.length===7?"Todos os dias":st.days.slice().sort().map(d=>WEEKDAYS[d]).join(", ");
    cont.innerHTML=`
      <div class="eq-tabs">
        <button data-tab="recorrente" class="${st.tab==='recorrente'?'on':''}">Recorrente</button>
        <button data-tab="pontual" class="${st.tab==='pontual'?'on':''}">Data específica</button>
      </div>
      ${st.tab==='recorrente'?`
        <div style="display:flex;flex-direction:column;gap:18px">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <label class="eq-label" style="margin:0">Dias da semana</label>
              <button id="eq-sched-preset" style="background:none;border:none;color:#059669;font-size:11px;font-weight:600;cursor:pointer;display:flex;gap:4px;align-items:center"><i class="ti ti-sparkles"></i> Seg–Sex comercial</button>
            </div>
            <div class="eq-days-row">${WEEKDAYS.map((d,i)=>`<button class="eq-day ${st.days.includes(i)?'on':''}" data-di="${i}">${d}</button>`).join('')}</div>
          </div>
          <div class="eq-grid2">
            <div><label class="eq-label">Início</label><input type="time" class="eq-input" id="eq-sched-start" value="${st.startTime}"></div>
            <div><label class="eq-label">Repetir a cada</label>
              <div style="display:flex;gap:8px;align-items:center">
                <input type="number" min="1" class="eq-input" style="width:64px;text-align:center" id="eq-sched-iw" value="${st.intervalWeeks}">
                <span style="font-size:13px;color:#64748b">semana(s)</span></div>
            </div>
          </div>
          <div><label class="eq-label">Duração do plantão</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
              ${[12,24,36,48].map(h=>`<button class="eq-dur ${st.duration===h?'on':''}" data-dur="${h}">${h}h</button>`).join('')}
              <span style="font-size:13px;color:#94a3b8">ou</span>
              <input type="number" min="1" class="eq-input" style="width:64px;text-align:center" id="eq-sched-dur" value="${st.duration}">
              <span style="font-size:13px;color:#64748b">h</span>
            </div>
          </div>
          ${st.days.length>0?`<div class="eq-preview"><i class="ti ti-repeat"></i><span><b>${preview}</b> às ${st.startTime}, plantão de ${st.duration}h ${st.intervalWeeks>1?`a cada ${st.intervalWeeks} semanas`:'toda semana'}.</span></div>`:''}
          <div style="display:flex;justify-content:flex-end"><button class="eq-btn eq-btn-primary ${!st.days.length?'disabled':''}" id="eq-sched-add"><i class="ti ti-plus"></i> Adicionar regra</button></div>
        </div>
      `:`
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label class="eq-label">Data</label><input type="date" class="eq-input" id="eq-sched-date" value="${st.date}"></div>
            <div><label class="eq-label">Início</label><input type="time" class="eq-input" id="eq-sched-pstart" value="${st.pStart}"></div>
            <div><label class="eq-label">Duração (h)</label><input type="number" min="1" class="eq-input" id="eq-sched-pdur" value="${st.pDuration}"></div>
          </div>
          <div style="display:flex;justify-content:flex-end"><button class="eq-btn eq-btn-primary ${!st.date?'disabled':''}" id="eq-sched-addp"><i class="ti ti-plus"></i> Adicionar data</button></div>
        </div>`}
      <div style="margin-top:20px">
        <label class="eq-label">Regras configuradas</label>
        ${st.rules.length===0?`<div class="eq-rules-empty">Nenhuma regra cadastrada.</div>`:`<div class="eq-rules-list">${st.rules.map(r=>`
          <div><span style="display:flex;align-items:center;gap:6px"><i class="ti ti-clock" style="color:#10b981"></i>${esc(describeRule(r))}</span>
            <button class="eq-icon-btn" data-rr="${r.id}"><i class="ti ti-trash"></i></button></div>`).join('')}</div>`}
      </div>`;
    cont.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{st.tab=b.dataset.tab;draw();});
    cont.querySelectorAll('.eq-day').forEach(b=>b.onclick=()=>{const i=+b.dataset.di;st.days=st.days.includes(i)?st.days.filter(x=>x!==i):[...st.days,i];draw();});
    cont.querySelectorAll('.eq-dur').forEach(b=>b.onclick=()=>{st.duration=+b.dataset.dur;draw();});
    cont.querySelectorAll('[data-rr]').forEach(b=>b.onclick=()=>{st.rules=st.rules.filter(x=>x.id!==b.dataset.rr);draw();});
    const preset=cont.querySelector('#eq-sched-preset');if(preset)preset.onclick=()=>{st.days=[0,1,2,3,4];st.startTime="08:00";st.duration=10;st.intervalWeeks=1;draw();};
    const bind=(id,fn)=>{const e=cont.querySelector('#'+id);if(e)e.addEventListener('input',fn);};
    bind('eq-sched-start',e=>st.startTime=e.target.value);
    bind('eq-sched-iw',e=>st.intervalWeeks=Number(e.target.value)||1);
    bind('eq-sched-dur',e=>st.duration=Number(e.target.value)||1);
    bind('eq-sched-date',e=>st.date=e.target.value);
    bind('eq-sched-pstart',e=>st.pStart=e.target.value);
    bind('eq-sched-pdur',e=>st.pDuration=Number(e.target.value)||1);
    const add=cont.querySelector('#eq-sched-add');if(add)add.onclick=()=>{if(!st.days.length)return;
      st.rules.push({id:Date.now().toString(),kind:"recorrente",days:st.days.slice(),startTime:st.startTime,duration:st.duration,intervalWeeks:st.intervalWeeks});st.days=[];draw();};
    const addp=cont.querySelector('#eq-sched-addp');if(addp)addp.onclick=()=>{if(!st.date)return;
      st.rules.push({id:Date.now().toString(),kind:"pontual",date:st.date,startTime:st.pStart,duration:st.pDuration});st.date="";draw();};
  }
  draw();
  el.querySelector('#eq-sched-save').onclick=()=>{
    if(isProfile)S.profile.scheduleRules=st.rules;
    else{const u=S.users.find(x=>x.id===user.id);if(u)u.scheduleRules=st.rules;}
    closeModal(el);
  };
}

/* ---------- Detail slide-over ---------- */
function openDetailPanel(user){
  const form=JSON.parse(JSON.stringify(user));
  form.services=form.services||[];
  let customSpecialties=[];
  let newSpecialtyInput=null;
  const host=document.getElementById('eq-modals');
  const wrap=document.createElement('div');wrap.className='eq-slide-over';host.appendChild(wrap);
  function group(){return S.groups.find(g=>g.id===form.group);}
  function draw(){
    const g=group();
    const allSpecs=[...SPECIALTIES,...customSpecialties];
    wrap.innerHTML=`<div class="eq-slide">
      <div class="eq-slide-head">
        <div class="eq-who">${avatar(form.name,g?g.color:'slate',12)}
          <div><b style="color:#1e293b">${esc(form.name)}</b>
            <div class="eq-badges">${badge(form.status==='active'?'Ativo':'Inativo',form.status==='active'?'emerald':'slate')}
              ${g?`<span class="eq-badge slate"><span class="eq-dot ${GROUP_COLORS[g.color].replace('eq-grad-','eq-')}" style="background:${{emerald:'#10b981',sky:'#0ea5e9',amber:'#f59e0b',violet:'#8b5cf6',rose:'#f43f5e'}[g.color]}"></span>${esc(g.name)}</span>`:''}</div>
          </div></div>
        <button class="eq-close" id="eq-detail-close"><i class="ti ti-x"></i></button>
      </div>
      <div class="eq-slide-body">
        <div><label class="eq-label"><i class="ti ti-mail"></i> E-mail</label><input class="eq-input disabled" disabled value="${esc(form.email)}"></div>
        <div class="eq-reset-row">
          <div class="eq-info"><i class="ti ti-key"></i><span id="eq-d-reset-msg">Enviar link de redefinição de senha.</span></div>
          <button class="eq-btn eq-btn-ghost" id="eq-d-reset"><i class="ti ti-key"></i> Redefinir</button>
        </div>
        <div><label class="eq-label"><i class="ti ti-phone"></i> Telefone</label><input class="eq-input" id="eq-d-phone" value="${esc(form.phone||'')}"></div>
        ${isDoctor(form.role)?`
          <div><label class="eq-label"><i class="ti ti-stethoscope"></i> CRM</label>
            <div class="eq-crm"><div class="eq-crm-pref">CRM/</div>
              <select id="eq-d-crm-uf">${BR_STATES.map(s=>`<option ${form.crm?.uf===s?'selected':''}>${s}</option>`).join('')}</select>
              <input class="eq-input eq-crm-num" id="eq-d-crm-num" maxlength="6" placeholder="000000" value="${esc(form.crm?.number||'')}">
              ${form.crm?.uf&&form.crm?.number?.length===6?`<span class="eq-crm-ok">CRM/${esc(form.crm.uf)} ${esc(form.crm.number)}</span>`:''}
            </div></div>`:''}
        <div><label class="eq-label"><i class="ti ti-briefcase"></i> Grupo</label>
          <select class="eq-input" id="eq-d-group">${S.groups.map(gg=>`<option value="${gg.id}" ${gg.id===form.group?'selected':''}>${esc(gg.name)}</option>`).join('')}</select></div>
        <button class="eq-linkrow" id="eq-d-sched">
          <span><span class="eq-mini-ico"><i class="ti ti-calendar"></i></span>Configurar agenda</span>
          <i class="ti ti-chevron-right" style="color:#94a3b8"></i>
        </button>
        <div>
          <div class="eq-restricted-head">${iconBadge('lock',S.canEditRestricted?'amber':'slate')}
            <div><h3>Dados restritos</h3>${!S.canEditRestricted?'<small>Somente leitura — sem permissão para editar</small>':''}</div></div>
          <div class="eq-restricted-body">
            <div><label class="eq-label"><i class="ti ti-clock"></i> Horas semanais</label>
              <input type="number" min="0" class="eq-input ${S.canEditRestricted?'':'disabled'}" style="width:96px" id="eq-d-hours" value="${form.weeklyHours||0}" ${S.canEditRestricted?'':'disabled'}></div>
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <label class="eq-label" style="margin:0">Serviços e comissão</label>
                ${S.canEditRestricted?`<button id="eq-d-addsvc" style="background:none;border:none;color:#059669;font-size:11px;font-weight:600;cursor:pointer;display:flex;gap:4px;align-items:center"><i class="ti ti-plus"></i> Adicionar</button>`:''}
              </div>
              ${form.services.length===0&&newSpecialtyInput===null?`<div class="eq-rules-empty">Nenhum serviço vinculado.</div>`:`
                <div style="display:flex;flex-direction:column;gap:8px">
                ${form.services.map(s=>`<div class="eq-svc-row">
                  <select data-sid="${s.id}" class="eq-input eq-svc-name" ${S.canEditRestricted?'':'disabled'}>
                    ${allSpecs.map(sp=>`<option ${sp===s.name?'selected':''}>${esc(sp)}</option>`).join('')}
                    ${S.canEditRestricted?'<option value="__new__">+ Nova opção…</option>':''}
                  </select>
                  <div class="eq-svc-percent"><input type="number" min="0" max="100" class="eq-input eq-svc-pct" data-sid="${s.id}" value="${s.percent||0}" ${S.canEditRestricted?'':'disabled'}><span>%</span></div>
                  ${S.canEditRestricted?`<button class="eq-icon-btn" data-rmsvc="${s.id}"><i class="ti ti-trash"></i></button>`:''}
                </div>`).join('')}
                ${newSpecialtyInput!==null?`<div class="eq-newsvc">
                  <input type="text" id="eq-d-newspec" placeholder="Nome do novo serviço…" value="${esc(newSpecialtyInput)}">
                  <button class="ok" id="eq-d-newok"><i class="ti ti-check"></i></button>
                  <button id="eq-d-newcancel"><i class="ti ti-x"></i></button></div>`:''}
                </div>`}
            </div>
          </div>
        </div>
      </div>
      <div class="eq-slide-foot">
        <button class="eq-btn eq-btn-ghost" id="eq-d-cancel">Cancelar</button>
        <button class="eq-btn eq-btn-primary" id="eq-d-save"><i class="ti ti-check"></i> Salvar</button>
      </div>
    </div>`;
    wrap.querySelector('#eq-detail-close').onclick=close;
    wrap.querySelector('#eq-d-cancel').onclick=close;
    wrap.addEventListener('click',e=>{if(e.target===wrap)close();},{once:true});
    wrap.querySelector('#eq-d-reset').onclick=()=>{
      wrap.querySelector('#eq-d-reset-msg').innerHTML=`<b style="color:#059669">Link enviado para ${esc(form.email)} ✓</b>`;
      setTimeout(()=>{const m=wrap.querySelector('#eq-d-reset-msg');if(m)m.textContent='Enviar link de redefinição de senha.';},2400);
    };
    const bind=(id,fn)=>{const e=wrap.querySelector('#'+id);if(e)e.addEventListener('input',fn);};
    bind('eq-d-phone',e=>form.phone=e.target.value);
    bind('eq-d-crm-uf',e=>{form.crm={...(form.crm||{}),uf:e.target.value};});
    bind('eq-d-crm-num',e=>{form.crm={...(form.crm||{}),number:e.target.value.replace(/\D/g,'').slice(0,6)};});
    bind('eq-d-group',e=>{form.group=e.target.value;draw();});
    bind('eq-d-hours',e=>{form.weeklyHours=Number(e.target.value)||0;});
    wrap.querySelectorAll('.eq-svc-name').forEach(sel=>sel.onchange=e=>{
      const sid=Number(sel.dataset.sid);const v=e.target.value;
      if(v==='__new__'){newSpecialtyInput='';draw();return;}
      const s=form.services.find(x=>x.id===sid);if(s){s.name=v;}
    });
    wrap.querySelectorAll('.eq-svc-pct').forEach(inp=>inp.oninput=e=>{
      const sid=Number(inp.dataset.sid);const s=form.services.find(x=>x.id===sid);if(s)s.percent=Number(e.target.value)||0;
    });
    wrap.querySelectorAll('[data-rmsvc]').forEach(b=>b.onclick=()=>{form.services=form.services.filter(x=>x.id!==Number(b.dataset.rmsvc));draw();});
    const addsvc=wrap.querySelector('#eq-d-addsvc');if(addsvc)addsvc.onclick=()=>{form.services.push({id:Date.now(),name:allSpecs[0],percent:0});draw();};
    const newInp=wrap.querySelector('#eq-d-newspec');if(newInp){
      newInp.focus();
      newInp.oninput=e=>newSpecialtyInput=e.target.value;
      newInp.onkeydown=e=>{if(e.key==='Enter')confirmNew();if(e.key==='Escape'){newSpecialtyInput=null;draw();}};
    }
    const newOk=wrap.querySelector('#eq-d-newok');if(newOk)newOk.onclick=confirmNew;
    const newCancel=wrap.querySelector('#eq-d-newcancel');if(newCancel)newCancel.onclick=()=>{newSpecialtyInput=null;draw();};
    wrap.querySelector('#eq-d-sched').onclick=()=>openScheduleModal(form,false);
    wrap.querySelector('#eq-d-save').onclick=()=>{
      const idx=S.users.findIndex(x=>x.id===form.id);if(idx>=0)S.users[idx]=JSON.parse(JSON.stringify(form));
      close();renderUsers();
    };
  }
  function confirmNew(){
    const name=(newSpecialtyInput||"").trim();
    if(!name){newSpecialtyInput=null;draw();return;}
    if(![...SPECIALTIES,...customSpecialties].includes(name))customSpecialties.push(name);
    form.services.push({id:Date.now(),name,percent:0});newSpecialtyInput=null;draw();
  }
  function close(){wrap.remove();}
  draw();
}

/* ---------- Groups modal ---------- */
function openGroupsModal(){
  let editing=null;let draft=null;
  const body=`<div id="eq-groups-body"></div>`;
  const footerSlot=`<div id="eq-groups-footer" style="display:contents"></div>`;
  const el=modal({title:"Gestão de grupos",subtitle:"Grupos definem permissões de acesso na clínica.",
    icon:"shield-check",variant:"violet",width:"wide",body,footer:footerSlot});
  const bodyEl=el.querySelector('#eq-groups-body');
  const footEl=el.querySelector('#eq-groups-footer');
  function draw(){
    if(!editing){
      bodyEl.innerHTML=`<div class="eq-glist">${S.groups.map(g=>`
        <div><div class="eq-gitem">
          <div class="eq-gcolor ${GROUP_COLORS[g.color]}"><i class="ti ti-users" style="font-size:14px"></i></div>
          <div><p style="margin:0;font-size:13px;font-weight:600;color:#1e293b">${esc(g.name)}</p>
            <p style="margin:0;font-size:11px;color:#94a3b8">${g.members.length} ${g.members.length===1?'pessoa':'pessoas'} · ${g.permissions.length} permissões</p></div>
          </div>
          <div style="display:flex;gap:2px">
            <button class="eq-icon-btn" data-edit="${g.id}" style="color:#94a3b8"><i class="ti ti-pencil"></i></button>
            <button class="eq-icon-btn" data-del="${g.id}"><i class="ti ti-trash"></i></button>
          </div>
        </div>`).join('')}</div>`;
      footEl.innerHTML=`<button class="eq-btn eq-btn-primary" id="eq-g-new"><i class="ti ti-plus"></i> Novo grupo</button>`;
      footEl.querySelector('#eq-g-new').onclick=()=>{draft={id:'g'+Date.now(),name:'',color:'sky',permissions:[],members:[]};editing=draft.id;draw();};
      bodyEl.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{const g=S.groups.find(x=>x.id===b.dataset.edit);draft=JSON.parse(JSON.stringify(g));editing=draft.id;draw();});
      bodyEl.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{S.groups=S.groups.filter(x=>x.id!==b.dataset.del);draw();renderUsers();});
    }else{
      bodyEl.innerHTML=`
        <div style="display:flex;flex-direction:column;gap:18px">
          <div><label class="eq-label">Nome do grupo</label>
            <input class="eq-input" id="eq-g-name" value="${esc(draft.name)}" placeholder="Ex: Fisioterapeutas" autofocus></div>
          <div><label class="eq-label">Cor de identificação</label>
            <div style="display:flex;gap:8px">${Object.keys(GROUP_COLORS).map(c=>`<button class="eq-swatch ${GROUP_COLORS[c]} ${draft.color===c?'on':''}" data-color="${c}"></button>`).join('')}</div></div>
          <div><label class="eq-label">Permissões</label>
            <div class="eq-perms">${PERMISSIONS_CATALOG.map(p=>`
              <label><span>${esc(p.label)}</span>
                <input type="checkbox" data-perm="${p.id}" ${draft.permissions.includes(p.id)?'checked':''}></label>`).join('')}</div></div>
          <div><label class="eq-label">Pessoas no grupo</label>
            <div class="eq-members">${S.users.map(u=>`
              <label><div class="who">${avatar(u.name,'emerald',10)}<span>${esc(u.name)}</span></div>
                <input type="checkbox" data-mem="${u.id}" ${draft.members.includes(u.id)?'checked':''}></label>`).join('')}</div></div>
        </div>`;
      footEl.innerHTML=`<button class="eq-btn eq-btn-ghost" id="eq-g-cancel">Cancelar</button>
        <button class="eq-btn eq-btn-primary ${!draft.name?'disabled':''}" id="eq-g-save"><i class="ti ti-check"></i> Salvar grupo</button>`;
      bodyEl.querySelector('#eq-g-name').addEventListener('input',e=>{draft.name=e.target.value;footEl.querySelector('#eq-g-save').classList.toggle('disabled',!draft.name);});
      bodyEl.querySelectorAll('[data-color]').forEach(b=>b.onclick=()=>{draft.color=b.dataset.color;bodyEl.querySelectorAll('[data-color]').forEach(x=>x.classList.toggle('on',x.dataset.color===draft.color));});
      bodyEl.querySelectorAll('[data-perm]').forEach(cb=>cb.onchange=()=>{const id=cb.dataset.perm;draft.permissions=cb.checked?[...new Set([...draft.permissions,id])]:draft.permissions.filter(x=>x!==id);});
      bodyEl.querySelectorAll('[data-mem]').forEach(cb=>cb.onchange=()=>{const id=cb.dataset.mem;draft.members=cb.checked?[...new Set([...draft.members,id])]:draft.members.filter(x=>x!==id);});
      footEl.querySelector('#eq-g-cancel').onclick=()=>{editing=null;draft=null;draw();};
      footEl.querySelector('#eq-g-save').onclick=()=>{
        if(!draft.name)return;
        const idx=S.groups.findIndex(g=>g.id===draft.id);
        if(idx>=0)S.groups[idx]=draft;else S.groups.push(draft);
        // sync users' group when members change: users already have their .group field; not remapping here
        editing=null;draft=null;draw();renderUsers();
      };
    }
  }
  draw();
}

/* ---------- Invite modal ---------- */
function openInviteModal(){
  const st={email:"",groupId:S.groups[0]?.id||"",sent:false};
  const body=`<div id="eq-invite-body"></div>`;
  const footerSlot=`<div id="eq-invite-footer" style="display:contents"></div>`;
  const el=modal({title:"Convidar usuário",subtitle:"Envie um convite por e-mail para acessar a clínica.",
    icon:"user-plus",variant:"sky",body,footer:footerSlot});
  const bd=el.querySelector('#eq-invite-body');const ft=el.querySelector('#eq-invite-footer');
  function draw(){
    if(st.sent){
      bd.innerHTML=`<div class="eq-invite-ok"><div class="eq-ok-badge"><i class="ti ti-check"></i></div>
        <p style="margin:0;font-weight:700;color:#1e293b">Convite enviado para ${esc(st.email)}</p>
        <p style="margin:0;font-size:13px;color:#64748b">A pessoa receberá um e-mail para concluir o cadastro.</p></div>`;
      ft.innerHTML='';setTimeout(()=>closeModal(el),1600);return;
    }
    bd.innerHTML=`
      <div style="display:flex;flex-direction:column;gap:14px">
        <div><label class="eq-label"><i class="ti ti-mail"></i> E-mail</label>
          <input type="email" class="eq-input" id="eq-inv-email" placeholder="nome@exemplo.com" value="${esc(st.email)}" autofocus></div>
        <div><label class="eq-label"><i class="ti ti-briefcase"></i> Grupo</label>
          <select class="eq-input" id="eq-inv-group">${S.groups.map(g=>`<option value="${g.id}" ${g.id===st.groupId?'selected':''}>${esc(g.name)}</option>`).join('')}</select>
          <p style="margin:6px 0 0;font-size:11px;color:#94a3b8">As permissões serão definidas pelo grupo escolhido.</p></div>
      </div>`;
    ft.innerHTML=`<button class="eq-btn eq-btn-ghost" data-close="1">Cancelar</button>
      <button class="eq-btn eq-btn-primary ${!st.email?'disabled':''}" id="eq-inv-send"><i class="ti ti-mail"></i> Enviar convite</button>`;
    bd.querySelector('#eq-inv-email').addEventListener('input',e=>{st.email=e.target.value;ft.querySelector('#eq-inv-send').classList.toggle('disabled',!st.email);});
    bd.querySelector('#eq-inv-group').addEventListener('change',e=>{st.groupId=e.target.value;});
    ft.querySelector('#eq-inv-send').onclick=()=>{if(!st.email)return;st.sent=true;draw();};
  }
  draw();
}

/* ---------- init ---------- */
window.initEquipe=function(){render();};
})();