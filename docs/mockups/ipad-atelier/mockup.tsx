// Mockup: the Atelier view in the mobile app, on iPad. The Atelier is the real Desktop component (apps/desktop/src/atelier)
// with sample sessions; around it, the real mobile app's tablet layout (its rail, its classes, MobileBot, Tag, buttons, copy).
// A tap on an agent opens its session in a panel over the Atelier; « … » or the name of a room opens the room's sheet.
import { useCallback, useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Session } from '@ledge/protocol';
import { Atelier } from '../../../apps/desktop/src/atelier/Atelier';
import { LangProvider } from '../../../apps/desktop/src/i18n/lang';
import { loadMessages } from '../../../apps/desktop/src/i18n/messages';
import { initialNav, type NavAction } from '../../../apps/desktop/src/nav/state';
import { copy } from '../../../apps/mobile/src/copy';
import { MobileBot } from '../../../apps/mobile/src/ui/MobileBot';
import { Tag } from '../../../apps/mobile/src/ui/Tag';
import { buttonClass, iconButtonClass } from '../../../apps/mobile/src/ui/Button';
import { Icon } from '../../../apps/mobile/src/ui/icons';
import { LinkStatus } from '../../../apps/mobile/src/ui/Header';
import { Notice } from '../../../apps/mobile/src/ui/Notice';
import { many, projects, manyProjects, quiet, session, usual, ompSeats, unfiled } from './fixtures';

type Theme = 'dark' | 'light';
type Orient = 'land' | 'port';
type View = 'flow' | 'actions' | 'cases' | 'notes';
type Step = 'tab' | 'session' | 'full' | 'room';
type Case = 'many' | 'quiet' | 'offline' | 'omp' | 'unfiled';
type Sheet = { kind: 'session'; id: string } | { kind: 'room'; project: string } | null;

const q = new URLSearchParams(location.search);
const noop = () => {};
const filing = { dragging: null, over: null, seated: null, dragProps: () => ({ draggable: true as const, onDragStart: noop, onDragEnd: noop }), dropProps: () => ({ onDragOver: noop, onDragLeave: noop, onDrop: noop }), file: noop, markSeated: noop };
const actions = { request: noop, resume: noop, restore: noop, pending: null, confirm: noop, cancel: noop, allowed: () => false };
const menu = { menu: null, session: null, renaming: null, open: noop, openOn: noop, close: noop, terminal: noop, rename: noop, closeRename: noop } as never;

const state = (s: Session) => {
  switch (s.state) {
    case 'waiting_permission': return { tone: 'approval' as const, label: copy.kind.permission };
    case 'waiting_input': return { tone: 'attention' as const, label: copy.kind.question };
    case 'idle': return { tone: 'ok' as const, label: copy.agents.state.idle };
    case 'exited': return { tone: 'muted' as const, label: copy.agents.state.exited };
    default: return { tone: 'info' as const, label: copy.agents.state.working };
  }
};

/* ───────────── The iPad's opening fit ───────────── */

/** Readable first (recommended for the iPad, pure: room sizes and the view in, a zoom and a direction out; it fits beside
 *  layout.ts's widestRow / fitCeiling once that is shared). A room's names (13 px) and states (12 px) reach 11 pt at a zoom
 *  of 0.92: each room is shown whole across the screen's short side (its height in landscape, its width in portrait), at
 *  the most that fits, never above 100 %; the rooms run along the long side (a row in landscape, a column in portrait),
 *  to scroll with one finger. Pinching out still shows everything; « Ajuster » comes back here. */
export const IPAD_PAD = { top: 56, side: 12, bottom: 34 };
/** The floor: states (12 px at 100 %) at 11 px on screen. Below it the room no longer fits whole and scrolls. */
export const IPAD_READ = 11 / 12;
export function ipadFit(rooms: readonly { w: number; h: number }[], view: { width: number; height: number }, orient: Orient): { zoom: number; along: 'row' | 'column' } {
  const tall = Math.max(...rooms.map(r => r.h)), wide = Math.max(...rooms.map(r => r.w));
  const zoom = orient === 'land'
    ? Math.min(1, Math.max(IPAD_READ, (view.height - 4) / (tall + IPAD_PAD.top + IPAD_PAD.bottom)))
    : Math.min(1, Math.max(IPAD_READ, (view.width - 4) / (wide + 2 * IPAD_PAD.side)));
  return { zoom, along: orient === 'land' ? 'row' : 'column' };
}

/** Applies ipadFit over the Atelier the real component fitted (the mockup cannot change its hook): the shell's zoom, its
 *  flow, the scroller free to scroll, the zoom bar's level. */
