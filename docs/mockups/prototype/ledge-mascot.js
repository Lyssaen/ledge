/* Local design study: no connection to the daemon or OS tray, no real sessions launched. */
(() => {
  const $ = selector => document.querySelector(selector);
  const root = document.documentElement;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const state = { session: false, offline: false, dnd: false, reduced: media.matches };
  const gestures = [
    ['blink', '−', 'Un clignement', 'Un instant, puis de retour.', 'Un clignement naturel, de temps en temps.', 350],
    ['curious', '◔', 'Tiens, vous voilà', 'Une tête qui penche.', 'Il vous remarque et incline la tête avec curiosité.', 1800],
    ['hello', '~', 'Petit coucou', 'Une patte pour vous saluer.', 'Un salut bref, réservé à votre arrivée.', 1850],
    ['boop', '↑', 'Boop !', 'Un clic, un petit bond.', 'Il se tasse, bondit et retrouve tranquillement sa place.', 850],
    ['happy', '⌒', 'Content de vous voir', 'Les yeux sourient.', 'Un sourire et un petit balancement pour répondre au survol.', 1800],
    ['look', '↔', 'Un regard autour', 'Curieux, sans s’agiter.', 'Il regarde à gauche, puis à droite, avant de se recentrer.', 2600],
    ['stretch', '↟', 'Un étirement', 'Après une longue pause.', 'Un étirement occasionnel pour retrouver sa posture.', 2000],
    ['tap', '···', 'Toc, toc', 'Trois petits tapotements.', 'Sa patte tapote le bord du notch. Un geste rare, sans son.', 1500],
    ['pulse', '✧', 'Une petite idée', 'L’antenne s’illumine.', 'Une lueur douce peut signaler une astuce disponible, sans ouvrir de bulle.', 1850],
    ['nod', '✓', 'Bien reçu', 'Un signe de tête.', 'Il confirme une interaction reçue, sans prétendre qu’une tâche a réussi.', 1000],
    ['yawn', '≈', 'La pause s’installe', 'Il ferme doucement les yeux.', 'Après un moment calme, il s’étire et ferme les yeux.', 2200],
    ['sleep', 'z', 'Je veille au calme', 'Présent, même endormi.', 'Il somnole, toujours visible. Votre retour suffit à le réveiller.', 3600]
  ];
  const character = `<svg class="ledge-character" viewBox="0 0 96 96" aria-hidden="true"><g class="mascot-body"><g class="mascot-pose"><path class="mascot-antenna" d="M48 23v-9"/><circle class="mascot-light" cx="48" cy="12" r="3"/><path class="mascot-spark" d="M48 3V0M39 6l-3-3M57 6l3-3"/><rect class="mascot-foot" x="30" y="74" width="12" height="8" rx="4"/><rect class="mascot-foot" x="54" y="74" width="12" height="8" rx="4"/><path class="mascot-shell" d="M23 33Q25 21 40 21h16q15 0 17 12l5 23q4 22-17 22H35Q14 78 18 56Z"/><path class="mascot-base" opacity=".5" d="M19 63q5 11 29 11t29-11q0 15-16 15H35Q19 78 19 63"/><path class="mascot-shine" d="M28 34q3-7 14-7h12"/><rect class="mascot-visor" x="25" y="37" width="46" height="27" rx="12"/><g class="mascot-gaze"><g class="mascot-blink"><g class="mascot-eyes"><rect x="35" y="44" width="6" height="12" rx="3"/><rect x="55" y="44" width="6" height="12" rx="3"/></g><path class="mascot-lids mascot-smile" d="M34 51q4-8 8 0m12 0q4-8 8 0"/><path class="mascot-lids mascot-sleep" d="M34 50q4 4 8 0m12 0q4 4 8 0"/></g></g><ellipse class="mascot-hand" cx="78" cy="63" rx="5" ry="8"/></g></g></svg>`;
  const tray = `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true"><path class="tray-symbol" d="M11 3h2v3h-2zM7 6h10q3 0 4 4l1 7q0 4-5 4H7q-5 0-5-4l1-7q1-4 4-4"/><rect class="tray-cutout" x="5" y="10" width="14" height="8" rx="3"/><rect class="tray-symbol" x="8" y="12" width="2" height="4" rx="1"/><rect class="tray-symbol" x="14" y="12" width="2" height="4" rx="1"/></svg>`;
  document.querySelectorAll('[data-character]').forEach(slot => { slot.innerHTML = slot.dataset.tray ? tray : character; });
  const actors = [...document.querySelectorAll('.resident-art .ledge-character, .portrait .ledge-character, .welcome-mascot .ledge-character')];
  let gestureTimer, ambientTimer, openingTimer, currentGesture = '', lastInteraction = Date.now(), lastPointer = null, pointerFrame = 0;
  const reduced = () => state.reduced || media.matches;
  function announce(text) { $('#announcement').textContent = text; }
  function describe(title, copy) { $('#expression').textContent = title; $('#expression-copy').textContent = copy; }
  function rest() {
    clearTimeout(gestureTimer); currentGesture = '';
    actors.forEach(actor => actor.removeAttribute('data-gesture'));
    document.querySelectorAll('[data-gesture-button]').forEach(button => button.setAttribute('aria-pressed', 'false'));
    if (state.offline) describe('Je reste avec vous', 'Connexion perdue. Son antenne s’éteint ; Ledge reste présent dans le notch et le tray.');
    else if (state.dnd) describe('Tout doucement', 'Mode concentration : il reste présent, sans animations spontanées.');
    else if (state.session) describe('L’équipe est au complet', 'Ledge reste en tête du notch. La session a son propre compagnon juste en dessous.');
    else describe('À votre rythme', 'Il respire doucement, cligne des yeux et garde votre place.');
  }
  function play(id, user = true) {
    const item = gestures.find(g => g[0] === id); if (!item) return;
    rest(); currentGesture = id;
    if (user) lastInteraction = Date.now();
    actors.forEach(actor => { void actor.getBoundingClientRect(); actor.dataset.gesture = id; });
    document.querySelector(`[data-gesture-button="${id}"]`)?.setAttribute('aria-pressed', 'true');
    describe(item[2], reduced() ? 'Animations réduites : les mouvements sont désactivés, les expressions restent lisibles.' : item[4]);
    if (user) announce(item[2]);
    gestureTimer = setTimeout(rest, item[5]);
  }
  gestures.forEach(([id, symbol, title, hint], index) => {
    const button = document.createElement('button'); button.className = 'gesture'; button.dataset.gestureButton = id; button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `<span class="gesture-symbol" aria-hidden="true">${symbol}</span><span><strong>${title}</strong><small>${hint}</small></span><span class="gesture-number">${String(index + 1).padStart(2, '0')}</span>`;
    button.addEventListener('click', () => play(id)); $('#gesture-grid').append(button);
  });
  function closeWelcome() { clearTimeout(openingTimer); $('#welcome').hidden = true; $('#resident').setAttribute('aria-expanded', 'false'); }
  function openWelcome() { clearTimeout(openingTimer); $('#welcome').hidden = false; $('#resident').setAttribute('aria-expanded', 'true'); closeTray(); $('#close-welcome').focus({ preventScroll: true }); }
  function closeTray() { $('#tray-menu').hidden = true; $('#tray').setAttribute('aria-expanded', 'false'); }
  function syncScenario() {
    root.dataset.offline = String(state.offline); root.dataset.dnd = String(state.dnd);
    $('#session-slot').hidden = !state.session;
    $('#session').setAttribute('aria-pressed', String(state.session)); $('#session').textContent = state.session ? '− Terminer la session' : '+ Une session arrive';
    $('#offline').setAttribute('aria-pressed', String(state.offline)); $('#offline').textContent = state.offline ? 'Reconnecter' : 'Connexion perdue';
    $('#dnd').setAttribute('aria-pressed', String(state.dnd)); $('#dnd-mark').textContent = state.dnd ? '●' : '○';
    $('#tray-badge').hidden = !state.offline && !state.session;
    $('#tray-status').textContent = state.offline ? 'Connexion perdue' : state.dnd ? 'Ne pas déranger' : state.session ? 'Présent · 1 session active' : 'Présent · aucune session';
    $('#notch-tip').innerHTML = state.offline ? 'Je reste avec vous.<small>Connexion perdue · accueil disponible</small>' : state.session ? 'Ledge & son équipe.<small>1 session active · ouvrir l’accueil</small>' : 'Ledge est là.<small>Aucune session · cliquer pour commencer</small>';
    $('#launch').disabled = state.offline;
    $('#launch').textContent = state.offline ? 'Connexion indisponible' : state.session ? 'Rejoindre le notch' : '+ Nouvelle session';
    $('#tray-new').disabled = state.offline;
    rest(); scheduleAmbient();
  }
  $('#session').addEventListener('click', () => { state.session = !state.session; syncScenario(); if (state.session) { play('hello'); announce('Une session arrive. Ledge reste présent à ses côtés.'); } else announce('Session terminée. Ledge reste présent.'); });
  $('#offline').addEventListener('click', () => { state.offline = !state.offline; syncScenario(); announce($('#tray-status').textContent); });
  function toggleDnd() { state.dnd = !state.dnd; syncScenario(); }
  $('#dnd').addEventListener('click', toggleDnd); $('#tray-dnd').addEventListener('click', toggleDnd);
  $('#resident').addEventListener('click', () => { play('boop'); openingTimer = setTimeout(openWelcome, reduced() ? 0 : 450); });
  $('#resident').addEventListener('pointerenter', () => { if (!state.offline) play('happy'); });
  $('#portrait-button').addEventListener('click', () => play('boop'));
  $('#close-welcome').addEventListener('click', () => { closeWelcome(); $('#resident').focus({ preventScroll: true }); });
  $('#launch').addEventListener('click', () => { state.session = true; closeWelcome(); syncScenario(); play('hello'); announce('Session simulée démarrée. Ledge reste dans le notch.'); });
  $('#shortcut').addEventListener('click', () => { play('pulse'); $('#welcome p').textContent = 'Ctrl + Alt + L : ouvrir Ledge. Échap : refermer l’accueil ou le menu du tray.'; });
  $('#tray').addEventListener('click', () => { const show = $('#tray-menu').hidden; closeWelcome(); $('#tray-menu').hidden = !show; $('#tray').setAttribute('aria-expanded', String(show)); if (show) $('#tray-open').focus({ preventScroll: true }); });
  $('#tray-open').addEventListener('click', openWelcome); $('#tray-new').addEventListener('click', openWelcome);
  document.addEventListener('pointerdown', event => { if (!event.target.closest('#tray-menu, #tray')) closeTray(); if (!event.target.closest('#welcome, #resident, #tray-menu, #tray')) closeWelcome(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { const inTray = !$('#tray-menu').hidden; closeWelcome(); closeTray(); $(inTray ? '#tray' : '#resident').focus({ preventScroll: true }); } if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'l') { event.preventDefault(); openWelcome(); } });
  $('#theme').addEventListener('click', () => { const light = root.dataset.theme !== 'light'; root.dataset.theme = light ? 'light' : 'dark'; $('#theme').textContent = light ? 'Passer en sombre' : 'Passer en clair'; });
  document.querySelectorAll('[data-scale]').forEach(button => { if (button.tagName !== 'BUTTON') return; button.addEventListener('click', () => { $('#desktop').dataset.scale = button.dataset.scale; document.querySelectorAll('button[data-scale]').forEach(other => other.setAttribute('aria-pressed', String(other === button))); }); });
  function syncMotion() { root.dataset.reduced = String(reduced()); $('#reduced').checked = reduced(); $('#reduced').disabled = media.matches; rest(); resetGaze(); scheduleAmbient(); }
  $('#reduced').addEventListener('change', event => { state.reduced = event.target.checked; syncMotion(); });
  media.addEventListener('change', () => { state.reduced = media.matches; syncMotion(); });
  function resetGaze() { actors.forEach(actor => { actor.style.setProperty('--gx', '0px'); actor.style.setProperty('--gy', '0px'); actor.style.setProperty('--tilt', '0deg'); }); }
  function track(event, target, radius) {
    lastPointer = { x: event.clientX, y: event.clientY, target, radius };
    if (pointerFrame) return;
    pointerFrame = requestAnimationFrame(() => {
      pointerFrame = 0; if (reduced() || document.hidden || !lastPointer) return;
      const { x, y, target, radius } = lastPointer, box = target.getBoundingClientRect();
      const dx = x - box.left - box.width / 2, dy = y - box.top - box.height / 2;
      if (Math.hypot(dx, dy) > radius) { resetGaze(); return; }
      lastInteraction = Date.now();
      if (currentGesture === 'sleep' || currentGesture === 'yawn') play('curious', false);
      actors.forEach(actor => { actor.style.setProperty('--gx', `${Math.max(-4, Math.min(4, dx / radius * 5))}px`); actor.style.setProperty('--gy', `${Math.max(-2, Math.min(2, dy / radius * 3))}px`); actor.style.setProperty('--tilt', `${Math.max(-5, Math.min(5, dx / radius * 7))}deg`); });
    });
  }
  $('#desktop').addEventListener('pointermove', event => track(event, $('#resident'), 160));
  $('#portrait').addEventListener('pointermove', event => track(event, $('#portrait-button'), 210));
  ['#desktop', '#portrait'].forEach(selector => $(selector).addEventListener('pointerleave', () => { lastPointer = null; resetGaze(); }));
  let ambientCount = 0;
  function scheduleAmbient() {
    clearTimeout(ambientTimer);
    if (reduced() || state.dnd || state.offline || document.hidden) return;
    ambientTimer = setTimeout(() => {
      if (!currentGesture && Date.now() - lastInteraction > 3500) { ambientCount++; const idle = Date.now() - lastInteraction; play(idle > 60000 ? 'sleep' : ambientCount % 5 === 0 ? 'look' : 'blink', false); }
      scheduleAmbient();
    }, 4500 + Math.random() * 2200);
  }
  document.addEventListener('visibilitychange', () => { root.dataset.paused = String(document.hidden); if (document.hidden) { clearTimeout(openingTimer); rest(); } scheduleAmbient(); });
  window.addEventListener('pagehide', () => { clearTimeout(gestureTimer); clearTimeout(ambientTimer); clearTimeout(openingTimer); cancelAnimationFrame(pointerFrame); });
  syncScenario(); syncMotion();
})();
