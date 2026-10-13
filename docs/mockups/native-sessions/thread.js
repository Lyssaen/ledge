/* Local mockup only: native-event fixtures, no agent connection or shell execution. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const scenarios = window.LedgeNativeScenarios;
  const bot = (provider, state, size = 28, seed = provider) => window.LedgeMascotSVG(provider, state, size, seed);
  const query = new URLSearchParams(location.search);
  let current = Object.hasOwn(scenarios, query.get('session')) ? query.get('session') : 'claude';
  /** How the last reply of a turn is shown: 'inline' in the flow of the thread (A), or as a structured card (B). */
  let replyVariant = query.get('reply') === 'card' ? 'card' : 'inline';
  let selected = null;
  let inspectedHelper = null;
  let activeAgent = null;
  let parentScroll = 0;
  let selectionBeforeAgent = null;
  let decision = null;
  let completed = false;
  let replaying = false;
  let replayStep = 0;
  let timer = null;
  let exchanges = [];
  let answered = false;
  const session = () => scenarios[current];
  const helperState = h => h.state || 'idle';
  const allTools = () => [...visibleTools(), ...session().helpers.flatMap(h => h.tools || [])];
  const announce = text => { $('announcement').textContent = text; };

  function visibleTools() {
    const tools = session().tools.map(t => ({ ...t }));
    if (current === 'codex' && completed) {
      const last = tools.at(-1);
      Object.assign(last, { status: 'success', duration: '1,21 s', exit: '0', result: last.completedResult, source: 'item_completed → CommandExecution' });
    }
    if (replaying) return tools.slice(0, replayStep).map((t, i) => i === replayStep - 1 && t.status !== 'unknown' ? { ...t, status: 'running', result: 'Exécution en cours. Aucun résultat final reçu.', duration: null, exit: null } : t);
    return tools;
  }
  function state() {
    if (replaying) return ['working', 'En cours'];
    if (current === 'codex' && completed) return ['idle', 'Tour terminé'];
    if (current === 'claude' && decision) return [decision === 'accept' ? 'working' : 'idle', decision === 'accept' ? 'Accord transmis' : 'Refus transmis'];
    return [session().state, session().stateLabel];
  }
  function renderHeader() {
    const s = session(); const [st, label] = state();
    $('brand-bot').innerHTML = bot('claude', 'idle', 31, 'ledge');
    $('scenarios').innerHTML = Object.entries(scenarios).map(([id, x]) => `<button class="scenario" data-scenario="${id}" data-id="${id}" aria-pressed="${current === id}"><span class="scenario-top">${bot(id, current === id ? st : x.state, 30)}<strong>${x.name}</strong><span class="provider">${x.provider}</span></span><span class="scenario-title">${x.label}</span><span class="scenario-state"><span class="tiny-dot"></span>${current === id ? label : x.stateLabel}</span></button>`).join('');
    $('handle-bots').innerHTML = Object.keys(scenarios).map(id => `<button class="handle-select" data-scenario="${id}" aria-label="Ouvrir ${scenarios[id].name}">${bot(id, id === current ? st : scenarios[id].state, 18)}</button>`).join('');
    $('session-head').innerHTML = `<header class="session-head"><div class="identity-row">${bot(current, st, 34)}<div class="identity-copy"><strong>${s.name}</strong><span class="provider-name">${s.provider}</span><p>ledge · session de démonstration</p></div><span class="status-chip ${st === 'waiting_permission' ? 'wait' : st === 'idle' ? 'done' : ''}"><span class="tiny-dot"></span>${label}</span></div><h2 class="session-topic">${s.topic}</h2>${helpersTreeHTML()}<div class="branch-row"><span>⌘ ledge</span><span class="branch">⑂ ${s.branch}</span></div></header>`;
    if (activeAgent) renderAgentHeader();
  }
  /** Like the overlay's HelpersTree: the helpers under the title, one line each, ├ then └; a click opens the agent's view. */
  function helpersTreeHTML() {
    const helpers = session().helpers; if (!helpers.length) return '';
    return `<ul class="helpers-tree" aria-label="Sous-agents">${helpers.map((h, i) => {
      const working = helperState(h) === 'working';
      return `<li><button class="helper-row" data-agent="${h.id}" aria-label="Ouvrir la discussion de ${h.name}"><span class="tree-mark" aria-hidden="true">${i === helpers.length - 1 ? '└' : '├'}</span>${bot(current, helperState(h), 20, h.name)}<span class="helper-task">${esc(h.task)}</span><span class="helper-meta">${esc(h.kind || h.name)} · ${working ? 'Au travail' : 'Terminé'}</span><span class="helper-open" aria-hidden="true">›</span></button></li>`;
    }).join('')}</ul>`;
  }
  const streamHTML = tools => tools.map(toolHTML).join('');

  function filesFor(t) {
    const s = session();
    if (t.id === 'patch') return s.files;
    if (t.id === 'repair') return [{ ...s.files[0], label: 'Modification confirmée', description: 'Reprise de la dernière ligne.', diff: '+ if (!line.endsWith("\\n")) {\n+   pending = line;\n+   return;\n+ }', added: 4, removed: 0 }];
    if (t.id === 'migration') return s.files;
    if (t.id === 'cursor-write') return [s.files[1]];
    return [];
  }
  function fileHTML(f, tool) {
    const confirmed = tool.status === 'success';
    const label = confirmed ? f.label : tool.status === 'running' ? 'Écriture en cours' : 'Écriture non confirmée';
    const diff = confirmed ? f.diff : null;
    return `<details class="inline-file ${confirmed ? '' : 'unconfirmed'}" data-file="${esc(f.path)}" data-owner="${tool.id}"><summary><span class="file-symbol" aria-hidden="true">▤</span><span class="file-identity"><strong>${esc(f.path)}</strong><small>${label}</small></span><span class="file-chevron" aria-hidden="true">⌄</span></summary><div class="inline-diff"><p>${esc(confirmed ? f.description : tool.status === 'running' ? 'Le résultat de cette écriture est attendu.' : 'Cet appel ne confirme pas que le fichier a été créé ou modifié.')}</p>${diff ? `<pre>${diff.split('\n').map(line => `<span class="${line.startsWith('+') ? 'diff-added' : line.startsWith('-') ? 'diff-removed' : ''}">${esc(line)}</span>`).join('\n')}</pre><span class="diff-caption">Extrait du changement · données de démonstration</span>` : '<span class="diff-caption">Aucun changement confirmé à afficher.</span>'}</div></details>`;
  }
  function toolHTML(t) {
    const icon = { success: '✓', failed: '!', running: '◌', unknown: '·' }[t.status];
    return `<article class="thread-action" data-action="${t.id}"><details class="native-tool" data-tool="${t.id}"><summary><span class="tool-state ${t.status}">${icon}</span><span class="tool-label"><strong>${esc(t.label)}</strong><small>${esc(t.detail)}</small></span><span class="tool-row-status">${t.status === 'running' ? 'En cours' : t.status === 'failed' ? 'Échec' : ''}</span><span class="chevron" aria-hidden="true">›</span></summary><div class="tool-detail"><p class="detail-label">${['CommandExecution', 'Bash'].includes(t.name) ? 'Commande' : 'Paramètres / fichiers'}</p><pre>${esc(t.command)}</pre><p class="detail-label">${t.status === 'running' ? 'État' : 'Résultat'}</p>${t.result ? `<pre class="${t.status === 'failed' ? 'error-output' : ''}">${esc(t.result)}</pre>` : '<p class="unknown-note">Aucun résultat dans cette source. La réussite de cet appel est inconnue.</p>'}<div class="detail-bottom"><span>${t.exit !== null ? 'Code de sortie ' + esc(t.exit) : t.status === 'unknown' ? 'État inconnu' : t.status === 'running' ? 'En attente du résultat' : 'Résultat reçu'}</span><span>${t.duration || 'Durée indisponible'}</span></div></div></details>${filesFor(t).map(f => fileHTML(f, t)).join('')}</article>`;
  }
  const fileChip = (file, unconfirmed) => `<code class="reply-file ${unconfirmed ? 'unconfirmed' : ''}">${esc(file)}</code>`;
  function finalHTML(s) {
    if (!s.final || !(completed || current === 'cursor') || replaying) return '';
    if (replyVariant === 'inline' || !s.finalCard) return `<div class="final-message"><div class="final-label">RÉPONSE DE ${s.name.toUpperCase()}</div>${s.final}</div>`;
    const c = s.finalCard;
    return `<article class="reply-card"><div class="reply-top"><span class="reply-eyebrow">${c.ask ? 'À VOUS DE JOUER' : 'RÉPONSE'}</span><span class="reply-badge">${c.ask ? 'Une question' : 'Tour terminé'}</span></div><h3>${esc(c.title)}</h3><p class="reply-meta">${esc(s.name)} a terminé${s.time ? ' · ' + esc(s.time) : ''}</p><p class="reply-lead">${esc(c.lead)}</p>${c.did ? `<p class="reply-section">CE QUE J’AI FAIT</p>${c.did.map(d => `<div class="reply-item"><span class="reply-check ${d.unconfirmed ? 'unconfirmed' : ''}" aria-hidden="true">${d.unconfirmed ? '·' : '✓'}</span><span>${esc(d.text)}${d.file ? ' ' + fileChip(d.file, d.unconfirmed) : ''}${d.unconfirmed ? '<small>Écriture non confirmée par la source</small>' : ''}</span></div>`).join('')}` : ''}${c.verified ? `<p class="reply-section">VÉRIFIÉ</p>${c.verified.map(v => `<div class="reply-item"><span class="reply-check" aria-hidden="true">✓</span><span><code class="reply-file">${esc(v.text)}</code> ${esc(v.note)}</span></div>`).join('')}` : ''}${c.ask ? `<p class="reply-section">À DÉCIDER</p><div class="reply-item ask"><span class="reply-check ask" aria-hidden="true">?</span><span>${esc(c.ask)}</span></div>${answerHTML(c)}` : ''}</article>`;
  }
  // The answer block of the real card: one option per line, a free field, one button. Picking an option fills the field.
  function answerHTML(c) {
    if (answered) return `<p class="reply-answered">✓ Réponse transmise · simulation</p>`;
    const options = (c.options || []).map((o, i) => `<label class="reply-opt"><input type="radio" name="reply-opt" value="${esc(o)}" ${i === 0 ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('');
    return `<form class="reply-answer" id="reply-answer" aria-label="Répondre à la question"><fieldset><legend class="sr-only">Options</legend>${options}</fieldset><input class="reply-free" id="reply-free" maxlength="300" autocomplete="off" placeholder="Ou proposez autre chose…" aria-label="Autre réponse"><div class="reply-actions"><small>Une puce remplit le champ, Entrée envoie</small><button type="submit" class="panel-button primary">Envoyer la réponse →</button></div></form>`;
  }
  function reportHTML(h, text) {
    const time = h.time ? ' · ' + esc(h.time) : '';
    if (replyVariant === 'inline' || !h.reportCard) return `<div class="final-report"><span class="report-label">Rapport final${time}</span><p>${esc(text)}</p></div>`;
    const c = h.reportCard;
    return `<article class="reply-card compact"><div class="reply-top"><span class="reply-eyebrow">RAPPORT FINAL</span><span class="reply-badge">${esc(h.name)}${time}</span></div><h3>${esc(c.title)}</h3>${c.points.map(pt => `<div class="reply-item"><span class="reply-check" aria-hidden="true">✓</span><span>${esc(pt)}</span></div>`).join('')}${c.note ? `<p class="reply-note">${esc(c.note)}</p>` : ''}</article>`;
  }
  function permissionHTML() {
    if (decision) return `<div class="decision-result ${decision === 'deny' ? 'denied' : ''}">${decision === 'accept' ? '✓ Accord transmis — simulation' : '× Refus transmis — simulation'}<p>${decision === 'accept' ? 'En attente d’un événement d’exécution. La migration n’est pas marquée comme réussie.' : 'La commande n’a pas été exécutée dans ce scénario.'}</p></div>`;
    return `<div class="permission"><div class="permission-title"><span aria-hidden="true">◇</span>Otto demande votre accord</div><p>${session().permission.reason}</p><pre>${esc(session().permission.command)}</pre><div class="permission-actions"><button class="panel-button" data-permission="deny">Refuser</button><button class="panel-button primary" data-permission="accept">Autoriser une fois</button></div><p class="permission-note">Action simulée · réponse native à raccorder</p></div>`;
  }
  function renderFeed() {
    const s = session(); const tools = visibleTools();
    // Preserve open cards and the exact reading position when the demo receives a new event.
    const open = [...$('panel-feed').querySelectorAll('details[open]')].map(el => el.dataset.tool ? ['tool', el.dataset.tool] : el.dataset.file ? ['file', el.dataset.owner, el.dataset.file] : ['history']);
    const scroll = $('viewport').scrollTop;
    $('panel-feed').innerHTML = `${s.previous ? `<details class="previous-turn"><summary>Tour précédent <span>Réponse conservée</span></summary><p>${s.previous}</p></details>` : ''}<div class="turn-marker"><span>DISCUSSION</span><span>${s.time || 'Horodatage indisponible'}</span></div><div class="user-message">${s.question}</div><div class="message-meta">Vous${s.time ? ' · ' + s.time : ''}</div><div class="agent-message">${bot(current, state()[0], 25)}<div class="agent-text"><strong>${s.name}</strong>${s.message}</div></div><div class="activity-stream">${streamHTML(tools)}</div>${current === 'claude' && !replaying ? `<div id="decision-area">${permissionHTML()}</div>` : ''}${current === 'cursor' ? '<div class="unknown-note">Les appels sont enregistrés. Cette source ne fournit ni leurs résultats ni leurs durées.</div>' : ''}${finalHTML(s)}${current === 'codex' && !completed ? '<div class="live-line"><span class="live-dot"></span>Nova attend le résultat de la vérification…</div>' : ''}${exchanges.map(x => `<div class="user-message exchange">${esc(x)}</div><div class="message-meta">Vous · simulation</div><p class="simulated-answer">Votre message apparaîtrait dans un nouveau tour. Aucun envoi réel dans cette maquette.</p>`).join('')}`;
    for (const el of $('panel-feed').querySelectorAll('details')) {
      if (open.some(([kind, key, path]) => kind === 'tool' ? el.dataset.tool === key : kind === 'file' ? el.dataset.owner === key && el.dataset.file === path : el.classList.contains('previous-turn'))) el.open = true;
    }
    $('viewport').scrollTop = scroll;
  }
  function renderFooter() {
    const blocked = current === 'claude' && !decision;
    const readOnly = current === 'cursor' && replyVariant === 'inline';
    const note = current === 'cursor' ? '<span>Canal de réponse à raccorder pour Cursor · simulation</span><span>Historique conservé</span>' : '<span>Simulation locale · aucun envoi réel</span><span>Historique conservé</span>';
    $('session-footer').innerHTML = readOnly ? '<div class="readonly-footer"><span>◉</span><div>Historique en lecture seule<small>Aucun canal de réponse connecté dans ce scénario.</small></div></div>' : `<form class="composer" id="composer"><input id="message-input" aria-label="Message de démonstration à ${session().name}" maxlength="500" autocomplete="off" placeholder="${blocked ? 'Une autorisation attend votre réponse dans le fil' : 'Écrire à ' + session().name + '…'}" ${blocked ? 'disabled' : ''}><button aria-label="Simuler l’envoi du message" ${blocked ? 'disabled' : ''}>↑</button></form><div class="footer-note">${note}</div>`;
  }

  function renderAgentHeader() {
    const h = session().helpers.find(h => h.id === activeAgent); if (!h) return;
    $('session-head').innerHTML = `<header class="session-head agent-page-head"><button id="agent-back" class="back-row" aria-label="Revenir à la discussion de ${session().name}"><span aria-hidden="true">←</span> ${session().name}<span class="back-context">Discussion principale</span></button><div class="identity-row">${bot(current, helperState(h), 32, h.name)}<div class="identity-copy"><strong>${h.name}</strong><span class="provider-name">${h.kind || 'Sous-agent'}</span><p>Délégué par ${session().name}</p></div><span class="agent-state ${helperState(h) === 'working' ? 'working' : ''}">${helperState(h) === 'working' ? 'En cours' : 'Terminé'}</span></div><h2 class="session-topic">${h.task}</h2></header>`;
  }
  /** The agent's view reads like a short log: its own words are plain lines, the parent's brief and the final report stand apart. */
  function messageHTML(who, text, isParent = false) {
    if (isParent) return `<div class="delegated"><span class="delegated-label">Consigne de ${esc(who)}</span><p>${esc(text)}</p></div>`;
    const h = session().helpers.find(h => h.id === activeAgent);
    return `<div class="agent-line">${bot(current, helperState(h), 16, who)}<p>${esc(text)}</p></div>`;
  }
  function openAgent(id) {
    const h = session().helpers.find(h => h.id === id); if (!h) return;
    parentScroll = $('viewport').scrollTop; selectionBeforeAgent = selected;
    activeAgent = id; inspectedHelper = id; selected = null;
    $('viewport').hidden = true;
    $('agent-viewport').hidden = false;
    renderAgentHeader(); renderAgentFeed(h);
    $('agent-viewport').scrollTop = 0;
    $('session-footer').hidden = true;
    renderInspector(); $('agent-back').focus({ preventScroll: true });
    announce('Discussion de ' + h.name + ' ouverte.');
  }
  function renderAgentFeed(h) {
    $('agent-feed').innerHTML = (h.discussion || []).map(event => {
      if (event.role === 'parent') return messageHTML(session().name, event.text, true);
      if (event.role === 'assistant') return messageHTML(h.name, event.text);
      if (event.role === 'report') return reportHTML(h, event.text);
      if (event.role === 'waiting') return `<div class="live-line"><span class="live-dot"></span>${esc(event.text)}</div>`;
      if (event.tool) { const t = h.tools?.find(t => t.id === event.tool); return t ? toolHTML({ ...t, detail: t.detail.replace(h.name + ' · ', '') }) : ''; }
      return `<div class="simple-action">${esc(event.text)}</div>`;
    }).join('');
  }
  function closeAgent(restoreFocus = true) {
    const id = activeAgent; if (!id) return;
    activeAgent = null; inspectedHelper = null; selected = selectionBeforeAgent;
    $('agent-viewport').hidden = true; $('agent-feed').innerHTML = '';
    $('viewport').hidden = false; $('session-footer').hidden = false;
    renderHeader(); renderInspector(); $('viewport').scrollTop = parentScroll;
    if (restoreFocus) document.querySelector(`[data-agent="${id}"]`)?.focus({ preventScroll: true });
  }

  function renderInspector() {
    const s = session(); const h = s.helpers.find(h => h.id === inspectedHelper);
    if (h && !selected) { renderHelperInspector(h); return; }
    const t = allTools().find(t => t.id === selected);
    const fields = t ? [['Outil', t.name], ['Identifiant natif', t.nativeId || 'Non fourni'], ['Résultat', { success: 'Réussite confirmée', failed: 'Échec confirmé', running: 'Pas encore reçu', unknown: 'Non fourni' }[t.status]], ['Durée', t.duration || 'Non fournie'], ['Code de sortie', t.exit ?? 'Non fourni']] : [['Session native', current === 'codex' ? 'thread_demo_nova' : current === 'claude' ? 'session_demo_otto' : 'conversation_demo_pim'], ['Harnais', s.provider], ['État', state()[1]]];
    const raw = t ? { schema: 'ledge.event.v1 (proposition)', source: current === 'claude' ? 'hook + transcript' : 'transcript', provider: current, nativeCallId: t.nativeId, kind: 'tool', tool: t.name, status: t.status, result: t.status === 'running' || t.status === 'unknown' ? null : t.result, duration: t.duration, exitCode: t.exit === null ? null : Number(t.exit) } : { schema: 'ledge.session.v1 (proposition)', provider: current, nativeSessionId: fields[0][1], state: state()[0], usage: s.input ? { inputTokens: Number(s.input.replaceAll(' ', '')), outputTokens: Number(s.output.replaceAll(' ', '')) } : null };
    $('inspector').innerHTML = `<article class="inspector-card"><div class="inspector-top"><div class="inspector-kind">${t ? 'ACTION SÉLECTIONNÉE' : 'LA SESSION'}</div><h3>${t ? esc(t.label) : 'Un état relié à des faits'}</h3><p>${t ? esc(t.status === 'unknown' ? 'Le transcript contient cet appel, mais ne permet pas de savoir s’il a réussi.' : t.status === 'running' ? 'Un début d’exécution est connu. Le résultat final reste en attente.' : t.status === 'failed' ? 'Le code de sortie et le résultat signalent cet échec. Il reste dans le fil, même après une correction.' : 'Le résultat reçu confirme la fin de cette action.') : 'Les informations viennent des événements et du transcript. Sélectionnez une action dans le fil pour explorer ses données.'}</p><span class="source-pill">${esc(t ? t.source : s.source)}</span></div><dl class="field-list">${fields.map(([k, v]) => `<div class="field-row"><dt>${esc(k)}</dt><dd class="${String(v).startsWith('Non fourni') ? 'missing' : ''}">${esc(v)}</dd></div>`).join('')}</dl><details class="raw"><summary>Voir le modèle de données proposé</summary><pre>${esc(JSON.stringify(raw, null, 2))}</pre></details></article>`;
  }
  function renderHelperInspector(h) {
    const source = current === 'claude' ? 'SubagentStart / Stop + transcript du sous-agent' : 'SubAgentActivity + transcript associé';
    const rows = [['Parent', session().name], ['Identifiant natif', h.id], ['Type', h.kind || 'Non fourni'], ['État', helperState(h) === 'working' ? 'En cours' : 'Terminé']];
    const raw = { schema: 'ledge.agent.v1 (proposition)', parentSessionId: current === 'claude' ? 'session_demo_otto' : 'thread_demo_nova', nativeAgentId: h.id, agentType: h.kind || null, state: helperState(h), transcriptPath: current === 'claude' ? '<session>/subagents/agent-' + h.id + '.jsonl' : '<transcript associé>', finalReport: h.result };
    $('inspector').innerHTML = `<article class="inspector-card"><div class="inspector-top"><div class="inspector-kind">SOUS-AGENT · ${esc(h.name)}</div><h3>${esc(h.task)}</h3><p>Les outils sont rattachés à cet agent par son identifiant et son transcript. Son état est distinct de celui du parent.</p><span class="source-pill">${source}</span></div><dl class="field-list">${rows.map(([k,v]) => `<div class="field-row"><dt>${k}</dt><dd class="${v.startsWith('Non ') ? 'missing' : ''}">${esc(v)}</dd></div>`).join('')}</dl><details class="raw"><summary>Voir le modèle de données proposé</summary><pre>${esc(JSON.stringify(raw, null, 2))}</pre></details></article>`;
  }
  function renderCoverage() {
    const s = session();
    $('coverage').innerHTML = `<div class="coverage"><h3>Dans ce scénario ${s.provider}</h3><ul class="coverage-list">${s.coverage.map(([k, v]) => `<li class="${v.startsWith('Indisponible') || v.startsWith('Selon') ? 'partial' : ''}"><span>${k}</span><span>${v}</span></li>`).join('')}</ul><p class="coverage-note">${s.coverageNote}</p><p>Valeurs et contenus fictifs. La couverture dépend du harnais, de sa version et des sources raccordées.</p></div>`;
  }


  function renderReplySwitch() { for (const b of $('reply-variant').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.reply === replyVariant)); }
  function reset(id = current) {
    clearInterval(timer); timer = null; closeAgent(false);
    current = id; selected = null; inspectedHelper = null; decision = null; completed = false; replaying = false; replayStep = 0; exchanges = []; answered = false;
    $('panel-feed').innerHTML = ''; $('viewport').scrollTop = 0;
    $('replay').disabled = false; $('replay-note').textContent = 'Les actions restent dans cette maquette.';
    const url = new URL(location.href); url.searchParams.delete('variant'); url.searchParams.set('session', current); if (replyVariant === 'card') url.searchParams.set('reply', 'card'); else url.searchParams.delete('reply');
    try { history.replaceState(null, '', url); } catch { /* file:// is supported */ }
    renderHeader(); renderFeed(); renderFooter(); renderInspector(); renderCoverage();
  }
  function replay() {
    reset(); replaying = true; replayStep = 0; renderHeader(); renderFeed();
    $('replay').disabled = true; $('replay-note').textContent = 'Lecture du scénario… Les sous-agents restent consultables.';
    timer = setInterval(() => {
      replayStep++;
      if (replayStep > session().tools.length) {
        clearInterval(timer); timer = null; replaying = false; completed = current === 'codex';
        $('replay').disabled = false; $('replay-note').textContent = 'Lecture terminée. Ouvrez les fichiers ou consultez les sous-agents.';
      }
      renderHeader(); renderFeed(); renderInspector();
    }, 1050);
  }
  document.addEventListener('click', event => {
    const summary = event.target.closest('summary');
    if (summary && summary.parentElement.dataset.tool) {
      selected = summary.parentElement.dataset.tool; inspectedHelper = null; renderInspector();
    }
    if (summary && summary.parentElement.dataset.owner) {
      selected = summary.parentElement.dataset.owner; inspectedHelper = null; renderInspector();
    }
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.scenario) { reset(button.dataset.scenario); return; }
    if (button.dataset.reply) {
      replyVariant = button.dataset.reply; renderReplySwitch();
      const url = new URL(location.href); if (replyVariant === 'card') url.searchParams.set('reply', 'card'); else url.searchParams.delete('reply');
      try { history.replaceState(null, '', url); } catch { /* file:// is supported */ }
      renderFeed(); renderFooter(); const h = session().helpers.find(h => h.id === activeAgent); if (h) renderAgentFeed(h);
      announce(replyVariant === 'card' ? 'Dernière réponse affichée en carte structurée.' : 'Dernière réponse affichée dans le fil.'); return;
    }
    if (button.dataset.agent) { openAgent(button.dataset.agent); return; }
    if (button.id === 'agent-back') { closeAgent(); return; }
    if (button.dataset.helperSource) { inspectedHelper = button.dataset.helperSource; selected = null; renderInspector(); return; }
    if (button.dataset.permission) {
      decision = button.dataset.permission;
      $('decision-area').innerHTML = permissionHTML(); renderHeader(); renderFooter();
      announce(decision === 'accept' ? 'Accord simulé. Aucun résultat d’exécution reçu.' : 'Refus simulé.'); return;
    }
    if (button.id === 'theme') {
      const light = document.documentElement.dataset.theme !== 'light';
      document.documentElement.dataset.theme = light ? 'light' : 'dark';
      button.innerHTML = `${light ? 'Apparence sombre' : 'Apparence claire'} <span aria-hidden="true">◐</span>`; return;
    }
    if (button.id === 'replay') replay();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeAgent) { event.preventDefault(); closeAgent(); }
  });
  document.addEventListener('change', event => {
    if (event.target.name !== 'reply-opt') return;
    const free = $('reply-free'); if (free) { free.value = event.target.value; free.focus(); }
  });
  document.addEventListener('submit', event => {
    if (event.target.id === 'reply-answer') {
      event.preventDefault();
      const free = $('reply-free'); const picked = event.target.querySelector('input[name="reply-opt"]:checked');
      const text = (free && free.value.trim()) || (picked && picked.value);
      if (!text) return;
      answered = true; exchanges.push(text); renderFeed(); $('viewport').scrollTop = $('viewport').scrollHeight;
      announce('Réponse ajoutée à la maquette. Aucun envoi réel.');
      return;
    }
    if (event.target.id !== 'composer') return;
    event.preventDefault(); const input = $('message-input'); const text = input.value.trim();
    if (!text || input.disabled) return;
    exchanges.push(text); input.value = ''; renderFeed(); $('viewport').scrollTop = $('viewport').scrollHeight;
    announce('Message ajouté à la maquette. Aucun envoi réel.');
  });
  renderReplySwitch(); reset();
})();
