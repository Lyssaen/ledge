import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChatTurn, Session } from '../../../packages/protocol/src/index';
import { Bot } from '../../../apps/overlay/src/bots/Bot';
import type { BotState } from '../../../apps/overlay/src/bots/poseFor';
import { ResidentMascot } from '../../../apps/overlay/src/bots/ResidentMascot';
import { Bubble, type BubbleAck } from '../../../apps/overlay/src/surface/Bubble';
import { ChatView } from '../../../apps/overlay/src/surface/ChatView';
import { SIZES } from '../../../apps/overlay/src/surface/geometry';
import { Shoulders } from '../../../apps/overlay/src/surface/Shoulders';
import { Badge } from '../../../apps/overlay/src/ui/Badge';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { LangProvider } from '../../../apps/overlay/src/i18n/lang';

type Tool = 'claude' | 'codex' | 'cursor';
type Machine = 'local' | 'dev' | 'studio';
type Agent = { id: string; name: string; tool: Tool; project: string; machine: Machine; task: string; state: BotState };
type Ask = { id: string; agent: string; kind: 'approval' | 'question'; text: string; options?: string[] };
type Notice = { key: number; kind: 'done' | 'error' | 'offline'; agent?: string; title: string; sub: string };
type Mode = 'handle' | 'bubble' | 'name' | 'chat';
type Scenario = 'idle' | 'approval' | 'question' | 'done' | 'error' | 'offline' | 'queue' | 'name' | 'pip' | 'chat';
type Proposal = 'filet' | 'points' | 'mascot' | 'count';
type NotchAgent = { id: string; name: string; task: string; state: BotState };

const MACHINES: Record<Machine, string> = { local: 'PC local', dev: 'Dev SSH', studio: 'Studio SSH' };
const ORDER: Machine[] = ['local', 'dev', 'studio'];
const CHAT_H = 520;
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
  otto: { id: 'ask-otto', agent: 'otto', kind: 'approval', text: 'pnpm --filter @ledge/overlay test -- --run' },
  nova: { id: 'ask-nova', agent: 'nova', kind: 'question', text: 'Migration progressive ou courte fenêtre de maintenance ?', options: ['Migration progressive', 'Courte fenêtre de maintenance'] },
  lou: { id: 'ask-lou', agent: 'lou', kind: 'approval', text: 'pnpm up --latest && pnpm test' },
};
const NOTICES: Record<'done' | 'error' | 'offline', Omit<Notice, 'key'>> = {
  done: { kind: 'done', agent: 'sage', title: 'Sage a terminé', sub: '2 min de travail · Commerce' },
  error: { kind: 'error', agent: 'iris', title: 'Iris s’est arrêtée sur une erreur', sub: 'Le serveur de paiement de test ne répond plus (ECONNREFUSED)' },
  offline: { kind: 'offline', title: 'Studio SSH est hors ligne', sub: 'Ash est en pause jusqu’au retour de la machine' },
};
const SCENARIOS: { id: Scenario; label: string; hint: string }[] = [
  { id: 'idle', label: 'Repos', hint: 'L’encoche choisie, au calme' },
  { id: 'approval', label: 'Accord', hint: 'Bulle de l’overlay, 440 px' },
  { id: 'question', label: 'Question', hint: 'Bulle de l’overlay, 440 px' },
  { id: 'done', label: 'Terminé', hint: 'Bulle de l’overlay, 440 px' },
  { id: 'error', label: 'Erreur', hint: 'Même cadre, 440 px' },
  { id: 'offline', label: 'Hors ligne', hint: 'Même cadre, 440 px' },
  { id: 'queue', label: 'File', hint: 'Bulle et « +2 autres »' },
  { id: 'name', label: 'Un nom', hint: 'Le point reste court' },
  { id: 'pip', label: 'Pastille', hint: 'Le point rouge reste sur l’encoche' },
  { id: 'chat', label: 'Chat', hint: 'Le chat de l’overlay, 480 px' },
];
const PROPOSALS: { id: Proposal; label: string; hint: string }[] = [
  { id: 'filet', label: 'Filet', hint: '76 × 10 px · les points seulement' },
  { id: 'points', label: 'Points', hint: '79 × 16 px · sans mascotte' },
  { id: 'mascot', label: 'Mascotte', hint: '23 × 20 px · une pastille s’il vous attend' },
  { id: 'count', label: 'Compte', hint: '35 × 20 px · Ledge et un nombre' },
];
const HOT_ORDER: BotState[] = ['approval', 'error', 'question', 'readonly'];
const KEEP: [string, string][] = [
  ['Encoche', 'Quatre propositions, toutes plus petites que la barre de 141 × 28 px : filet 76 × 10, points 79 × 16, mascotte 23 × 20, compte 35 × 20.'],
  ['Notifications', 'La bulle de l’overlay sur main, 440 px : accord, question, terminé, et « +2 autres » quand la file a plusieurs demandes.'],
  ['Chat', 'Le chat de l’overlay, 480 px de large. Un clic sur l’encoche l’ouvre. Retour et fermer replient l’encoche.'],
];
const HANDOFF: [string, string][] = [
  ['Ouvrir', 'Le lien et le bouton Ouvrir de la bulle partent vers Ledge Desktop. Ici, un toast le dit.'],
  ['Pastille', 'Le point rouge reste sur l’encoche. L’installation s’ouvre dans Desktop.'],
  ['Un agent sans demande', 'Un clic sur son point tient en une ligne. La session, elle, s’ouvre dans Desktop.'],
];
const DROPPED: [string, string][] = [
  ['Les têtes des agents', 'Les visages des agents quittent l’encoche. Ils reviennent dans la bulle et dans le chat, à leur taille.'],
  ['Le menu de l’île', 'Réglages, Ne pas déranger et Quitter restent dans Ledge Desktop.'],
];

