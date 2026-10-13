/* Disposable motion study. No daemon connection; state changes are explicit simulations. */
(() => {
  const $ = s => document.querySelector(s);
  const root = document.documentElement;
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const states = {
    working: ['Au travail', 'Une courte préparation, un saut, puis du calme. Même rythme pour tous ; une petite signature distingue chaque outil.'],
    waiting_input: ['Une question', 'La tête s’incline d’abord ; le regard se décale ensuite. Une hésitation légère, sans multiplier les appels à l’attention.'],
    waiting_permission: ['Votre accord', 'La main se lève une seule fois. Le bot attend ensuite calmement votre décision.'],
    idle: ['Disponible', 'Un petit rebond d’accueil, puis un regard occasionnel et un étirement rare. Disponible ne veut pas dire terminé.'],
    exited: ['Terminée', 'Les paupières se ferment en deux temps, la posture se relâche, puis tout mouvement s’arrête.'],
    error: ['Erreur', 'Un bref recul, puis une expression préoccupée immobile. Aucun tremblement ni clignotement.']
  };
  const cast = [['claude', 'Otto', 'Claude Code', 'Une inclinaison à l’arrivée'], ['codex', 'Nova', 'Codex', 'Un léger roulis'], ['cursor', 'Pim', 'Cursor Agent', 'Une pointe vers l’avant']];
  let state = 'working', sequence = null;
  const bots = [];
  const quiet = () => $('#reduced').checked || media.matches;
  const paused = () => $('#paused').checked || document.hidden;
  const svgNS = 'http://www.w3.org/2000/svg';
  function addBot(host, tool, name, size) {
    host.innerHTML = window.LedgeMascotSVG(tool, state, size, `session-${tool}`);
    const svg = host.querySelector('svg');
    let child = svg.querySelector('.body');
    for (const cls of ['signature', 'arrival', 'hop']) {
      const group = document.createElementNS(svgNS, 'g'); group.classList.add(cls);
      child.replaceWith(group); group.append(child); child = group;
    }
    const seed = Number(svg.dataset.seed);
    const bot = { svg, tool, name, size, seed, nextHop: performance.now() + 900 + seed % 2200, nextBlink: performance.now() + 1400 + seed % 3500, nextIdle: performance.now() + 3500 + seed % 4000, cycle: 0 };
    bots.push(bot); return bot;
  }
  $('#cast').innerHTML = cast.map(([tool,name,label,signature]) => `<article class="member"><button class="portrait" data-tool="${tool}" aria-label="Faire réagir ${name}"></button><strong>${name}</strong><small>${label} · ${signature}</small></article>`).join('');
  cast.forEach(([tool,name]) => {
    addBot($(`.portrait[data-tool=${tool}]`), tool, name, 144);
    const notch = document.createElement('span'); $('#notch').append(notch); addBot(notch,tool,name,12);
    const row = document.createElement('div'); row.className = 'session-row';
    row.innerHTML = `<span class="avatar"></span><div><strong>${name}</strong><small>harness-assistant · main</small></div><span class="status"></span>`;
    $('#rows').append(row); addBot(row.querySelector('.avatar'),tool,name,32);
  });
  $('#cast').addEventListener('pointermove', e => {
    const target = e.target.closest('.portrait'); if (!target || quiet() || paused() || ['error','exited'].includes(state)) return;
    const box = target.getBoundingClientRect(); const svg = target.querySelector('svg');
    svg.style.setProperty('--gx', `${Math.max(-2,Math.min(2,(e.clientX-box.left-box.width/2)/box.width*4))}px`);
    svg.style.setProperty('--gy', `${Math.max(-2,Math.min(2,(e.clientY-box.top-box.height/2)/box.height*4))}px`);
  });
  document.querySelectorAll('.portrait').forEach(p => {
    p.addEventListener('pointerleave', () => { p.querySelector('svg').style.setProperty('--gx','0px'); p.querySelector('svg').style.setProperty('--gy','0px'); });
    p.addEventListener('click', () => { const b = bots.find(b => b.svg === p.querySelector('svg')); if (!['exited','error'].includes(state)) animate(b,'.arrival',['scale(1)','scale(1.07,.92)','scale(.97,1.04)','scale(1)'],360); });
  });
  function animate(bot, selector, transforms, duration, extra = {}) {
    if (quiet() || paused()) return;
    const el = bot.svg.querySelector(selector); el.getAnimations().forEach(a => a.cancel());
    return el.animate(transforms.map(transform => ({transform})), {duration,easing:'cubic-bezier(.22,1,.36,1)',...extra});
  }
  function hop(bot) {
    const rendered = bot.svg.getBoundingClientRect().width;
    const units = bot.size <= 20 ? 72 : 96;
    const height = Math.min(7,Math.max(2,rendered*.12))/rendered*units;
    animate(bot,'.hop',['translateY(0) scale(1)','translateY(0) scale(1.06,.92)',`translateY(-${height}px) scale(.96,1.06)`,'translateY(0) scale(1.05,.95)','scale(1)'],480);
    if (bot.size <= 20) return;
    animate(bot,'.ground',['scaleX(1)','scaleX(.9)','scaleX(.72)','scaleX(.95)','scaleX(1)'],480);
    if ($('#signature').checked) {
      const angles = bot.tool === 'claude' ? [0,0,0,5,0] : bot.tool === 'codex' ? [0,-4,5,2,0] : [0,-2,7,2,0];
      animate(bot,'.signature',angles.map(a => `rotate(${a}deg)`),480);
    }
  }
  function transition(bot) {
    if (bot.size <= 20) return;
    if (state === 'working') hop(bot);
    if (state === 'waiting_input') {
      animate(bot,'.arrival',['rotate(-5deg)','rotate(2deg)','rotate(0deg)'],500);
      animate(bot,'.gaze',['translate(0,0)','translate(0,0)','translate(2px,-1px)','translate(0,0)'],650);
    }
    if (state === 'waiting_permission') animate(bot,'.arm',['rotate(0deg)','rotate(-40deg) translateY(-7px)','rotate(-22deg) translateY(-5px)'],850,{delay:180});
    if (state === 'idle') animate(bot,'.arrival',['scale(1)','translateY(-2px) scale(.98,1.04)','scale(1.03,.97)','scale(1)'],500);
    if (state === 'exited') animate(bot,'.eye-blink',['scaleY(1)','scaleY(.5)','scaleY(.65)','scaleY(.12)','scaleY(1)'],500);
    if (state === 'error') animate(bot,'.arrival',['translateX(0)','translateX(-3px) rotate(-3deg)','translateX(0)'],500);
  }
  function setState(next, play = true) {
    state = next;
    bots.forEach(b => {
      b.svg.getAnimations({subtree:true}).filter(a => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).forEach(a => a.cancel());
      b.svg.dataset.state = next; b.svg.style.setProperty('--gx','0px'); b.svg.style.setProperty('--gy','0px');
      b.svg.setAttribute('aria-label',`${b.name} · ${states[next][0]}`);
      b.nextHop = performance.now()+3600+b.seed%9*100;
      if (play) transition(b);
    });
    document.querySelectorAll('[data-state-button]').forEach(b => b.setAttribute('aria-pressed',String(b.dataset.stateButton === state)));
    document.querySelectorAll('.status').forEach(el => el.textContent = states[state][0]);
    $('#state-title').textContent = states[state][0]; $('#state-note').textContent = states[state][1];
    syncPreferences();
  }
  function stopSequence() { clearInterval(sequence); sequence = null; $('#sequence').textContent = '▷ Lire le scénario'; $('#sequence').setAttribute('aria-pressed','false'); }
  Object.entries(states).forEach(([key,[label]]) => {
    const btn = document.createElement('button'); btn.textContent = label; btn.dataset.stateButton = key;
    btn.addEventListener('click', () => { stopSequence(); setState(key); }); $('.states').append(btn);
  });
  $('#replay').onclick = () => { stopSequence(); setState(state); };
  $('#sequence').onclick = () => {
    if (sequence) return stopSequence();
    const steps = ['working','waiting_input','working','waiting_permission','idle','exited']; let i=0;
    setState(steps[0]); $('#sequence').textContent = '□ Arrêter le scénario'; $('#sequence').setAttribute('aria-pressed','true');
    sequence = setInterval(() => { if (paused()) return; if (++i >= steps.length) return stopSequence(); setState(steps[i]); },2600);
  };
  $('#theme').onclick = () => { const light = root.dataset.theme !== 'light'; root.dataset.theme = light?'light':'dark'; $('#theme').textContent = light?'Thème sombre':'Thème clair'; $('#theme').setAttribute('aria-pressed',String(light)); };
  function syncPreferences() {
    root.dataset.reduced = String(quiet()); root.dataset.paused = String(paused());
    bots.forEach(b => {
      b.svg.getAnimations({subtree:true}).forEach(a => { if (quiet()) a.cancel(); else if (paused()) a.pause(); else if (a.playState === 'paused') a.play(); });
      if (quiet()) { b.svg.style.setProperty('--gx','0px'); b.svg.style.setProperty('--gy','0px'); }
      if (paused() || quiet()) { b.nextHop = performance.now()+3600+b.seed%9*100; b.nextBlink=performance.now()+3400+b.seed%3300; b.nextIdle=performance.now()+5000+b.seed%4000; }
    });
  }
  $('#reduced').onchange = syncPreferences; $('#paused').onchange = syncPreferences;
  media.addEventListener('change',syncPreferences); document.addEventListener('visibilitychange',syncPreferences);
  const timer = setInterval(() => {
    if (quiet() || paused()) return;
    const now = performance.now();
    bots.forEach(b => {
      if (state === 'working' && now >= b.nextHop) { hop(b); b.nextHop=now+3600+b.seed%9*100; }
      if (b.size <= 20 || ['error','exited'].includes(state)) return;
      if (now >= b.nextBlink) { animate(b,'.eye-blink',['scaleY(1)','scaleY(.08)','scaleY(1)'],180); b.nextBlink=now+3400+(b.seed+(++b.cycle)*997)%3300; }
      if (now >= b.nextIdle) {
        if (state === 'idle') {
          animate(b,'.gaze',['translateX(0)','translateX(2px)','translateX(2px)','translateX(0)'],1700);
          if (b.cycle%4 === 0) animate(b,'.arrival',['scale(1)','scale(.98,1.04)','scale(1)'],1600);
        }
        if (state === 'working') animate(b,'.gaze',['translateX(0)',`translateX(${b.cycle%2?1.4:-1.4}px)`,'translateX(0)'],1400);
        if (state === 'waiting_input') animate(b,'.arrival',['rotate(0deg)','rotate(-2deg)','rotate(0deg)'],1800);
        b.nextIdle=now+5500+(b.seed+b.cycle*557)%3500;
      }
    });
  },120);
  addEventListener('pagehide',() => {clearInterval(timer); stopSequence();});
  setState('working',false);
})();
