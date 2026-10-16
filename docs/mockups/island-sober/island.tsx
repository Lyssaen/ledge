import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bot } from '../../../apps/overlay/src/bots/Bot';
import type { BotState } from '../../../apps/overlay/src/bots/poseFor';
import { Handle, type HandleBot } from '../../../apps/overlay/src/surface/Handle';
import { Shoulders } from '../../../apps/overlay/src/surface/Shoulders';
import { ISLAND, SIZES, islandOrder, pipeBefore } from '../../../apps/overlay/src/surface/geometry';
import { ChatView } from '../../../apps/overlay/src/surface/ChatView';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Badge } from '../../../apps/overlay/src/ui/Badge';
import { Kbd } from '../../../apps/overlay/src/ui/Kbd';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { LangProvider } from '../../../apps/overlay/src/i18n/lang';
import type { ChatTurn, Session } from '../../../packages/protocol/src/index';

type Tool = 'claude' | 'codex' | 'cursor';
type Machine = 'local' | 'dev' | 'studio';
type Agent = { id: string; name: string; tool: Tool; project: string; machine: Machine; task: string; state: BotState };
type Ask = { id: string; agent: string; kind: 'approval' | 'question'; text: string; detail: string; command?: string; cwd?: string; options?: string[] };
type Notice = { key: number; kind: 'done' | 'error' | 'offline'; agent?: string; title: string; sub: string };
type Mode = 'handle' | 'ask' | 'notice' | 'peek' | 'chat';
type Scenario = 'idle' | 'approval' | 'question' | 'done' | 'error' | 'offline' | 'queue' | 'chat' | 'menu';

