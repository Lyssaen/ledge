import React, { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ResidentMascot } from '../../../apps/overlay/src/bots/ResidentMascot';
import { Shoulders } from '../../../apps/overlay/src/surface/Shoulders';

/* ------------------------------------------------------------------------------------------------------------------
 * Mockup: the closed notch shows Ledge alone, one activity line fed by every agent, and the music cover on the right.
 * Data follows dev-back's contract (feat/notch-activity-back 438a4268): packages/protocol/src/activity.ts + media.ts.
 * ---------------------------------------------------------------------------------------------------------------- */

type Theme = 'light' | 'dark';
type Lang = 'fr' | 'en';
type Reason = 'permission' | 'question' | 'plan' | 'diff' | 'finished' | 'error';
type ToolKind = 'read' | 'edit' | 'search' | 'command' | 'other';

/** One activity, as the contract's NotchActivity, resolved with the session names the snapshot gives. */
type Line =
  | { kind: 'message'; from: string; to: string; summary: string; helper?: boolean }
  | { kind: 'tool'; who: string; tool: string; target: string; helper?: boolean }
  | { kind: 'thinking'; who: string; helper?: boolean }
  | { kind: 'notification'; who: string; reason: Reason; text?: string }
  | { kind: 'track'; title: string; artist: string };

/** NowPlaying from media.ts, with `cover` standing for the artwork data URL. */
interface Music { title: string; artist: string; cover?: string; playing: boolean; can: { previous: boolean; playPause: boolean; next: boolean }; player: string }

/* Geometry (px). Awake height and paddings follow the current compact island (geometry.ts ISLAND); the rest is the filet. */
const G = { h: 38, padL: 12, padR: 12, resident: 22, lineGap: 10, lineMax: 420, musicGap: 12, cover: 24, coverR: 5, ctl: 28, titles: 168, filetH: 10, filetPad: 6, ledgeW: 9, max: 640 };
const WAKE_MS = 5000;

/* Invented covers: no real artwork. */
const COVERS = {
  a: 'linear-gradient(135deg, #e8a33c 0%, #c2452f 55%, #3b1530 100%)',
  b: 'linear-gradient(160deg, #9fd3c7 0%, #3a7a8c 50%, #162a3d 100%)',
  c: 'conic-gradient(from 210deg at 35% 40%, #f2e6d0, #b78ad9, #4b2a7a, #f2e6d0)'
};
const TRACK_A: Music = { title: 'Lignes de fuite', artist: 'Atelier Nord', cover: COVERS.a, playing: true, can: { previous: true, playPause: true, next: true }, player: 'Spotify' };
const TRACK_B: Music = { title: 'Sous la verrière', artist: 'Halles 72', cover: COVERS.b, playing: true, can: { previous: true, playPause: true, next: true }, player: 'Spotify' };
const TRACK_WEB: Music = { title: 'Live coding session #41 — building a notch in Tauri', artist: '', cover: COVERS.c, playing: true, can: { previous: false, playPause: true, next: true }, player: 'Microsoft Edge' };

/* ------------------------------------------------------------------ copy */

const kindOf = (tool: string): ToolKind =>
  /^(Edit|Write|MultiEdit|NotebookEdit|apply_patch)$/.test(tool) ? 'edit' : /^(Grep|Glob|LS|WebFetch|WebSearch)$/.test(tool) ? 'search' : tool === 'Read' ? 'read' : /^(Bash|Shell|exec_command)$/.test(tool) ? 'command' : 'other';

const COPY = {
  fr: {
    tool: { read: 'lit', edit: 'modifie', search: 'cherche', command: 'lance', other: (t: string) => `utilise ${t}` } as Record<Exclude<ToolKind, 'other'>, string> & { other: (t: string) => string },
    thinking: 'réfléchit…',
    reason: { permission: 'attend votre accord', question: 'vous pose une question', plan: 'vous soumet un plan', diff: 'vous montre un diff', finished: 'a terminé', error: 's’est arrêté sur une erreur' } as Record<Reason, string>,
    helper: 'sous-agent',
    by: 'de',
    open: (n: string) => `Ouvrir ${n} dans Ledge`,
    music: 'Musique en cours',
    noArtist: (p: string) => p,
    prev: 'Précédent', pause: 'Pause', play: 'Lecture', next: 'Suivant',
    cantPrev: 'Ce lecteur ne permet pas de revenir en arrière',
    cantNext: 'Ce lecteur ne permet pas de passer au suivant',
    cantPlay: 'Ce lecteur ne se met pas en pause depuis Ledge',
    paused: 'En pause',
    ago: (s: string) => `il y a ${s}`
  },
  en: {
    tool: { read: 'reads', edit: 'edits', search: 'searches', command: 'runs', other: (t: string) => `uses ${t}` } as Record<Exclude<ToolKind, 'other'>, string> & { other: (t: string) => string },
    thinking: 'is thinking…',
    reason: { permission: 'needs your approval', question: 'has a question', plan: 'has a plan for you', diff: 'has a diff for you', finished: 'is done', error: 'stopped on an error' } as Record<Reason, string>,
    helper: 'sub-agent',
    by: 'by',
    open: (n: string) => `Open ${n} in Ledge`,
    music: 'Now playing',
    noArtist: (p: string) => p,
    prev: 'Previous', pause: 'Pause', play: 'Play', next: 'Next',
    cantPrev: 'This player can’t go back',
    cantNext: 'This player can’t skip ahead',
    cantPlay: 'This player can’t be paused from Ledge',
    paused: 'Paused',
    ago: (s: string) => `${s} ago`
  }
};
type Copy = typeof COPY.fr;