const now = () => new Date().toISOString();
const SEED: ChatTurn[] = [{
  qid: 'seed', question: 'Qu’est-ce qui attend ma décision ?', askedAt: now(), answeredAt: now(), steps: [{ kind: 'sessions' }],
  answer: '### Rien de bloquant pour l’instant\n\n- **Otto** prépare les tests et demandera ton accord.\n- **Nova** aura besoin de ton choix sur la migration.',
}];

function sessionFor(a: Agent, pending?: Session['pending'], state?: Session['state']): Session {
  return {
    id: a.id, name: a.name, tool: a.tool, cwd: `/workspace/${a.project.toLowerCase()}`, project: a.project, title: a.task, topic: a.task,
    tmuxSession: a.id, state: state ?? (pending?.kind === 'question' ? 'waiting_input' : pending ? 'waiting_permission' : a.state === 'error' ? 'error' : a.state === 'idle' ? 'idle' : 'working'),
    helpers: [], startedAt: now(), lastActivityAt: now(), source: 'launcher', pending,
  };
}

function hottest(states: BotState[]): BotState | null {
  return HOT_ORDER.find(s => states.includes(s)) ?? null;
}

function Notch({ proposal, groups, pip, pendingCount, theme, reduced, preview = false, onOpenChat, onDot, onPip }: {
  proposal: Proposal; groups: NotchAgent[][]; pip: boolean; pendingCount: number; theme: 'dark' | 'light'; reduced: boolean; preview?: boolean;
  onOpenChat: () => void; onDot: (id: string) => void; onPip: () => void;
}) {
  const Tag = preview ? 'span' : 'div';
  const agents = groups.flat();
  const signal = hottest(agents.map(a => a.state));
  const showMascot = proposal === 'mascot' || proposal === 'count';
  const strip = proposal === 'filet' || proposal === 'points';
  const tally = pendingCount > 0 ? pendingCount : agents.length;
  const mark = (a: NotchAgent) => {
    const hot = a.state === 'approval' || a.state === 'question' || a.state === 'error';
    const hollow = a.state === 'readonly';
    const props = { className: 'dot', 'data-state': a.state, 'data-hot': hot || undefined, 'data-hollow': hollow || undefined };
    if (preview) return <span key={a.id} {...props} />;
    return <button key={a.id} type="button" {...props} aria-label={`${a.name}, ${STATE_LABEL[a.state]}, ouvrir`} title={`${a.name} · ${a.task}`} onClick={e => { e.stopPropagation(); onDot(a.id); }} />;
  };
  return <Tag className={`handle ${proposal === 'count' ? 'notch-count' : proposal}`} data-proposal={proposal} aria-hidden={preview || undefined}>
    {!preview && <button type="button" className="handle-open" tabIndex={strip ? 0 : -1} aria-hidden={strip ? undefined : true} aria-label="Ouvrir le chat" onClick={onOpenChat} />}
    {showMascot && <span className="resident">
      {preview ? <ResidentMascot size={proposal === 'count' ? 12 : 14} theme={theme} reducedMotion={reduced} center={{ x: 0, y: 0 }} /> : <button type="button" data-resident aria-label="Ledge, ouvrir" title="Ouvrir le chat" onClick={onOpenChat}>
        <ResidentMascot size={proposal === 'count' ? 12 : 14} theme={theme} reducedMotion={reduced} center={{ x: 0, y: 0 }} />
      </button>}
      {pip && (preview ? <span className="notch-pip" /> : <button type="button" className="notch-pip" data-update-pip="new" aria-label="Ledge 0.6.0 est prêt" title="Ledge 0.6.0 est prêt" onClick={e => { e.stopPropagation(); onPip(); }} />)}
      {!pip && proposal === 'mascot' && signal && <span className="notch-pip notch-signal" data-state={signal} aria-hidden="true" />}
    </span>}
    {strip && groups.map(g => <Fragment key={g[0].id}>
      <span className="sep" aria-hidden="true" />
      <span className="dots">{g.map(mark)}</span>
    </Fragment>)}
    {strip && pip && (preview ? <span className="notch-pip" /> : <button type="button" className="notch-pip" data-update-pip="new" aria-label="Ledge 0.6.0 est prêt" title="Ledge 0.6.0 est prêt" onClick={e => { e.stopPropagation(); onPip(); }} />)}
    {proposal === 'count' && (preview
      ? <span className="tally" data-hot={pendingCount > 0 || undefined} data-state={pendingCount > 0 ? signal ?? undefined : undefined}>{tally}</span>
      : <button type="button" className="tally" data-hot={pendingCount > 0 || undefined} data-state={pendingCount > 0 ? signal ?? undefined : undefined} aria-label={pendingCount > 0 ? `${pendingCount} en attente, ouvrir le chat` : `${tally} sessions, ouvrir le chat`} onClick={onOpenChat}>{tally}</button>)}
  </Tag>;
}

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

