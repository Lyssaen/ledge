import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot } from '../../../apps/overlay/src/bots/Bot';
import type { BotState } from '../../../apps/overlay/src/bots/poseFor';
import { ResidentMascot } from '../../../apps/overlay/src/bots/ResidentMascot';
import { Shoulders } from '../../../apps/overlay/src/surface/Shoulders';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';

type Tool = 'claude' | 'codex' | 'cursor';
type Machine = 'local' | 'dev' | 'studio';
type Agent = { id: string; name: string; tool: Tool; project: string; machine: Machine; task: string; state: BotState };
type Ask = { id: string; agent: string; kind: 'approval' | 'question'; title: string; detail: string };
type Notice = { key: number; kind: 'done' | 'error' | 'offline'; agent?: string; title: string; sub: string };
type Mode = 'handle' | 'ask' | 'notice' | 'name';
type Scenario = 'idle' | 'approval' | 'question' | 'done' | 'error' | 'offline' | 'queue' | 'name' | 'pip' | 'chat';

const MACHINES: Record<Machine, string> = { local: 'PC local', dev: 'Dev SSH', studio: 'Studio SSH' };
const ORDER: Machine[] = ['local', 'dev', 'studio'];
const STATE_LABEL: Record<BotState, string> = {
  working: 'au travail', starting: 'démarre', idle: 'disponible', approval: 'attend un accord',
  question: 'a une question', error: 'en erreur', done: 'a terminé', readonly: 'hors ligne',
};
const AGENTS: Agent[] = [
  { id: 'otto', name: 'Otto', tool: 'claude', project: 'Ledge', machine: 'local', task: 'Concevoir la navigation desktop', state: 'working' },
  { id: 'rio', name: 'Rio', tool: 'cursor', project: 'Ledge', machine: 'local', task: 'Préparer la version 0.6', state: 'working' },
  { id: 'sage', name: 'Sage', tool: 'claude', project: 'Commerce', machine: 'local', task: 'Corriger le calcul de la TVA', state: 'working' },
  { id: 'nova', name: 'Nova', tool: 'codex', project: 'Commerce', machine: 'dev', task: 'Préparer la migration des commandes', state: 'working' },
  { id: 'iris', name: 'Iris', tool: 'cursor', project: 'Commerce', machine: 'dev', task: 'Adapter le paiement', state: 'working' },
  { id: 'lou', name: 'Lou', tool: 'codex', project: 'Mobile', machine: 'dev', task: 'Mettre à jour les dépendances', state: 'working' },
  { id: 'ash', name: 'Ash', tool: 'cursor', project: 'Studio', machine: 'studio', task: 'Vérifier la version distante', state: 'working' },
];
const ASKS: Record<string, Ask> = {
  otto: { id: 'ask-otto', agent: 'otto', kind: 'approval', title: 'Otto · pnpm test', detail: 'pnpm --filter @ledge/overlay test -- --run' },
  nova: { id: 'ask-nova', agent: 'nova', kind: 'question', title: 'Nova · question', detail: 'Migration progressive ou courte fenêtre de maintenance ?' },
  lou: { id: 'ask-lou', agent: 'lou', kind: 'approval', title: 'Lou · pnpm up', detail: 'pnpm up --latest && pnpm test' },
};
const NOTICES: Record<'done' | 'error' | 'offline', Omit<Notice, 'key'>> = {
  done: { kind: 'done', agent: 'sage', title: 'Sage a terminé', sub: '2 min · le calcul arrondit par ligne' },
  error: { kind: 'error', agent: 'iris', title: 'Iris · erreur', sub: 'ECONNREFUSED · le paiement de test ne répond plus' },
  offline: { kind: 'offline', title: 'Studio SSH', sub: 'Reconnexion automatique' },
};
const NOTICE_MS = 6000;
const SCENARIOS: { id: Scenario; label: string; hint: string }[] = [
  { id: 'idle', label: 'Repos', hint: 'La barre, rien de plus' },
  { id: 'approval', label: 'Accord', hint: 'Deux signes' },
  { id: 'question', label: 'Question', hint: 'Le rang ouvre Desktop' },
  { id: 'done', label: 'Terminé', hint: 'Trois mots, six secondes' },
  { id: 'error', label: 'Erreur', hint: 'Trois mots, six secondes' },
  { id: 'offline', label: 'Hors ligne', hint: 'Trois mots, six secondes' },
  { id: 'queue', label: 'File', hint: 'Un chiffre' },
  { id: 'name', label: 'Un nom', hint: 'Clic sur un point' },
  { id: 'pip', label: 'Pastille', hint: 'Un point rouge' },
  { id: 'chat', label: 'Chat', hint: 'La mascotte ouvre Desktop' },
];
const KEEP: [string, string][] = [
  ['La barre', '28 px de haut, au repos comme lorsqu’elle parle. Mascotte, points, filet entre les machines.'],
  ['Accord', 'Un nom et deux signes, × et ✓. Y, N, Entrée. La commande complète est dans Desktop.'],
  ['Avis', '« Sage a terminé », « Iris · erreur », « Studio SSH ». Une barre de 6 s. Le clic ouvre la session.'],
  ['File', 'Le même rang, un chiffre, deux lamelles de quelques pixels.'],
];
const HANDOFF: [string, string][] = [
  ['Chat et pastille', 'La mascotte et le point rouge. L’île ne s’élargit pas.'],
  ['Question', 'Le rang entier est le bouton. Les choix s’écrivent dans Desktop.'],
  ['Un agent', 'Un clic sur son point : « Rio · version 0.6 », puis sa session.'],
];
const DROPPED: [string, string][] = [
  ['La grande ligne', 'La version précédente s’ouvrait sur 520 px. Ici le rang reste sous 250 px, à la même hauteur que le repos.'],
  ['Les phrases', 'Plus de sous-titre, plus de commande affichée, plus de bouton Répondre.'],
  ['Visages, chat, menu', 'Les têtes au repos, le fil, les réglages, Ne pas déranger et Quitter vivent dans Ledge Desktop.'],
];