function useIpadFit(box: React.RefObject<HTMLDivElement | null>, orient: Orient, on: boolean, key: unknown): void {
  useEffect(() => {
    if (!on) return;
    const apply = () => {
      const el = box.current; if (!el) return;
      const sc = el.querySelector<HTMLElement>('.overview-scroll.atelier'), shell = el.querySelector<HTMLElement>('.office-shell');
      const rooms = [...el.querySelectorAll<HTMLElement>('.atelier-room, .unassigned-zone')].map(r => ({ w: r.offsetWidth, h: r.offsetHeight }));
      if (!sc || !shell || rooms.length === 0) return;
      const { zoom, along } = ipadFit(rooms, { width: sc.clientWidth, height: sc.clientHeight }, orient);
      const st = shell.style;
      st.padding = `${IPAD_PAD.top}px ${IPAD_PAD.side}px ${IPAD_PAD.bottom}px`; st.minHeight = ''; st.alignContent = 'flex-start'; st.gap = '0 8px';
      if (along === 'row') { st.flexWrap = 'nowrap'; st.width = 'max-content'; st.maxWidth = 'none'; st.justifyContent = 'flex-start'; }
      else { const w = Math.max(...rooms.map(r => r.w)) + 2 * IPAD_PAD.side; st.flexWrap = 'wrap'; st.width = `${w}px`; st.maxWidth = `${w}px`; st.justifyContent = 'center'; }
      st.zoom = String(zoom);
      sc.classList.remove('fitted'); sc.style.overflow = 'auto';
      const level = el.querySelector('.zoom-level'); if (level) level.textContent = `${Math.round(zoom * 100)} %`;
    };
    // The real Atelier refits on its own (a resize, fonts loaded): the iPad fit is applied again after each of its writes.
    let busy = false;
    const again = () => { if (busy) return; busy = true; apply(); requestAnimationFrame(() => { busy = false; }); };
    const shell = box.current?.querySelector('.office-shell');
    const mo = new MutationObserver(again);
    if (shell) mo.observe(shell, { attributes: true, attributeFilter: ['style'] });
    const t = [setTimeout(again, 60), setTimeout(again, 400)];
    return () => { t.forEach(clearTimeout); mo.disconnect(); };
  }, [box, orient, on, key]);
}

/* ───────────── The iPad and the app around the Atelier ───────────── */

/** An iPad, landscape (1180 × 820) or portrait (820 × 1180), its status bar; the screen is the containing block of the
 *  app's fixed rail (the transform), so the mobile app's own tablet rules apply as on a real iPad. */
function IPad({ orient, scale = 1, children }: { orient: Orient; scale?: number; children: ReactNode }): JSX.Element {
  const [w, h] = orient === 'land' ? [1180, 820] : [820, 1180];
  return (
    <div className="mk-ipad" style={{ width: (w + 36) * scale, height: (h + 36) * scale }}>
      <div className="mk-ipad-body" style={{ width: w + 36, height: h + 36, transform: `scale(${scale})` }}>
        <div className="mk-screen" style={{ width: w, height: h }}>
          <div className="mk-status"><span>10:24</span><span>lun. 4 nov.</span><span className="mk-fill" /><span>Wi-Fi</span><span>87 %</span></div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The mobile rail with the new « Atelier », on a tablet only (the phone keeps its three tabs). */
function Rail({ active, count = 2, hot = false }: { active: 'chat' | 'inbox' | 'agents' | 'atelier'; count?: number; hot?: boolean }): JSX.Element {
  const tab = (on: boolean) => `flex min-h-12 items-center justify-center gap-2 rounded-control text-body transition-colors duration-100 active:bg-raised ${on ? 'bg-raised text-fg' : 'text-muted'}`;
  return (
    <nav aria-label={copy.nav.label} className="tabbar grid flex-none grid-cols-4 border-t border-line bg-bg pt-2 pb-3">
      <a href="#" onClick={e => e.preventDefault()} className={`${tab(active === 'chat')} px-1 text-center leading-tight`}><Icon name="chat" />{copy.nav.chat}</a>
      <a href="#" onClick={e => e.preventDefault()} className={tab(active === 'inbox')}><Icon name="inbox" />{copy.nav.inbox}
        {count > 0 && <span className="inline-grid h-[19px] min-w-[19px] place-items-center rounded-md bg-primary px-[5px] text-meta font-bold text-primary-fg">{count}</span>}</a>
      <a href="#" onClick={e => e.preventDefault()} className={tab(active === 'agents')}><Icon name="grid" />{copy.nav.agents}</a>
      <a href="#" onClick={e => e.preventDefault()} aria-current={active === 'atelier' ? 'page' : undefined} className={`${tab(active === 'atelier')} ${hot ? 'mk-hot' : ''}`}>
        <svg className="size-5 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M9 20v-5h6v5" /></svg>
        Atelier
      </a>
    </nav>
  );
}

/** The Atelier screen: a compact head (the link, the title, the counts), then the real Atelier fitted to what is left. */
function AtelierScreen({ sessions, fresh = true, sheet, onSheet, onChat, orient, fit = 'ipad' }: { sessions: Session[]; fresh?: boolean; sheet: Sheet; onSheet(s: Sheet): void; onChat(): void; orient: Orient; fit?: 'ipad' | 'desktop' }): JSX.Element {
  // The link down: the last known state, the mascots still (the Atelier's pause), as the phone's bots are frozen.
  const nav = useState(() => initialNav({ helpers: true, paused: !fresh } as never, 'atelier'))[0];
  const dispatch = useCallback((a: NavAction) => {
    if (a.type === 'open') onSheet({ kind: 'session', id: a.id });
    else if (a.type === 'chat') onChat();
  }, [onSheet, onChat]);
  // A room's « … » or its name: the room's sheet (its agents, « Écrire au groupe »), instead of Desktop's menu.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const tap = (e: Event) => {
      const t = e.target as HTMLElement;
      const room = t.closest<HTMLElement>('[data-room]');
      if (room && t.closest('.room-menu-wrap, .project-conversations, .plaque-name')) { e.preventDefault(); e.stopPropagation(); onSheet({ kind: 'room', project: room.dataset.room! }); }
    };
    el.addEventListener('click', tap, true); el.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest('.room-menu-wrap')) e.stopPropagation(); }, true);
    return () => el.removeEventListener('click', tap, true);
  }, [onSheet]);
  useIpadFit(box, orient, fit === 'ipad', sessions);
  const live = sessions.filter(s => s.state !== 'exited');
  const waiting = sessions.filter(s => s.state === 'waiting_permission' || s.state === 'waiting_input').length;
  // The rooms: a rig's, or a known project's; « Sans projet » is not a room.
  const known = new Set([...projects.projects, ...manyProjects.projects].map(p => p.id));
  const rooms = new Set(sessions.filter(s => s.rig || known.has(s.project)).map(s => s.rig?.name ?? s.project)).size;
  return (
    <div className="app mk-app">
      <Rail active="atelier" />
      <div className="mk-atelier-col">
        <header className="flex flex-none items-center gap-3 pt-3 pb-3">
          <h1 className="text-title font-semibold tracking-[-.3px]">Atelier</h1>
          <span className="text-meta text-muted">{fresh ? '' : `${copy.agents.offline} · `}{`${live.length} ${live.length > 1 ? 'agents' : 'agent'} · ${rooms} ${rooms > 1 ? 'pièces' : 'pièce'}${waiting ? ` · ${waiting} ${waiting > 1 ? 'attendent' : 'attend'}` : ''}`}</span>
          <span className="mk-fill" />
          <LinkStatus link={{ fresh, pc: 'gch-wsl' }} />
        </header>
        {!fresh && <div className="mb-3 flex-none"><Notice title={copy.offline.pcOffline} tone="warning" role="status"><p>{copy.link.lostBody}</p></Notice></div>}
        <div ref={box} className={`mk-floor ${fresh ? '' : 'mk-frozen'}`}>
          <LangProvider lang="fr">
            <Atelier nav={nav} dispatch={dispatch} sessions={sessions} projects={sessions === many ? manyProjects : projects} order={sessions}
              projectIdOf={(s: Session) => s.project ?? null} filing={filing as never} actions={actions as never} menu={menu} tasks={[]} />
          </LangProvider>
        </div>
      </div>
      {sheet?.kind === 'session' && <SessionPanel s={sessions.find(x => x.id === sheet.id) ?? sessions[0]!} fresh={fresh} onClose={() => onSheet(null)} />}
      {sheet?.kind === 'room' && <RoomPanel project={sheet.project} sessions={sessions} fresh={fresh} onClose={() => onSheet(null)} onOpen={id => onSheet({ kind: 'session', id })} />}
    </div>
  );
}