/* ------------------------------------------------------------------ glyphs */

const TONE: Record<string, string> = { message: 'var(--task)', tool: 'var(--info)', thinking: 'var(--muted-foreground)', permission: 'var(--danger-text)', error: 'var(--danger-text)', question: 'var(--warning)', plan: 'var(--warning)', diff: 'var(--warning)', finished: 'var(--success)', track: 'var(--sidebar-primary)' };
const toneOf = (l: Line) => l.kind === 'notification' ? TONE[l.reason]! : TONE[l.kind]!;

function Glyph({ line, still }: { line: Line; still?: boolean }) {
  const c = toneOf(line);
  const common = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: c, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (line.kind === 'message') return <svg {...common}><path d="M2.5 8h9M8.5 4.5 12 8l-3.5 3.5" /></svg>;
  if (line.kind === 'tool') return <Spinner color={c} still={still} />;
  if (line.kind === 'thinking') return <span className="na-dots" data-still={still || undefined} aria-hidden="true"><i /><i /><i /></span>;
  if (line.kind === 'track') return <svg {...common}><path d="M6 12.2V3.6l7-1.4v8.4" /><circle cx="4.4" cy="12.2" r="1.7" /><circle cx="11.4" cy="10.6" r="1.7" /></svg>;
  const r = line.reason;
  if (r === 'finished') return <svg {...common}><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>;
  if (r === 'error') return <svg {...common}><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;
  if (r === 'permission') return <svg {...common}><path d="M8 2.2 13 4v3.6c0 3-2.2 5.2-5 6.2-2.8-1-5-3.2-5-6.2V4z" /></svg>;
  if (r === 'question') return <svg {...common}><path d="M5.8 6a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5v.4" /><circle cx="8" cy="12.6" r=".5" fill={c} /></svg>;
  return <svg {...common}><rect x="3" y="2.5" width="10" height="11" rx="1.6" /><path d="M5.5 6h5M5.5 9h3.5" /></svg>;
}

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
function Spinner({ color, still }: { color: string; still?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => { if (still) return; const t = setInterval(() => setI(n => (n + 1) % FRAMES.length), 80); return () => clearInterval(t); }, [still]);
  return <span className="na-spin" aria-hidden="true" style={{ color }}>{FRAMES[still ? 2 : i]}</span>;
}

/* ------------------------------------------------------------------ the line */

function text(line: Line, t: Copy): string {
  switch (line.kind) {
    case 'message': return `${line.from} → ${line.to} : ${line.summary}`;
    case 'tool': { const k = kindOf(line.tool); return `${line.who} ${k === 'other' ? t.tool.other(line.tool) : t.tool[k]} ${line.target}`; }
    case 'thinking': return `${line.who} ${t.thinking}`;
    case 'notification': return `${line.who} ${t.reason[line.reason]}${line.text ? ` : ${line.text}` : ''}`;
    case 'track': return line.artist ? `${line.title} · ${line.artist}` : line.title;
  }
}

function LineBody({ line, t, still, aged }: { line: Line; t: Copy; still?: boolean; aged?: string }) {
  const sub = 'helper' in line && line.helper ? <span className="na-sub">› {t.helper}</span> : null;
  let body: ReactNode;
  switch (line.kind) {
    case 'message': body = <><b>{line.from}</b>{sub}<span className="na-arrow">→</span><b>{line.to}</b><span className="na-text">{line.summary}</span></>; break;
    case 'tool': { const k = kindOf(line.tool); body = <><b>{line.who}</b>{sub}<span className="na-verb">{k === 'other' ? t.tool.other(line.tool) : t.tool[k]}</span><code>{line.target}</code></>; break; }
    case 'thinking': body = <><b>{line.who}</b>{sub}<span className="na-verb">{t.thinking}</span></>; break;
    case 'notification': body = <><b>{line.who}</b><span className="na-verb">{t.reason[line.reason]}</span>{line.text && <span className="na-text">{line.text}</span>}</>; break;
    case 'track': body = <><b>{line.title}</b>{line.artist && <span className="na-text">{line.artist}</span>}</>; break;
  }
  return <span className="na-line" data-kind={line.kind} data-aged={aged ? true : undefined} title={text(line, t)}>
    <span className="na-glyph"><Glyph line={line} still={still || !!aged} /></span>
    <span className="na-words">{body}</span>
    {aged && <span className="na-age">{aged}</span>}
  </span>;
}

/* ------------------------------------------------------------------ the music slot */