/** Width and height of the resting notch, whose content is in normal flow. */
function useBox(ref: React.RefObject<HTMLDivElement | null>, active: boolean, key: unknown) {
  const [box, setBox] = useState({ w: 150, h: 28 });
  useLayoutEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      setBox(prev => prev.w === Math.ceil(r.width) && prev.h === Math.ceil(r.height) ? prev : { w: Math.ceil(r.width), h: Math.ceil(r.height) });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, key]);
  return box;
}

function App() {
  const reduced = useReducedMotion();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const [proposal, setProposal] = useState<Proposal>('filet');
  const [scenario, setScenario] = useState<Scenario>('idle');
  const [mode, setMode] = useState<Mode>('handle');
  const [agents, setAgents] = useState(AGENTS);
  const [pending, setPending] = useState<Ask[]>([]);
  const [shownId, setShownId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [nameId, setNameId] = useState<string | null>(null);
  const [offline, setOffline] = useState<Machine[]>([]);
  const [pip, setPip] = useState(false);
  const [bubbleAck, setBubbleAck] = useState<BubbleAck>(null);
  const [held, setHeld] = useState(false);
  const [chat, setChat] = useState<ChatTurn[]>(SEED);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const [live, setLive] = useState('');
  const [slotH, setSlotH] = useState(180);
  const contentRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const ackTimer = useRef<number | undefined>(undefined);

  const agent = (id: string) => agents.find(a => a.id === id)!;
  const ask = pending.find(p => p.id === shownId) ?? null;
  const waiting = pending.filter(p => p.id !== shownId);

  useEffect(() => { if (!toast) return; const t = window.setTimeout(() => setToast(null), 3600); return () => window.clearTimeout(t); }, [toast]);
  useEffect(() => () => window.clearTimeout(ackTimer.current), []);
  useLayoutEffect(() => {
    if (mode !== 'bubble') return;
    const el = slotRef.current;
    if (!el) return;
    const read = () => {
      const inner = (el.firstElementChild as HTMLElement | null) ?? el;
      const h = Math.ceil(inner.offsetHeight);
      if (h > 0) setSlotH(prev => prev === h ? prev : h);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [mode, shownId, notice?.key, bubbleAck]);

  const announce = (text: string) => setLive(text);
  const openDesktop = (text: string) => { setToast({ key: Date.now(), text }); announce(`Ledge Desktop. ${text}`); };
  const fold = () => { setMode('handle'); setNameId(null); setNotice(null); setShownId(null); setBubbleAck(null); };
  const openChat = () => { setChat(c => c.length ? c : SEED); setMode('chat'); setNotice(null); setShownId(null); setNameId(null); setToast(null); };

  const showAsk = (a: Ask | null) => {
    setBubbleAck(null); setNameId(null); setNotice(null); setShownId(a?.id ?? null); setMode(a ? 'bubble' : 'handle');
    if (a) announce(a.kind === 'approval' ? `${agent(a.agent).name} attend votre accord. ${a.text}` : `${agent(a.agent).name} a une question. ${a.text}`);
  };

  const run = (s: Scenario) => {
    window.clearTimeout(ackTimer.current);
    setScenario(s); setBubbleAck(null); setHeld(false); setNameId(null); setShownId(null); setNotice(null); setToast(null);
    setAgents(AGENTS.map(a => s === 'error' && a.id === 'iris' ? { ...a, state: 'error' } : s === 'done' && a.id === 'sage' ? { ...a, state: 'idle' } : a));
    setOffline(s === 'offline' ? ['studio'] : []);
    setPip(s === 'pip');
    const queue = s === 'approval' ? [ASKS.otto] : s === 'question' ? [ASKS.nova] : s === 'queue' ? [ASKS.otto, ASKS.nova, ASKS.lou] : [];
    setPending(queue);
    if (s === 'chat') { openChat(); return; }
    if (s === 'name') { setMode('name'); setNameId('rio'); announce('Rio · version 0.6'); return; }
    if (s === 'done' || s === 'error' || s === 'offline') {
      const n = { ...NOTICES[s], key: Date.now() };
      setNotice(n); setMode('bubble'); announce(`${n.title}. ${n.sub}`);
      return;
    }
    if (queue.length) showAsk(queue[0]);
    else setMode('handle');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const advance = (current: Ask) => {
    window.clearTimeout(ackTimer.current);
    ackTimer.current = window.setTimeout(() => {
      setPending(prev => {
        const rest = prev.filter(p => p.id !== current.id);
        showAsk(rest[0] ?? null);
        return rest;
      });
    }, reduced ? 400 : 700);
  };
  const decide = (a: Ask) => { if (bubbleAck) return; setBubbleAck('confirmed'); advance(a); };

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
      if (el.closest('.min-scenarios, .min-top, .gallery') || el.closest('input, textarea')) return;
      if (mode !== 'bubble' || !ask || bubbleAck || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' && el.tagName === 'BUTTON') return;
      const k = e.key.toLowerCase();
      if (ask.kind === 'approval' && (k === 'y' || e.key === 'Enter' || k === 'n')) { e.preventDefault(); decide(ask); }
      else if (ask.kind === 'question' && e.key === 'Enter') { e.preventDefault(); decide(ask); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const visual = (a: Agent): BotState => {
    if (offline.includes(a.machine)) return 'readonly';
    const p = pending.find(x => x.agent === a.id);
    return p ? p.kind : a.state;
  };
  const groups = ORDER.map(m => agents.filter(a => a.machine === m)).filter(g => g.length).map(g => [...g.filter(a => pending.some(p => p.agent === a.id)), ...g.filter(a => !pending.some(p => p.agent === a.id))].map(a => ({ id: a.id, name: a.name, task: a.task, state: visual(a) })));
  const named = nameId ? agent(nameId) : null;
  const resting = useBox(contentRef, mode === 'handle' || mode === 'name', `${proposal}-${mode}-${nameId}-${pip}-${pending.map(p => p.id).join()}-${agents.map(a => a.state).join()}-${offline.join()}`);
  const box = mode === 'chat' ? { w: SIZES.sessionW, h: CHAT_H } : mode === 'bubble' ? { w: SIZES.bubbleW, h: slotH } : resting;
  const motion = reduced ? 'none' : 'left 260ms cubic-bezier(.2,.8,.2,1), width 260ms cubic-bezier(.2,.8,.2,1)';
  const sessions = agents.map(a => sessionFor(a));

  const bubbleSession = ask ? sessionFor(agent(ask.agent), { kind: ask.kind === 'question' ? 'question' : 'permission', text: ask.text, options: ask.options, source: 'hook' })
    : notice?.kind === 'done' && notice.agent ? sessionFor(agent(notice.agent), undefined, 'idle') : null;

  const galleryGroups = ORDER.map(m => AGENTS.filter(a => a.machine === m)).filter(g => g.length).map(g => g.map(a => ({
    id: a.id, name: a.name, task: a.task,
    state: (a.id === 'otto' ? 'approval' : a.id === 'nova' ? 'question' : 'working') as BotState,
  })));

  return <LangProvider lang="fr"><div className="min" data-scenario={scenario} data-mode={mode} data-proposal={proposal} data-reduced={reduced || undefined}>
    <header className="min-top">
      <div><h1>L’île, quatre encoches</h1><p>Quatre encoches plus petites. La bulle reste à 440 px, le chat à 480 px.</p></div>
      <span className="min-mock">Maquette · données simulées</span>
      <Button variant="outline" size="sm" aria-pressed={theme === 'light'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</Button>
    </header>

    <nav className="gallery" aria-label="Propositions d’encoche">
      {PROPOSALS.map(p => <button key={p.id} type="button" data-proposal={p.id} aria-pressed={proposal === p.id} onClick={() => setProposal(p.id)}>
        <span className="gallery-stage">
          <span className="gallery-notch" data-notch={p.id}>
            <Notch proposal={p.id} groups={galleryGroups} pip={false} pendingCount={2} theme={theme} reduced={reduced} preview onOpenChat={() => {}} onDot={() => {}} onPip={() => {}} />
          </span>
        </span>
        <strong>{p.label}</strong>
        <small>{p.hint}</small>
      </button>)}
    </nav>

    <nav className="min-scenarios" aria-label="Scénarios">
      {SCENARIOS.map(s => <button key={s.id} type="button" data-scenario-btn={s.id} aria-pressed={scenario === s.id} onClick={() => run(s.id)}><strong>{s.label}</strong><small>{s.hint}</small></button>)}
    </nav>

    <div className="min-grid">
      <section className="stage" aria-label="Bureau simulé">
        <div className="stage-windows" aria-hidden="true"><div className="win win-term"><i /><i /><i /><i /><i /></div><div className="win win-editor"><i /><i /><i /><i /></div></div>
        <div className="island-wrap" style={{ width: box.w }}>
          <Shoulders left={0} w={box.w} strip={mode === 'handle'} transition={motion} opacity={1} />
          <div className="island" data-mode={mode} data-notch={mode === 'handle' ? proposal : undefined} data-surface style={{ width: box.w, height: box.h }} onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}>
            <div ref={contentRef} className="island-content" key={`${mode}-${shownId ?? ''}-${notice?.key ?? ''}-${nameId ?? ''}`}>
              {mode === 'handle' && <Notch proposal={proposal} groups={groups} pip={pip} pendingCount={pending.length} theme={theme} reduced={reduced} onOpenChat={openChat} onDot={openDot} onPip={() => openDesktop('Ouverture des mises à jour')} />}

              {mode === 'bubble' && (ask || notice?.kind === 'done') && bubbleSession && <div ref={slotRef} style={{ position: 'relative', width: SIZES.bubbleW, height: slotH }}>
                <Bubble session={bubbleSession} moreCount={waiting.length} visible paused={reduced || held} ack={bubbleAck} kind={notice?.kind === 'done' ? 'finished' : 'ask'} elapsedMs={notice?.kind === 'done' ? 120000 : undefined}
                  theme={theme} reducedMotion={reduced} onOpen={() => { openDesktop(`Ouverture de la session de ${bubbleSession.name}`); fold(); }} onDismiss={fold}
                  onDecide={() => ask && decide(ask)} onReply={() => ask && decide(ask)} />
              </div>}

              {mode === 'bubble' && notice && notice.kind !== 'done' && <div ref={slotRef}><NoticeCard notice={notice} agent={notice.agent ? agent(notice.agent) : undefined} theme={theme} reduced={reduced} held={held}
                onDone={fold} onOpen={() => { openDesktop(notice.agent ? `Ouverture de la session de ${agent(notice.agent).name}` : 'Ouverture des machines'); fold(); }} /></div>}

              {mode === 'name' && named && <button type="button" className="row row-hit" data-kind="name" title={`${named.task} · ${named.project} · ${MACHINES[named.machine]}`} onClick={() => { openDesktop(`Ouverture de la session de ${named.name}`); fold(); }}>
                <Bot tool={named.tool} state={visual(named)} pose={1} size={16} theme={theme} seed={named.id} reducedMotion={reduced} frozen={offline.includes(named.machine)} />
                <strong>{named.name} · {named.id === 'rio' ? 'version 0.6' : named.task}</strong>
              </button>}

              {mode === 'chat' && <ChatView visible theme={theme} turns={chat} live={null} sessions={sessions} offline={null} reducedMotion={reduced}
                onAsk={question => setChat(c => [...c, { qid: 'q' + Date.now(), question, askedAt: now(), answeredAt: now(), steps: [{ kind: 'sessions' }], answer: '### Réponse simulée\n\nConstruite à partir des sessions de la maquette.' }])}
                onCancel={() => {}} onReset={() => setChat([])} onBack={fold} onClose={fold} onOpenSession={id => openDesktop(`Ouverture de la session de ${agent(id).name}`)} onTerminal={id => openDesktop(`Ouverture du terminal de ${agent(id).name}`)} />}
            </div>
          </div>
        </div>
        {toast && <div key={toast.key} className="toast" role="status"><span className="toast-app"><Icon size={14} {...ICONS.external} /></span><span><strong>Ledge Desktop</strong><small>{toast.text}</small></span></div>}
        <div className="taskbar" aria-hidden="true"><i /><i /><i /><i className="tb-ledge" /><i /></div>
        <div className="sr-only" aria-live="polite" role="status">{live}</div>
      </section>

      <aside className="scope" aria-labelledby="scope-title">
        <h2 id="scope-title">Quatre encoches, mêmes notifications</h2>
        <p>Seule l’encoche au repos change. La bulle (440 px) et le chat (480 px) gardent la taille de l’overlay sur main. Cette page ne change pas l’application.</p>
        <h3><span className="dot-key keep" />Comme sur main</h3>
        <ul>{KEEP.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
        <h3><span className="dot-key move" />Part dans Ledge Desktop</h3>
        <ul>{HANDOFF.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
        <h3><span className="dot-key drop" />En moins que l’île sobre</h3>
        <ul>{DROPPED.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
        <p className="scope-keys">Échap replie · Y ou N décident dans la bulle d’accord · Entrée répond à une question</p>
      </aside>
    </div>
  </div></LangProvider>;
}

function NoticeCard({ notice, agent, theme, reduced, held, onDone, onOpen }: { notice: Notice; agent?: Agent; theme: 'dark' | 'light'; reduced: boolean; held: boolean; onDone: () => void; onOpen: () => void }) {
  const state: BotState = notice.kind === 'error' ? 'error' : 'readonly';
  return <div className="main-notice" data-kind={notice.kind} onMouseEnter={() => {}} onMouseLeave={() => {}}>
    <div className="main-notice-who">
      {agent ? <Bot tool={agent.tool} state={state} pose={1} size={40} theme={theme} seed={agent.id} reducedMotion={reduced} frozen={notice.kind === 'offline'} /> : <span className="machine-dot" aria-hidden="true" style={{ width: 40, height: 40, margin: 0 }} />}
      <a href="#open" onClick={e => { e.preventDefault(); onOpen(); }}><strong>{notice.title}</strong><small>{notice.sub}</small></a>
      <Icon size={16} {...ICONS.chevronRight} />
    </div>
    <div className="main-notice-actions">
      <Badge state={state} label={notice.kind === 'error' ? 'Erreur' : 'Hors ligne'} />
      <span style={{ flex: 1 }} />
      <Button variant="outline" size="sm" onClick={onDone}>OK</Button>
      <Button variant="primary" size="sm" onClick={onOpen}>Ouvrir</Button>
    </div>
    <span className="drain" aria-hidden="true" style={{ left: 16, right: 16, height: 2 }}><i data-run={reduced || held ? undefined : true} onAnimationEnd={onDone} /></span>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