const MACHINES: Record<Machine, string> = { local: 'PC local', dev: 'Dev SSH', studio: 'Studio SSH' };
const TOOLS: Record<Tool, string> = { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' };
const AGENTS: Agent[] = [
  { id: 'otto', name: 'Otto', tool: 'claude', project: 'Ledge', machine: 'local', task: 'Concevoir la navigation desktop', state: 'working' },
  { id: 'rio', name: 'Rio', tool: 'cursor', project: 'Ledge', machine: 'local', task: 'Préparer la version 0.6', state: 'working' },
  { id: 'sage', name: 'Sage', tool: 'claude', project: 'Commerce', machine: 'local', task: 'Corriger le calcul de la TVA', state: 'working' },
  { id: 'nova', name: 'Nova', tool: 'codex', project: 'Commerce', machine: 'dev', task: 'Préparer la migration des commandes', state: 'working' },
  { id: 'iris', name: 'Iris', tool: 'cursor', project: 'Commerce', machine: 'dev', task: 'Adapter le paiement', state: 'working' },
  { id: 'lou', name: 'Lou', tool: 'codex', project: 'Mobile', machine: 'dev', task: 'Mettre à jour les dépendances', state: 'working' },
  { id: 'ash', name: 'Ash', tool: 'cursor', project: 'Studio', machine: 'studio', task: 'Vérifier la version distante', state: 'working' }
];
const ASKS: Record<string, Ask> = {
  otto: { id: 'ask-otto', agent: 'otto', kind: 'approval', text: 'Lancer les tests de l’overlay avant de fusionner', detail: 'Bash', command: 'pnpm --filter @ledge/overlay test -- --run', cwd: '~/ledge/application' },
  nova: { id: 'ask-nova', agent: 'nova', kind: 'question', text: 'Migration progressive ou courte fenêtre de maintenance ?', detail: 'La table orders compte 4,2 M de lignes et la boutique reste ouverte la nuit.', options: ['Migration progressive', 'Courte fenêtre de maintenance'] },
  lou: { id: 'ask-lou', agent: 'lou', kind: 'approval', text: 'Mettre à jour 12 dépendances majeures puis lancer les tests', detail: 'Bash', command: 'pnpm up --latest && pnpm test', cwd: '~/mobile/app' }
};
const NOTICES: Record<'done' | 'error' | 'offline', Omit<Notice, 'key'>> = {
  done: { kind: 'done', agent: 'sage', title: 'Sage a terminé', sub: '4 min de travail · le calcul arrondit par ligne, les tests passent' },
  error: { kind: 'error', agent: 'iris', title: 'Iris s’est arrêtée sur une erreur', sub: 'Le serveur de paiement de test ne répond plus (ECONNREFUSED)' },
  offline: { kind: 'offline', title: 'Studio SSH est hors ligne', sub: 'Ash est en pause jusqu’au retour de la machine' }
};
const NOTICE_MS = 6000;
const SCENARIOS: { id: Scenario; label: string; hint: string }[] = [
  { id: 'idle', label: 'Repos', hint: 'Île compacte, rien à faire' },
  { id: 'approval', label: 'Demande d’accord', hint: 'Otto veut lancer une commande' },
  { id: 'question', label: 'Question', hint: 'Nova demande un choix' },
  { id: 'done', label: 'Terminé', hint: 'Avis qui s’efface' },
  { id: 'error', label: 'Erreur', hint: 'Avis qui s’efface' },
  { id: 'offline', label: 'Machine hors ligne', hint: 'Avis qui s’efface' },
  { id: 'queue', label: 'Demandes en file', hint: 'Trois demandes à traiter' },
  { id: 'chat', label: 'Chat Ledge', hint: 'Depuis la mascotte' },
  { id: 'menu', label: 'Réglages · Dans le chat', hint: 'Le menu du chat Ledge' }
];
const KEEP: [string, string][] = [
  ['Île compacte', 'Mascotte Ledge, têtes des bots avec leur état, séparateur par machine, pastille +n, lune Ne pas déranger, bande discrète sous une fenêtre maximisée.'],
  ['Demandes d’accord', 'Résumé de la commande, Autoriser / Refuser, Plus tard. Y / N et Entrée / Échap.'],
  ['Questions', 'Choix proposés par l’agent et réponse courte (ancienne carte question de la session).'],
  ['Avis brefs', 'Terminé (bulle de 6 s), erreur, et nouveau : machine hors ligne. Phrase de bot qui s’efface après 5 s.'],
  ['Chat Ledge', 'Le fil complet depuis la mascotte, avec ses cartes « Lancer la session » et « Envoyer l’instruction ».'],
  ['Menu dans le chat', 'La roue dentée quitte l’île compacte : dans l’en-tête du chat, elle ouvre « Réglages dans Ledge Desktop », Ne pas déranger et Quitter.'],
  ['Sons et Ne pas déranger', 'Les signaux sonores jouent toujours ; Ne pas déranger se bascule depuis le menu du chat.'],
  ['Pastille de mise à jour', 'Le point sur la mascotte signale une version ; l’installation se fait dans Ledge Desktop.']
];
const MOVE: [string, string][] = [
  ['Liste des sessions', 'Groupée par dépôt et branche, J / K, Alt 1…9, retirer une session terminée, champ « Demander à Ledge… ».'],
  ['Vue session', 'Fil complet, dernière réponse, sous-agents (vue Helper), mode lecture.'],
  ['Terminal', 'La bande en direct, le mode lecture à côté du fil, « Ouvrir l’onglet » (O).'],
  ['Lecteur de documents', 'Markdown et références ouverts depuis une session ou le chat.'],
  ['Nouvelle session', 'Formulaire de lancement, navigateur de dossiers, choix du harnais, Ctrl Alt N.'],
  ['Relecture de diff et de plan', 'La bulle propose seulement « Relire dans Ledge ».'],
  ['Tous les réglages', 'Affichage (tailles, écran, position, mode discret, thème, couleur), Machines SSH, Notifications, Sons, À propos, versions et mises à jour.'],
  ['Aide et coachmark', 'La liste des raccourcis ; l’île n’affiche que les touches de la carte ouverte.']
];
const DOUBT: string[] = [
  'Les cartes du chat qui lancent une session ou relaient une instruction : gardées, car elles font partie du chat, mais elles recréent un lancement depuis l’île.',
  'Ctrl Alt L ouvrait la liste : ici il ouvre la première demande en attente, sinon le chat.',
  'Le retour « Retour aux sessions » du chat est masqué (plus de liste) ; × replie l’île.',
  'Clic sur un bot sans demande : un aperçu d’une ligne (état, tâche), pas la session.'
];

const now = () => new Date().toISOString();
const asSession = (a: Agent): Session => ({ id: a.id, name: a.name, tool: a.tool, cwd: `/workspace/${a.project.toLowerCase()}`, project: a.project, title: a.task, topic: a.task, repoId: a.project.toLowerCase(), machineName: MACHINES[a.machine], tmuxSession: a.id, state: a.state === 'approval' ? 'waiting_permission' : a.state === 'question' ? 'waiting_input' : a.state === 'error' ? 'error' : a.state === 'idle' ? 'idle' : 'working', helpers: [], startedAt: now(), lastActivityAt: now(), source: 'launcher' } as unknown as Session);
const SEED_CHAT: ChatTurn[] = [{ qid: 'seed', question: 'Qu’est-ce qui attend ma décision ?', askedAt: now(), answeredAt: now(), steps: [{ kind: 'sessions' }], answer: '### Rien de bloquant pour l’instant\n\n- **Otto** · lance les tests de l’overlay, il demandera ton accord avant de fusionner.\n- **Nova** · prépare la migration des commandes ; elle aura besoin de ton choix sur la stratégie.\n\nLes autres agents travaillent. Ouvre un nom pour suivre sa session dans Ledge Desktop.' } as ChatTurn];

/** The compact island's width, following Handle's own layout (ISLAND), plus the settings gear after it. */
function handleWidth(bots: HandleBot[], dnd: boolean) {
  const shown = islandOrder(bots).slice(0, ISLAND.max);
  let w = ISLAND.padL + ISLAND.resident + (bots.length ? ISLAND.sepGap + SIZES.separatorH : 0);
  shown.forEach((b, i) => { w += ISLAND.gap + ISLAND.companion + (pipeBefore(shown[i - 1], b) ? ISLAND.sepGap + SIZES.separatorH : 0); });
  if (bots.length > ISLAND.max) w += ISLAND.gap + ISLAND.pill;
  if (dnd) w += ISLAND.gap + ISLAND.moon;
  return w + ISLAND.padR;
}

function useReducedMotion() {
  const [r, setR] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => { const m = window.matchMedia('(prefers-reduced-motion: reduce)'); const on = () => setR(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, []);
  return r;
}
/** The island's inner content height, so the notch can transition between two explicit heights. */
function useHeight(ref: React.RefObject<HTMLDivElement | null>, key: unknown) {
  const [h, setH] = useState(ISLAND.h);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight)); ro.observe(el); setH(el.offsetHeight);
    return () => ro.disconnect();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return h;
}