function Cover({ music, pulse }: { music: Music; pulse?: boolean }) {
  return <span className="na-cover" data-paused={!music.playing || undefined} data-pulse={pulse || undefined} data-empty={!music.cover || undefined} style={{ background: music.cover ?? undefined } as CSSProperties}>
    {!music.cover && <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M6 12.2V3.6l7-1.4v8.4" /><circle cx="4.4" cy="12.2" r="1.7" /><circle cx="11.4" cy="10.6" r="1.7" /></svg>}
    {!music.playing && <span className="na-pz" aria-hidden="true"><i /><i /></span>}
  </span>;
}

const Ico = {
  prev: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM20 5v14L9.5 12z" /></svg>,
  next: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM4 5v14l10.5-7z" /></svg>,
  pause: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4h3.5v16H7zM13.5 4H17v16h-3.5z" /></svg>,
  play: <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15L19.5 12z" /></svg>
};

function MusicSlot({ music, open, t, onToggle, onOpen, onClose, pulse }: { music: Music; open: boolean; t: Copy; onToggle?: () => void; onOpen?: () => void; onClose?: () => void; pulse?: boolean }) {
  const ctl = (key: 'prev' | 'play' | 'next') => {
    const allowed = key === 'prev' ? music.can.previous : key === 'next' ? music.can.next : music.can.playPause;
    const label = key === 'prev' ? t.prev : key === 'next' ? t.next : music.playing ? t.pause : t.play;
    const why = key === 'prev' ? t.cantPrev : key === 'next' ? t.cantNext : t.cantPlay;
    return <button type="button" className="na-ctl" data-play={key === 'play' || undefined} aria-label={label} aria-disabled={!allowed || undefined} title={allowed ? label : why} tabIndex={open ? 0 : -1}
      onClick={() => { if (allowed && key === 'play') onToggle?.(); }}>
      {key === 'play' ? (music.playing ? Ico.pause : Ico.play) : Ico[key]}
    </button>;
  };
  return <div className="na-music" data-open={open || undefined} onMouseEnter={onOpen} onMouseLeave={onClose} onFocus={onOpen} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onClose?.(); }}>
    <button type="button" className="na-cover-btn" aria-label={`${t.music} : ${music.title}${music.artist ? `, ${music.artist}` : ''}${music.playing ? '' : ` (${t.paused})`}`} aria-expanded={open}>
      <Cover music={music} pulse={pulse} />
    </button>
    <span className="na-titles" aria-hidden={!open}>
      <b>{music.title}</b>
      <span>{music.artist || music.player}{!music.playing && <em> · {t.paused}</em>}</span>
    </span>
    <span className="na-ctls">{ctl('prev')}{ctl('play')}{ctl('next')}</span>
  </div>;
}

/* ------------------------------------------------------------------ the notch */

type Rest = 'eq' | 'bare' | 'cover';

interface NotchProps {
  theme: Theme; lang: Lang; awake: boolean; line?: Line | null; music?: Music | null; open?: boolean; still?: boolean; aged?: string;
  rest?: Rest; pending?: 'permission' | 'question' | null; pulse?: boolean;
  onEnter?: () => void; onLeave?: () => void; onOpenMusic?: () => void; onCloseMusic?: () => void; onToggle?: () => void;
}

function Notch(p: NotchProps) {
  const t = COPY[p.lang];
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.offsetWidth)); ro.observe(el); setW(el.offsetWidth);
    return () => ro.disconnect();
  }, []);
  const music = p.music ?? null;
  const restCover = !p.awake && p.rest === 'cover' && music;
  const mode = p.awake ? 'awake' : restCover ? 'mini' : 'filet';
  return <div className="na-holder">
    <div ref={ref} className="na-notch" data-mode={mode} onMouseEnter={p.onEnter} onMouseLeave={p.onLeave}>
      {mode === 'filet' && <>
        <span className="na-ledge" data-pending={p.pending ?? undefined} title={t.open('Ledge')} />
        {music && music.playing && p.rest === 'eq' && <span className="na-eq" aria-label={`${t.music} : ${music.title}`}><i /><i /><i /></span>}
      </>}
      {mode === 'mini' && music && <>
        <span className="na-ledge" data-pending={p.pending ?? undefined} />
        <Cover music={music} />
      </>}
      {mode === 'awake' && <>
        <span className="na-resident"><ResidentMascot size={G.resident} theme={p.theme} reducedMotion={p.still} /></span>
        {p.line ? <button type="button" className="na-line-btn" aria-label={p.line.kind === 'track' ? text(p.line, t) : t.open(('who' in p.line ? p.line.who : 'from' in p.line ? p.line.from : ''))}>
          <LineBody line={p.line} t={t} still={p.still} aged={p.aged} />
        </button> : <span className="na-line-empty" />}
        {music && <>
          <span className="na-sep" aria-hidden="true" />
          <MusicSlot music={music} open={!!p.open} t={t} pulse={p.pulse} onOpen={p.onOpenMusic} onClose={p.onCloseMusic} onToggle={p.onToggle} />
        </>}
      </>}
    </div>
    {w > 0 && <Shoulders left={(ref.current?.offsetLeft ?? 0)} w={w} strip={mode !== 'awake'} transition="none" opacity={1} />}
  </div>;
}

/* ------------------------------------------------------------------ examples (real-looking text) */

