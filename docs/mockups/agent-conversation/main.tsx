// Isolated design preview of the « Conversation » tab (spec docs/superpowers/specs/2026-10-21-agent-conversation-design.md).
// It mounts Desktop's real title bar, sidebar, top bar and session page (thread, reply) on a fixture fleet; the thread's
// message cards are the app's plus the two entry points (./MessageCard.tsx), and the side pane is the new tab
// (./ConversationPane.tsx). No daemon: the controls above the window drive the states and simulate the live part.
import '@ledge/ui/documents/markdown.css';
import '../../../apps/desktop/src/styles/app.css';
import './conversation.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { daemonStore, projectOf, type DaemonClient, type MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { Button } from '@ledge/ui/ui/Button';
import { Icon, ICONS } from '@ledge/ui/ui/icons';
import { LangProvider, type Lang } from '../../../apps/desktop/src/i18n/lang';
import { loadMessages } from '../../../apps/desktop/src/i18n/messages';
import { mainOrder } from '../../../apps/desktop/src/nav/agents';
import { ScreenKeysContext } from '../../../apps/desktop/src/nav/screenKeys';
import type { NavAction, NavState } from '../../../apps/desktop/src/nav/state';
import { Sidebar } from '../../../apps/desktop/src/shell/Sidebar';
import { TitleBar } from '../../../apps/desktop/src/shell/TitleBar';
import { TopBar } from '../../../apps/desktop/src/shell/TopBar';
import { setTheme, useAppearance, useTheme, type Theme } from '../../../apps/desktop/src/shell/theme';
import { createSessionMemory } from '../../../apps/desktop/src/session/memory';
import { SessionPage } from '../../../apps/desktop/src/session/SessionPage';
import { ConversationContext } from './context';
import { conversation } from './conversation';
import { ConversationPane, type PaneTabId } from './ConversationPane';
import { cleared, NOVA, oneSided, OTTO, PROJECTS, RAW_PEER, sessionsFor, STEP_LABELS, STEPS, threadsAt } from './data';

type Scenario = 'both' | 'oneSided' | 'empty';
type Width = 'wide' | 'narrow';

const query = new URLSearchParams(location.search);
const pick = <T extends string>(key: string, values: readonly T[], fallback: T): T => (values as readonly string[]).includes(query.get(key) ?? '') ? query.get(key) as T : fallback;

// Nothing is sent: the session page reads documents through the client only in the pane's document tab, which is not the app's here.
const client = { send: () => {} } as unknown as DaemonClient;
const memory = createSessionMemory();
const machines = [{ id: 'local', label: 'Local', status: 'open', ready: true, recents: [], sessions: [], launcher: null }] as unknown as MachineState[];
const projectIdOf = (s: Session) => projectOf(s, PROJECTS);
const noop = () => {};
const decisions = { busy: () => false, landed: null, decide: () => false, reply: () => false };
const actions = { request: noop, resume: noop, restore: noop, pending: null, confirm: noop, cancel: noop, allowed: () => true };
const filing = { dragging: null, over: null, seated: null, dragProps: () => ({ draggable: true as const, onDragStart: noop, onDragEnd: noop }), dropProps: () => ({ onDragOver: noop, onDragLeave: noop, onDrop: noop }), file: noop, markSeated: noop };
const screenKeys = { current: null };

const LABELS = {
  fr: {
    title: 'Conversation entre agents', scenario: 'État', width: 'Largeur', theme: 'Thème', lang: 'Langue',
    scenarios: { both: 'Les deux fils', oneSided: 'Pair inconnu', empty: 'Vide' }, widths: { wide: 'Large', narrow: 'Étroite' },
    themes: { dark: 'Sombre', light: 'Clair' }, next: 'Simuler la suite', reset: 'Recommencer', done: 'Fin de la simulation',
    novaPage: 'Maquette : ouvrirait la page de Nova, le message allumé dans son fil.', other: 'Maquette : cette action n’est pas simulée.'
  },
  en: {
    title: 'Conversation between agents', scenario: 'State', width: 'Width', theme: 'Theme', lang: 'Language',
    scenarios: { both: 'Both threads', oneSided: 'Unknown peer', empty: 'Empty' }, widths: { wide: 'Wide', narrow: 'Narrow' },
    themes: { dark: 'Dark', light: 'Light' }, next: 'Simulate next', reset: 'Start over', done: 'End of the simulation',
    novaPage: 'Mockup: would open Nova’s page, the message lit in its thread.', other: 'Mockup: this action is not simulated.'
  }
};

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange(v: T): void }): JSX.Element {
  return (
    <div className="mock-field">
      <span>{label}</span>
      <div className="view-switch" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => <button key={v} type="button" role="radio" aria-checked={v === value} aria-selected={v === value} onClick={() => onChange(v)}>{text}</button>)}
      </div>
    </div>
  );
}