function useReducedMotion() {
  const [r, setR] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setR(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return r;
}

/** The notch follows its content, so a dot row and a sentence can share one transition. */
function useBox(ref: React.RefObject<HTMLDivElement | null>, key: unknown) {
  const [box, setBox] = useState({ w: 150, h: 28 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setBox({ w: Math.ceil(r.width), h: Math.ceil(r.height) });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key]);
  return box;
}

function App() {
  const reduced = useReducedMotion();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const [scenario, setScenario] = useState<Scenario>('idle');
  const [mode, setMode] = useState<Mode>('handle');
  const [agents, setAgents] = useState(AGENTS);
  const [pending, setPending] = useState<Ask[]>([]);
  const [shownId, setShownId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [nameId, setNameId] = useState<string | null>(null);
  const [offline, setOffline] = useState<Machine[]>([]);
  const [pip, setPip] = useState(false);
  const [ack, setAck] = useState<string | null>(null);
  const [nods, setNods] = useState<Record<string, number>>({});
  const [held, setHeld] = useState(false);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const [live, setLive] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const ackTimer = useRef<number | undefined>(undefined);

  const agent = (id: string) => agents.find(a => a.id === id)!;
  const ask = pending.find(p => p.id === shownId) ?? null;
  const waiting = pending.filter(p => p.id !== shownId);

  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 3600); return () => window.clearTimeout(t); }, [toast]);
  useEffect(() => () => window.clearTimeout(ackTimer.current), []);

  const announce = (text: string) => setLive(text);
  const openDesktop = (text: string) => { setToast({ key: Date.now(), text }); announce(`Ledge Desktop. ${text}`); };
  const fold = () => { setMode('handle'); setNameId(null); setNotice(null); setAck(null); };

  const showAsk = (a: Ask | null) => {
    setAck(null); setNameId(null); setNotice(null); setShownId(a?.id ?? null); setMode(a ? 'ask' : 'handle');
    if (a) announce(`${a.title}. ${a.detail}`);
  };

  const run = (s: Scenario) => {
    window.clearTimeout(ackTimer.current);
    setScenario(s); setAck(null); setHeld(false); setNameId(null); setShownId(null); setNotice(null); setToast(null);
    setAgents(AGENTS.map(a => s === 'error' && a.id === 'iris' ? { ...a, state: 'error' } : s === 'done' && a.id === 'sage' ? { ...a, state: 'idle' } : a));
    setOffline(s === 'offline' ? ['studio'] : []);
    setPip(s === 'pip');
    const queue = s === 'approval' ? [ASKS.otto] : s === 'question' ? [ASKS.nova] : s === 'queue' ? [ASKS.otto, ASKS.nova, ASKS.lou] : [];
    setPending(queue);
    if (s === 'chat') { setMode('handle'); openDesktop('Ouverture du chat'); return; }
    if (s === 'name') { setMode('name'); setNameId('rio'); announce('Rio · version 0.6'); return; }
    if (s === 'done' || s === 'error' || s === 'offline') {
      const n = { ...NOTICES[s], key: Date.now() };
      setNotice(n); setMode('notice'); announce(`${n.title}. ${n.sub}`);
      return;
    }
    if (queue.length) { showAsk(queue[0]); }
    else setMode('handle');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const resolve = (a: Ask, text: string) => {
    if (ack) return;
    setAck(text); setNods(n => ({ ...n, [a.agent]: (n[a.agent] ?? 0) + 1 })); announce(text);
    window.clearTimeout(ackTimer.current);
    ackTimer.current = window.setTimeout(() => {
      setPending(prev => {
        const rest = prev.filter(p => p.id !== a.id);
        showAsk(rest[0] ?? null);
        return rest;
      });
    }, reduced ? 500 : 800);
  };

  const openDot = (id: string) => {
    const p = pending.find(x => x.agent === id);
    if (p) { showAsk(p); return; }
    setNameId(id); setMode('name'); setNotice(null); setShownId(null);
    announce(`${agent(id).name} · ${agent(id).task}`);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === 'Escape' && mode !== 'handle') { e.preventDefault(); fold(); return; }
      if (el.closest('.min-scenarios, .min-top')) return;
      if (mode !== 'ask' || !ask || ack || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' && el.tagName === 'BUTTON') return;
      const k = e.key.toLowerCase();
      if (ask.kind === 'approval' && (k === 'y' || e.key === 'Enter')) { e.preventDefault(); resolve(ask, `Accord envoyé à ${agent(ask.agent).name}.`); }
      else if (ask.kind === 'approval' && k === 'n') { e.preventDefault(); resolve(ask, `Refus envoyé à ${agent(ask.agent).name}.`); }
      else if (ask.kind === 'question' && e.key === 'Enter') { e.preventDefault(); openDesktop(`Ouverture de la question de ${agent(ask.agent).name}`); fold(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const visual = (a: Agent): BotState => {
    if (offline.includes(a.machine)) return 'readonly';
    const p = pending.find(x => x.agent === a.id);
    return p ? p.kind : a.state;
  };
  const groups = ORDER.map(m => agents.filter(a => a.machine === m)).filter(g => g.length).map(g => [...g.filter(a => pending.some(p => p.agent === a.id)), ...g.filter(a => !pending.some(p => p.agent === a.id))]);
  const named = nameId ? agent(nameId) : null;
  const box = useBox(contentRef, `${mode}-${shownId}-${notice?.key}-${nameId}-${pip}-${pending.map(p => p.id).join()}-${agents.map(a => a.state).join()}-${offline.join()}`);
  const motion = reduced ? 'none' : 'left 260ms cubic-bezier(.2,.8,.2,1), width 260ms cubic-bezier(.2,.8,.2,1)';

  return <div className="min" data-scenario={scenario} data-mode={mode} data-reduced={reduced || undefined}>
    <header className="min-top">
      <div><h1>L’île, petite</h1><p>Elle tient dans la barre. Une demande ajoute un nom et, pour un accord, deux signes.</p></div>
      <span className="min-mock">Maquette · données simulées</span>
      <Button variant="outline" size="sm" aria-pressed={theme === 'light'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</Button>
    </header>

    <nav className="min-scenarios" aria-label="Scénarios">
      {SCENARIOS.map(s => <button key={s.id} type="button" data-scenario-btn={s.id} aria-pressed={scenario === s.id} onClick={() => run(s.id)}><strong>{s.label}</strong><small>{s.hint}</small></button>)}
    </nav>

    <div className="min-grid">
      <section className="stage" aria-label="Bureau simulé">
        <div className="stage-windows" aria-hidden="true"><div className="win win-term"><i /><i /><i /><i /><i /></div><div className="win win-editor"><i /><i /><i /><i /></div></div>
        <div className="island-wrap" style={{ width: box.w }}>
          <Shoulders left={0} w={box.w} transition={motion} opacity={1} />
          {mode === 'ask' && waiting.length > 0 && <div className="queue-slivers" aria-hidden="true">{waiting.slice(0, 2).map((p, i) => <i key={p.id} style={{ width: `calc(100% - ${(i + 1) * 16}px)` }} />)}</div>}
          <div className="island" data-mode={mode} data-surface style={{ width: box.w, height: box.h }}>
            <div ref={contentRef} className="island-content" key={`${mode}-${shownId ?? ''}-${notice?.key ?? ''}-${nameId ?? ''}`}>
              {mode === 'handle' && <div className="handle">
                <span className="resident">
                  <button type="button" data-resident aria-label="Ledge, ouvrir" title="Ouvrir le chat dans Ledge Desktop" onClick={() => openDesktop('Ouverture du chat')}>
                    <ResidentMascot size={16} theme={theme} reducedMotion={reduced} center={{ x: 0, y: 0 }} />
                  </button>
                  {pip && <button type="button" className="pip" data-update-pip="new" aria-label="Ledge 0.6.0 est prêt" title="Ledge 0.6.0 est prêt" onClick={() => openDesktop('Ouverture des mises à jour')} />}
                </span>
                {groups.map(g => <Fragment key={g[0].machine}>
                  <span className="sep" aria-hidden="true" />
                  <span className="dots">
                    {g.map(a => {
                      const state = visual(a);
                      const hot = state === 'approval' || state === 'question' || state === 'error';
                      return <button key={a.id} type="button" className="dot" data-state={state} data-hot={hot || undefined} data-hollow={state === 'readonly' || undefined} aria-label={`${a.name}, ${STATE_LABEL[state]}, ouvrir`} title={`${a.name} · ${a.task}`} onClick={() => openDot(a.id)} />;
                    })}
                  </span>
                </Fragment>)}
              </div>}

              {mode === 'ask' && ask && ask.kind === 'question' && <button type="button" className="row row-hit" data-kind="question" title={ask.detail} aria-label={`${ask.title}. ${ask.detail}`} onClick={() => { openDesktop(`Ouverture de la question de ${agent(ask.agent).name}`); fold(); }}>
                <Bot tool={agent(ask.agent).tool} state="question" pose={1} size={16} theme={theme} seed={ask.agent} reducedMotion={reduced} />
                <strong>{ask.title}</strong>
                {waiting.length > 0 && <span className="count" aria-label={`${waiting.length} autres demandes`}>{waiting.length}</span>}
              </button>}

              {mode === 'ask' && ask && ask.kind === 'approval' && <div className="row" data-kind="approval" title={ask.detail}>
                <Bot tool={agent(ask.agent).tool} state="approval" pose={1} size={16} theme={theme} seed={ask.agent} reducedMotion={reduced} nodKey={nods[ask.agent] ?? 0} />
                <strong>{ask.title}</strong>
                {waiting.length > 0 && <span className="count" aria-label={`${waiting.length} autres demandes`}>{waiting.length}</span>}
                {ack ? <span className="ack" role="status" aria-label={ack}><Icon size={13} {...ICONS.check} /></span> : <>
                  <button type="button" className="icon-btn" aria-label="Refuser" onClick={() => resolve(ask, `Refus envoyé à ${agent(ask.agent).name}.`)}><Icon size={12} {...ICONS.close} /></button>
                  <button type="button" className="icon-btn yes" aria-label="Autoriser" onClick={() => resolve(ask, `Accord envoyé à ${agent(ask.agent).name}.`)}><Icon size={12} {...ICONS.check} /></button>
                </>}
              </div>}

              {mode === 'notice' && notice && <NoticeRow notice={notice} agent={notice.agent ? agent(notice.agent) : undefined} theme={theme} reduced={reduced} held={held}
                onHold={setHeld} onDone={fold} onOpen={() => { openDesktop(notice.agent ? `Ouverture de la session de ${agent(notice.agent).name}` : 'Ouverture des machines'); fold(); }} />}

              {mode === 'name' && named && <button type="button" className="row row-hit" data-kind="name" title={`${named.task} · ${named.project} · ${MACHINES[named.machine]}`} onClick={() => { openDesktop(`Ouverture de la session de ${named.name}`); fold(); }}>
                <Bot tool={named.tool} state={visual(named)} pose={1} size={16} theme={theme} seed={named.id} reducedMotion={reduced} frozen={offline.includes(named.machine)} />
                <strong>{named.name} · {named.id === 'rio' ? 'version 0.6' : named.task}</strong>
              </button>}
            </div>
          </div>
        </div>
        {toast && <div key={toast.key} className="toast" role="status"><span className="toast-app"><Icon size={14} {...ICONS.external} /></span><span><strong>Ledge Desktop</strong><small>{toast.text}</small></span></div>}
        <div className="taskbar" aria-hidden="true"><i /><i /><i /><i className="tb-ledge" /><i /></div>
        <div className="sr-only" aria-live="polite" role="status">{live}</div>
      </section>

      <aside className="scope" aria-labelledby="scope-title">
        <h2 id="scope-title">La même hauteur, au repos et en demande</h2>
        <p>28 px de haut, moins de 250 px de large. Proposition. Cette page ne change pas l’application.</p>
        <h3><span className="dot-key keep" />Sur l’île</h3>
        <ul>{KEEP.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
        <h3><span className="dot-key move" />Ouvre Ledge Desktop</h3>
        <ul>{HANDOFF.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
        <h3><span className="dot-key drop" />Retiré de l’île sobre</h3>
        <ul>{DROPPED.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
        <p className="scope-keys">Échap replie · Y autorise · N refuse · Entrée le geste du rang</p>
      </aside>
    </div>
  </div>;
}

function NoticeRow({ notice, agent, theme, reduced, held, onHold, onDone, onOpen }: { notice: Notice; agent?: Agent; theme: 'dark' | 'light'; reduced: boolean; held: boolean; onHold: (v: boolean) => void; onDone: () => void; onOpen: () => void }) {
  const state: BotState = notice.kind === 'done' ? 'idle' : 'error';
  return <button type="button" className="row row-hit" data-kind={notice.kind} title={notice.sub} aria-label={`${notice.title}. ${notice.sub}`} onClick={onOpen} onMouseEnter={() => onHold(true)} onMouseLeave={() => onHold(false)} onFocus={() => onHold(true)} onBlur={() => onHold(false)}>
    {agent ? <Bot tool={agent.tool} state={state} pose={1} size={16} theme={theme} seed={agent.id} reducedMotion={reduced} /> : <span className="machine-dot" aria-hidden="true" />}
    <strong>{notice.title}</strong>
    <span className="drain" aria-hidden="true"><i data-run={reduced ? undefined : true} style={{ animationPlayState: held ? 'paused' : 'running' }} onAnimationEnd={onDone} /></span>
  </button>;
}

createRoot(document.getElementById('root')!).render(<App />);
