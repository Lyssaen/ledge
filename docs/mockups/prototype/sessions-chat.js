/* Local design study: sessions, branches and answers are scripted from this repository's real state on 2026-10-11. Nothing is connected. */
(() => {
  const $ = s => document.querySelector(s);
  const root = document.documentElement;
  const RESIDENT = `<svg class="ledge-character" viewBox="0 0 96 96" aria-hidden="true"><g class="mascot-body"><g class="mascot-pose"><path class="mascot-antenna" d="M48 23v-9"/><circle class="mascot-light" cx="48" cy="12" r="3"/><path class="mascot-spark" d="M48 3V0M39 6l-3-3M57 6l3-3"/><rect class="mascot-foot" x="30" y="74" width="12" height="8" rx="4"/><rect class="mascot-foot" x="54" y="74" width="12" height="8" rx="4"/><path class="mascot-shell" d="M23 33Q25 21 40 21h16q15 0 17 12l5 23q4 22-17 22H35Q14 78 18 56Z"/><path class="mascot-base" opacity=".5" d="M19 63q5 11 29 11t29-11q0 15-16 15H35Q19 78 19 63"/><path class="mascot-shine" d="M28 34q3-7 14-7h12"/><rect class="mascot-visor" x="25" y="37" width="46" height="27" rx="12"/><g class="mascot-gaze"><g class="mascot-blink"><g class="mascot-eyes"><rect x="35" y="44" width="6" height="12" rx="3"/><rect x="55" y="44" width="6" height="12" rx="3"/></g><path class="mascot-lids mascot-smile" d="M34 51q4-8 8 0m12 0q4-8 8 0"/></g></g><ellipse class="mascot-hand" cx="78" cy="63" rx="5" ry="8"/></g></g></svg>`;
  const resident = (cls = '') => `<span class="resident ${cls}" aria-hidden="true">${RESIDENT}</span>`;
  const ICON = {
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>', dnd: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-4-3-7-6-8 1 4-1 8-6 8-2 0-3-.5-4-1 0 1 .5 2 1 3"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>', chevron: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>', x: '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    terminal: '<svg viewBox="0 0 24 24"><path d="m4 17 6-6-6-6M12 19h8"/></svg>', send: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>', branch: '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 7.5v9M18 10.5c0 4-12 2-12 6"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg>'
  };
  const TOOL = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' };
  const STATE = { starting: 'Démarrage', working: 'Au travail', waiting_permission: 'Votre accord', waiting_input: 'Une question', idle: 'Disponible', error: 'Erreur', exited: 'Terminée' };
  const S = [
    { id: 'otto', name: 'Otto', tool: 'claude', state: 'waiting_permission', project: 'harness-assistant', path: '~/Workspace/harness-assistant', branch: 'main', wt: false, topic: 'Mascotte permanente et tray', age: '18 min' },
    { id: 'nova', name: 'Nova', tool: 'codex', state: 'waiting_input', project: 'harness-assistant', path: '~/Workspace/harness-assistant/.claude/worktrees/codex', branch: 'worktree-codex', wt: true, topic: 'Hooks Codex et approbations', age: '12 min' },
    { id: 'pim', name: 'Pim', tool: 'cursor', state: 'working', project: 'harness-assistant', path: '~/Workspace/harness-assistant/.claude/worktrees/cursor', branch: 'worktree-cursor', wt: true, topic: 'Plans Cursor et sous-agents', age: '8 min' },
    { id: 'bix', name: 'Bix', tool: 'claude', state: 'idle', project: 'harness-assistant', path: '~/Workspace/harness-assistant/.claude/worktrees/folder-browser', branch: 'worktree-folder-browser', wt: true, topic: '', age: '2 min' },
    { id: 'lu', name: 'Lu', tool: 'claude', state: 'exited', project: 'design-system', path: '~/Workspace/design-system', branch: 'main', wt: false, topic: 'Tokens de mouvement v5', age: '25 min' }
  ];
  const by = id => S.find(s => s.id === id);
  const bot = (s, size, state = s.state) => `<span class="bot-wrap">${LedgeMascotSVG(s.tool, state, size, s.name)}</span>`;
  const branch = s => `<span class="branch${s.wt ? ' wt' : ''}" title="${s.wt ? 'worktree ' + s.branch : 'branche ' + s.branch} · ${s.path}">${ICON.branch}${s.wt ? s.branch.replace(/^worktree-/, '') : s.branch}</span>`;
  const who = s => `<a class="who" href="#chat" data-open="${s.id}">${s.name}</a>`;
  const sep = '<span class="sep">·</span>';
  const head = (sub, extra = '') => `<div class="panel-head"><div class="copy"><span class="panel-brand">Ledge<span class="accent">.</span></span><span class="panel-sub">${sub}</span></div>${extra}<button class="icon outline" aria-label="Nouvelle session">${ICON.plus}</button><button class="icon" aria-label="Ne pas déranger">${ICON.dnd}</button><button class="icon" aria-label="Réglages">${ICON.gear}</button><button class="icon" aria-label="Replier">${ICON.chevron}</button></div>`;
  const foot = `<div class="panel-foot">${ICON.dnd}<span>Ne pas déranger</span><span class="grow"></span><kbd>Ctrl Alt L</kbd><kbd>?</kbd></div>`;
  const badge = s => `<span class="badge" data-state="${s.state}">${STATE[s.state]}</span>`;
  const summary = `${S.length} sessions · ${S.filter(s => s.state.startsWith('waiting')).length} demandes pour vous`;

  // 01 — today: every row is the project, then the first name
  $('#list-today').innerHTML = head(summary) + `<div class="rows">${S.map((s, i) => `<button class="row${i === 0 ? ' hi' : ''}"><span class="bot-wrap">${LedgeMascotSVG(s.tool, s.state, 32, s.name)}</span><span class="copy"><span class="title">${s.project}</span><span class="meta">${s.name} ${sep} ${TOOL[s.tool]} ${sep} ${s.age}</span></span>${badge(s)}</button>`).join('')}</div>` + foot;

  // 01 — proposed: grouped by repository, the topic first, then branch, first name, tool, age
  function nextRows(hi = 'otto') {
    const groups = [...new Set(S.map(s => s.project))];
    return `<div class="rows">${groups.map(p => { const list = S.filter(s => s.project === p); return `<div class="group"><strong>${p}</strong><code>${list[0].path.replace(/\/\.claude.*$/, '')}</code><span class="count">${list.length} bot${list.length > 1 ? 's' : ''}</span></div>` + list.map(s => `<button class="row${s.id === hi ? ' hi' : ''}" data-open="${s.id}">${bot(s, 32)}<span class="copy"><span class="title${s.topic ? '' : ' untitled'}">${s.topic || 'Sans sujet encore'}</span><span class="meta">${s.name} ${sep} ${branch(s)} ${sep} <span class="rest">${s.age}</span>${badge(s)}</span></span><span class="path">${TOOL[s.tool]} · ${s.path}</span></button>`).join(''); }).join('')}</div>`;
  }
  $('#list-next').innerHTML = head(summary) + nextRows() + foot;

  // 02 — the handle, the terminal tabs, the session header
  $('#handle').innerHTML = resident() + '<span class="handle-sep" aria-hidden="true"></span>' + S.map(s => `<span class="slot${s.state === 'waiting_permission' ? ' asking' : s.state === 'waiting_input' ? ' asking question lifted' : ''}" data-tip="${s.id}">${bot(s, s.state.startsWith('waiting') ? 20 : 12)}</span>`).join('');
  $('#handle').querySelectorAll('.slot').forEach(slot => slot.addEventListener('mouseenter', () => { const s = by(slot.dataset.tip); $('#handle-tip').innerHTML = `<strong>${s.name}</strong><span>${s.topic || 'Sans sujet encore'}</span><small>${s.branch} · ${TOOL[s.tool]} · ${STATE[s.state].toLowerCase()}</small>`; }));
  $('#wt').innerHTML = `<div class="wt-tabs">${S.slice(0, 3).map((s, i) => `<span class="wt-tab${i === 1 ? ' active' : ''}">${s.name} · ${s.topic || s.branch}</span>`).join('')}<span class="wt-more">⌄</span></div><div class="wt-body">codex 0.162 · <b>~/…/worktrees/codex</b><br><br>› Les sous-agents attendent jusqu'à 60 s via hook.wait.<br>› Faut-il garder cette temporisation pour les sous-agents<br>&nbsp;&nbsp;seulement, ou l'étendre à l'agent principal ?<br><br>&nbsp;&nbsp;<b>1.</b> Sous-agents seulement (recommandé)<br>&nbsp;&nbsp;2. Tous les agents<br>&nbsp;&nbsp;3. Ne pas attendre<br><br>› <span class="cur"></span></div>`;
  const nova = by('nova');
  $('#session-head').innerHTML = `<div class="session-head"><button class="icon" aria-label="Retour">${ICON.back}</button>${bot(nova, 32)}<div class="copy"><span class="title" title="Renommer"><span>${nova.topic}</span>${ICON.edit.replace('<svg', '<svg class="edit"')}</span><span class="sub">${nova.name} ${sep} ${branch(nova)} ${sep} ${TOOL[nova.tool]} ${sep} ${nova.age}</span></div><button class="icon" aria-label="Aller au terminal">${ICON.terminal}</button><button class="icon" aria-label="Fermer">${ICON.x}</button></div><div class="session-body"><div class="rename"><span>Hooks Codex et approbations</span><kbd>↵</kbd><kbd>Échap</kbd></div><span>Pendant la saisie, le nouveau sujet part au daemon en <code>session.rename</code> ; l'onglet Windows Terminal suit.</span><div class="card"><h4>Nova vous pose une question</h4><code>Garder la temporisation de 60 s pour les sous-agents seulement ?</code><div class="actions"><button>Tous</button><button class="primary">Sous-agents seulement</button></div></div></div>`;


  // 04 — the entry point: the proposed list with the ask field in its foot
  $('#list-ask').innerHTML = head(summary) + nextRows('nova') + `<div class="ask">${resident()}<input id="ask-input" type="text" placeholder="Demander à Ledge… où en sont les autres ?" aria-label="Demander à Ledge"><kbd>/</kbd></div>` + foot;

  // 04 — the conversation
  const ANSWERS = {
    status: { q: 'Où en sont les autres ?', steps: ['Relis les 5 sessions', 'Lis les terminaux d\'Otto, Nova et Pim', 'git status dans 4 dossiers'], a: () => `<p>Quatre compagnons sur <strong>harness-assistant</strong>, un sur design-system. Deux attendent quelque chose de vous.</p><ul>${[['otto', 'attend votre accord depuis 4 min pour <code>git push origin main</code> : la mascotte permanente, trois commits locaux.'], ['nova', 'vous pose une question : garder la temporisation de 60 s pour les sous-agents seulement ? Un test rouge dans <code>hooks.test.ts</code>.'], ['pim', 'au travail depuis 8 min sur les plans Cursor. Six fichiers touchés, rien de commité.'], ['bix', 'disponible. Sa branche est verte depuis 36ae75b, prête à fusionner.'], ['lu', 'a terminé il y a 25 min : tokens de mouvement v5, poussés.']].map(([id, t]) => { const s = by(id); return `<li>${bot(s, 20)}<span class="t">${who(s)} <span class="branch${s.wt ? ' wt' : ''}">${ICON.branch}${s.branch}</span> <span>${t}</span></span></li>`; }).join('')}</ul><div class="acts"><button class="primary" data-open="nova">Répondre à Nova</button><button data-open="otto">Voir la demande d'Otto</button></div><div class="sources"><b>Sources</b><span>terminaux d'Otto, Nova, Pim</span><span>·</span><span>git dans 4 dossiers</span><span>·</span><span>il y a 10 s</span></div>` },
    pim: { q: 'Qu\'a changé Pim sur worktree-cursor ?', steps: ['git log main..worktree-cursor', 'git diff --stat dans le worktree', 'Lis le terminal de Pim'], a: () => { const s = by('pim'); return `<p>${who(s)} travaille dans <code>.claude/worktrees/cursor</code> depuis 8 min. Deux commits d'avance sur main, rien de poussé.</p><div><span class="commit"><b>0a12336</b> feat(adapters): Cursor Agent questions, plans, subagents</span><span class="commit"><b>b1bdc90</b> feat(adapters): Cursor Agent adapter on its hooks</span></div><p>Modifié, pas encore commité :</p><div class="diffstat"><span>packages/ledge/src/adapters/cursor.ts <b>+84</b> <s>−12</s></span><span>packages/ledge/src/adapters/cursor.test.ts <b>+61</b></span><span>docs/tour.md <b>+9</b> <s>−1</s></span></div><blockquote>« Les plans Cursor s'affichent maintenant comme ceux de Claude ; je passe aux sous-agents. » — Pim, il y a 2 min</blockquote><div class="acts"><button class="primary" data-open="pim">Ouvrir Pim</button><button>Voir le diff</button></div><div class="sources"><b>Sources</b><span>git dans le worktree</span><span>·</span><span>terminal de Pim</span><span>·</span><span>à l'instant</span></div>`; } },
    merge: { q: 'Quelles branches peuvent être fusionnées ?', steps: ['git log main..* pour 3 worktrees', 'Cherche les tests rouges dans les terminaux'], a: () => `<p>Une branche est prête, deux ne le sont pas encore.</p><ul>${[['bix', 'worktree-folder-browser', 'un commit, tests verts, personne n\'y travaille : fusionnable maintenant.'], ['pim', 'worktree-cursor', 'bâtie sur worktree-codex : attendre que Pim commite, et fusionner Codex d\'abord.'], ['nova', 'worktree-codex', 'un test rouge tant que la question de Nova reste sans réponse.']].map(([id, b, t]) => { const s = by(id); return `<li>${bot(s, 20)}<span class="t">${who(s)} <span class="branch wt">${ICON.branch}${b}</span> <span>${t}</span></span></li>`; }).join('')}</ul><p>Ordre conseillé : folder-browser, puis codex, puis cursor.</p><div class="acts"><button class="primary" data-open="bix">Ouvrir Bix</button><button data-open="nova">Répondre à Nova</button></div><div class="sources"><b>Sources</b><span>git dans 3 worktrees</span><span>·</span><span>terminaux de Nova et Pim</span><span>·</span><span>il y a 4 s</span></div>` },
    other: { q: '', steps: ['Relis les 5 sessions', 'Cherche dans les terminaux'], a: () => `<p>Dans cette maquette, je ne sais répondre qu'aux trois questions proposées. Le vrai Ledge lirait les sessions, les terminaux et git pour celle-ci.</p><div class="sources"><b>Sources</b><span>aucune, réponse scénarisée</span></div>` }
  };
  const chat = $('#chat');
  const history = [];
  let busy = false;
  function renderChat() {
    const thread = history.length ? `<div class="thread" id="thread">${history.map(m => m.role === 'user' ? `<div class="msg user"><span class="bubble">${m.text}</span></div>` : m.role === 'thinking' ? `<div class="thinking">${resident('thinking-pose')}<div class="steps">${m.steps.map((t, i) => `<span class="${i < m.at ? 'done' : i === m.at ? 'now' : ''}">${t}</span>`).join('')}</div></div>` : `<div class="msg ledge">${resident(m.fresh ? 'nod' : '')}<div class="answer">${m.html}</div></div>`).join('')}</div>` : `<div class="empty-chat">${resident('happy')}<strong>Demandez-moi des nouvelles.</strong>Je vois les ${S.length} sessions, leurs terminaux et leurs dépôts. Je lis, je ne touche à rien.</div>`;
    chat.innerHTML = `<div class="panel-head"><button class="icon" aria-label="Retour à la liste">${ICON.back}</button>${resident()}<div class="copy"><span class="panel-brand">Ledge<span class="accent">.</span></span><span class="panel-sub">Voit ${S.length} sessions · 2 dépôts · lecture seule</span></div><button class="icon" aria-label="Fermer">${ICON.x}</button></div>${thread}<div class="chips">${Object.entries(ANSWERS).filter(([k]) => k !== 'other').map(([k, v]) => `<button data-ask="${k}" ${busy ? 'disabled' : ''}>${v.q}</button>`).join('')}</div><div class="composer"><input id="chat-input" type="text" placeholder="Demander à Ledge…" aria-label="Votre question" ${busy ? 'disabled' : ''}><button id="chat-send" aria-label="Envoyer" ${busy ? 'disabled' : ''}>${ICON.send}</button></div>`;
    const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight;
  }
  const wait = ms => new Promise(r => setTimeout(r, root.dataset.reduced === 'true' ? 0 : ms));
  async function ask(key, text) {
    if (busy) return; busy = true;
    const item = ANSWERS[key] || ANSWERS.other;
    history.forEach(m => { m.fresh = false; });
    history.push({ role: 'user', text: text || item.q });
    const th = { role: 'thinking', steps: item.steps, at: 0 }; history.push(th); renderChat();
    $('#announcement').textContent = 'Ledge cherche.';
    for (let i = 0; i < item.steps.length; i++) { th.at = i; renderChat(); await wait(650 + i * 150); }
    history.pop(); history.push({ role: 'ledge', html: item.a(), fresh: true }); busy = false; renderChat();
    $('#announcement').textContent = 'Ledge a répondu.';
    document.querySelector('#chat-input')?.focus({ preventScroll: true });
  }
  chat.addEventListener('click', e => {
    const chip = e.target.closest('[data-ask]'); if (chip) return ask(chip.dataset.ask);
    const open = e.target.closest('[data-open]'); if (open) { e.preventDefault(); const s = by(open.dataset.open); $('#announcement').textContent = `Ouvrirait la session de ${s.name}.`; open.classList.add('nod'); setTimeout(() => open.classList.remove('nod'), 700); return; }
    if (e.target.closest('#chat-send')) submit();
  });
  chat.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'chat-input') submit(); });
  function submit() { const input = $('#chat-input'); const v = input?.value.trim(); if (!v) return; const key = Object.keys(ANSWERS).find(k => ANSWERS[k].q.toLowerCase() === v.toLowerCase()) || (/pim|cursor/i.test(v) ? 'pim' : /fusion|merge|branche/i.test(v) ? 'merge' : /autres|nouvelles|où en|ou en/i.test(v) ? 'status' : 'other'); ask(key, v); }
  $('#ask-input').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.value.trim()) { const v = e.target.value.trim(); e.target.value = ''; $('#chat').scrollIntoView({ block: 'center' }); const ci = $('#chat-input'); if (ci) { ci.value = v; submit(); } } });
  document.addEventListener('keydown', e => { if (e.key === '/' && !/input|textarea/i.test(e.target.tagName)) { e.preventDefault(); $('#ask-input').focus(); } });
  renderChat();
  // Rows and buttons outside the chat only announce what they would do.
  document.querySelectorAll('#list-next [data-open], #list-ask [data-open]').forEach(b => b.addEventListener('click', () => { $('#announcement').textContent = `Ouvrirait la session de ${by(b.dataset.open).name}.`; }));

  // Theme
  $('#theme').addEventListener('click', () => { const light = root.dataset.theme !== 'light'; root.dataset.theme = light ? 'light' : 'dark'; $('#theme').textContent = light ? 'Passer en sombre' : 'Passer en clair'; });
  if (location.hash === '#light') $('#theme').click();
  document.querySelectorAll('[data-resident]').forEach(el => { el.innerHTML = RESIDENT; });
})();
