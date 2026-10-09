/* Ledge design prototype: all sessions and results are fictional and stay in this tab. */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const bots = window.LedgeMascots;
  const toolNames = {claude:'Claude Code',codex:'Codex',cursor:'Cursor Agent'};
  const labels = {starting:'Démarrage',working:'Au travail',waiting_permission:'Votre accord',waiting_input:'Une question',idle:'Disponible',error:'Erreur',exited:'Terminée'};
  const scenarios = [
    ['overview','Vue d’ensemble','Quatre sessions, deux demandes. Ouvrez Otto ou Nova pour leur répondre.'],
    ['permission','Autorisation','Autorisez ou refusez la commande. Observez le geste avant la reprise du travail.'],
    ['question','Question','Choisissez une réponse ou saisissez votre propre proposition.'],
    ['diff','Revue de fichiers','Dépliez les fichiers, essayez le mode lecture, puis acceptez ou refusez les modifications.'],
    ['plan','Validation de plan','Lisez les étapes. Approuvez le plan ou demandez une modification.'],
    ['helpers','Sous-agents','Le parent travaille pendant que Lu attend une autorisation. Répondez directement à Lu.'],
    ['long','Commande longue','La sortie évolue. Vous pouvez interrompre la commande ou simuler sa fin.'],
    ['report','Rapport reçu','Passez en mode lecture, consultez le terminal ou envoyez une nouvelle instruction.'],
    ['error','Erreur','L’erreur reste visible et calme. Consultez le terminal simulé ou réessayez.'],
    ['exited','Session terminée','La session ne bouge plus. Continuer crée une nouvelle session dans cette démonstration.'],
    ['readonly','Lecture seule','Une session sans lanceur reste visible ; ses actions de réponse sont indisponibles.'],
    ['team','Équipe & connexion','Essayez 0, 5 ou 12 sessions, puis coupez la connexion simulée.']
  ];
  let sessions = [], activeId = 'otto', mode = 'list', reading = false, dnd = false, offline = false;
  let scenario = 'overview', epoch = 0, timers = new Set(), transitionTimer, hoverTimer, leaveTimer;
  let bubble = null, bubbleRemaining = 4000, bubbleHover = false, lastTick = performance.now();
  let busy = new Set(), tests = new Set(), selectedRow = 0, navigationVersion = 0;
  let drafts = new Map(), customAnswers = new Map(), answers = new Map(), grants = new Set();
  let longTicks = 0, motionOverride = false, newSessionIndex = 0;
  const osMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const surface = $('#surface'), desktop = $('#desktop');
  const sessionById = id => sessions.find(s => s.id === id);
  const active = () => sessionById(activeId);
  const interactive = s => s && !offline && !s.readonly && !busy.has(s.id);
  const delay = (fn, duration) => {
    const generation = epoch;
    const timer = setTimeout(() => { timers.delete(timer); if (generation === epoch) fn(); }, duration);
    timers.add(timer); return timer;
  };
  function cancelTimers() { timers.forEach(clearTimeout); timers.clear(); clearTimeout(hoverTimer); clearTimeout(leaveTimer); }
  function announce(message) { $('#status').textContent = message; }
  function record(action) { tests.add(action); $('#tested-count').textContent = tests.size + ' action' + (tests.size > 1 ? 's testées' : ' testée'); }
  const avatar = (key, size = 32) => `<span data-avatar="${escape(key)}" data-size="${size}"></span>`;
  const badge = s => `<span class="badge" data-state="${s.state}">${s.readonly ? 'Lecture seule' : labels[s.state]}</span>`;
  function pendingEntries() {
    return sessions.flatMap(s => [
      ...(s.pending && !s.readonly ? [{id:s.id,sessionId:s.id,kind:s.pending,at:s.pendingAt || 0}] : []),
      ...(s.helpers || []).filter(h => h.pending).map(h => ({id:h.id,sessionId:s.id,helperId:h.id,kind:h.pending,at:h.pendingAt || 0}))
    ]).sort((a,b) => a.at - b.at);
  }
  function resolveAvatar(key) {
    if (key === 'theme-demo') return {id:'theme-demo',name:'Signal',tool:'claude',state:'idle'};
    if (key === 'empty-demo') return {id:'empty-demo',name:'Ledge',tool:'codex',state:'idle'};
    if (key === 'active-header') return active();
    if (key === 'active-bubble') return bubble ? sessionById(bubble.sessionId)?.helpers?.find(h => h.id === bubble.helperId) || sessionById(bubble.sessionId) : active();
    return sessionById(key) || sessions.flatMap(s => s.helpers || []).find(h => h.id === key);
  }
  function refreshAvatars(root = document) {
    $$('[data-avatar]', root).forEach(slot => {
      const s = resolveAvatar(slot.dataset.avatar);
      if (s) bots.update(slot, s, Number(slot.dataset.size));
    });
  }
  function baseSessions() {
    return [
      {id:'otto',name:'Otto',tool:'claude',project:'harness-assistant',age:'2 min',state:'waiting_permission',pending:'permission',pendingAt:1,command:'pnpm test --filter overlay'},
      {id:'nova',name:'Nova',tool:'codex',project:'design-system',age:'8 min',state:'waiting_input',pending:'question',pendingAt:2,command:'Choisir le thème par défaut'},
      {id:'pim',name:'Pim',tool:'cursor',project:'landing-page',age:'12 min',state:'working',kind:'long',command:'pnpm build'},
      {id:'bix',name:'Bix',tool:'claude',project:'documentation',age:'18 min',state:'idle',kind:'report'}
    ];
  }
  function renderRows(rebuild = false) {
    const list = $('#session-list');
    if (rebuild) {
      list.innerHTML = sessions.map((s,i) => `<button class="session-row entering" data-session="${s.id}" style="--index:${i}"><span class="number">${i+1}</span>${avatar(s.id)}<span class="row-copy"><strong>${escape(s.project)}</strong><small>${escape(s.name)} · ${toolNames[s.tool]} · ${s.age}</small></span><span class="row-badge"></span></button>`).join('');
    }
    $$('.session-row').forEach((row,i) => {
      const s = sessions[i];
      row.classList.toggle('selected', s.id === activeId);
      row.setAttribute('aria-label', `${s.name} · ${s.project} · ${s.readonly ? 'Lecture seule' : labels[s.state]}`);
      $('.row-badge', row).innerHTML = badge(s);
    });
    const count = pendingEntries().length;
    $('#list-summary').textContent = `${sessions.length} session${sessions.length > 1 ? 's' : ''} · ${count ? count + ' demande' + (count > 1 ? 's' : '') + ' pour vous' : 'tout est à jour'}`;
    $('#empty-state').hidden = sessions.length > 0;
    $('#queue-summary').hidden = !sessions.length || count > 0 || !tests.size;
    renderHandle();
    refreshAvatars($('#view-list'));
  }
  function renderHandle() {
    const host = $('#handle-bots'), dense = sessions.length > 5;
    const visible = sessions.length > 10 ? sessions.filter((s,i) => s.pending || i < 5) : sessions;
    const keys = visible.map(s => s.id).join(',');
    if (host.dataset.keys !== keys || !host.children.length) {
      host.dataset.keys = keys;
      host.innerHTML = visible.map(s => `<button class="handle-bot" data-session="${s.id}">${avatar(s.id,12)}<span class="tooltip"></span></button>`).join('') + (visible.length < sessions.length ? `<button class="handle-more" data-action="list">+${sessions.length-visible.length}</button>` : '') + (!sessions.length ? '<div class="handle-empty"></div>' : '');
    }
    $$('.handle-bot',host).forEach(button => {
      const s = sessionById(button.dataset.session);
      button.classList.toggle('waiting', Boolean(s.pending));
      button.classList.toggle('question', s.state === 'waiting_input');
      $('[data-avatar]',button).dataset.size = s.pending ? (dense ? '18' : '20') : (dense ? '11' : '12');
      $('.tooltip',button).textContent = `${s.name} · ${labels[s.state]} · ouvrir`;
      button.setAttribute('aria-label', `${s.name} · ${labels[s.state]} · ouvrir la session`);
    });
    refreshAvatars(host);
  }
  function fitSurface() {
    const layer = $(`[data-layer="${mode}"]`);
    const available = Math.max(250,desktop.clientHeight - 44);
    const width = Math.min(mode === 'handle' ? (sessions.length ? 28 : 6) : mode === 'bubble' ? 336 : mode === 'session' ? (reading ? 560 : 420) : 380, desktop.clientWidth - 20);
    const oldWidth = surface.getBoundingClientRect().width, oldHeight = surface.getBoundingClientRect().height;
    layer.style.setProperty('--content-width', width + 'px');
    layer.style.setProperty('--max-height', available + 'px');
    const height = Math.min(layer.scrollHeight,available);
    surface.classList.toggle('shrinking',width < oldWidth || height < oldHeight);
    surface.classList.toggle('empty-handle',mode === 'handle' && !sessions.length);
    surface.style.width = width + 'px';
    surface.style.height = Math.max(height,mode === 'handle' ? 60 : 80) + 'px';
  }
  function setMode(next, {manual = true, focus = false} = {}) {
    if (next === 'session' && !active()) next = 'list';
    if (next === 'bubble' && !bubble) {
      bubble = pendingEntries()[0];
      if (!bubble) { announce('Aucune demande en attente. Utilisez « Simuler une demande » pour en créer une.'); next = 'list'; }
      else { activeId = bubble.sessionId; bubbleRemaining = 4000; renderBubble(); }
    }
    if (manual) navigationVersion++;
    clearTimeout(transitionTimer);
    clearTimeout(leaveTimer);
    const previous = mode;
    mode = next;
    surface.dataset.mode = next;
    $$('.surface-view').forEach(view => {const visible = view.dataset.layer === next;view.classList.toggle('active',visible);view.inert = !visible;});
    $$('.view-tabs button').forEach(b => b.setAttribute('aria-pressed',b.dataset.view === next));
    if (next === 'list') renderRows();
    if (next === 'session') renderSession();
    if (next !== 'bubble') bubbleHover = false;
    surface.classList.toggle('reading-mode', next === 'session' && reading);
    fitSurface();
    if (focus) {
      transitionTimer = setTimeout(() => { if (mode === next) ($('button:not([disabled]), textarea', $(`[data-layer="${mode}"]`)) || surface).focus({preventScroll:true}); }, bots.reduced() ? 0 : 350);
    } else if (previous !== next && surface.contains(document.activeElement) && document.activeElement.closest('[inert]')) surface.focus({preventScroll:true});
  }
  function openSession(id, {focus = false, manual = true} = {}) {
    if (!sessionById(id)) return;
    saveDraft();activeId = id;selectedRow = sessions.findIndex(s => s.id === id);bubble = null;
    renderRows();setMode('session',{focus,manual});record('ouvrir');
  }
  function saveDraft() { if (mode === 'session' && active()) drafts.set(activeId,$('#reply').value); }
  function terminalMarkup(s, expanded = false) {
    const log = s.terminal || (s.state === 'error' ? '❯ pnpm test --filter overlay\nError: connection to test runner lost\nProcess exited with code 1' : s.state === 'exited' ? 'Session ended · exit code 0' : s.state === 'working' ? `❯ ${s.command || 'pnpm test'}\n› Préparation de l’environnement…\n› Traitement en cours…` : s.outcome === 'denied' ? 'Action refusée par l’utilisateur.\nAucune commande exécutée.' : '✓ Bot.spec.tsx · 8 tests\n✓ Surface.spec.tsx · 4 tests\n12 tests passed · résultat simulé');
    return `<details class="terminal-preview ${expanded?'expanded':''}" ${expanded?'open':''}><summary>› Aperçu du terminal <span class="muted">· simulation</span></summary><pre id="terminal-output">${escape(log)}</pre></details>`;
  }
  const actionButtons = (kind, disabled = false) => `<div class="request-actions"><button data-action="deny" ${disabled?'disabled':''}>${kind === 'plan' ? 'Le modifier' : 'Refuser'}</button><button class="primary" data-action="approve" ${disabled?'disabled':''}>${kind === 'diff' ? 'Appliquer' : kind === 'plan' ? 'Approuver le plan' : 'Autoriser'} <span class="muted-key">Y</span></button></div>`;
  function sessionBody(s) {
    const disabled = !interactive(s);
    const top = `<div class="section-eyebrow"><span>${s.pending ? 'À vous de jouer' : s.state === 'working' ? 'En cours' : s.state === 'error' ? 'À examiner' : 'Session'} ${s.guessed ? '· état estimé' : ''}</span>${badge(s)}</div>`;
    if (s.readonly) return top + `<h2>Visible, en lecture seule.</h2><p>${s.name} a été lancé sans le lanceur Ledge.</p><div class="readonly-note">Son état reste visible. Pour répondre à cette session, retrouvez son terminal d’origine.<br><br>Pour une prochaine session interactive :<br><code>ledge ${s.tool === 'claude' ? 'claude' : s.tool}</code></div>`;
    if (s.pending === 'permission') return top + `<h2>${s.name} souhaite lancer une commande.</h2><p>Les tests vérifieront les composants et les transitions de l’interface.</p><section class="request-card"><h3>Exécution dans ${escape(s.project)}</h3><div class="code-well">${escape(s.command)}</div><label class="checkbox-line"><input type="checkbox" id="grant-session" ${grants.has(s.id)?'checked':''} ${disabled?'disabled':''}> Toujours pour cette session simulée</label>${actionButtons('permission',disabled)}</section><p class="scope-note">La décision concerne cette commande uniquement, sauf si vous cochez l’option.</p>`;
    if (s.pending === 'question') return top + `<h2>Quel thème utiliser par défaut ?</h2><p>${s.name} prépare les composants. Choisissez l’expérience de départ ; les deux thèmes resteront disponibles.</p><div class="options">${[['dark','Sombre · Signal','Contours précis, reflets discrets.'],['light','Clair · Galet','Coque ivoire et lumière douce.'],['system','Suivre le système','S’adapter au thème de votre ordinateur.']].map(([value,title,description],i)=>`<label class="option"><input type="radio" name="answer" value="${value}" ${(answers.get(s.id)||'dark')===value?'checked':''} ${disabled?'disabled':''}><span><strong>${title}${i===0?'<span class="recommended">Recommandé</span>':''}</strong><small>${description}</small></span></label>`).join('')}</div><input id="custom-answer" class="custom-answer" aria-label="Autre réponse" placeholder="Ou proposez autre chose…" value="${escape(customAnswers.get(s.id)||'')}" ${disabled?'disabled':''}><div class="request-actions"><button class="primary" data-action="answer" ${disabled?'disabled':''}>Envoyer la réponse →</button></div>`;
    if (s.pending === 'diff') return top + `<h2>Un regard sur les changements ?</h2><p>${s.name} propose les matières Signal et Galet et ajuste les mouvements des compagnons.</p><details class="diff-file" open><summary>src/bots/Bot.tsx <span class="diff-count">+3 −1</span></summary><div class="diff-lines"><div class="removed">− material="default"</div><div class="added">+ material={dark ? 'signal' : 'pebble'}</div><div class="added">+ motion="subtle"</div><div class="added">+ blinkSeed={session.id}</div></div></details><details class="diff-file"><summary>src/styles/motion.css <span class="diff-count">+2 −1</span></summary><div class="diff-lines"><div class="removed">− animation: bounce 1s infinite;</div><div class="added">+ animation: breathe 5.4s ease-in-out;</div><div class="added">+ transition: transform 300ms var(--grow);</div></div></details><label class="checkbox-line"><input type="checkbox" id="grant-files" ${disabled?'disabled':''}> Toujours pour ces deux fichiers simulés</label>${actionButtons('diff',disabled)}<p class="scope-note">Extrait fictif destiné à tester la revue de fichiers.</p>`;
    if (s.pending === 'plan') return top + `<h2>Une présence plus naturelle.</h2><p>${s.name} vous propose trois étapes pour intégrer les compagnons dans les vues de Ledge.</p><ol class="plan-list"><li><strong>Accorder les matières au thème</strong><small>Signal en sombre, Galet en clair · Bot.tsx</small></li><li><strong>Décomposer les gestes</strong><small>Regard, inclinaison, main, puis retour au calme.</small></li><li><strong>Vérifier les petites tailles</strong><small>Poignée, liste, bulle et mouvements réduits.</small></li></ol><div class="code-well">Hors périmètre : daemon, hooks et transport.</div>${actionButtons('plan',disabled)}<p class="scope-note">L’approbation ici teste le parcours. Elle ne valide pas les documents du projet.</p>`;
    if (s.state === 'error') return top + `<h2>La commande s’est arrêtée.</h2><p>${s.name} a rencontré un problème. Rien n’est relancé automatiquement.</p><div class="error-block">Le processus de test ne répond plus.<br>Code de sortie : 1 · erreur simulée</div>${terminalMarkup(s)}<div class="request-actions"><button data-action="terminal">Voir le terminal</button><button class="primary" data-action="retry" ${disabled?'disabled':''}>Réessayer</button></div>`;
    if (s.state === 'exited') return top + `<h2>À bientôt, ${s.name}.</h2><p>Cette session est terminée. Son dernier résultat reste consultable.</p><div class="report-summary"><div><strong>18 min</strong><span>Durée</span></div><div><strong>3</strong><span>Fichiers</span></div><div><strong>12</strong><span>Tests simulés</span></div></div><div class="code-well">Bot.tsx<br>motion.css<br>Bot.spec.tsx</div>${terminalMarkup(s)}<div class="request-actions"><button data-action="terminal">Terminal simulé</button><button class="primary" data-action="continue" ${disabled?'disabled':''}>Continuer avec ${s.name}</button></div><p class="scope-note">Dans cette maquette, « Continuer » crée une nouvelle session. La retraite automatique après 10 minutes n’est pas simulée.</p>`;
    if (s.helpers) return top + `<h2>Une petite équipe, au travail.</h2><p>${s.name} coordonne deux sous-agents. Chacun garde son état et ses demandes.</p><div class="helper-tree">${s.helpers.map(h=>`<div class="helper-row">${avatar(h.id,20)}<span class="helper-label"><strong>${h.name}</strong><small>${h.task}</small></span>${badge(h)}</div>${h.pending?`<div class="helper-request"><p>${h.name} souhaite vérifier les contrastes.</p><code>pnpm test:contrast</code><div class="request-actions"><button data-action="helper-deny" data-helper="${h.id}" ${disabled||busy.has(h.id)?'disabled':''}>Refuser</button><button class="primary" data-action="helper-approve" data-helper="${h.id}" ${disabled||busy.has(h.id)?'disabled':''}>Autoriser</button></div></div>`:''}`).join('')}</div>${terminalMarkup(s)}`;
    if (s.state === 'working' || s.state === 'starting') return top + `<h2>${s.state === 'starting' ? 'La session se prépare.' : 'Concentré sur sa tâche.'}</h2><p>${s.name} ${s.state==='starting'?'initialise son environnement.':'travaille. Vous pouvez consulter sa sortie sans interrompre son activité.'}</p><div class="code-well">${escape(s.command || 'Préparation de la session…')}</div><div class="working-bar" aria-label="Travail en cours, progression indéterminée"><span></span></div><div class="row" style="justify-content:space-between"><span class="working-time" id="elapsed">${String(Math.floor(longTicks / 60)).padStart(2,'0')}:${String(longTicks%60).padStart(2,'0')}</span><label class="checkbox-line" style="margin:0"><input id="follow-output" type="checkbox" checked> Suivre la sortie</label></div>${terminalMarkup(s,true)}<div class="request-actions"><button data-action="interrupt" ${disabled?'disabled':''}>Interrompre</button></div>`;
    if (['denied','interrupted','change'].includes(s.outcome)) return top + `<h2>${s.outcome==='denied'?'Décision reçue.':s.outcome==='interrupted'?'La commande est interrompue.':'Le plan attend vos ajustements.'}</h2><p>${s.outcome==='denied'?'L’action a été refusée. Aucune commande ni modification n’a été exécutée.':s.outcome==='interrupted'?'Le travail simulé s’est arrêté à votre demande. La session reste disponible.':'Indiquez ce que vous souhaitez changer dans le champ ci-dessous.'}</p><div class="code-well">${s.outcome==='change'?'En attente de vos instructions.':'Prêt pour votre prochaine instruction.'}</div>${terminalMarkup(s)}`;
    return top + `<h2>Les compagnons ont trouvé leur place.</h2><p>${s.name} a terminé son tour. Voici le résultat simulé pour tester la lecture d’un rapport.</p><ul class="report-list"><li>Les matières suivent le thème : <strong>Signal</strong> en sombre, <strong>Galet</strong> en clair.</li><li>Les expressions restent lisibles de <code>12 px</code> à <code>48 px</code>.</li><li>Les gestes sont décalés entre les sessions et respectent les mouvements réduits.</li></ul><div class="report-summary"><div><strong>3</strong><span>Fichiers</span></div><div><strong>12</strong><span>Tests simulés</span></div><div><strong>0</strong><span>Erreur simulée</span></div></div>${s.lastReply?`<div class="inline-confirmation">Votre instruction : ${escape(s.lastReply)}</div>`:''}${terminalMarkup(s)}<div class="quick-replies"><button data-action="quick-reply" data-text="Vérifie les petites tailles">Vérifier les petites tailles</button><button data-action="quick-reply" data-text="Affiner les transitions">Affiner les transitions</button></div>`;
  }
  function renderSession() {
    const s = active();if (!s) return;
    $('#session-title').textContent = `${s.name} · ${s.project}`;
    $('#session-subtitle').textContent = `${toolNames[s.tool]} · ${s.age}${offline?' · hors connexion':''}`;
    $('#session-content').innerHTML = sessionBody(s);
    $('#view-session').classList.toggle('is-readonly',Boolean(s.readonly));
    $('#reply').value = drafts.get(s.id) || '';
    $('#reply').disabled = !interactive(s) || s.state === 'exited';
    $('#send-reply').disabled = !interactive(s) || s.state === 'exited';
    $('[data-action="terminal"]',$('.session-header')).disabled = Boolean(s.readonly);
    $('#auto-next-line').hidden = !pendingEntries().length || Boolean(s.readonly);
    $('#reading-toggle').setAttribute('aria-pressed',String(reading));
    $('#reading-toggle').setAttribute('aria-label',reading?'Quitter le mode lecture':'Activer le mode lecture');
    renderQueue();refreshAvatars($('#view-session'));
  }
  function renderQueue() {
    const queue = pendingEntries(), index = queue.findIndex(e=>e.sessionId===activeId);
    $('#queue-bar').hidden = queue.length < 2;
    $('#queue-position').textContent = `${index < 0 ? '—' : index+1} / ${queue.length} pour vous`;
    $('#queue-avatars').innerHTML = queue.map(e=>`<button class="queue-avatar" data-session="${e.sessionId}" aria-label="Ouvrir ${escape(sessionById(e.sessionId).name)}" aria-current="${e.sessionId===activeId}">${avatar(e.helperId||e.sessionId,20)}</button>`).join('');
  }
  function renderBubble() {
    if (!bubble) return;
    const parent = sessionById(bubble.sessionId), s = bubble.helperId ? parent?.helpers?.find(h=>h.id===bubble.helperId) : parent;
    if (!s) return;
    $('#bubble-title').textContent = `${s.name} ${bubble.kind==='question'?'a une question':'attend votre accord'}`;
    $('#bubble-text').textContent = parent.project + ' · ' + (bubble.helperId?'sous-agent':toolNames[parent.tool]);
    $('#bubble-command').textContent = bubble.kind==='permission' ? s.command || 'pnpm test:contrast' : bubble.kind==='question' ? 'Quel thème utiliser par défaut ?' : bubble.kind==='diff' ? '2 fichiers modifiés · revue nécessaire' : '3 étapes proposées · à lire';
    $('#bubble-actions').innerHTML = bubble.kind==='permission' ? `<button data-action="bubble-deny" ${offline?'disabled':''}>Refuser</button><button class="primary" data-action="bubble-approve" ${offline?'disabled':''}>Autoriser</button>` : bubble.kind==='question' ? `<button data-action="close">Plus tard</button><button class="primary" data-action="bubble-answer" ${offline?'disabled':''}>Sombre · Signal</button>` : '<button class="primary" data-action="open-bubble">Examiner →</button>';
    const extra = pendingEntries().length-1;
    $('#bubble-more').textContent = extra>0?`+${extra} autre${extra>1?'s':''}`:'';
    $('#bubble-more').hidden = extra<=0;
    refreshAvatars($('#view-bubble'));
  }
  function refresh({content = true,rebuild = false} = {}) {
    renderRows(rebuild);
    if (content && mode==='session') renderSession();
    if (mode==='bubble') renderBubble();
    refreshAvatars();fitSurface();
  }
  function nextRequest() {
    const entries = pendingEntries();if (!entries.length) { setMode('list');announce('Tout est à jour. Aucune demande en attente.');return; }
    const at = entries.findIndex(e=>e.sessionId===activeId);
    const next = entries[(at+1)%entries.length];openSession(next.sessionId,{focus:true});record('file-attente');
  }
  function finishWork(id) {
    const s = sessionById(id);if (!s || s.state!=='working' || offline) return;
    s.state='idle';s.pending=null;s.kind='report';s.outcome='complete';
    s.terminal='✓ Bot.spec.tsx · 8 tests\n✓ Surface.spec.tsx · 4 tests\n12 tests passed · résultat simulé';
    refresh({content:activeId===id});
    announce(`${s.name} a terminé son tour simulé. Son rapport est disponible.`);
  }
  function decide(accepted, {helperId, text, planChange = false} = {}) {
    const parent = bubble && mode==='bubble' ? sessionById(bubble.sessionId) : active();
    const helper = helperId || (mode==='bubble' ? bubble?.helperId : null);
    const s = helper ? parent?.helpers?.find(h=>h.id===helper) : parent;
    if (!s || !parent || !interactive(parent) || busy.has(s.id) || !s.pending) return;
    const fromMode=mode, revision=navigationVersion, nextEnabled=$('#auto-next').checked;
    const pendingKind=s.pending;
    s.requestKind=pendingKind;
    if (pendingKind==='permission' && $('#grant-session')?.checked) grants.add(s.id);
    if (pendingKind==='diff' && $('#grant-files')?.checked) grants.add(s.id+':files');
    busy.add(s.id);bots.nod(s.id);bubbleRemaining=Infinity;
    $$('button,input',fromMode==='bubble'?$('#view-bubble'):$('#session-content')).forEach(b=>b.disabled=true);
    const request=$('.request-card');if(request)request.classList.add('resolving');
    announce(`${s.name} a reçu ${accepted?'votre accord':'votre décision'}. Un signe de tête, puis la suite.`);
    record(accepted?(pendingKind==='question'?'réponse':'accord'):'refus');
    delay(()=>{
      busy.delete(s.id);s.pending=null;s.state=accepted?'working':'idle';s.outcome=accepted?'':planChange?'change':'denied';
      if(text)s.lastReply=text;
      if(accepted)s.command=pendingKind==='question'?'Préparer le thème choisi…':s.command||'Appliquer les changements…';
      else s.terminal=planChange?'Plan non approuvé. En attente de modifications.':'Action refusée. Aucune commande exécutée.';
      const closingBubble=mode==='bubble'&&bubble?.id===s.id;
      if(closingBubble)bubble=null;
      refresh({content:activeId===parent.id});
      const stillHere=revision===navigationVersion;
      if(closingBubble)setMode('handle',{manual:false});
      else if(stillHere && fromMode==='session' && nextEnabled && !planChange){
        const next=pendingEntries()[0];
        if(next)openSession(next.sessionId,{manual:false,focus:true});
        else{setMode('list',{manual:false,focus:true});announce('Tout est à jour. Vos compagnons peuvent reprendre.');const rev=navigationVersion;delay(()=>{if(mode==='list'&&rev===navigationVersion&&!surface.matches(':hover')&&!surface.contains(document.activeElement))setMode('handle',{manual:false});},2000);}
      }
      if(planChange){announce('Indiquez les ajustements souhaités dans le champ de réponse.');$('#reply').focus();}
      if(accepted)delay(()=>{
        if(helper){if(!offline){s.state='idle';s.outcome='complete';refresh({content:activeId===parent.id});}}
        else finishWork(s.id);
      },3000);
    },bots.reduced()?0:900);
  }
  function sendReply(text) {
    const s=active();if(!interactive(s)||s.state==='exited'||!text.trim())return;
    s.lastReply=text.trim();s.pending=null;s.state='working';s.outcome='';s.command='Traiter votre instruction…';
    drafts.delete(s.id);$('#reply').value='';refresh();bots.nod(s.id);record('message');announce(`${s.name} a reçu : « ${text.trim()} »`);
    delay(()=>finishWork(s.id),3400);
  }
  function simulateArrival() {
    if(offline){announce('Rétablissez la connexion simulée avant de créer une demande.');return;}
    if(!sessions.length)loadScenario('permission');
    const preferred=active();
    const s=preferred&&!preferred.readonly&&preferred.state!=='exited'?preferred:sessions.find(s=>!s.readonly&&s.state!=='exited');if(!s)return;
    epoch++;cancelTimers();busy.clear();
    const kind=s.requestKind||s.pending||'permission';
    s.state='working';s.pending=null;s.kind='long';activeId=s.id;bubble=null;
    refresh();setMode('handle');const revision=navigationVersion;
    announce('La session travaille. Une nouvelle demande arrivera dans un instant…');
    delay(()=>{
      if((kind==='permission'&&grants.has(s.id))||(kind==='diff'&&grants.has(s.id+':files'))){
        announce('Votre autorisation mémorisée est réutilisée pour cette même action simulée.');
        delay(()=>finishWork(s.id),2300);return;
      }
      s.pending=kind;s.state=kind==='question'?'waiting_input':'waiting_permission';s.command='pnpm test --filter overlay';s.pendingAt=Date.now();
      refresh({content:mode==='session'&&activeId===s.id});
      const button=$(`.handle-bot[data-session="${s.id}"]`);button?.classList.add('alerting');
      announce(dnd?'Nouvelle demande. Ne pas déranger est actif : elle reste dans la poignée.':`${s.name} a besoin de votre accord.`);
      delay(()=>{
        button?.classList.remove('alerting');
        if(mode==='handle'&&!dnd&&!offline&&revision===navigationVersion){bubble=pendingEntries()[0];bubbleRemaining=4000;renderBubble();setMode('bubble',{manual:false});}
      },bots.reduced()?0:540);
    },1300);
  }
  function syncSettings() {
    $('#studio-dnd').checked=dnd;$('#settings-dnd').checked=dnd;
    $$('.dnd-button').forEach(b=>{b.setAttribute('aria-pressed',String(dnd));b.setAttribute('aria-label',dnd?'Désactiver Ne pas déranger':'Activer Ne pas déranger')});
    const reduced=document.documentElement.dataset.reduced==='true'||osMotion.matches;
    $('#reduce-motion').checked=reduced;$('#settings-motion').checked=reduced;
  }
  function setDnd(value) {dnd=value;syncSettings();announce(dnd?'Ne pas déranger : les nouvelles demandes restent dans la poignée.':'Les nouvelles demandes pourront ouvrir une bulle.');record('ne-pas-déranger');}
  function setMotion(value) {motionOverride=true;document.documentElement.dataset.reduced=String(value);syncSettings();announce(osMotion.matches&&!value?'Votre système demande des mouvements réduits ; cette préférence reste respectée.':value?'Mouvements réduits. Les états restent indiqués par les expressions et les libellés.':'Les mouvements discrets sont réactivés.');record('mouvement');}
  function setTheme() {
    const light=document.documentElement.dataset.theme!=='light';document.documentElement.dataset.theme=light?'light':'dark';
    $('#theme-toggle span').textContent=light?'Mode sombre':'Mode clair';$('#theme-toggle').setAttribute('aria-label',light?'Passer au mode sombre, mascottes Signal':'Passer au mode clair, mascottes Galet');
    $('#material-name').textContent=light?'Galet':'Signal';$('#material-description').textContent=light?'Coque ivoire · mode clair':'Contours précis · mode sombre';
    $('#settings-theme-label').textContent=light?'Thème clair · Galet':'Thème sombre · Signal';
    record('thème');announce(light?'Mode clair : Galet. Les sessions conservent leur état.':'Mode sombre : Signal. Les sessions conservent leur état.');
  }
  function setOffline(value) {
    offline=value;document.documentElement.classList.toggle('offline',value);
    $('#connection-banner').hidden=!value;$('#connection-dot').classList.toggle('offline',value);
    $('#preview-label').textContent=value?'Connexion simulée interrompue':'Bureau de démonstration';
    $('#toggle-connection').textContent=value?'Rétablir la connexion':'Couper la connexion';
    if(value){cancelTimers();busy.clear();bubble=null;if(mode==='bubble')setMode('handle');}
    refresh();announce(value?'Connexion perdue : les derniers états sont figés, les réponses sont désactivées.':'Connexion rétablie. Vous pouvez reprendre vos interactions.');record('connexion');
  }
  function loadScenario(key) {
    saveDraft();epoch++;cancelTimers();busy.clear();bubble=null;reading=false;longTicks=0;drafts.clear();answers.clear();customAnswers.clear();grants.clear();
    scenario=key;sessions=baseSessions();activeId='otto';selectedRow=0;navigationVersion++;
    offline=false;document.documentElement.classList.remove('offline');$('#connection-banner').hidden=true;$('#connection-dot').classList.remove('offline');$('#preview-label').textContent='Bureau de démonstration';$('#toggle-connection').textContent='Couper la connexion';
    if(key!=='overview'){sessions.forEach(s=>{s.pending=null;if(s.state.startsWith('waiting'))s.state='working';});}
    const s=sessions[0];
    if(['permission','diff','plan'].includes(key)){s.state='waiting_permission';s.pending=key;s.pendingAt=1;}
    if(key==='question'){activeId='nova';sessions[1].state='waiting_input';sessions[1].pending='question';sessions[1].pendingAt=1;}
    if(key==='helpers'){s.state='working';s.helpers=[{id:'lu',name:'Lu',tool:'codex',state:'waiting_permission',pending:'permission',pendingAt:1,task:'Contrastes et accessibilité',command:'pnpm test:contrast'},{id:'pip',name:'Pip',tool:'cursor',state:'working',task:'Transitions de la surface'}];}
    if(key==='long'){activeId='pim';sessions[2].kind='long';}
    if(key==='report'){activeId='bix';}
    if(key==='error'){s.state='error';s.outcome='error';}
    if(key==='exited'){s.state='exited';s.outcome='complete';}
    if(key==='readonly'){s.readonly=true;s.state='working';}
    if(key==='team')makeTeam(12,false);
    $$('[data-scenario]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.scenario===key));
    $('#team-controls').hidden=key!=='team';$('#finish-simulation').hidden=key!=='long';
    renderRows(true);refreshAvatars();setMode(key==='overview'||key==='team'?'list':'session');
    announce(scenarios.find(s=>s[0]===key)[2]);
    $('#auto-next').checked=true;
  }
  function makeTeam(count,refreshView=true) {
    epoch++;cancelTimers();busy.clear();bubble=null;
    const names=['Otto','Nova','Pim','Bix','Lu','Milo','Ada','Nox','Pip','Sol','Mina','Tao'];
    sessions=Array.from({length:count},(_,i)=>({id:'team-'+i,name:names[i],tool:['claude','codex','cursor'][i%3],project:['harness-assistant','design-system','landing-page'][i%3],age:(i+1)+' min',state:i===1||i===7||i===10?'waiting_permission':i%3===0?'idle':'working',pending:i===1||i===7||i===10?'permission':null,pendingAt:i,command:'pnpm test'}));
    activeId=sessions[0]?.id||'';selectedRow=0;
    if(refreshView){renderRows(true);setMode('list');announce(`${count} sessions. Les demandes restent visibles dans la poignée, même quand les sessions au repos sont regroupées.`);record('équipe');}
  }
  function showTerminal() {
    if(!active()||active().readonly)return;
    let details=$('.terminal-preview',$('#session-content'));
    if(!details){$('#session-content').insertAdjacentHTML('beforeend',terminalMarkup(active(),true));details=$('.terminal-preview',$('#session-content'));}
    details.open=true;fitSurface();details.scrollIntoView({block:'nearest',behavior:bots.reduced()?'instant':'smooth'});
    announce('Aperçu du terminal simulé. Aucune fenêtre ni commande réelle n’est ouverte.');record('terminal');
  }
  function handleAction(action,target) {
    if(action==='close'){saveDraft();bubble=null;setMode('handle',{focus:true});}
    if(action==='back'||action==='list'){saveDraft();bubble=null;setMode('list',{focus:true});}
    if(action==='settings')setMode('settings',{focus:true});
    if(action==='dnd')setDnd(!dnd);
    if(action==='theme')setTheme();
    if(action==='reading'){reading=!reading;setMode('session');record('lecture');}
    if(action==='next')nextRequest();
    if(action==='open-bubble'&&bubble)openSession(bubble.sessionId,{focus:true});
    if(action==='approve'||action==='bubble-approve')decide(true);
    if(action==='deny'||action==='bubble-deny')decide(false,{planChange:active()?.pending==='plan'});
    if(action==='answer'){const value=$('#custom-answer')?.value.trim()||({dark:'Sombre · Signal',light:'Clair · Galet',system:'Suivre le système'}[$('input[name="answer"]:checked')?.value]);decide(true,{text:value});}
    if(action==='bubble-answer')decide(true,{text:'Sombre · Signal'});
    if(action==='helper-approve'||action==='helper-deny')decide(action==='helper-approve',{helperId:target.dataset.helper});
    if(action==='send')sendReply($('#reply').value);
    if(action==='quick-reply')sendReply(target.dataset.text);
    if(action==='terminal')showTerminal();
    if(action==='retry'&&interactive(active())){const s=active();s.state='working';s.outcome='';s.command='pnpm test --filter overlay';refresh();announce('Nouvelle tentative simulée en cours.');delay(()=>finishWork(s.id),3200);record('réessayer');}
    if(action==='interrupt'&&interactive(active())){const s=active();s.state='idle';s.pending=null;s.outcome='interrupted';s.terminal='Process interrupted by user.\nAucun résultat de réussite.';refresh();record('interruption');announce(`${s.name} a interrompu son travail. La session reste disponible.`);}
    if(action==='continue'&&interactive(active())){
      const old=active(),fresh={...old,id:old.id+'-next-'+(++newSessionIndex),state:'starting',outcome:'',age:'0 min',pending:null};delete fresh.terminal;
      sessions.push(fresh);activeId=fresh.id;renderRows(true);setMode('session');record('continuer');announce('Une nouvelle session démarre ; la précédente reste terminée.');
      delay(()=>{fresh.state='working';fresh.command='Reprendre le travail…';refresh();delay(()=>finishWork(fresh.id),2800);},700);
    }
  }
  $('#scenarios').innerHTML=scenarios.map(([id,name],i)=>`<button class="scenario-button" data-scenario="${id}" aria-pressed="${i===0}"><span>${String(i+1).padStart(2,'0')}</span>${name}<span>↗</span></button>`).join('');
  $('.rail-settings').insertAdjacentHTML('beforeend','<button id="simulate-arrival" class="secondary full" style="margin-top:12px">Simuler une demande ↗</button><button id="finish-simulation" class="secondary full" style="margin-top:7px" hidden>Simuler la fin du travail</button><div id="team-controls" hidden><div class="row tight" style="margin-top:12px"><button data-count="0">0</button><button data-count="5">5</button><button data-count="12">12 sessions</button></div><button id="toggle-connection" class="secondary full" style="margin-top:7px">Couper la connexion</button></div>');
  document.addEventListener('click',event=>{
    const target=event.target.closest('button');if(!target||target.disabled)return;
    if(target.dataset.scenario)loadScenario(target.dataset.scenario);
    if(target.dataset.session)openSession(target.dataset.session,{focus:true});
    if(target.dataset.view){saveDraft();bubble=null;setMode(target.dataset.view,{focus:true});}
    if(target.dataset.action)handleAction(target.dataset.action,target);
    if(target.dataset.count!==undefined)makeTeam(Number(target.dataset.count));
  });
  $('#theme-toggle').addEventListener('click',setTheme);
  $('#reset').addEventListener('click',()=>{tests.clear();$('#tested-count').textContent='0 action testée';loadScenario('overview');});
  $('#simulate-arrival').addEventListener('click',simulateArrival);
  $('#finish-simulation').addEventListener('click',()=>{finishWork(activeId);record('fin-travail');});
  $('#toggle-connection').addEventListener('click',()=>setOffline(!offline));
  $('#keyboard-help').addEventListener('click',()=>setMode('help',{focus:true}));
  ['#studio-dnd','#settings-dnd'].forEach(id=>$(id).addEventListener('change',e=>setDnd(e.target.checked)));
  ['#reduce-motion','#settings-motion'].forEach(id=>$(id).addEventListener('change',e=>setMotion(e.target.checked)));
  osMotion.addEventListener('change',()=>{if(!motionOverride)document.documentElement.dataset.reduced=String(osMotion.matches);syncSettings();});
  $('#reply').addEventListener('input',()=>{if(active())drafts.set(activeId,$('#reply').value);});
  $('#session-content').addEventListener('input',event=>{if(event.target.id==='custom-answer')customAnswers.set(activeId,event.target.value);if(event.target.name==='answer')answers.set(activeId,event.target.value);});
  $('#session-content').addEventListener('toggle',()=>requestAnimationFrame(fitSurface),true);
  $('#reply').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendReply(event.target.value);}});
  $('#edge-zone').addEventListener('pointerenter',()=>{clearTimeout(leaveTimer);if(mode==='handle')hoverTimer=setTimeout(()=>{if(mode==='handle'){setMode('list',{manual:false});surface.dataset.hoverOpened='true';}},180);});
  $('#edge-zone').addEventListener('pointerleave',()=>clearTimeout(hoverTimer));
  surface.addEventListener('pointerenter',()=>{clearTimeout(leaveTimer);bubbleHover=true;});
  surface.addEventListener('pointerleave',()=>{bubbleHover=false;if(mode==='list'&&surface.dataset.hoverOpened==='true')leaveTimer=setTimeout(()=>{if(mode==='list'&&!surface.contains(document.activeElement)){setMode('handle',{manual:false});delete surface.dataset.hoverOpened;}},500);});
  document.addEventListener('keydown',event=>{
    const editing=/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)||event.target.isContentEditable;
    if(event.ctrlKey&&event.altKey&&event.key.toLowerCase()==='l'){event.preventDefault();surface.classList.add('keyboard-nav');setMode('list',{focus:true});record('clavier');return;}
    if(editing)return;
    if(event.key==='Escape'&&surface.contains(event.target)){event.preventDefault();saveDraft();setMode(mode==='session'||mode==='settings'||mode==='help'?'list':'handle',{focus:true});return;}
    if(!surface.contains(event.target))return;
    const key=event.key.toLowerCase();
    if(key==='?' ){event.preventDefault();setMode('help',{focus:true});}
    if(key==='d'){event.preventDefault();setDnd(!dnd);}
    if(event.altKey&&event.key==='ArrowRight'){event.preventDefault();nextRequest();}
    if(mode==='list'&&['j','k','arrowdown','arrowup'].includes(key)&&sessions.length){event.preventDefault();selectedRow=(selectedRow+(['j','arrowdown'].includes(key)?1:-1)+sessions.length)%sessions.length;activeId=sessions[selectedRow].id;renderRows();surface.classList.add('keyboard-nav');$(`.session-row[data-session="${activeId}"]`).focus();}
    if(mode==='list'&&/^[1-9]$/.test(key)&&sessions[Number(key)-1]){event.preventDefault();openSession(sessions[Number(key)-1].id,{focus:true});}
    if(key==='r'&&mode==='session'&&!$('#reply').disabled){event.preventDefault();$('#reply').focus();}
    if(key==='o'&&mode==='session'){event.preventDefault();showTerminal();}
    if(['y','n'].includes(key)&&['session','bubble','list'].includes(mode)){
      const s=mode==='bubble'?sessionById(bubble?.sessionId):active();
      if(s?.pending&&s.pending!=='question'){event.preventDefault();decide(key==='y',{planChange:key==='n'&&s.pending==='plan'});}
    }
  });
  setInterval(()=>{
    const now=performance.now(),elapsed=now-lastTick;lastTick=now;
    if(mode!=='bubble'||document.hidden||bubbleHover||surface.contains(document.activeElement)||busy.size||!Number.isFinite(bubbleRemaining))return;
    bubbleRemaining-=elapsed;$('#bubble-timer-fill').style.setProperty('--remaining',String(Math.max(0,bubbleRemaining/4000)));
    if(bubbleRemaining<=0){bubble=null;setMode('handle',{manual:false});announce('La bulle s’est repliée. La demande reste disponible dans la poignée.');}
  },50);
  setInterval(()=>{
    if(document.hidden||offline||scenario!=='long')return;
    const s=sessionById('pim');if(!s||s.state!=='working')return;
    longTicks++;
    const lines=['› Résolution des dépendances…','› Compilation des composants…','› Vérification des types…','› Préparation des ressources…','› Assemblage du bundle…'];
    if(longTicks%3===0)s.terminal=`❯ pnpm build\n${lines.slice(0,Math.min(5,Math.floor(longTicks/3))).join('\n')}\n› Travail en cours · ${longTicks}s (simulé)`;
    if(activeId===s.id&&mode==='session'){
      if($('#elapsed'))$('#elapsed').textContent=String(Math.floor(longTicks/60)).padStart(2,'0')+':'+String(longTicks%60).padStart(2,'0');
      const output=$('#terminal-output');if(output&&s.terminal){output.textContent=s.terminal;if($('#follow-output')?.checked)output.scrollTop=output.scrollHeight;}
    }
  },1000);
  new ResizeObserver(()=>requestAnimationFrame(fitSurface)).observe(desktop);
  document.documentElement.dataset.reduced=String(osMotion.matches);syncSettings();loadScenario('overview');
})();