/* ───────────── The session panel, over the Atelier ───────────── */

const TOOL: Record<string, string> = copy.tools as never;
/** Each sample session's own last exchange. */
const THREADS: Record<string, { you: string; agent: string; tool: [string, string, string] }> = {
  otto: { you: 'Lance les tests avant de préparer la release.', agent: 'Je lance la suite complète, puis je mets à jour le changelog.', tool: ['Commande', 'pnpm -r build', '41 s'] },
  luna: { you: 'Refais le bandeau de la page d’accueil, plus court.', agent: 'J’ai deux versions du bandeau : l’ancienne, raccourcie, et une nouvelle avec la capture de l’Atelier.', tool: ['Écrit', 'src/pages/index.astro', '+48 −12'] },
  nova: { you: 'La reconnexion SSH boucle quand le Wi-Fi revient.', agent: 'Je regarde le délai de reprise du pont SSH ; un sous-agent lit le code du relais.', tool: ['Commande', 'pnpm --filter ledge test ssh', '12 s'] },
  default: { you: 'Avance sur ta tâche et préviens-moi quand c’est prêt.', agent: 'C’est noté, je m’y mets.', tool: ['Commande', 'git status', '1 s'] }
};

/** The session, as the phone's Thread screen shows it (its header, its bubbles, its composer), in a panel over the Atelier:
 *  on the right in landscape, from the bottom in portrait. « Plein écran » goes to the thread's own screen. */