const L = {
  message: { kind: 'message', from: 'Otto', to: 'Nova', summary: 'Maquette validée, tu peux brancher la ligne d’activité' } as Line,
  messageLong: { kind: 'message', from: 'pilot-lead', to: 'dev-front', summary: 'Relis la fiche de passation avant de commencer : la pochette ne doit jamais être coupée, c’est la ligne qui cède la place, et le survol garde l’encoche éveillée' } as Line,
  messageIn: { kind: 'message', from: 'review-qa', to: 'Otto', summary: 'Deux écarts sur le survol, détails dans la queue' } as Line,
  tool: { kind: 'tool', who: 'Otto', tool: 'Edit', target: 'surface/Handle.tsx' } as Line,
  toolCmd: { kind: 'tool', who: 'Nova', tool: 'Bash', target: 'pnpm --filter @ledge/overlay test' } as Line,
  toolRead: { kind: 'tool', who: 'Pim', tool: 'Read', target: 'protocol/src/media.ts' } as Line,
  toolSearch: { kind: 'tool', who: 'Bix', tool: 'Grep', target: '« sameTrack »' } as Line,
  toolHelper: { kind: 'tool', who: 'Otto', tool: 'Glob', target: 'apps/overlay/**/*.tsx', helper: true } as Line,
  thinking: { kind: 'thinking', who: 'Nova' } as Line,
  permission: { kind: 'notification', who: 'Pim', reason: 'permission', text: 'pnpm up --latest && pnpm test' } as Line,
  question: { kind: 'notification', who: 'Bix', reason: 'question', text: 'Migration progressive ou courte fenêtre de maintenance ?' } as Line,
  plan: { kind: 'notification', who: 'Otto', reason: 'plan' } as Line,
  finished: { kind: 'notification', who: 'Otto', reason: 'finished' } as Line,
  error: { kind: 'notification', who: 'Iris', reason: 'error', text: 'ECONNREFUSED 127.0.0.1:7317' } as Line,
  track: { kind: 'track', title: TRACK_B.title, artist: TRACK_B.artist } as Line,
  trackWeb: { kind: 'track', title: TRACK_WEB.title, artist: '' } as Line
};

/* ------------------------------------------------------------------ page parts */

function Desk({ theme, children, tall, label }: { theme: Theme; children: ReactNode; tall?: boolean; label?: string }) {
  return <div className={`na-desk th-${theme}`} data-tall={tall || undefined} data-theme-scope={theme}>
    {children}
    {label && <span className="na-desk-label">{label}</span>}
  </div>;
}

/** The same state in light and dark, side by side. */
function Pair({ title, note, tag, lang, ...props }: Omit<NotchProps, 'theme'> & { title: string; note: ReactNode; tag: string; lang: Lang }) {
  return <figure className="na-pair">
    <div className="na-pair-row">
      <Desk theme="light"><Notch theme="light" lang={lang} still {...props} /></Desk>
      <Desk theme="dark"><Notch theme="dark" lang={lang} still {...props} /></Desk>
    </div>
    <figcaption><span className="na-tag">{tag}</span><strong>{title}</strong><span>{note}</span></figcaption>
  </figure>;
}

function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return <section className="na-section" aria-labelledby={id}>
    <header><h2 id={id}>{title}</h2>{lead && <p>{lead}</p>}</header>
    {children}
  </section>;
}

/* ------------------------------------------------------------------ the live demo */

type Scenario = { id: string; label: string; run: (api: LiveApi) => void };
interface LiveApi { show: (l: Line) => void; music: (m: Music | null) => void; later: (ms: number, f: () => void) => void }

const SCENARIOS: Scenario[] = [
  { id: 'tool', label: 'Action', run: a => a.show(L.tool) },
  { id: 'thinking', label: 'Réflexion', run: a => a.show(L.thinking) },
  { id: 'permission', label: 'Demande d’accord', run: a => a.show(L.permission) },
  { id: 'finished', label: 'Tour terminé', run: a => a.show(L.finished) },
  { id: 'message', label: 'Message agent → agent', run: a => a.show(L.message) },
  { id: 'burst', label: 'Rafale d’actions', run: a => { a.show(L.toolRead); a.later(700, () => a.show(L.toolSearch)); a.later(1400, () => a.show(L.toolCmd)); a.later(2300, () => a.show(L.thinking)); } },
  { id: 'track', label: 'Changement de morceau', run: a => { a.music(TRACK_B); a.show(L.track); } },
  { id: 'collide', label: 'Morceau puis message', run: a => { a.music(TRACK_B); a.show(L.track); a.later(1500, () => a.show(L.message)); a.later(2400, () => a.show(L.tool)); } },
  { id: 'stop', label: 'Plus de musique', run: a => a.music(null) }
];

const RANK: Record<Line['kind'], number> = { message: 3, notification: 2, track: 1.5, tool: 1, thinking: 1 };

