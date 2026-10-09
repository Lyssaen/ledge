/* Animation controller for this design prototype; no service connection. */
window.LedgeMascots = (() => {
  const labels = {starting:'Démarrage',working:'Au travail',waiting_permission:'Votre accord',waiting_input:'Une question',idle:'Disponible',error:'Erreur',exited:'Terminée'};
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const clocks = new WeakMap();
  const reduced = () => document.documentElement.dataset.reduced === 'true' || media.matches;
  function update(slot, session, size = 32) {
    const identity = session.id + ':' + session.tool;
    if (slot.dataset.identity !== identity) {
      slot.innerHTML = window.LedgeMascotSVG(session.tool, session.state, size, session.name);
      slot.dataset.identity = identity;
    }
    const bot = slot.querySelector('.bot');
    const changed = bot.dataset.state !== session.state;
    bot.dataset.state = session.state;
    bot.dataset.readonly = String(Boolean(session.readonly));
    bot.setAttribute('aria-label', session.name + ' · ' + labels[session.state] + (session.readonly ? ' · lecture seule' : ''));
    bot.setAttribute('width', size);
    bot.setAttribute('height', size);
    bot.setAttribute('viewBox', size <= 20 ? '12 16 72 68' : '0 0 96 96');
    bot.dataset.small = String(size <= 20);
    const seed = Number(bot.dataset.seed);
    bot.style.setProperty('--tilt', (session.state === 'waiting_input' ? [4, -3, 6] : [-4, 3, -2])[seed % 3] + 'deg');
    if (changed) {
      bot.style.setProperty('--gx', '0px');
      bot.style.setProperty('--gy', '0px');
      bot.classList.remove('ask', 'nod', 'blink');
      if (session.state === 'waiting_permission' && !reduced() && !session.readonly) {
        requestAnimationFrame(() => { if (bot.isConnected) bot.classList.add('ask'); });
      }
    }
  }
  function nod(id) {
    if (reduced()) return;
    document.querySelectorAll('[data-identity]').forEach(slot => {
      if (slot.dataset.identity.split(':')[0] !== id) return;
      const bot = slot.querySelector('.bot');
      bot.classList.remove('ask', 'nod');
      void bot.getBoundingClientRect();
      bot.classList.add('nod');
      setTimeout(() => bot.classList.remove('nod'), 750);
    });
  }
  setInterval(() => {
    if (document.hidden || reduced() || document.documentElement.classList.contains('offline')) return;
    const now = performance.now();
    document.querySelectorAll('.bot').forEach(bot => {
      if (bot.closest('[inert]') || bot.dataset.small === 'true' || bot.dataset.readonly === 'true' || ['exited','error'].includes(bot.dataset.state)) return;
      const box = bot.getBoundingClientRect();
      if (box.bottom < 0 || box.top > innerHeight || !box.width) return;
      const seed = Number(bot.dataset.seed);
      let clock = clocks.get(bot);
      if (!clock) { clock = {blink:now + 1400 + seed % 3500, look:now + 800 + seed % 1800, cycle:0}; clocks.set(bot, clock); }
      if (now >= clock.blink) {
        bot.classList.remove('blink');
        void bot.getBoundingClientRect();
        bot.classList.add('blink');
        clock.cycle++;
        clock.blink = now + 3400 + (seed + clock.cycle * 997) % 3300;
      }
      if (now >= clock.look) {
        const focused = bot.dataset.state === 'working';
        bot.style.setProperty('--gx', focused ? (clock.cycle % 2 ? '1.4px' : '-1.4px') : '0px');
        bot.style.setProperty('--gy', focused ? '.3px' : '0px');
        clock.look = now + 2400 + (seed + clock.cycle * 557) % 2100;
      }
    });
  }, 180);
  document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('paused', document.hidden));
  return {update, nod, reduced};
})();