function App(): JSX.Element {
  useAppearance();
  const theme = useTheme();
  const [lang, setLang] = useState<Lang>(pick('lang', ['fr', 'en'] as const, 'fr'));
  const [scenario, setScenario] = useState<Scenario>(pick('state', ['both', 'oneSided', 'empty'] as const, 'both'));
  const [width, setWidth] = useState<Width>(pick('width', ['wide', 'narrow'] as const, 'wide'));
  const [step, setStep] = useState(Math.min(STEPS, Number(query.get('step') ?? 0) || 0));
  const stamps = useRef<string[]>([]);
  const [tabs, setTabs] = useState<PaneTabId[]>(['doc', 'conv']);
  const [active, setActive] = useState<PaneTabId>('conv');
  const [split, setSplit] = useState(0.5);
  const [aim, setAim] = useState<{ item?: string; n: number }>({ n: 0 });
  const [notice, setNotice] = useState('');
  const [seen, setSeen] = useState(0);
  const L = LABELS[lang];
  const stepText = step < STEPS ? `${step + 1}/${STEPS} · ${STEP_LABELS[lang][step]}` : L.done;

  // The fleet as the daemon would list it: Nova is not one of this machine's sessions when the peer is unknown.
  const sessions = useMemo(() => sessionsFor(scenario !== 'oneSided'), [scenario]);
  useLayoutEffect(() => { daemonStore.apply({ type: 'snapshot', sessions, machines: [], recents: [] } as never); daemonStore.setStatus('open'); }, [sessions]);
  const order = useMemo(() => mainOrder(sessions, PROJECTS), [sessions]);

  const threads = useMemo(() => {
    if (scenario === 'empty') return cleared();
    const both = threadsAt(step, stamps.current);
    return scenario === 'oneSided' ? oneSided(both) : both;
  }, [scenario, step]);
  const peer = scenario === 'oneSided' ? null : NOVA;
  const peerName = peer?.name ?? RAW_PEER;
  const peerKey = peer ? 'nova' : RAW_PEER;
  const bubbles = useMemo(() => conversation(threads.otto, peer ? threads.nova : undefined, peerKey, 'otto'), [threads, peer, peerKey]);
  const paneOpen = tabs.length > 0;
  // What the reader has seen of the conversation: all of it while its tab is the active one.
  if (paneOpen && active === 'conv' && seen !== bubbles.length) setSeen(bubbles.length);

  const openConversation = useCallback(() => { setTabs(ts => (ts.includes('conv') ? ts : [...ts, 'conv'])); setActive('conv'); }, []);
  // Its neighbour takes over, as in SidePane.
  const closeTab = useCallback((id: PaneTabId) => {
    const next = tabs.filter(x => x !== id);
    setTabs(next);
    if (active === id && next.length > 0) setActive(next[0]!);
  }, [tabs, active]);
  const link = useMemo(() => ({ open: paneOpen && active === 'conv' && tabs.includes('conv') ? peerKey : null, onOpen: openConversation }), [paneOpen, active, tabs, peerKey, openConversation]);
  const dispatch = useCallback((a: NavAction) => {
    if (a.type === 'open' && a.id === NOVA.id) setNotice(LABELS[lang].novaPage);
    else if (a.type !== 'reconcile') setNotice(LABELS[lang].other);
  }, [lang]);
  // « dans le fil »: the page is mounted again on the message (nav.place.item), which it brings into view and lights, as
  // « voir son fil » does from another agent's page. Narrow, the pane lay over the thread: its tab closes first.
  const light = useCallback((item: string, covered: boolean) => {
    if (covered) closeTab('conv');
    setAim(x => ({ item, n: x.n + 1 }));
  }, [closeTab]);

  const nav: NavState = useMemo(() => ({
    place: { kind: 'session', id: OTTO.id, view: 'atelier', project: 'all', ...(aim.item !== undefined && { item: aim.item }) },
    modal: null, chat: false, chatFocus: 0, fullscreen: false, helpers: true, paused: false
  }), [aim]);

  // Escape closes the pane's active tab (the page's own key, as in the app).
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && paneOpen) { e.preventDefault(); closeTab(active); } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [paneOpen, active, closeTab]);

  // The pane goes where the app puts it: inside the page's split, after the thread.
  const frame = useRef<HTMLDivElement>(null);
  const [split$, setSplit$] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setSplit$(frame.current?.querySelector<HTMLElement>('.session-split') ?? null); }, [aim.n, scenario]);

  const next = () => {
    if (step >= STEPS) return;
    stamps.current[step] ??= new Date().toISOString();
    setStep(step + 1);
  };
  const reset = (to: Scenario = scenario) => { stamps.current = []; setStep(0); setScenario(to); setTabs(['doc', 'conv']); setActive('conv'); setNotice(''); setAim(x => ({ n: x.n + 1 })); };

  return (
    <LangProvider lang={lang}>
      <ScreenKeysContext.Provider value={screenKeys}>
        <div className="mock-root">
          <header className="mock-bar">
            <span className="titlebar-mark">Ledge<span className="brand-dot">.</span></span>
            <span className="mock-title">{L.title}</span>
            <Segmented label={L.scenario} value={scenario} options={(['both', 'oneSided', 'empty'] as const).map(v => [v, L.scenarios[v]] as const)} onChange={v => reset(v)} />
            <Segmented label={L.width} value={width} options={(['wide', 'narrow'] as const).map(v => [v, L.widths[v]] as const)} onChange={setWidth} />
            <Segmented label={L.theme} value={theme} options={(['dark', 'light'] as const).map(v => [v, L.themes[v]] as const)} onChange={(v: Theme) => setTheme(v)} />
            <Segmented label={L.lang} value={lang} options={[['fr', 'FR'], ['en', 'EN']] as const} onChange={setLang} />
            <span className="spacer" />
            {scenario !== 'empty' && (
              <>
                <span className="mock-step" title={stepText}>{stepText}</span>
                <Button variant="outline" size="sm" onClick={next} disabled={step >= STEPS}><Icon d={ICONS.chevronRight.d} size={13} />{L.next}</Button>
                <Button variant="ghost" size="sm" onClick={() => reset()}>{L.reset}</Button>
              </>
            )}
          </header>
          <div className={`mock-stage ${width}`}>
            <div className="mock-window" ref={frame}>
              <TitleBar dispatch={dispatch} sessions={sessions} waits={new Map()} blocked={false} />
              <div className="application">
                <Sidebar nav={nav} dispatch={dispatch} sessions={sessions} archived={[]} machines={machines} projects={PROJECTS} order={order} projectIdOf={projectIdOf}
                  filing={filing as never} actions={actions as never} decisions={decisions} waits={new Map()} menu={{ open: noop }} onAsk={noop} onTerminal={noop} revealArchives={0} revealCurrent={0} />
                <section className="workspace">
                  <TopBar nav={nav} dispatch={dispatch} session={OTTO} helper={null} projects={PROJECTS} projectIdOf={projectIdOf} terminal={false} onTerminal={noop}
                    manage={{ open: false, onOpen: noop }} />
                  <ConversationContext.Provider value={link}>
                    <div className="conversation-workspace">
                      <SessionPage key={`${scenario}-${aim.n}`} session={OTTO} helper={null} items={threads.otto} nav={nav} dispatch={dispatch} decisions={decisions} waits={new Map()}
                        actions={actions as never} memory={memory} notify={setNotice} onShowKids={noop} onTerminal={noop} split={split} onSplit={setSplit} client={client} />
                    </div>
                  </ConversationContext.Provider>
                </section>
              </div>
              {split$ && paneOpen && createPortal(
                <ConversationPane tabs={tabs} active={active} onActive={setActive} onClose={closeTab} split={split} onSplit={setSplit}
                  self={OTTO} peer={peer} peerName={peerName} bubbles={bubbles} unseen={bubbles.length - seen}
                  onLight={light} onOpenPeer={() => setNotice(L.novaPage)} />,
                split$
              )}
            </div>
          </div>
          {notice && <div className="mock-notice" role="status" onClick={() => setNotice('')}>{notice} <Icon d={ICONS.close.d} size={12} /></div>}
        </div>
      </ScreenKeysContext.Provider>
    </LangProvider>
  );
}

// Not a top-level await: the bundle inlines fr.ts / en.ts after this module's code, so they are read once it has run.
void Promise.all([loadMessages('fr'), loadMessages('en')]).then(() => {
  setTheme(pick('theme', ['dark', 'light'] as const, 'dark'));
  createRoot(document.getElementById('root')!).render(<App />);
});