function SessionPanel({ s, fresh, onClose, full = false }: { s: Session; fresh: boolean; onClose(): void; full?: boolean }): JSX.Element {
  const omp = s.tool === ('omp' as Session['tool']);
  const where = <>{s.rig ? `${s.rig.name} · ${s.rig.role}` : s.project}{s.branch && <> · <code className="font-mono text-[.9em]">{s.branch}</code></>}</>;
  return (
    <aside className={full ? 'mk-full' : 'mk-panel'} aria-label={`Session de ${s.name}`}>
      {!full && <div className="mk-grabber" aria-hidden="true" />}
      <header className="flex-none border-b border-line pt-2 pb-3">
        <div className="flex items-center gap-2.5">
          <MobileBot tool={s.tool} seed={s.id} state={s.state} frozen={!fresh} />
          <div className="min-w-0 flex-1">
            <h1 className="text-title leading-[1.25] font-semibold tracking-[-.2px] [overflow-wrap:anywhere]">{omp ? s.name : s.topic ?? s.project}</h1>
            <p className="mt-[3px] text-meta text-muted">{s.name} · {TOOL[s.tool] ?? s.tool}</p>
          </div>
          <a href="#" onClick={e => e.preventDefault()} aria-label={copy.thread.terminal(s.name)} className={iconButtonClass({ variant: 'outline' })}><Icon name="terminal" /></a>
          {!omp && <a href="#" onClick={e => e.preventDefault()} aria-label={copy.sessionEnd.close(s.name)} className={iconButtonClass({ variant: 'outline' })}><Icon name="power" /></a>}
          {!full && <a href="#" onClick={e => e.preventDefault()} aria-label="Plein écran" title="Plein écran" className={iconButtonClass({ variant: 'outline' })}><Icon name="external" /></a>}
          {!full && <button type="button" onClick={onClose} aria-label="Fermer le panneau" title="Fermer" className={iconButtonClass({})}><Icon name="close" /></button>}
        </div>
        <p className="mt-2 ml-[46px] text-meta text-muted">{where}</p>
      </header>
      {omp ? (
        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <h2 className="text-heading">Pas de fil pour ce siège.</h2>
          <p className="max-w-[320px] text-body text-muted">Ledge ne lit pas la conversation d’un siège OMP lancé par OpenRig. Son terminal montre son écran.</p>
          <a href="#" onClick={e => e.preventDefault()} className={buttonClass({ variant: 'primary' })}><Icon name="terminal" />Ouvrir son terminal</a>
        </main>
      ) : (
        <>
          <main className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pt-5 pb-4">
            {(() => { const t = THREADS[s.id] ?? THREADS.default!; return <>
              <div className="max-w-[88%] self-end rounded-card bg-raised px-3.5 py-2.5 text-body">{t.you}</div>
              <div className="max-w-[92%] text-body">{t.agent}</div>
              <div className="flex items-center gap-2 text-meta text-muted"><Icon name={t.tool[0] === 'Écrit' ? 'edit' : 'terminal'} className="size-[14px]" /><span>{t.tool[0]}</span><code className="font-mono">{t.tool[1]}</code><span>· {t.tool[2]}</span></div>
            </>; })()}
            {s.state === 'waiting_permission' && (
              <div className="rounded-card border border-approval/40 bg-approval/5 p-3.5">
                <div className="flex items-center gap-2"><Tag tone="approval" label={copy.kind.permission} /><span className="text-body font-semibold">{s.name} veut exécuter une commande</span></div>
                <code className="mt-2.5 block rounded-control bg-well px-3 py-2 font-mono text-small">npm test</code>
                <div className="mt-3 flex gap-2"><button type="button" disabled={!fresh} className={buttonClass({ variant: 'primary', className: 'flex-1 disabled:opacity-45' })}>Autoriser</button><button type="button" disabled={!fresh} className={buttonClass({ className: 'flex-1 disabled:opacity-45' })}>Refuser</button></div>
              </div>
            )}
            {s.state === 'waiting_input' && (
              <div className="rounded-card border border-attention/40 bg-attention/5 p-3.5">
                <div className="flex items-center gap-2"><Tag tone="attention" label={copy.kind.question} /><span className="text-body font-semibold">Garder l’ancien bandeau ?</span></div>
                <div className="mt-3 flex gap-2"><button type="button" disabled={!fresh} className={buttonClass({ className: 'flex-1 disabled:opacity-45' })}>Oui</button><button type="button" disabled={!fresh} className={buttonClass({ className: 'flex-1 disabled:opacity-45' })}>Non, le nouveau</button></div>
              </div>
            )}
          </main>
          <div className="flex flex-none items-end gap-2 border-t border-line pt-3 pb-1">
            <div className="min-h-11 flex-1 rounded-control border border-input px-3.5 py-2.5 text-base text-muted">{!fresh ? copy.thread.composer.placeholder.offline : s.state === 'waiting_permission' || s.state === 'waiting_input' ? copy.thread.composer.placeholder.awaiting : copy.thread.composer.placeholder.idle(s.name)}</div>
            <button type="button" aria-label="Envoyer" disabled={!fresh} className={iconButtonClass({ variant: 'primary', round: true, className: 'disabled:opacity-45' })}><Icon name="arrowUp" /></button>
          </div>
        </>
      )}
    </aside>
  );
}