function Live({ lang }: { lang: Lang }) {
  const [theme, setTheme] = useState<Theme>('dark');
  const [awake, setAwake] = useState(false);
  const [line, setLine] = useState<Line | null>(null);
  const [music, setMusic] = useState<Music | null>(TRACK_A);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [pulse, setPulse] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const sleep = useRef<ReturnType<typeof setTimeout>>();
  const hold = useRef<{ line: Line; until: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const t = COPY[lang];

  const wake = () => { setAwake(true); clearTimeout(sleep.current); sleep.current = setTimeout(() => setAwake(false), WAKE_MS); };
  useEffect(() => { if (hover || open) clearTimeout(sleep.current); else if (awake) { clearTimeout(sleep.current); sleep.current = setTimeout(() => setAwake(false), WAKE_MS); } }, [hover, open]); // eslint-disable-line
  useEffect(() => () => { clearTimeout(sleep.current); timers.current.forEach(clearTimeout); }, []);

  const api: LiveApi = {
    show: l => {
      const now = Date.now();
      const h = hold.current;
      // A message keeps the line at least 3 s; anything below it is dropped meanwhile (the next one replaces it).
      if (h && h.until > now && RANK[l.kind] < RANK[h.line.kind]) { setLog(g => [`ignoré pendant le message : ${text(l, t)}`, ...g].slice(0, 5)); return; }
      hold.current = l.kind === 'message' ? { line: l, until: now + 3000 } : l.kind === 'notification' ? { line: l, until: now + 2000 } : l.kind === 'track' ? { line: l, until: now + 1200 } : null;
      setLine(l); if (l.kind === 'track') setPulse(k => k + 1);
      setLog(g => [text(l, t), ...g].slice(0, 5));
      wake();
    },
    music: m => setMusic(m),
    later: (ms, f) => { timers.current.push(setTimeout(f, ms)); }
  };

  return <div className="na-live">
    <Desk theme={theme} tall>
      <Notch theme={theme} lang={lang} awake={awake || hover} line={awake ? line : line} aged={!awake && hover && line ? t.ago('12 s') : undefined} music={music} open={open} rest="eq" pulse={pulse % 2 === 1}
        onEnter={() => setHover(true)} onLeave={() => { setHover(false); setOpen(false); }} onOpenMusic={() => setOpen(true)} onCloseMusic={() => setOpen(false)}
        onToggle={() => setMusic(m => m && { ...m, playing: !m.playing })} />
      <p className="na-live-hint">{awake || hover ? (hover ? 'Le survol garde l’encoche éveillée.' : 'Éveillée 5 s, puis elle se rendort.') : 'Au repos : le filet. Survole-le ou lance un événement.'}</p>
    </Desk>
    <div className="na-controls">
      <div className="na-chips" role="group" aria-label="Événements">
        {SCENARIOS.map(s => <button key={s.id} type="button" className="na-chip" onClick={() => { timers.current.forEach(clearTimeout); timers.current = []; s.run(api); }}>{s.label}</button>)}
      </div>
      <div className="na-chips" role="group" aria-label="Thème de la démo">
        <button type="button" className="na-chip" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Sombre</button>
        <button type="button" className="na-chip" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Clair</button>
      </div>
      <ol className="na-log" aria-label="Dernières lignes">{log.map((g, i) => <li key={i + g}>{g}</li>)}</ol>
    </div>
  </div>;
}

/* ------------------------------------------------------------------ copy table, questions, gaps */

const KEYS: [string, string, string][] = [
  ['notch.line.message(from, to, summary)', '{from} → {to} · résumé', '{from} → {to} · summary'],
  ['notch.line.tool.read(who, target)', '{who} lit {cible}', '{who} reads {target}'],
  ['notch.line.tool.edit', '{who} modifie {cible}', '{who} edits {target}'],
  ['notch.line.tool.search', '{who} cherche {cible}', '{who} searches {target}'],
  ['notch.line.tool.command', '{who} lance {commande}', '{who} runs {command}'],
  ['notch.line.tool.other(tool)', '{who} utilise {outil} {cible}', '{who} uses {tool} {target}'],
  ['notch.line.helper', '› sous-agent', '› sub-agent'],
  ['notch.line.thinking', '{who} réfléchit…', '{who} is thinking…'],
  ['notch.line.permission', '{who} attend votre accord · {texte}', '{who} needs your approval · {text}'],
  ['notch.line.question', '{who} vous pose une question · {texte}', '{who} has a question · {text}'],
  ['notch.line.plan', '{who} vous soumet un plan', '{who} has a plan for you'],
  ['notch.line.diff', '{who} vous montre un diff', '{who} has a diff for you'],
  ['notch.line.finished', '{who} a terminé', '{who} is done'],
  ['notch.line.error', '{who} s’est arrêté sur une erreur · {texte}', '{who} stopped on an error · {text}'],
  ['notch.line.track', '{titre} · {artiste}', '{title} · {artist}'],
  ['notch.line.ago(t)', 'il y a {t}', '{t} ago'],
  ['notch.line.open(who)', 'Ouvrir {who} dans Ledge (aria, info-bulle)', 'Open {who} in Ledge'],
  ['notch.music.label', 'Musique en cours : {titre}, {artiste}', 'Now playing: {title}, {artist}'],
  ['notch.music.prev / playPause / next', 'Précédent · Pause / Lecture · Suivant', 'Previous · Pause / Play · Next'],
  ['notch.music.cantPrev / cantNext / cantPlay', 'Ce lecteur ne permet pas de revenir en arrière / de passer au suivant / ne se met pas en pause depuis Ledge', 'This player can’t go back / can’t skip ahead / can’t be paused from Ledge'],
  ['notch.music.paused', 'En pause', 'Paused']
];

const QUESTIONS: [string, ReactNode, ReactNode][] = [
  ['Au repos avec musique, que voit-on ?', <>A : trois barres fixes à droite du trait de Ledge. B : rien, le filet reste nu. C : une mini-encoche de 30 px avec la pochette, qui ne se rendort jamais vraiment.</>, <>A. On sait que ça joue sans que l’encoche grandisse. C contredit « se rendort ».</>],
  ['Un morceau en pause : on le montre ?', <>Le contrat envoie la pause (playing = false). La maquette musique précédente avait fixé « visible 5 min en pause ».</>, <>Oui : pochette grisée avec le signe pause, réveillée seulement au survol. Après 5 min de pause, plus rien.</>],
  ['Faut-il réveiller l’encoche à chaque action ?', <>Avec plusieurs agents, une action arrive presque chaque seconde. L’encoche ne dormirait plus jamais.</>, <>Les messages, les notifications et le changement de morceau réveillent toujours. Une action ou une réflexion réveille seulement si l’encoche dort depuis au moins 20 s. Quand elle est déjà éveillée, elle remplace la ligne sans prolonger les 5 s.</>],
  ['Une demande d’accord en attente, après les 5 s ?', <>Avant, le filet montrait un tiret orange par session qui attendait. Ledge seul n’en garde plus aucune trace.</>, <>Le trait de Ledge prend la couleur de la demande la plus urgente (rouge pour un accord, ambre pour une question) jusqu’à la réponse.</>],
  ['Survoler le filet sans événement récent', <>L’encoche se réveille au survol, comme aujourd’hui. Mais que met-on dans la ligne ?</>, <>La dernière ligne, en gris, avec son âge (« il y a 12 s »). S’il n’y en a pas, Ledge et la pochette seuls.</>],
  ['Un clic sur la ligne', <>Aujourd’hui, un clic sur un bot ouvre sa session.</>, <>Il ouvre la session de l’agent dans Ledge Desktop. Pour un message, celle de l’expéditeur. Un clic sur la ligne d’un morceau ne fait rien.</>],
  ['Le chat de Ledge et les vues ouvertes', <>Hors du sujet de cette maquette. Le clic sur Ledge reste celui d’aujourd’hui.</>, <>Pas de changement.</>]
];

const GAPS: [string, string][] = [
  ['Réflexion sans texte', 'Le contrat a « thinking » sans contenu. La ligne dit « Nova réfléchit… », sans extrait. C’est suffisant pour la maquette.'],
  ['Nom du destinataire', '« counterpart » est une adresse (dev-front@ledge-dev-2) quand le destinataire n’est pas une session Ledge. Le front affiche ce qui précède « @ ». Quand « peer » est là, il affiche le prénom de la session.'],
  ['Sous-agent', 'Le contrat donne seulement « helperId ». La ligne dit « Otto › sous-agent », sans le nom de la tâche. Pour l’afficher, il faudrait lire session.helpers[].task : c’est possible, mais non retenu.'],
  ['Libellé d’outil', '« label » vaut par exemple « Edit src/a.ts ». Le front retire le nom de l’outil en tête pour garder la cible, puis la ramène à ses 2 derniers segments (target() existant).'],
  ['Pochette en retard', 'L’artwork peut arriver après le titre. Le front montre d’abord un carré neutre avec une note, puis la pochette en fondu de 200 ms.']
];

/* ------------------------------------------------------------------ page */

function Page() {
  const [lang, setLang] = useState<Lang>('fr');
  const [pageTheme, setPageTheme] = useState<Theme>('dark');
  useEffect(() => { document.documentElement.dataset.theme = pageTheme; }, [pageTheme]);
  const paused = { ...TRACK_A, playing: false };
  const noCover = { ...TRACK_B, cover: undefined };
  return <main className="na-page">
    <header className="na-top">
      <div>
        <h1>Encoche fermée : Ledge, une ligne, la musique</h1>
        <p>Les bots disparaissent de l’encoche. Ledge reste seul et l’encoche se réveille 5 s sur chaque événement d’un agent, sur une seule ligne. La pochette du morceau en cours se place à droite.</p>
      </div>
      <div className="na-chips">
        <button type="button" className="na-chip" aria-pressed={lang === 'fr'} onClick={() => setLang('fr')}>FR</button>
        <button type="button" className="na-chip" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        <button type="button" className="na-chip" aria-pressed={pageTheme === 'dark'} onClick={() => setPageTheme(pageTheme === 'dark' ? 'light' : 'dark')}>Page {pageTheme === 'dark' ? 'sombre' : 'claire'}</button>
      </div>
    </header>

    <Live lang={lang} />

    <Section id="anatomy" title="Anatomie" lead="Éveillée : 38 px de haut, comme l’île compacte d’aujourd’hui. Largeur selon le contenu, 640 px au plus. Si la place manque, c’est la ligne qui se coupe, jamais la pochette.">
      <figure className="na-anatomy">
        <Desk theme="dark"><Notch theme="dark" lang={lang} awake still line={L.tool} music={TRACK_A} /></Desk>
        <ol>
          <li><b>Ledge</b> 22 px, marge gauche 12. Seule mascotte de l’encoche.</li>
          <li><b>Ligne</b> à 10 px de Ledge, 13 px, 420 px au plus. Symbole de 14 px dans la couleur du type, prénom en 600, verbe en gris, cible en mono 12 px, « … » à la fin.</li>
          <li><b>Filet vertical</b> 1×16 en --sidebar-border, à 12 px de la ligne. Il n’existe que si un morceau est là.</li>
          <li><b>Pochette</b> 24 px, rayon 5, à 10 px du filet, marge droite 12.</li>
        </ol>
      </figure>
    </Section>

    <Section id="rest" title="Au repos" lead="Le filet de 10 px garde seulement le trait de Ledge : plus de tiret par session.">
      <div className="na-grid">
        <Pair lang={lang} tag="R1" title="Rien ne joue" note="Le trait de Ledge seul (9×3, couleur d’accent). Rien du côté de la musique." awake={false} music={null} />
        <Pair lang={lang} tag="R2 · recommandé" title="Musique en cours, variante A" note="Trois barres fixes de 1 px en gris, à 4 px du trait. Elles disparaissent en pause." awake={false} music={TRACK_A} rest="eq" />
        <Pair lang={lang} tag="R2 · B" title="Musique en cours, variante B" note="Rien au repos : la pochette n’apparaît qu’au réveil." awake={false} music={TRACK_A} rest="bare" />
        <Pair lang={lang} tag="R2 · C" title="Musique en cours, variante C" note="Mini-encoche de 30 px, toujours visible. Plus présente, mais l’encoche ne se rendort plus vraiment." awake={false} music={TRACK_A} rest="cover" />
        <Pair lang={lang} tag="R3 · proposé" title="Une demande attend" note="Après les 5 s, le trait de Ledge garde la couleur de la demande (rouge pour un accord, ambre pour une question) jusqu’à la réponse." awake={false} music={TRACK_A} rest="eq" pending="permission" />
      </div>
    </Section>

    <Section id="wake" title="Réveil par type d’événement" lead="Chaque ligne commence par le prénom de l’agent. L’ordre est la priorité : un message passe devant une notification, qui passe devant une action ou une réflexion.">
      <div className="na-grid">
        <Pair lang={lang} tag="1 · message" title="Message entre agents" note="Expéditeur → destinataire, puis le résumé d’une ligne. Symbole violet (--task)." awake line={L.message} music={TRACK_A} />
        <Pair lang={lang} tag="1 · message reçu" title="D’un agent inconnu de Ledge" note="Le contrat dit « in » : l’expéditeur vient de counterpart, ici un siège OpenRig." awake line={L.messageIn} music={TRACK_A} />
        <Pair lang={lang} tag="2 · notification" title="Demande d’accord" note="Le texte de la demande suit, en mono pour une commande." awake line={L.permission} music={TRACK_A} />
        <Pair lang={lang} tag="2 · notification" title="Question" note="Ambre, comme l’état « question » des badges." awake line={L.question} music={TRACK_A} />
        <Pair lang={lang} tag="2 · notification" title="Plan sans texte" note="Plan et diff ont la même forme, sans texte quand le contrat n’en donne pas." awake line={L.plan} music={TRACK_A} />
        <Pair lang={lang} tag="2 · notification" title="Tour terminé" note="Vert. Pas de durée : le contrat ne la donne pas." awake line={L.finished} music={TRACK_A} />
        <Pair lang={lang} tag="2 · notification" title="Erreur" note="Rouge, avec le message de l’erreur." awake line={L.error} music={TRACK_A} />
        <Pair lang={lang} tag="3 · action" title="Action en cours" note="Le spinner tourne (80 ms, comme LiveToolLine). Verbe selon l’outil, cible en mono." awake line={L.tool} music={TRACK_A} />
        <Pair lang={lang} tag="3 · action" title="Commande" note="Une commande garde ses premiers mots, coupés à 40 caractères." awake line={L.toolCmd} music={TRACK_A} />
        <Pair lang={lang} tag="3 · sous-agent" title="Action d’un sous-agent" note="Rattachée à l’agent principal : « Otto › sous-agent »." awake line={L.toolHelper} music={TRACK_A} />
        <Pair lang={lang} tag="3 · réflexion" title="Réflexion" note="Trois points qui pulsent lentement, sans texte de réflexion (le contrat n’en a pas)." awake line={L.thinking} music={TRACK_A} />
        <Pair lang={lang} tag="sans musique" title="Même ligne, rien ne joue" note="Ni filet ni pochette : l’encoche se termine après la ligne." awake line={L.tool} music={null} />
      </div>
    </Section>

    <Section id="long" title="Texte long" lead="Une seule ligne, toujours. Le texte se coupe avec « … » à 420 px. L’info-bulle donne la ligne entière.">
      <div className="na-grid">
        <Pair lang={lang} tag="troncature" title="Long message entre agents" note="Les deux prénoms restent entiers ; seul le résumé se coupe." awake line={L.messageLong} music={TRACK_A} />
        <Pair lang={lang} tag="troncature" title="Long titre de vidéo, sans artiste" note="Une vidéo web n’a souvent pas d’artiste : le titre seul." awake line={L.trackWeb} music={TRACK_WEB} />
      </div>
    </Section>

    <Section id="music" title="La musique" lead="Source : les contrôles média de Windows, tous les lecteurs. Quand le morceau change, l’encoche se réveille 5 s avec le titre et l’artiste dans la ligne, et la pochette fait un léger rebond.">
      <div className="na-grid">
        <Pair lang={lang} tag="M1" title="Changement de morceau" note="Symbole note dans la couleur d’accent, titre en 600, artiste en gris." awake line={L.track} music={TRACK_B} />
        <Pair lang={lang} tag="M2" title="Pochette pas encore arrivée" note="Carré neutre avec une note, puis la pochette en fondu quand elle arrive." awake line={L.track} music={noCover} />
        <Pair lang={lang} tag="M3" title="Survol de la pochette" note="L’encoche s’élargit vers la droite : titre et artiste sur deux lignes (168 px max), puis précédent, lecture/pause, suivant : trois icônes simples de 15 px, sans fond rond, dans des zones de 28 px. La ligne d’activité se coupe davantage." awake line={L.tool} music={TRACK_A} open />
        <Pair lang={lang} tag="M4" title="Bouton refusé par le lecteur" note="Désactivé, pas caché : opacité 0,35, curseur normal, info-bulle « Ce lecteur ne permet pas de revenir en arrière »." awake line={null} music={TRACK_WEB} open />
        <Pair lang={lang} tag="M5" title="En pause, au survol" note="Pochette grisée avec le signe pause, « En pause » sous l’artiste, bouton Lecture." awake line={null} music={paused} open />
        <Pair lang={lang} tag="M6" title="En pause, éveillée par un agent" note="La pochette reste grisée. Après 5 min de pause, elle disparaît avec son filet." awake line={L.thinking} music={paused} />
      </div>
    </Section>

    <Section id="collide" title="Collision : morceau puis message" lead="Le morceau change et, 1,5 s plus tard, Otto écrit à Nova. Le message prend la ligne tout de suite. La pochette reste, mais le titre du morceau n’est pas rejoué.">
      <div className="na-frames">
        {[{ at: '0 s', line: L.track, note: 'Réveil sur le morceau' }, { at: '1,5 s', line: L.message, note: 'Le message prend la ligne et le compte repart pour 5 s' }, { at: '2,4 s', line: L.message, note: 'Une action arrive : ignorée, le message garde la ligne au moins 3 s' }, { at: '6,5 s', line: null, note: 'Rendormie : le filet et ses barres' }].map((f, i) =>
          <figure key={i} className="na-frame">
            <Desk theme="dark">{f.line ? <Notch theme="dark" lang={lang} awake still line={f.line} music={TRACK_B} /> : <Notch theme="dark" lang={lang} awake={false} music={TRACK_B} rest="eq" />}</Desk>
            <figcaption><span className="na-tag">{f.at}</span><span>{f.note}</span></figcaption>
          </figure>)}
      </div>
      <table className="na-rules">
        <thead><tr><th>Arrive pendant que la ligne montre…</th><th>Message</th><th>Notification</th><th>Morceau</th><th>Action ou réflexion</th></tr></thead>
        <tbody>
          <tr><th>Message (≥ 3 s)</th><td>remplace</td><td>attend, puis s’affiche si elle date de moins de 5 s</td><td>ignoré (pochette mise à jour)</td><td>ignorée</td></tr>
          <tr><th>Notification (≥ 2 s)</th><td>remplace</td><td>remplace</td><td>ignoré (pochette mise à jour)</td><td>ignorée</td></tr>
          <tr><th>Morceau (≥ 1,2 s)</th><td>remplace</td><td>remplace</td><td>remplace</td><td>attend 1,2 s</td></tr>
          <tr><th>Action ou réflexion</th><td>remplace</td><td>remplace</td><td>remplace</td><td>remplace, sans prolonger les 5 s</td></tr>
        </tbody>
      </table>
      <p className="na-small">Chaque réveil compte 5 s depuis la dernière ligne qui réveille. Le survol de l’encoche ou de la pochette suspend le compte. Le compte repart à la sortie du pointeur. Le contrat (outranks) classe déjà message 3 &gt; notification 2 &gt; action et réflexion 1. Le morceau, propre au front, se place entre les deux.</p>
    </Section>

    <Section id="behaviour" title="Comportements">
      <ul className="na-list">
        <li><b>Survol du filet</b> : il se réveille comme aujourd’hui. La ligne montre le dernier événement en gris, avec son âge (« il y a 12 s »). S’il n’y en a pas : Ledge et la pochette seuls.</li>
        <li><b>Clic sur la ligne</b> : ouvre la session de l’agent dans Ledge Desktop (expéditeur pour un message). Rien pour un morceau.</li>
        <li><b>Clic sur Ledge</b> : inchangé.</li>
        <li><b>Survol ou focus de la pochette</b> : ouvre les commandes, 180 ms d’animation de largeur. Elles se referment à la sortie du pointeur ou du focus.</li>
        <li><b>Clavier</b> : Tab atteint Ledge, la ligne, la pochette, puis les trois boutons quand ils sont ouverts. Entrée ou Espace les active. Le focus visible est un contour de 2 px en couleur d’accent.</li>
        <li><b>Mouvement réduit</b> : pas de spinner (symbole fixe), pas de points qui pulsent, pas de rebond de pochette ; le réveil se fait par un fondu simple.</li>
        <li><b>Ne pas déranger</b> : inchangé pour la mascotte. Les réveils sont suspendus, sauf les demandes d’accord et les questions (comme les bulles aujourd’hui).</li>
        <li><b>Mobile</b> : l’encoche n’existe que sur Windows ; pas d’écran mobile concerné.</li>
      </ul>
    </Section>

    <Section id="copy" title="Textes FR / EN" lead="Clés proposées pour apps/overlay/src/i18n/messages.ts. Aucun texte n’est fixé côté daemon.">
      <table className="na-keys"><thead><tr><th>Clé</th><th>FR</th><th>EN</th></tr></thead>
        <tbody>{KEYS.map(([k, fr, en]) => <tr key={k}><td><code>{k}</code></td><td>{fr}</td><td>{en}</td></tr>)}</tbody></table>
    </Section>

    <Section id="gaps" title="Données : ce que la maquette lit dans le contrat" lead="Contrat de dev-back, branche feat/notch-activity-back (438a4268), fichiers packages/protocol/src/activity.ts et media.ts.">
      <ul className="na-list">{GAPS.map(([a, b]) => <li key={a}><b>{a}</b> : {b}</li>)}</ul>
    </Section>

    <Section id="open" title="Questions ouvertes pour toi" lead="Ma recommandation est en gras. Rien n’est tranché tant que tu ne l’as pas dit.">
      <ol className="na-questions">{QUESTIONS.map(([q, ctx, reco]) => <li key={q}><b>{q}</b><p>{ctx}</p><p className="na-reco">{reco}</p></li>)}</ol>
    </Section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Page />);
