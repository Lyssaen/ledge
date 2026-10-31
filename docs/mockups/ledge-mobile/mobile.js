/* Interactive design prototype only. No daemon connection or real authorization. */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const page = document.body.dataset.page;
  const params = new URLSearchParams(location.search);
  const scenario = params.get('scenario') || (page==='offline'?'offline':'');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paths = {
    back:'m15 18-6-6 6-6', arrow:'m9 5 7 7-7 7', check:'m5 12 4 4L19 6',
    inbox:'M4 4h16v16H4z M4 13h5l2 3h2l2-3h5', chat:'M4 4h16v13H9l-5 4z',
    terminal:'m5 5 6 6-6 6 M13 18h6', send:'M12 20V4 m-7 7 7-7 7 7',
    close:'m6 6 12 12 M6 18 18 6', shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z',
    settings:'M9 4h6l1 3 3 1v8l-3 1-1 3H9l-1-3-3-1V8l3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    stop:'M6 6h12v12H6z', link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'
  };
  const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.arrow}"/></svg>`;
  const agents = {
    otto:{name:'Otto', tool:'Claude Code', repo:'harness-assistant', branch:'wait-badge', task:'Badge d’attente', color:'#edc479'},
    nova:{name:'Nova', tool:'Codex', repo:'design-system', branch:'theme-default', task:'Thème au premier lancement', color:'#edc479'},
    kai:{name:'Kai', tool:'Codex', repo:'ledge-site', branch:'main', task:'Publication du site', color:'#a6c8f0'},
    bix:{name:'Bix', tool:'Claude Code', repo:'harness-assistant', branch:'session-search', task:'Recherche de sessions', color:'#a6d6bf'},
    pim:{name:'Pim', tool:'Cursor Agent', repo:'harness-assistant', branch:'markdown-reader', task:'Lecture des réponses', color:'#a6c8f0'}
  };
  function bot(id, large=false) {
    const a=agents[id] || agents.bix;
    const shell=a.tool==='Codex'?'<ellipse cx="48" cy="49" rx="32" ry="31"/>':a.tool==='Cursor Agent'?'<path d="M23 77Q14 78 17 66L30 22Q33 12 42 20L79 54Q88 63 77 67L58 71 46 83Q40 88 36 80L32 73Z"/>':'<rect x="15" y="22" width="66" height="56" rx="20"/>';
    return `<svg class="bot${large?' large':''}" viewBox="0 0 96 96" aria-hidden="true"><path d="M49 22V14" stroke="#7d8b91" stroke-width="2"/><circle cx="49" cy="12" r="3" fill="${a.color}"/><g fill="#34434b" stroke="#73858c" stroke-width=".8">${shell}</g><rect x="25" y="35" width="47" height="29" rx="13" fill="#172124"/><g fill="${a.color}"><rect x="36" y="43" width="6" height="12" rx="3"/><rect x="55" y="43" width="6" height="12" rx="3"/></g><path d="M31 79h9m17 0h9" stroke="#34434b" stroke-width="7" stroke-linecap="round"/></svg>`;
  }
  const requests = [
    {id:'tests-otto-01',agent:'otto',kind:'permission',title:'Lancer les tests de l’overlay',age:'3 min',reason:'Vérifier le badge après la modification de la liste.',command:'pnpm --filter overlay test'},
    {id:'theme-nova-01',agent:'nova',kind:'question',title:'Quel thème utiliser par défaut ?',age:'2 min',reason:'Choisir le thème avant que l’utilisateur règle ses préférences.'},
    {id:'push-kai-01',agent:'kai',kind:'risk',title:'Pousser en force sur main',age:'40 s',reason:'Publier la version réécrite de l’historique du site.',command:'git push --force origin main'}
  ];
  if(scenario==='many') for(let i=0;i<7;i++) requests.push({id:`extra-${i}`,agent:i%2?'pim':'bix',kind:'permission',title:['Vérifier les types','Exécuter les tests ciblés','Relancer le build'][i%3],age:`${30-i*3} s`,reason:'Vérifier les dernières modifications de cette tâche.',command:['pnpm typecheck','pnpm test','pnpm build'][i%3]});
  let saved={};
  try { saved=JSON.parse(sessionStorage.getItem('ledge-mobile-demo') || '{}'); } catch {}
  if(params.has('reset')) {
    saved={};
    try { Object.keys(sessionStorage).filter(k=>k.startsWith('ledge-mobile-')).forEach(k=>sessionStorage.removeItem(k)); } catch {}
  }
  function persist() { try {sessionStorage.setItem('ledge-mobile-demo',JSON.stringify(saved));} catch {} }
  const completed = () => saved.completed || {};
  const pending = () => requests.filter(r=>!completed()[r.id]);
  function saveDecision(id,value) {
    saved.completed={...completed(),[id]:value};
    persist();
  }
  function href(file, values={}) {
    const q=new URLSearchParams();
    if(scenario) q.set('scenario',scenario);
    Object.entries(values).forEach(([k,v])=>q.set(k,v));
    return file+(q.size?'?'+q:'');
  }
  const badge = r => r.kind==='risk'?'<span class="badge danger">Impact élevé</span>':r.kind==='question'?'<span class="badge attention">Question</span>':'<span class="badge attention">Autorisation</span>';
  const requestHref = r => href(r.kind==='risk'?'Risk.html':'Request.html',{id:r.id});
  function chrome(content, extra='') {
    app.className='app '+extra;
    app.innerHTML='<div class="prototype"><span>MAQUETTE INTERACTIVE</span><span>Données simulées</span></div>'+content;
  }
  function nav(active) {
    return `<nav class="tabs" aria-label="Navigation principale"><a class="tab" href="${href('Inbox.html')}" ${active==='inbox'?'aria-current="page"':''}>${icon('inbox')}À traiter ${pending().length?`<span class="count">${pending().length}</span>`:''}</a><a class="tab" href="${href('Agents.html')}" ${active==='agents'?'aria-current="page"':''}>${icon('chat')}Agents</a></nav>`;
  }
  const top = (title,subtitle,offline=false) => `<header class="page-head"><div class="head-row between"><div class="connection"><i class="dot${offline?' off':''}"></i>PC-Desan · ${offline?'déconnecté':'connecté'}</div><a class="icon-button" href="Pairing.html" aria-label="Connexion du téléphone">${icon('settings')}</a></div><h1>${title}</h1><p class="subtitle">${subtitle}</p></header>`;
  const backHead = (title,back='Inbox.html') => `<header class="page-head thread-head"><div class="head-row"><a class="icon-button back" href="${href(back)}" aria-label="Retour">${icon('back')}</a><span class="grow">${title}</span><span class="connection"><i class="dot${scenario==='offline'?' off':''}"></i>PC-Desan</span></div></header>`;
  function task(r) { const a=agents[r.agent];return `<div class="task">${bot(r.agent)}<div class="grow"><strong>${a.task}</strong><p>${a.name} · ${a.tool}</p><p>${a.repo} · <code>${a.branch}</code></p></div></div>`; }
  function requestCard(r,offline=false) {
    const a=agents[r.agent];
    return `<a class="request${r.kind==='risk'?' risky':''}" href="${offline?href('Request.html',{id:r.id,scenario:'offline'}):requestHref(r)}"><div class="row">${bot(r.agent)}<span class="identity grow">${a.name} · ${a.task}</span><span class="age">${r.age}</span></div><h3>${r.title}</h3><div class="branch">${a.repo} · <code>${a.branch}</code></div><div class="foot">${badge(r)}<span class="row muted">${offline?'Dernier état connu':'Examiner'}${icon('arrow')}</span></div></a>`;
  }
  function renderInbox(filter='all') {
    if(scenario==='offline') {renderOffline();return;}
    const list=pending().filter(r=>filter==='all'||(filter==='question'?r.kind==='question':r.kind!=='question'));
    chrome(top('À traiter',pending().length?`${pending().length} demandes. Choisissez par où commencer.`:'Toutes les demandes ont été traitées.')+`<main class="scroll"><div class="filters" role="group" aria-label="Filtrer les demandes">${[['all','Tout'],['permission','Autorisations'],['question','Questions']].map(([k,t])=>`<button class="filter" data-filter="${k}" aria-pressed="${filter===k}">${t}</button>`).join('')}</div><div class="section-label"><span>LES PLUS ANCIENNES D’ABORD</span><span>${list.length}</span></div><div class="stack">${list.map(r=>requestCard(r)).join('')}</div>${!list.length?`<div class="empty">${bot('bix',true)}<h2>${pending().length?'Aucune demande dans ce filtre':'Vous êtes à jour'}</h2><p>${pending().length?'Les autres demandes restent dans « Tout ».':'Pim travaille. Bix est disponible pour la suite.'}</p><a class="btn" href="Agents.html">Voir les agents ${icon('arrow')}</a></div>`:''}${Object.keys(completed()).length?'<p class="small muted" style="padding-top:20px">Les décisions transmises sont conservées dans le fil de chaque agent.</p>':''}</main>`+nav('inbox'));
    document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>renderInbox(b.dataset.filter));
  }
  function currentRequest() {
    const fallback=page==='risk'?requests[2]:requests[0];
    const r={...(requests.find(r=>r.id===params.get('id')) || fallback)};
    if(scenario==='long') r.command='pnpm --filter overlay exec vitest run src/surface/__tests__/SessionList.waiting-duration.test.tsx --reporter=verbose --testNamePattern="affiche la durée d’attente après reconnexion"';
    return r;
  }
  function showResult(r,decision,fromPC=false) {
    const a=agents[r.agent];
    chrome(backHead('Demande traitée')+`<main class="scroll"><div class="result"><div class="result-mark">${icon('check')}</div><span class="eyebrow">${a.name} · ${a.task}</span><h1>${fromPC?'Déjà traitée sur le PC':decision==='deny'?'Refus pris en compte':r.kind==='question'?'Réponse prise en compte':'Autorisation prise en compte'}</h1><p>${fromPC?'Cette demande a été résolue ailleurs. Aucune nouvelle décision n’a été envoyée.':'Le terminal a reçu votre décision. Elle apparaît maintenant dans le fil de cette session.'}</p><div class="notice"><strong>${r.title}</strong><p class="muted">${a.repo} · <code>${a.branch}</code></p>${r.command?`<code>${escape(r.command)}</code>`:''}</div><p>Une décision transmise ne peut pas être annulée.</p><a class="btn primary full" href="${href('Inbox.html')}">Retour aux demandes</a><a class="btn full" href="${href('Thread.html',{agent:r.agent})}">Voir le fil de ${a.name}</a></div></main>`);
  }
  function renderRequest() {
    const r=currentRequest();const a=agents[r.agent];
    if(scenario==='resolved') {saveDecision(r.id,'pc');showResult(r,'accept',true);return;}
    if(completed()[r.id]) {showResult(r,completed()[r.id],completed()[r.id]==='pc');return;}
    const offline=scenario==='offline';
    const high=r.kind==='risk';const question=r.kind==='question';
    chrome(backHead(question?'Une question':'Une autorisation')+`<main class="scroll">${task(r)}<div class="detail-title">${badge(r)}<h1>${r.title}</h1><p>${r.reason}</p></div>${question?`<form id="answer-form"><fieldset class="options" style="border:0;padding:0"><legend class="screen-reader">Choisir un thème</legend>${['Sombre · Signal','Clair · Galet','Suivre le système','Autre réponse'].map((v,i)=>`<label class="option"><input type="radio" name="answer" value="${i}"><span>${v}</span></label>`).join('')}</fieldset><div id="other-field" hidden><label class="field-label" for="other">Votre réponse à Nova</label><textarea id="other" placeholder="Précisez votre choix…"></textarea></div></form>`:`<pre class="command">${escape(r.command)}</pre>${high?'<div class="notice danger"><strong class="red">Peut remplacer l’historique distant</strong><p>Les commits présents sur <code>origin/main</code> peuvent être écrasés. Les autres personnes travaillant sur cette branche peuvent être affectées.</p></div>':'<div class="notice"><strong>Exécution dans le projet</strong><p class="muted">Le script de test du dépôt sera exécuté avec les permissions de cette session. Il peut modifier des fichiers ou accéder au réseau.</p></div>'}<dl class="metadata"><dt>Dossier</dt><dd><code>~/Workspace/${a.repo}</code></dd><dt>Branche</dt><dd><code>${a.branch}</code></dd>${high?'<dt>Destination</dt><dd><code>origin/main</code> · dépôt distant</dd>':''}<dt>Demandé</dt><dd>Il y a ${r.age}</dd></dl><details class="disclosure"><summary>Contexte de la demande ${icon('terminal')}</summary><pre>${high?'Kai : J’ai réécrit les derniers commits pour nettoyer l’historique. Je demande votre accord avant de remplacer la branche distante.':'Otto : Le badge est ajouté à la liste des sessions. Je lance les tests de l’overlay pour vérifier les durées d’attente et le rendu.'}</pre></details>`}${offline?'<div class="notice warning"><strong>Connexion au PC perdue</strong><p>Dernier état connu. Reconnectez-vous pour vérifier si cette demande attend toujours une décision.</p></div>':''}</main><footer class="actions" id="decision-actions">${question?'<button class="btn primary" id="answer" disabled>Envoyer ma réponse</button>':`<div class="button-row"><button class="btn" id="deny" ${offline?'disabled':''}>Refuser</button><button class="btn ${high?'danger':'primary'}" id="approve" ${offline?'disabled':''}>${high?'Vérifier et autoriser':'Autoriser une fois'}</button></div>`}<a class="btn quiet" href="${href('Thread.html',{agent:r.agent})}">Voir le fil de ${a.name}</a><p class="hint">${offline?'Aucune décision ne sera envoyée hors connexion.':'La décision sera transmise immédiatement au PC.'}</p></footer>`);
    if(question) {
      const button=document.getElementById('answer');
      const update=()=>{
        const radio=document.querySelector('input[name=answer]:checked');
        const other=radio?.value==='3';document.getElementById('other-field').hidden=!other;
        button.disabled=offline || !radio || (other&&!document.getElementById('other').value.trim());
      };
      document.getElementById('answer-form').oninput=update;
      button.onclick=()=>{
        const choice=document.querySelector('input[name=answer]:checked');
        const answer=choice.value==='3'?document.getElementById('other').value.trim():choice.parentElement.innerText;
        saved.answers={...saved.answers,[r.id]:answer};
        transmit(r,'answer');
      };
    } else {
      document.getElementById('deny').onclick=()=>transmit(r,'deny');
      document.getElementById('approve').onclick=()=>high?confirmRisk(r):transmit(r,'accept');
    }
  }
  function confirmRisk(r) {
    const dialog=document.createElement('dialog');
    dialog.setAttribute('aria-label','Confirmer le push forcé');
    dialog.innerHTML=`<div class="dialog-head"><h2>Autoriser ce push forcé ?</h2><button class="icon-button" id="close-dialog" aria-label="Fermer la confirmation">${icon('close')}</button></div><p class="small muted">Kai · Publication du site · ledge-site</p><div class="notice danger"><strong class="red">L’historique de origin/main peut être écrasé.</strong><p>Cette action affecte le dépôt distant et peut supprimer des commits de la branche partagée.</p></div><pre class="command">${escape(r.command)}</pre><p class="fine">Une vérification sur votre appareil sera demandée. Elle confirme votre identité, pas la sûreté de la commande.</p><button class="btn danger full" id="confirm-risk">${icon('shield')}Confirmer avec mon appareil</button><button class="btn quiet full" id="cancel-risk">Revenir à la demande</button><p class="fine">Démonstration : aucune authentification ni commande réelle.</p>`;
    app.append(dialog);dialog.showModal();
    const close=()=>dialog.close();
    dialog.querySelector('#close-dialog').onclick=close;dialog.querySelector('#cancel-risk').onclick=close;
    dialog.onclose=()=>dialog.remove();
    dialog.querySelector('#confirm-risk').onclick=()=>{dialog.close();transmit(r,'accept');};
  }
  function transmit(r,decision) {
    const footer=document.getElementById('decision-actions');
    footer.innerHTML='<div class="notice" role="status"><strong>Transmission au PC…</strong><p>En attente de confirmation du terminal.</p></div>';
    setTimeout(()=>{
      if(scenario==='disconnect') {
        footer.innerHTML=`<div class="notice warning" role="alert"><strong>Réception non confirmée</strong><p>La connexion a été perdue pendant l’envoi. La décision a peut-être été reçue. Vérifiez son état avant de recommencer.</p></div><button class="btn primary" id="check-state">Reconnecter et vérifier</button>`;
        document.getElementById('check-state').onclick=()=>{
          saveDecision(r.id,decision);showResult(r,decision);
        };
      } else {saveDecision(r.id,decision);showResult(r,decision);}
    },850);
  }
  function renderAgents() {
    const groups=[['harness-assistant',['otto','bix','pim']],['design-system',['nova']],['ledge-site',['kai']]];
    chrome(top('Agents',scenario==='offline'?'Dernier état connu · connexion perdue':'5 sessions · 3 projets sur ce PC',scenario==='offline')+`<main class="scroll">${groups.map(([repo,ids])=>`<div class="section-label">${repo}</div>${ids.map(id=>{
      const a=agents[id];const r=pending().find(r=>r.agent===id);
      return `<a class="session-row" href="${href('Thread.html',{agent:id})}">${bot(id)}<div class="grow"><div class="row between"><h3>${a.task}</h3>${id==='bix'?'<span class="unread">● Non lu</span>':''}</div><div class="branch">${a.name} · <code>${a.branch}</code></div><p>${r?r.title:id==='bix'?'La recherche est prête. Voir le résultat.':'Travaille sur les dernières modifications.'}</p><div style="margin-top:8px">${r?badge(r):`<span class="badge ${id==='bix'?'ok':'info'}">${id==='bix'?'Disponible':'Au travail'}</span>`}</div></div>${icon('arrow')}</a>`;
    }).join('')}`).join('')}</main>`+nav('agents'));
  }
  function renderThread() {
    const id=agents[params.get('agent')]?params.get('agent'):'bix';const a=agents[id];
    const r=pending().find(r=>r.agent===id);const previous=requests.find(r=>r.agent===id&&completed()[r.id]);
    const offline=scenario==='offline';
    const history=saved.messages?.[id] || [];
    const working=id==='pim'||history.length>0||(previous&&completed()[previous.id]!=='deny');
    const locked=!!r||offline||working;
    const draftKey='ledge-mobile-draft-'+id;
    let draft='';try {draft=sessionStorage.getItem(draftKey)||'';} catch {}
    const message=id==='pim'?'<p>Je vérifie le rendu des réponses longues et la navigation dans les fichiers.</p>':id==='bix'?'<strong>La recherche de sessions est prête.</strong><ul><li>Recherche par titre et dépôt</li><li>Conservation du filtre au retour</li><li>Tests de la liste vérifiés</li></ul><div class="suggestion"><div class="eyebrow">Suggestion pour la suite</div><p>Je peux te montrer le diff avant de préparer la fusion.</p></div>':r?`<p>${r.reason}</p><p>J’attends votre ${r.kind==='question'?'réponse':'accord'} avant de continuer.</p>`:'<p>Votre décision a été reçue. Je reprends la tâche.</p>';
    chrome(`<header class="page-head thread-head"><div class="head-row"><a class="icon-button back" href="${href('Agents.html')}" aria-label="Retour aux agents">${icon('back')}</a>${bot(id)}<div class="grow"><h1>${a.task}</h1><p>${a.name} · ${a.tool}</p></div><a class="icon-button" href="${href('Terminal.html',{agent:id})}" aria-label="Ouvrir le terminal de ${a.name}">${icon('terminal')}</a></div><p class="branch" style="margin:8px 0 0 44px">${a.repo} · <code>${a.branch}</code></p></header><main class="scroll conversation" aria-label="Échanges avec ${a.name}"><div class="time">Aujourd’hui</div><div class="bubble me">${id==='bix'?'Ajoute une recherche dans la liste des sessions.':`Continue la tâche « ${a.task} ».`}</div>${previous?`<div class="history-event">${completed()[previous.id]==='deny'?'Refus':'Accord / réponse'} pris en compte · depuis ${completed()[previous.id]==='pc'?'le PC':'le téléphone'}${saved.answers?.[previous.id]?` · ${escape(saved.answers[previous.id])}`:''}</div>`:''}<article class="bubble agent">${message}</article>${r?`<div class="notice warning"><strong>Décision attendue · dans « À traiter »</strong><p>${r.title}</p><a class="btn full" style="margin-top:12px" href="${requestHref(r)}">Examiner la demande ${icon('arrow')}</a></div>`:'<span class="time">10:14 · Réponse de l’agent</span>'}<div id="messages" class="stack">${history.map(text=>`<div class="bubble me">${escape(text)}</div><div class="delivery">Pris par le terminal</div>`).join('')}</div></main><footer class="composer"><div class="compose-status ${offline?'muted':r?'amber':working?'blue':'green'}"><i class="dot" style="background:currentColor"></i>${offline?'Connexion perdue · dernier état connu':r?'En attente d’une décision':working?'Au travail · consultez le terminal':'Disponible pour votre consigne'}</div><div id="send-error"></div>${!locked?'<div class="chips"><button class="chip" data-chip>Montre le diff</button><button class="chip" data-chip>Lance les tests</button><button class="chip" data-chip>Explique les changements</button></div>':''}<div class="compose-row"><label class="screen-reader" for="draft">Message pour ${a.name}</label><textarea id="draft" rows="1" placeholder="${offline?'Reconnectez-vous pour écrire':r?'Traitez la demande ci-dessus':working?'L’agent travaille…':`Écrire à ${a.name}…`}" ${locked?'disabled':''}>${escape(draft)}</textarea><button class="send" id="send" aria-label="Envoyer à ${a.name}" disabled>${icon('send')}</button></div></footer>`);
    const input=document.getElementById('draft');const send=document.getElementById('send');
    let busy=false;
    const update=()=>{send.disabled=locked||busy||!input.value.trim();try {sessionStorage.setItem(draftKey,input.value);} catch {}};
    input.oninput=update;update();
    document.querySelectorAll('[data-chip]').forEach(b=>b.onclick=()=>{input.value=b.textContent;update();input.focus();});
    send.onclick=()=>{
      const text=input.value.trim();if(!text||busy||locked)return;
      busy=true;update();input.disabled=true;document.querySelectorAll('[data-chip]').forEach(b=>b.disabled=true);
      const wrap=document.createElement('div');wrap.className='stack';wrap.innerHTML=`<div class="bubble me">${escape(text)}</div><div class="delivery" role="status">Envoi au PC…</div>`;
      document.getElementById('messages').append(wrap);wrap.scrollIntoView({block:'end'});
      setTimeout(()=>{
        if(scenario==='send-failure') {
          wrap.remove();
          document.getElementById('send-error').innerHTML='<div class="notice warning composer-error" role="alert"><strong>Message non envoyé</strong><p>Le PC est injoignable. Votre brouillon est conservé.</p><button class="btn full" id="reconnect" style="margin-top:8px">Reconnecter</button></div>';
          document.getElementById('reconnect').onclick=()=>{location.href=href('Thread.html',{agent:id,scenario:'reconnected'});};
          send.disabled=true;
          input.disabled=false;
        } else {
          wrap.querySelector('.delivery').textContent='Pris par le terminal · à l’instant';
          saved.messages={...saved.messages,[id]:[...history,text]};persist();
          input.value='';update();
          document.querySelector('.compose-status').innerHTML='<i class="dot"></i>Consigne reçue · l’agent reprend';
        }
      },850);
    };
  }
  function renderOffline() {
    chrome(top('À traiter','Dernier état connu · aujourd’hui à 22:14',true)+`<main class="scroll"><div class="notice warning"><strong>Connexion au PC perdue</strong><p>Le PC, le réseau ou Tailscale est indisponible. Les demandes ci-dessous peuvent avoir changé.</p><button class="btn full" id="retry" style="margin-top:12px">Reconnecter et actualiser</button></div><div class="section-label">DERNIER ÉTAT CONNU</div><div class="stack">${requests.map(r=>requestCard(r,true)).join('')}</div><p class="small muted" style="margin-top:16px">Vous pouvez consulter les demandes. Aucune décision ne sera envoyée hors connexion.</p></main>`+nav('inbox'));
    document.getElementById('retry').onclick=e=>{e.currentTarget.disabled=true;e.currentTarget.textContent='Reconnexion…';setTimeout(()=>location.href='Inbox.html',700);};
  }
  function renderTerminal() {
    const id=agents[params.get('agent')]?params.get('agent'):'bix';const a=agents[id];
    const waiting=pending().some(r=>r.agent===id);
    const offline=scenario==='offline';
    chrome(backHead(`Terminal de ${a.name}`,'Thread.html')+`<main class="scroll terminal-content"><div class="terminal-toolbar"><span class="small muted">Lecture seule · ${offline?'dernier état connu':waiting?'en attente':'en direct'}</span><div class="row"><button class="btn" id="smaller" aria-label="Réduire le texte">A−</button><button class="btn" id="larger" aria-label="Agrandir le texte">A+</button></div></div><div class="terminal" tabindex="0" aria-label="Sortie du terminal, défilement horizontal"><pre id="terminal-text">${escape(`> ${a.task}\n\n● Dossier : ~/Workspace/${a.repo}\n  Branche : ${a.branch}\n\n${waiting?'● Une décision est attendue dans Ledge.\n  Aucune nouvelle commande exécutée.':'● Lecture des dernières modifications…\n\n  apps/overlay/src/surface/SessionList.tsx\n  packages/ledge/src/daemon/state.ts\n\n● Vérification de la recherche de sessions\n  18 tests réussis\n\n● Préparation du résumé…\n\n✻ Working… (14s · esc to interrupt)'}`)}</pre></div></main><footer class="actions"><p class="hint">Faites défiler horizontalement pour lire les lignes longues.</p><button class="btn" id="interrupt" ${waiting||offline?'disabled':''}>${icon('stop')}Interrompre ${a.name}</button><p class="hint">Interrompre n’annule pas les actions déjà effectuées.</p></footer>`);
    document.querySelector('.back').href=href('Thread.html',{agent:id});
    let size=12;
    const resize=delta=>{size=Math.max(11,Math.min(20,size+delta));document.getElementById('terminal-text').style.fontSize=size+'px';};
    document.getElementById('smaller').onclick=()=>resize(-1);document.getElementById('larger').onclick=()=>resize(1);
    document.getElementById('interrupt').onclick=e=>{e.currentTarget.disabled=true;e.currentTarget.textContent='Interruption transmise';document.getElementById('terminal-text').textContent+='\n\n■ Interrompu. En attente de votre consigne.';};
  }
  function renderNotification() {
    chrome(`<main class="scroll"><div class="lock-time"><p>Mercredi 14 octobre</p><strong>10:14</strong></div><a class="push-card" href="${href('Request.html',{id:requests[0].id})}"><div class="push-head"><span>LEDGE · PC-DESAN</span><span>maintenant</span></div><h3>Votre accord est demandé</h3><p>Badge d’attente · Otto</p><p>Lancer les tests de l’overlay</p><div class="open-hint">Ouvrir la demande dans Ledge ${icon('arrow')}</div></a><a class="push-card" href="${href('Request.html',{id:requests[1].id})}"><div class="push-head"><span>LEDGE · PC-DESAN</span><span>il y a 2 min</span></div><h3>Nova a une question</h3><p>Thème au premier lancement</p><div class="open-hint">Voir la question ${icon('arrow')}</div></a><p class="notification-note">Aperçu du parcours iPhone.<br>Touchez une notification, puis vérifiez la demande dans Ledge avant de décider.</p></main>`,'notification-bg');
  }
  function renderPairing(step=0) {
    const screens=[
      ['Votre PC, à portée de main','Connectez le téléphone au réseau privé de votre PC pour retrouver vos agents.',`<ol class="checklist"><li><div>Connecter Tailscale<small>Sur le PC et le téléphone, utilisez le même réseau privé.</small></div></li><li><div>Ouvrir le QR code du PC<small>Dans Ledge : Réglages → Mobile. Scannez avec l’appareil photo du téléphone.</small></div></li><li><div>Installer et appairer Ledge<small>Gardez le PC à proximité pour cette première connexion.</small></div></li></ol>`,'Tailscale est connecté'],
      ['Installer Ledge','Le QR code du PC ouvre l’adresse privée de votre application.',`<div class="notice"><strong>Dans Safari sur votre téléphone</strong><p>Ouvrez le menu de partage, puis « Sur l’écran d’accueil ». Ouvrez ensuite Ledge depuis sa nouvelle icône.</p></div><p class="small muted" style="margin-top:16px">Le code d’appairage se saisit dans l’application installée. Les notifications seront proposées ensuite.</p>`,'Ledge est installé'],
      ['Appairer ce téléphone','Saisissez le code affiché dans Ledge sur votre PC.',`<label class="field-label" for="pair-code">Code à six chiffres</label><input id="pair-code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="000000"><p class="small muted" style="margin-top:10px">Démo : utilisez 481203. Code valable 2 minutes.</p><div id="pair-error" class="toast" role="status"></div><div class="notice"><strong>PC-Desan · réseau privé</strong><p>Vous pourrez retirer l’accès de ce téléphone depuis Réglages → Mobile sur le PC.</p></div>`,'Appairer mon téléphone'],
      ['Vous êtes connecté','Ce téléphone est appairé à PC-Desan.',`<div class="notice success"><strong class="green">Accès confirmé</strong><p>Vos demandes et conversations sont disponibles tant que le PC et Tailscale sont connectés.</p></div><div class="detail-title"><h2>Être prévenu quand un agent attend</h2><p>Activez les notifications pour ouvrir une demande directement depuis votre écran verrouillé.</p></div>`,'Activer les notifications']
    ];
    const [title,subtitle,body,button]=screens[step];
    chrome(`<header class="page-head"><div class="head-row between"><a class="icon-button back" href="Inbox.html" aria-label="Retour aux demandes">${icon('back')}</a><span class="small muted">Connexion · ${step+1} / 4</span></div></header><main class="scroll"><div class="steps">${screens.map((_,i)=>`<span class="step${i<=step?' active':''}"></span>`).join('')}</div><div class="pair-hero">${bot('bix',true)}<h1>${title}</h1><p>${subtitle}</p></div>${body}</main><footer class="actions"><button class="btn primary" id="pair-next" ${step===2?'disabled':''}>${button}</button>${step===3?'<a class="btn quiet" href="Inbox.html">Plus tard</a>':''}<p class="hint">Démonstration du parcours · aucune connexion réelle</p></footer>`);
    if(step===2) document.getElementById('pair-code').oninput=e=>{e.target.value=e.target.value.replace(/\D/g,'');document.getElementById('pair-next').disabled=e.target.value.length!==6;};
    document.getElementById('pair-next').onclick=()=>{
      if(step===2&&document.getElementById('pair-code').value!=='481203') {document.getElementById('pair-error').textContent='Code non reconnu. Essayez le code de démonstration 481203.';return;}
      if(step===3) {document.getElementById('pair-next').textContent='Notifications activées dans la démo';setTimeout(()=>location.href='Inbox.html',700);return;}
      renderPairing(step+1);
    };
  }
  ({inbox:renderInbox,request:renderRequest,risk:renderRequest,agents:renderAgents,thread:renderThread,offline:renderOffline,terminal:renderTerminal,notification:renderNotification,pairing:renderPairing}[page] || renderInbox)();
})();