/** A room's sheet: its agents (a tap opens one), and « Écrire au groupe » (the phone's broadcast, by ids). */
function RoomPanel({ project, sessions, fresh, onClose, onOpen }: { project: string; sessions: Session[]; fresh: boolean; onClose(): void; onOpen(id: string): void }): JSX.Element {
  const mine = sessions.filter(s => (s.rig ? `rig:${s.rig.name}` : s.project) === project || s.project === project || s.rig?.name === project.replace(/^.*:/, ''));
  const name = mine[0]?.rig ? mine[0].rig.name : projects.projects.find(p => p.id === project)?.name ?? project;
  const [writing, setWriting] = useState(true);
  return (
    <aside className="mk-panel" aria-label={`Pièce ${name}`}>
      <div className="mk-grabber" aria-hidden="true" />
      <header className="flex flex-none items-center gap-2.5 border-b border-line pt-2 pb-3">
        <div className="min-w-0 flex-1"><h1 className="text-title font-semibold">{name}</h1><p className="mt-[3px] text-meta text-muted">{mine.length} {mine.length > 1 ? 'agents' : 'agent'}</p></div>
        <button type="button" onClick={onClose} aria-label="Fermer le panneau" className={iconButtonClass({})}><Icon name="close" /></button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {mine.map(s => (
          <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center gap-3 border-b border-line py-3 text-left active:bg-raised/60">
            <MobileBot tool={s.tool} seed={s.id} state={s.state} frozen={!fresh} />
            <span className="min-w-0 flex-1"><span className="block text-body font-semibold">{s.name}</span><span className="block truncate text-meta text-muted">{s.rig?.role ?? s.topic ?? s.branch}</span></span>
            <Tag {...state(s)} />
          </button>
        ))}
        <div className="pt-4">
          {!writing ? <button type="button" onClick={() => setWriting(true)} className="text-meta text-info">{copy.agents.writeGroup}</button> : (
            <div className="flex flex-col gap-2">
              <div className="min-h-[68px] rounded-control border border-input px-3.5 py-2.5 text-base text-muted">{copy.agents.writeGroupPlaceholder}</div>
              <div className="flex gap-2"><button type="button" onClick={() => setWriting(false)} className={buttonClass({ variant: 'ghost', className: 'flex-1' })}>{copy.agents.cancel}</button><button type="button" disabled={!fresh} className={buttonClass({ variant: 'primary', className: 'flex-[2]' })}>{copy.agents.send}</button></div>
            </div>
          )}
        </div>
      </main>
    </aside>
  );
}

/** The Agents list of the split, drawn after screens/Agents.tsx's rows. */
function AgentsList({ sessions, current }: { sessions: Session[]; current: string }): JSX.Element {
  return (
    <>
      <header className="flex-none pt-3 pb-[18px]"><LinkStatus link={{ fresh: true, pc: 'gch-wsl' }} /><h1 className="mt-3 text-display leading-[1.15] font-semibold tracking-[-1px]">{copy.agents.title}</h1></header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {sessions.filter(s => !s.rig).map(s => (
          <a key={s.id} href="#" onClick={e => e.preventDefault()} aria-current={s.id === current ? 'page' : undefined} className="flex gap-3 border-b border-line py-4 aria-[current=page]:-mx-3 aria-[current=page]:rounded-card aria-[current=page]:border-transparent aria-[current=page]:bg-raised aria-[current=page]:px-3">
            <div className="mt-[3px]"><MobileBot tool={s.tool} seed={s.id} state={s.state} /></div>
            <div className="min-w-0 flex-1"><h3 className="text-body font-semibold">{s.topic}</h3><div className="my-[3px] text-meta text-muted">{s.name} · <code className="font-mono text-[.9em]">{s.branch}</code></div><div className="mt-2"><Tag {...state(s)} /></div></div>
          </a>
        ))}
      </main>
    </>
  );
}

/* ───────────── Views ───────────── */