function App() {
  const reduced = useReducedMotion();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const [scenario, setScenario] = useState<Scenario>('idle');
  const [mode, setMode] = useState<Mode>('handle');
  const [agents, setAgents] = useState(AGENTS);
  const [pending, setPending] = useState<Ask[]>([]);
  const [shownAsk, setShownAsk] = useState<string | null>(null);
  const [later, setLater] = useState<string[]>([]);
  const [ack, setAck] = useState<{ id: string; text: string } | null>(null);
  const [nods, setNods] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [offline, setOffline] = useState<Machine[]>([]);
  const [dnd, setDnd] = useState(false);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);
  const [live, setLive] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [reply, setReply] = useState('');
  const [nudge, setNudge] = useState(false);
  const [quit, setQuit] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const agent = (id: string) => agents.find(a => a.id === id)!;
  const ask = pending.find(p => p.id === shownAsk) ?? null;
  const askFor = (id: string) => pending.find(p => p.agent === id);
  const bots: HandleBot[] = agents.map(a => {
    const p = askFor(a.id); const off = offline.includes(a.machine);
    return { id: a.id, name: a.name, tool: a.tool, state: off ? 'readonly' : p ? p.kind : a.state, readOnly: off, pose: 1, pending: !!p, lifted: notice?.agent === a.id && mode === 'notice', machine: a.machine === 'local' ? undefined : a.machine };
  });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3600); return () => clearTimeout(t); }, [toast]);

  const announce = (text: string) => setLive(text);
  const showAsk = (a: Ask | null) => {
    setShownAsk(a?.id ?? null); setChoice(null); setReply(''); setAck(null); setNudge(false);
    setMode(a ? 'ask' : 'handle');
    if (a) announce(a.kind === 'approval' ? `${agent(a.agent).name} attend votre accord : ${a.text}` : `${agent(a.agent).name} a une question : ${a.text}`);
  };
  const openDesktop = (what: string) => { setToast({ key: Date.now(), text: what }); announce(`Ledge Desktop s’ouvre : ${what}`); };

  const run = (s: Scenario) => {
    setScenario(s); setMenuOpen(false); setLater([]); setPeek(null); setQuit(false); setNotice(null);
    setAgents(AGENTS.map(a => s === 'error' && a.id === 'iris' ? { ...a, state: 'error' } : s === 'done' && a.id === 'sage' ? { ...a, state: 'idle' } : a));
    setOffline(s === 'offline' ? ['studio'] : []);
    const queue = s === 'approval' ? [ASKS.otto] : s === 'question' ? [ASKS.nova] : s === 'queue' ? [ASKS.otto, ASKS.nova, ASKS.lou] : [];
    setPending(queue);
    if (queue.length) { if (dnd) { setMode('handle'); setShownAsk(null); announce('Ne pas déranger : la demande attend dans l’île.'); } else showAsk(queue[0]); return; }
    setShownAsk(null);
    if (s === 'done' || s === 'error' || s === 'offline') {
      if (dnd) { setMode('handle'); return; }
      const n = { ...NOTICES[s], key: Date.now() }; setNotice(n); setMode('notice'); announce(`${n.title}. ${n.sub}`); return;
    }
    if (s === 'chat') { setChat(SEED_CHAT); setMode('chat'); return; }
    if (s === 'menu') { setChat(SEED_CHAT); setMode('chat'); setMenuOpen(true); return; }
    setMode('handle');
  };

  /** After a decision: the bot nods, the line says it was sent, then the next unhandled request (not set aside) comes up. */
  const resolve = (a: Ask, text: string) => {
    if (ack) return;
    setAck({ id: a.id, text }); setNods(n => ({ ...n, [a.agent]: (n[a.agent] ?? 0) + 1 })); announce(text);
    setTimeout(() => {
      setPending(prev => {
        const rest = prev.filter(p => p.id !== a.id);
        const next = rest.find(p => !later.includes(p.id)) ?? null;
        showAsk(next);
        return rest;
      });
    }, reduced ? 500 : 900);
  };
  const approve = (a: Ask) => resolve(a, `Accord envoyé à ${agent(a.agent).name}.`);
  const deny = (a: Ask) => resolve(a, `Refus envoyé à ${agent(a.agent).name}.`);
  const answer = (a: Ask) => {
    const text = reply.trim() || (choice !== null ? a.options![choice] : '');
    if (!text) { setNudge(true); announce('Choisissez une réponse ou écrivez-en une.'); return; }
    resolve(a, `Réponse envoyée à ${agent(a.agent).name} : « ${text} ».`);
  };
  const putOff = (a: Ask) => {
    const set = [...later, a.id]; setLater(set);
    const next = pending.find(p => !set.includes(p.id));
    showAsk(next ?? null);
    if (!next) announce('Les demandes attendent dans l’île. Cliquez sur un bot pour y revenir.');
  };
  const openAsk = (a: Ask) => { openDesktop(`session de ${agent(a.agent).name} (${agent(a.agent).project})`); putOff(a); };
  const clickBot = (id: string) => {
    const p = askFor(id);
    if (p) { setLater(l => l.filter(x => x !== p.id)); showAsk(p); return; }
    setPeek(id); setMode('peek');
  };
  const fold = () => { setMode('handle'); setPeek(null); };

  // The keys of the open card. Enter on a focused button keeps its native click; letters never fire inside a field.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
      if (e.key === 'Escape' && mode !== 'handle') {
        e.preventDefault();
        if (mode === 'ask' && ask) putOff(ask); else if (menuOpen) { setMenuOpen(false); gearRef.current?.focus(); } else fold();
        return;
      }
      if (mode !== 'ask' || !ask || ack || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Enter' && !(el.tagName === 'BUTTON' && el.closest('.island')) && (!typing || el.dataset.reply !== undefined)) { e.preventDefault(); ask.kind === 'approval' ? approve(ask) : answer(ask); return; }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 'o') { e.preventDefault(); openAsk(ask); }
      else if (ask.kind === 'approval' && k === 'y') approve(ask);
      else if (ask.kind === 'approval' && k === 'n') deny(ask);
      else if (ask.kind === 'question' && /^[1-9]$/.test(k) && ask.options![+k - 1]) { setChoice(+k - 1); setReply(''); setNudge(false); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => { if (mode === 'chat' && !menuOpen) requestAnimationFrame(() => document.querySelector<HTMLInputElement>('[data-chat-input]')?.focus()); if (mode !== 'chat') setMenuOpen(false); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (menuOpen) menuRef.current?.querySelector<HTMLElement>('button')?.focus(); }, [menuOpen]);

  const askLedge = (question: string) => {
    const waiting = pending.map(p => agent(p.agent));
    const answer = waiting.length
      ? `### ${waiting.length} ${waiting.length > 1 ? 'demandes attendent' : 'demande attend'}\n\n` + waiting.map(a => `- **${a.name}** · ${a.project} — ${askFor(a.id)!.kind === 'approval' ? 'attend ton accord' : 'attend ta réponse'}.`).join('\n') + '\n\nTu peux les traiter depuis l’île, ou ouvrir la session dans Ledge Desktop.'
      : '### Tout le monde travaille\n\n' + agents.map(a => `- **${a.name}** · ${a.task} (${MACHINES[a.machine]}${offline.includes(a.machine) ? ', hors ligne' : ''}).`).join('\n') + '\n\nRéponse construite à partir des données simulées de la maquette.';
    setChat(c => [...c, { qid: 'q' + Date.now(), question, askedAt: now(), answeredAt: now(), steps: [{ kind: 'sessions' }], answer } as ChatTurn]);
  };

  const hw = handleWidth(bots, dnd);
  const width = mode === 'handle' ? hw : mode === 'chat' ? SIZES.sessionW : mode === 'peek' ? 360 : mode === 'notice' ? 400 : SIZES.bubbleW;
  const innerH = useHeight(contentRef, `${mode}-${shownAsk}-${notice?.key}-${peek}`);
  const height = mode === 'chat' ? 520 : innerH;
  const waiting = pending.filter(p => p.id !== shownAsk).length;
  const frozenIds = agents.filter(a => offline.includes(a.machine)).map(a => a.id);

  return <LangProvider lang="fr"><div className="sober" data-reduced={reduced || undefined}>
    <header className="sober-top">
      <div><h1>L’île, sobre</h1><p>Elle prévient, on agit vite, le reste s’ouvre dans Ledge Desktop.</p></div>
      <span className="sober-mock">Maquette · données simulées</span>
      <Button variant="outline" size="sm" aria-pressed={theme === 'light'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</Button>
    </header>

    <nav className="sober-scenarios" aria-label="Scénarios">
      {SCENARIOS.map(s => <button key={s.id} type="button" aria-pressed={scenario === s.id} onClick={() => run(s.id)}><strong>{s.label}</strong><small>{s.hint}</small></button>)}
    </nav>

    <div className="sober-grid">
      <section className="stage" aria-label="Bureau simulé">
        <div className="stage-windows" aria-hidden="true"><div className="win win-term"><i /><i /><i /><i /><i /></div><div className="win win-editor"><i /><i /><i /><i /></div></div>
        <div className="island-wrap" style={{ width }}>
          <Shoulders left={0} w={width} transition={reduced ? 'none' : 'left 260ms cubic-bezier(.2,.8,.2,1), width 260ms cubic-bezier(.2,.8,.2,1)'} opacity={1} />
          {mode === 'ask' && waiting > 0 && <div className="queue-slivers" aria-hidden="true">{pending.filter(p => p.id !== shownAsk).slice(0, 2).map((p, i) => <i key={p.id} style={{ width: `calc(100% - ${(i + 1) * 28}px)` }} />)}</div>}
          <div className="island" data-mode={mode} data-surface style={{ width, height }}>
            <div ref={contentRef} className="island-content" key={mode === 'handle' ? 'h' : mode + (shownAsk ?? '') + (notice?.key ?? '') + (peek ?? '')}>
              {mode === 'handle' && <div className="handle-row" style={{ width: hw }}>
                <div style={{ position: 'relative', width: hw, height: ISLAND.h }}>
                  <Handle bots={bots} slots={islandOrder(bots).slice(0, ISLAND.max).map(b => ({ id: b.id, size: ISLAND.companion, center: 0 }))} visible hoverId={hover} onHover={setHover} onOpen={clickBot} onOpenHome={() => { setChat(c => c.length ? c : SEED_CHAT); setMode('chat'); }} dnd={dnd} theme={theme} reducedMotion={reduced} frozen={false} />
                </div>
              </div>}

              {mode === 'ask' && ask && <AskCard ask={ask} agent={agent(ask.agent)} index={pending.indexOf(ask) + 1} total={pending.length} queue={pending.map(p => agent(p.agent))} theme={theme} reduced={reduced} nod={nods[ask.agent] ?? 0} ack={ack?.id === ask.id ? ack.text : null}
                choice={choice} reply={reply} nudge={nudge} onChoice={i => { setChoice(i); setReply(''); setNudge(false); }} onReply={t => { setReply(t); if (t) setChoice(null); setNudge(false); }}
                onApprove={() => approve(ask)} onDeny={() => deny(ask)} onAnswer={() => answer(ask)} onLater={() => putOff(ask)} onOpen={() => openAsk(ask)} />}

              {mode === 'notice' && notice && <NoticeCard notice={notice} agent={notice.agent ? agent(notice.agent) : undefined} theme={theme} reduced={reduced}
                onDone={fold} onOpen={() => { openDesktop(notice.agent ? `session de ${agent(notice.agent).name}` : 'état des machines'); fold(); }} />}

              {mode === 'peek' && peek && <PeekCard agent={agent(peek)} offline={frozenIds.includes(peek)} theme={theme} reduced={reduced} onClose={fold} onOpen={() => { openDesktop(`session de ${agent(peek).name} (${agent(peek).project})`); fold(); }} />}

              {mode === 'chat' && <div className="island-chat"><ChatView visible theme={theme} turns={chat} live={null} sessions={agents.map(asSession)} offline={null} onAsk={askLedge} onCancel={() => {}} onReset={() => setChat([])}
                onBack={fold} onClose={() => { setMenuOpen(false); fold(); }} onOpenSession={id => { openDesktop(`session de ${agent(id).name}`); }} onTerminal={id => openDesktop(`terminal de ${agent(id).name}`)} reducedMotion={reduced} />
                <button ref={gearRef} type="button" className="chat-gear" aria-label="Menu de Ledge" title="Menu de Ledge" aria-haspopup="true" aria-expanded={menuOpen} aria-controls="chat-menu" onClick={() => setMenuOpen(o => !o)}><Icon size={16} {...ICONS.gear} /></button>
                {menuOpen && <div ref={menuRef} id="chat-menu" className="island-menu chat-menu" role="group" aria-label="Menu de Ledge">
                <button type="button" className="menu-item" onClick={() => { openDesktop('Réglages'); setMenuOpen(false); fold(); }}>
                  <Icon size={16} {...ICONS.gear} /><span><strong>Réglages dans Ledge Desktop</strong><small>Affichage, machines, notifications, sons, mises à jour</small></span><Icon size={14} {...ICONS.external} />
                </button>
                <button type="button" className="menu-item" role="switch" aria-checked={dnd} onClick={() => setDnd(d => !d)}>
                  <Icon size={16} {...ICONS.dnd} /><span><strong>Ne pas déranger</strong><small>Les demandes attendent dans l’île, sans bulle ni son</small></span><i className="menu-switch" data-on={dnd || undefined} />
                </button>
                <div className="menu-sep" role="separator" />
                <button type="button" className="menu-item menu-quit" onClick={() => { setQuit(true); fold(); announce('Simulation : Ledge ne quitte pas dans la maquette.'); }}>
                  <Icon size={16} {...ICONS.close} /><span><strong>Quitter Ledge</strong></span>
                </button>
              </div>}
              </div>}

            </div>
          </div>
        </div>
        {quit && <p className="stage-note">Simulation : « Quitter » fermerait l’île et Ledge Desktop.</p>}
        {toast && <div key={toast.key} className="toast" role="status"><span className="toast-app"><Icon size={14} {...ICONS.external} /></span><span><strong>Ledge Desktop</strong><small>Ouverture : {toast.text}</small></span></div>}
        <div className="taskbar" aria-hidden="true"><i /><i /><i /><i className="tb-ledge" /><i /></div>
        <div className="sr-only" aria-live="polite" role="status">{live}</div>
      </section>

      <aside className="scope" aria-labelledby="scope-title">
        <h2 id="scope-title">Ce que l’île garde / ce qui part dans Ledge Desktop</h2>
        <h3><span className="dot keep" />L’île garde</h3>
        <ul>{KEEP.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
        <h3><span className="dot move" />Part dans Ledge Desktop</h3>
        <ul>{MOVE.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ul>
        <h3><span className="dot doubt" />À trancher</h3>
        <ul className="doubts">{DOUBT.map(d => <li key={d}><span>{d}</span></li>)}</ul>
        <p className="scope-keys"><Kbd>Entrée</Kbd> autoriser / répondre · <Kbd>Échap</Kbd> plus tard · <Kbd>O</Kbd> ouvrir dans Ledge · <Kbd>Y</Kbd> <Kbd>N</Kbd> · <Kbd>1</Kbd>…<Kbd>9</Kbd> choix</p>
      </aside>
    </div>
  </div></LangProvider>;
}

function Who({ agent, theme, reduced, state, nod, frozen, title, count }: { agent: Agent; theme: 'dark' | 'light'; reduced: boolean; state: BotState; nod?: number; frozen?: boolean; title: string; count?: React.ReactNode }) {
  return <div className="card-who">
    <Bot tool={agent.tool} state={state} pose={1} size={40} theme={theme} seed={agent.id} reducedMotion={reduced} nodKey={nod} frozen={frozen} />
    <div className="card-title"><strong>{title}</strong><small>{TOOLS[agent.tool]} · {agent.project} · {MACHINES[agent.machine]}</small></div>
    {count}
  </div>;
}

function Secondary({ onOpen, onLater, laterLabel = 'Plus tard' }: { onOpen: () => void; onLater?: () => void; laterLabel?: string }) {
  return <div className="card-secondary">
    <button type="button" className="link-btn" onClick={onOpen}><Icon size={13} {...ICONS.external} />Ouvrir dans Ledge<Kbd>O</Kbd></button>
    {onLater && <button type="button" className="link-btn" onClick={onLater}>{laterLabel}<Kbd>Échap</Kbd></button>}
  </div>;
}

function AskCard(p: { ask: Ask; agent: Agent; index: number; total: number; queue: Agent[]; theme: 'dark' | 'light'; reduced: boolean; nod: number; ack: string | null; choice: number | null; reply: string; nudge: boolean;
  onChoice: (i: number) => void; onReply: (t: string) => void; onApprove: () => void; onDeny: () => void; onAnswer: () => void; onLater: () => void; onOpen: () => void }) {
  const { ask, agent } = p;
  const approval = ask.kind === 'approval';
  const busy = !!p.ack;
  return <div className="card" data-kind={ask.kind}>
    <Who agent={agent} theme={p.theme} reduced={p.reduced} state={ask.kind} nod={p.nod} title={approval ? `${agent.name} attend votre accord` : `${agent.name} a une question`} count={p.total > 1 ? <span className="queue-heads" aria-label={`Demande ${p.index} sur ${p.total}`}>{p.queue.map((a, i) => <span key={a.id} aria-hidden="true" data-current={i === p.index - 1 || undefined}><Bot tool={a.tool} state="working" pose={1} size={16} theme={p.theme} seed={a.id} reducedMotion={p.reduced} paused /></span>)}<b aria-hidden="true">{p.index} / {p.total}</b></span> : undefined} />
    {approval ? <div className="card-body">
      <p className="card-text">{ask.text}</p>
      <div className="command"><span className="command-tool">{ask.detail}</span><code className="mono">{ask.command}</code><small className="mono">{ask.cwd}</small></div>
    </div> : <div className="card-body">
      <p className="card-text card-question">{ask.text}</p>
      <p className="card-detail">{ask.detail}</p>
      <div className="choices" role="radiogroup" aria-label="Réponses proposées">
        {ask.options!.map((o, i) => <button key={o} type="button" role="radio" aria-checked={p.choice === i} className="choice" disabled={busy} onClick={() => p.onChoice(i)}><Kbd>{i + 1}</Kbd><span>{o}</span>{p.choice === i && <Icon size={14} {...ICONS.check} />}</button>)}
      </div>
      <label className="short-reply" data-nudge={p.nudge || undefined}>
        <span className="sr-only">Réponse courte</span>
        <input data-reply type="text" className="ledge-field" maxLength={140} placeholder="Ou répondre en quelques mots…" value={p.reply} disabled={busy} onChange={e => p.onReply(e.target.value)} />
      </label>
    </div>}
    {p.ack ? <p className="card-ack" role="status"><Icon size={14} {...ICONS.check} />{p.ack}</p> : <div className="card-actions">
      {approval ? <>
        <Button variant="outline" size="sm" onClick={p.onDeny}>Refuser<Kbd>N</Kbd></Button>
        <Button variant="primary" size="sm" onClick={p.onApprove}><Icon size={14} {...ICONS.check} />Autoriser<Kbd accent>↵</Kbd></Button>
      </> : <Button variant="primary" size="sm" onClick={p.onAnswer} aria-disabled={p.choice === null && !p.reply.trim()}><Icon size={14} {...ICONS.send} />Répondre<Kbd accent>↵</Kbd></Button>}
    </div>}
    {p.nudge && !p.ack && <p className="card-hint" role="alert">Choisissez une réponse ou écrivez-en une.</p>}
    {!p.ack && <Secondary onOpen={p.onOpen} onLater={p.onLater} laterLabel={p.total > 1 ? 'Plus tard, suivante' : 'Plus tard'} />}
  </div>;
}

function NoticeCard({ notice, agent, theme, reduced, onDone, onOpen }: { notice: Notice; agent?: Agent; theme: 'dark' | 'light'; reduced: boolean; onDone: () => void; onOpen: () => void }) {
  const [held, setHeld] = useState(false);
  return <div className="card notice" data-kind={notice.kind} onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
    {agent ? <Who agent={agent} theme={theme} reduced={reduced} state={notice.kind === 'done' ? 'idle' : 'error'} title={notice.title} /> :
      <div className="card-who"><span className="machine-glyph" aria-hidden="true"><Icon size={20} d={['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8', 'M4 3l16 14']} /></span><div className="card-title"><strong>{notice.title}</strong><small>Connexion perdue il y a 20 s · reconnexion automatique</small></div></div>}
    <p className="card-detail">{notice.sub}</p>
    <div className="card-actions">
      <Badge state={notice.kind === 'done' ? 'idle' : notice.kind === 'error' ? 'error' : 'readonly'} label={notice.kind === 'done' ? 'Terminé' : notice.kind === 'error' ? 'Erreur' : 'Hors ligne'} />
      <span style={{ flex: 1 }} />
      <Button variant="outline" size="sm" onClick={onDone}>OK</Button>
      <Button variant="primary" size="sm" onClick={onOpen}><Icon size={14} {...ICONS.external} />Ouvrir dans Ledge</Button>
    </div>
    <div className="drain" aria-hidden="true"><i style={{ animationDuration: `${NOTICE_MS}ms`, animationPlayState: held ? 'paused' : 'running' }} onAnimationEnd={onDone} /></div>
  </div>;
}

function PeekCard({ agent, offline, theme, reduced, onClose, onOpen }: { agent: Agent; offline: boolean; theme: 'dark' | 'light'; reduced: boolean; onClose: () => void; onOpen: () => void }) {
  return <div className="card peek">
    <Who agent={agent} theme={theme} reduced={reduced} state={agent.state} frozen={offline} title={agent.name} />
    <div className="peek-line"><Badge state={offline ? 'readonly' : agent.state} label={offline ? 'Hors ligne' : undefined} /><span>{agent.task}</span></div>
    <div className="card-actions"><Button variant="ghost" size="sm" onClick={onClose}>Fermer</Button><Button variant="primary" size="sm" onClick={onOpen}><Icon size={14} {...ICONS.external} />Ouvrir dans Ledge</Button></div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