const STEPS: Record<Step, [string, ReactNode]> = {
  tab: ['a · L’onglet', <>Sur iPad, la barre de l'app gagne <b>Atelier</b>, après Agents. L'Atelier s'ouvre <b>lisible</b> : une pièce entière dans la hauteur de l'écran (en portrait, dans sa largeur), au zoom où noms et états font au moins 11 pt (ici 92 %), les autres pièces à la suite, qu'on fait glisser d'un doigt (en paysage vers la gauche, en portrait vers le haut). Deux doigts zooment ; « Ajuster » revient à cette vue. Le téléphone ne change pas : pas d'onglet Atelier sous 768 px.</>],
  session: ['b · Toucher un agent', <>Un toucher sur un agent ouvre sa session <b>dans un panneau par-dessus l'Atelier</b> : à droite en paysage, en bas en portrait. C'est l'écran de fil de l'app (en-tête, bulles, demande, réponse). Toucher un autre agent change le panneau ; × ou un glissement le ferme.</>],
  full: ['c · Plein écran', <>« Plein écran » (la flèche du panneau) ouvre le fil comme aujourd'hui sur iPad : la liste des agents à gauche, le fil à droite, sous l'onglet Agents. On revient à l'Atelier par son onglet, au zoom où on l'a laissé. Aucun écran nouveau.</>],
  room: ['d · Une pièce', <>Le nom d'une pièce, ou son « … », ouvre la feuille de la pièce : ses agents (un toucher ouvre le fil) et <b>Écrire au groupe</b>, le même envoi groupé que dans Agents.</>]
};

function FlowView({ orient, theme }: { orient: Orient; theme: Theme }): JSX.Element {
  const [step, setStep] = useState<Step>((q.get('step') as Step) ?? 'tab');
  const [sheet, setSheet] = useState<Sheet>(null);
  useEffect(() => { setSheet(step === 'session' ? { kind: 'session', id: 'otto' } : step === 'room' ? { kind: 'room', project: 'website' } : null); }, [step]);
  const sessions = [...usual, ...ompSeats];
  return (
    <>
      <div className="mk-steps">{(Object.keys(STEPS) as Step[]).map(k => <button key={k} aria-checked={step === k} onClick={() => setStep(k)}>{STEPS[k][0]}</button>)}</div>
      <p className="mk-intro">{STEPS[step][1]}</p>
      <IPad orient={orient} key={`${orient}-${theme}`}>
        {step === 'full'
          ? <div className="app mk-app"><Rail active="agents" /><div className="split">
              <section className="split-list"><AgentsList sessions={sessions} current="otto" /></section>
              <section className="split-detail"><SessionPanel full s={sessions[0]!} fresh onClose={() => setStep('tab')} /></section>
            </div></div>
          : <AtelierScreen sessions={sessions} sheet={sheet} onSheet={setSheet} onChat={noop} orient={orient} fit={q.get('fit') === 'desktop' ? 'desktop' : 'ipad'} />}
      </IPad>
    </>
  );
}

const ACTIONS: [string, string, string, string][] = [
  ['Voir les pièces, les agents et leur état', 'oui', 'Tel quel, ajusté à l’écran ; légende en bas à gauche.', 'Projet et rig par session : ajout daemon (voir Notes).'],
  ['Ouvrir une session (clic)', 'oui', 'Toucher : panneau par-dessus l’Atelier ; « Plein écran » vers le fil.', ''],
  ['Zoom, déplacement, « Ajuster »', 'oui', 'Ouverture lisible (vue 1 a) ; un doigt fait défiler les pièces, deux doigts zooment (déjà géré par l’Atelier) ; « Ajuster » revient à la vue lisible ; barre de zoom à 44 pt, sans l’aide clavier.', 'Zoom gardé localement.'],
  ['Répondre, décider (accord, question)', 'oui', 'Dans le panneau, comme dans le fil.', ''],
  ['Écrire à un projet (menu de pièce)', 'oui', 'Nom ou « … » de la pièce : feuille de la pièce, « Écrire au groupe ».', 'Envoi groupé par ids, déjà là.'],
  ['Fermer, reprendre une session', 'oui', 'Bouton ⏻ du panneau, comme le fil d’aujourd’hui.', ''],
  ['Sous-agents (petits bots)', 'oui', 'Affichés ; un toucher ouvre le fil du parent.', 'Ouvrir un sous-agent seul : absent du protocole.'],
  ['Le bureau de Ledge', 'oui', 'Un toucher ouvre l’onglet Ledge (le chat de l’app).', ''],
  ['Menu d’une session (clic droit, « … » du siège)', 'non', 'Retiré : ses actions (fermer, reprendre, terminal) sont dans le panneau.', ''],
  ['Ranger : glisser un agent vers une pièce, « Ranger dans… »', 'non', 'Reste sur Desktop. « Sans projet » s’affiche, sans action.', 'Absent du protocole téléphone (lot suivant).'],
  ['Nouveau projet, lancer dans un projet', 'non', 'Reste sur Desktop.', 'Absent du protocole téléphone.'],
  ['Archiver, supprimer, renommer', 'non', 'Reste sur Desktop.', 'Absent du protocole téléphone.'],
  ['Messages et tâches qui voyagent (arcs, jetons)', 'non', 'Pas d’animation au lot 1.', 'Les tâches du téléphone n’ont pas leur journal.'],
  ['Détacher l’Atelier, nombre de places, regroupement', 'non', 'Propres à Desktop. Places et regroupement : réglages locaux plus tard si besoin.', ''],
  ['« Gérer » un rig (page OpenRig)', 'non', 'Masqué : l’app n’a pas de page OpenRig.', ''],
  ['Raccourcis clavier (J/K, Alt 1…)', 'non', 'Masqués sur iPad.', '']
];

function ActionsView(): JSX.Element {
  return (
    <div className="mk-card">
      <p className="mk-kicker">Les actions de la vue Desktop, sur iPad (lot 1)</p>
      <table className="mk-table"><thead><tr><th>Sur Desktop</th><th>iPad</th><th>Forme tactile</th><th>Back</th></tr></thead>
        <tbody>{ACTIONS.map(([a, ok, how, back]) => <tr key={a}><td>{a}</td><td className={ok === 'oui' ? 'mk-yes' : 'mk-no'}>{ok === 'oui' ? 'Oui' : 'Reste sur Desktop'}</td><td>{how}</td><td className="muted">{back}</td></tr>)}</tbody></table>
      <p className="mk-small">Pas d'appui long ni de glisser-déposer au lot 1 : un seul geste par chose (toucher), et les actions de session vivent dans le panneau, comme dans le fil de l'app. Cibles : 44 pt au moins (barre de zoom, boutons du panneau). À l'ouverture (92 %), un siège (bot, nom, état) fait déjà plus de 44 pt ; si on pince pour tout voir, il rapetisse, mais sa zone de toucher reste de 44 pt au moins, quel que soit le zoom, sans changer le dessin.</p>
    </div>
  );
}

const CASES: Record<Case, [string, string]> = {
  many: ['Beaucoup de projets', 'Six projets : le zoom ne baisse pas, les pièces s’enchaînent (environ 3 écrans et demi en paysage, 4 en portrait) et on les fait glisser d’un doigt. Pour tout voir d’un coup, on pince : les pièces rapetissent jusqu’à tenir dans l’écran, illisibles mais repérables ; « Ajuster » ramène à la vue lisible.'],
  quiet: ['Aucun agent actif', 'Toutes les sessions sont terminées : les pièces restent, leurs agents en gris (« Terminé ») ; sans aucune session, l’Atelier montre le seul bureau de Ledge.'],
  offline: ['PC hors ligne', 'L’état mobile existant : « Dernier état connu · connexion perdue », le bandeau du PC déconnecté ; les bots figés. Toucher un agent ouvre son fil en lecture, rien n’est envoyé. Le bandeau prend de la hauteur : le zoom reste au plancher lisible (92 %), le bas de la pièce passe sous le bord et se fait défiler.'],
  omp: ['Siège OMP', 'Ivo et Mia sont des sièges OMP du rig dev-omp, dans la pièce du rig. Un toucher ouvre le panneau « Pas de fil pour ce siège », avec son terminal, comme sur Desktop.'],
  unfiled: ['Sans projet', 'Des sessions dans un dossier qu’aucun projet ne couvre : la zone « Sans projet » de Desktop, après la dernière pièce (au bout de la ligne en paysage, sous la dernière pièce en portrait). Chaque carte : bot, nom, tâche, nom du dossier, état. Pas de poignée ni de « Ranger dans… » : on range depuis le PC, et l’aide le dit. Un toucher ouvre le panneau.'],
};

function CasesView({ orient, theme }: { orient: Orient; theme: Theme }): JSX.Element {
  const [c, setC] = useState<Case>((q.get('case') as Case) ?? 'many');
  const [sheet, setSheet] = useState<Sheet>(null);
  useEffect(() => { setSheet(c === 'omp' ? { kind: 'session', id: 'mia' } : c === 'offline' ? { kind: 'session', id: 'luna' } : null); }, [c]);
  const sessions = c === 'many' ? many : c === 'quiet' ? quiet : c === 'offline' ? usual : c === 'unfiled' ? unfiled : [...usual, ...ompSeats];
  return (
    <>
      <div className="mk-steps">{(Object.keys(CASES) as Case[]).map(k => <button key={k} aria-checked={c === k} onClick={() => setC(k)}>{CASES[k][0]}</button>)}</div>
      <p className="mk-intro">{CASES[c][1]}</p>
      <IPad orient={orient} key={`${c}-${orient}-${theme}`}>
        <AtelierScreen sessions={sessions} fresh={c !== 'offline'} sheet={sheet} onSheet={setSheet} onChat={noop} orient={orient} />
      </IPad>
    </>
  );
}

const TEXTS: [string, string, string][] = [
  ['nav.atelier', 'Atelier', 'Atelier'],
  ['atelier.subtitle(n, rooms, waiting)', '9 agents · 3 pièces · 2 attendent', '9 agents · 3 rooms · 2 waiting'],
  ['atelier.fullScreen', 'Plein écran', 'Full screen'],
  ['atelier.closePanel', 'Fermer le panneau', 'Close the panel'],
  ['atelier.room(n)', '4 agents', '4 agents'],
  ['atelier.ompNoThread / ompBody / ompTerminal', 'Pas de fil pour ce siège. / Ledge ne lit pas la conversation d’un siège OMP lancé par OpenRig. Son terminal montre son écran. / Ouvrir son terminal', 'No thread for this seat. / Ledge does not read the conversation of an OMP seat launched by OpenRig. Its terminal shows its screen. / Open its terminal'],
  ['atelier.unassignedHint (iPad)', 'Ledge ne relie ces sessions à aucun projet. On les range depuis le PC.', 'Ledge links these sessions to no project. File them from the PC.'],
  ['rooms.rigWhere(dossier, projet)', 'rig · ledge · projet Ledge (nom du dossier, pas le chemin) ; sans projet : rig · ledge', 'rig · ledge · project Ledge'],
  ['(repris tels quels)', 'Écrire au groupe · Envoyer · Annuler · Votre accord · Une question · Au travail · Disponible · Terminée · connecté / déconnecté', '']
];

function NotesView(): JSX.Element {
  return (
    <div className="mk-cards">
      <div className="mk-card">
        <p className="mk-kicker">La seule question pour Guillaume</p>
        <p><b>Toucher un agent : un panneau par-dessus l'Atelier, ou l'écran du fil comme aujourd'hui ?</b></p>
        <p>Recommandé : <b>le panneau</b>. On garde l'Atelier sous les yeux, on passe d'un agent à l'autre d'un toucher, et « Plein écran » mène au fil habituel. L'autre voie (aller au fil, puis ‹ Retour) ne coûte rien de plus, mais fait perdre la vue d'ensemble à chaque agent.</p>
      </div>
      <div className="mk-card">
        <p className="mk-kicker">Ajout au back (note de dev-back), nécessaire au lot 1</p>
        <ul>
          <li>Le téléphone ne connaît aujourd'hui ni les projets de l'utilisateur, ni le rig des sièges : sa session n'a que le nom de dossier. Le daemon ajoute, sous drapeau : <b>le projet de chaque session</b>, la <b>liste des projets (id, nom, couleur)</b> sans règles ni chemins, et le <b>rig (nom, rôle)</b> de chaque siège.</li>
          <li>Sans ce drapeau (PC plus ancien), pas d'onglet Atelier.</li>
          <li>Côté app : la logique de placement de Desktop (<code>atelier/layout.ts</code>, pure) passe dans un paquet partagé ; zoom et places réécrits côté mobile.</li>
          <li>Déjà possibles : répondre, décider, fermer, reprendre, écrire au groupe (par ids), le chat Ledge.</li>
        </ul>
      </div>
      <div className="mk-card">
        <p className="mk-kicker">L'ajustement iPad (comportement par défaut recommandé)</p>
        <ul>
          <li><b>Règle.</b> Lisible d'abord : à 100 %, un nom fait 13 px et un état 12 px ; il faut donc un zoom de 0,92 pour 11 pt. L'iPad montre une pièce entière dans le petit côté de l'écran (la hauteur en paysage, la largeur en portrait), au plus grand zoom qui tient, jamais au-dessus de 100 % ; les pièces suivent le long du grand côté, à faire défiler. <b>Plancher :</b> jamais sous 11/12 (états à 11 pt) ; si la place manque (bandeau « PC hors ligne », Split View, clavier), la pièce n'est plus entière et défile aussi dans l'autre sens, plutôt que de rapetisser.</li>
          <li><b>Mesuré dans la maquette</b> (3 pièces) : paysage 92 % (noms 12 px, états 11,1 px, 1,7 écran de large) ; portrait 94 % (12,2 et 11,3 px, 2 écrans de haut). Six pièces : même zoom, 3,3 écrans en paysage, 4 en portrait.</li>
          <li><b>Le tapis plus étroit.</b> La pièce garde sa table et ses places ; seul le tapis autour de la table passe de 130 à 90 px de chaque côté (<code>RUG_SIDE</code>, un paramètre de <code>layout.ts</code>). Sans lui, la pièce de 4 agents dépasse la largeur du portrait à 0,92.</li>
          <li><b>Faisable dans layout.ts partagé :</b> oui. Le calcul ne prend que la taille des pièces et celle de la vue (comme <code>widestRow</code> et <code>fitCeiling</code> dans <code>zoom.ts</code>). Il faut que la hauteur d'une pièce y soit connue : aujourd'hui elle vient de la CSS (714 px) ; elle devient une constante du paquet. Le hook de Desktop (<code>useAtelierView</code>) n'est pas repris : côté mobile, l'ajustement est réécrit (note de dev-back).</li>
          <li><b>À régler au passage :</b> avec le tapis plus étroit, le petit bot d'un sous-agent en bout de table chevauchait la plante de ce côté (chez Nova). La maquette retire la plante du côté où un sous-agent est assis (la liste <code>avoid</code> de <code>plantsFor</code>, comme pour « +N »).</li>
        </ul>
      </div>
      <div className="mk-card">
        <p className="mk-kicker">Ce qui ne bouge pas</p>
        <ul>
          <li>Le téléphone : pas d'onglet Atelier sous 768 px de large (ou en paysage court) ; ses trois onglets restent.</li>
          <li>Les autres écrans de l'app, sur iPad comme sur téléphone.</li>
        </ul>
      </div>
      <div className="mk-card mk-texts">
        <p className="mk-kicker">Textes FR / EN</p>
        <table className="mk-table"><tbody>{TEXTS.map(([k, fr, en]) => <tr key={k}><td><code>{k}</code></td><td>{fr}</td><td className="muted">{en}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

function App(): JSX.Element {
  const [theme, setTheme] = useState<Theme>((q.get('theme') as Theme) ?? 'dark');
  const [orient, setOrient] = useState<Orient>((q.get('orient') as Orient) ?? 'land');
  const [view, setView] = useState<View>((q.get('view') as View) ?? 'flow');
  document.documentElement.dataset.theme = theme;
  const VIEWS: [View, string][] = [['flow', '1 · Parcours'], ['cases', '2 · Cas limites'], ['actions', '3 · Actions'], ['notes', '4 · Question, back, textes']];
  return (
    <>
      <div className="mk-bar">
        <strong>Maquette · L'Atelier sur iPad</strong>
        <div className="mk-seg">{VIEWS.map(([v, l]) => <button key={v} aria-checked={view === v} onClick={() => setView(v)}>{l}</button>)}</div>
        <span className="mk-fill" />
        {(view === 'flow' || view === 'cases') && <div className="mk-seg">{(['land', 'port'] as Orient[]).map(o => <button key={o} aria-checked={orient === o} onClick={() => setOrient(o)}>{o === 'land' ? 'Paysage' : 'Portrait'}</button>)}</div>}
        <div className="mk-seg">{(['dark', 'light'] as Theme[]).map(x => <button key={x} aria-checked={theme === x} onClick={() => setTheme(x)}>{x === 'dark' ? 'Sombre' : 'Clair'}</button>)}</div>
      </div>
      <main className="mk-main">
        {view === 'flow' && <FlowView orient={orient} theme={theme} />}
        {view === 'cases' && <CasesView orient={orient} theme={theme} />}
        {view === 'actions' && <ActionsView />}
        {view === 'notes' && <NotesView />}
      </main>
    </>
  );
}

void session;
await loadMessages('fr');
createRoot(document.getElementById('root')!).render(<App />);
