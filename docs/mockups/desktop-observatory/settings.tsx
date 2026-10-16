import React, { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Bot } from '../../../apps/overlay/src/bots/Bot';
import { ResidentMascot } from '../../../apps/overlay/src/bots/ResidentMascot';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Kbd } from '../../../apps/overlay/src/ui/Kbd';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { DEFAULT_ACCENT, parseAccent } from '../../../apps/overlay/src/accent';

/* Réglages: every setting of Ledge, the island's included, in one page of Ledge Desktop.
   Sources: apps/overlay SettingsView + MachineSettings (island), apps/desktop/src/settings (branch feat/desktop). */

type Tool = 'claude' | 'codex' | 'cursor';
export type SectionId = 'general' | 'appearance' | 'island' | 'notifications' | 'sounds' | 'machines' | 'projects' | 'shortcuts' | 'about';
export type MachineEntry = { id: string; label: string; ssh?: string; version: string; install: 'npm' | 'git'; reachable?: boolean };
export type FolderRule = { id: string; folder: string; machine: string; project: string };
import { LedgeSuggestions, basename, type Project, type Proposal } from './projects';
type Scale = 'auto' | 1 | 1.25 | 1.5 | 2;
type EventKey = 'approval' | 'question' | 'finished' | 'error' | 'team';
type Channel = 'island' | 'windows' | 'app';

export type Prefs = {
  lang: 'fr' | 'en'; autostart: boolean; tool: Tool; autoUpdate: boolean; checkedAt: number;
  accent: string | null; reduced: boolean; scale: Scale;
  island: boolean; screen: 'primary' | 'second'; position: 'center' | 'left' | 'right'; discreet: boolean; islandScale: Scale; panelScale: Scale;
  islandShows: { finished: boolean; say: boolean; helpers: boolean; quick: boolean }; islandKey: string;
  dnd: boolean; dndSchedule: boolean; dndFrom: string; dndTo: string; dndDays: boolean[];
  events: Record<EventKey, Record<Channel, boolean>>; toastSeconds: number;
  sounds: boolean; volume: 'quiet' | 'normal' | 'loud'; categories: Record<'requests' | 'finished' | 'errors' | 'decisions' | 'team', boolean>; behind: boolean;
  rememberFolders: boolean;
};
export const DEFAULT_PREFS: Prefs = {
  lang: 'fr', autostart: true, tool: 'claude', autoUpdate: true, checkedAt: Date.now() - 42 * 60e3,
  accent: null, reduced: false, scale: 'auto',
  island: true, screen: 'primary', position: 'center', discreet: true, islandScale: 'auto', panelScale: 'auto',
  islandShows: { finished: true, say: true, helpers: true, quick: true }, islandKey: 'Ctrl Alt L',
  dnd: false, dndSchedule: false, dndFrom: '19:00', dndTo: '08:00', dndDays: [true, true, true, true, true, false, false],
  events: {
    approval: { island: true, windows: true, app: true }, question: { island: true, windows: true, app: true },
    finished: { island: true, windows: false, app: true }, error: { island: true, windows: true, app: true }, team: { island: false, windows: false, app: false }
  },
  toastSeconds: 6,
  sounds: true, volume: 'normal', categories: { requests: true, finished: true, errors: true, decisions: true, team: false }, behind: true,
  rememberFolders: true
};
export const INITIAL_MACHINES: MachineEntry[] = [
  { id: 'local', label: 'PC local', version: '0.5.4', install: 'npm' },
  { id: 'dev', label: 'Dev SSH', ssh: 'dev', version: '0.5.4', install: 'npm' },
  { id: 'studio', label: 'Studio SSH', ssh: 'studio', version: '0.5.2', install: 'git' }
];
export const INITIAL_RULES: FolderRule[] = [
  { id: 'r1', folder: '~/Workspace/ledge-notes', machine: 'PC local', project: 'ledge' },
  { id: 'r2', folder: '/srv/shop/scripts', machine: 'Dev SSH', project: 'commerce' }
];

const P = (d: string[]) => d;
export const gearIcon = ICONS.gear.d;
const SECTIONS: { id: SectionId; label: string; hint: string; icon: readonly string[] }[] = [
  { id: 'general', label: 'Général', hint: 'Langue, démarrage, harnais par défaut et mises à jour.', icon: P(['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6']) },
  { id: 'appearance', label: 'Apparence', hint: 'Thème, couleur de Ledge, échelle et mouvements.', icon: P(['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 3v18']) },
  { id: 'island', label: 'Île', hint: 'L’île en haut de l’écran : où elle se pose et ce qu’elle signale.', icon: P(['M3 5h18v14H3z', 'M9 5h6v1.5a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 6.5z']) },
  { id: 'notifications', label: 'Notifications', hint: 'Qui vous prévient, et quand vous laisser tranquille.', icon: P(['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10.3 21a1.94 1.94 0 0 0 3.4 0']) },
  { id: 'sounds', label: 'Sons', hint: 'Les signaux sonores de votre équipe.', icon: P(['M11 5 6 9H2v6h4l5 4V5Z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M19 5a10 10 0 0 1 0 14']) },
  { id: 'machines', label: 'Machines', hint: 'Cette machine et vos serveurs SSH. Une seule liste pour l’île et Ledge Desktop.', icon: P(['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8']) },
  { id: 'projects', label: 'Projets', hint: 'Projets, dépôts et dossiers mémorisés.', icon: ICONS.folder.d },
  { id: 'shortcuts', label: 'Raccourcis clavier', hint: 'Dans l’application, et partout dans Windows.', icon: P(['M2 6h20v12H2z', 'M6 10h.01', 'M10 10h.01', 'M14 10h.01', 'M18 10h.01', 'M7 14h10']) },
  { id: 'about', label: 'À propos', hint: 'Versions, journal et réinitialisation.', icon: P(['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 16v-4', 'M12 8h.01']) }
];
export const sectionLabel = (id: SectionId) => SECTIONS.find(s => s.id === id)!.label;

const TOOLS: { id: Tool; label: string }[] = [{ id: 'claude', label: 'Claude Code' }, { id: 'codex', label: 'Codex' }, { id: 'cursor', label: 'Cursor Agent' }];
const SCALES: Scale[] = ['auto', 1, 1.25, 1.5, 2];
const pct = (s: number) => `${Math.round(s * 100)} %`;
const scaleOptions = (auto: number) => SCALES.map(s => ({ value: s, label: s === 'auto' ? `Auto (${pct(auto)})` : pct(s), wide: s === 'auto' }));
const ACCENTS = [['Corail', DEFAULT_ACCENT], ['Ambre', '#e0a33a'], ['Menthe', '#2fb380'], ['Lagon', '#2b9fc4'], ['Indigo', '#6a6ff0'], ['Prune', '#b55bc9']] as const;
const DAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const EVENTS: { id: EventKey; label: string; hint: string }[] = [
  { id: 'approval', label: 'Un agent attend votre accord', hint: 'Commande, écriture ou publication à valider.' },
  { id: 'question', label: 'Un agent vous pose une question', hint: 'Il ne reprend qu’après votre réponse.' },
  { id: 'finished', label: 'Un agent ou Ledge a terminé', hint: 'Une tâche principale arrive au bout.' },
  { id: 'error', label: 'Quelque chose échoue', hint: 'Erreur d’un agent, machine déconnectée.' },
  { id: 'team', label: 'Un agent arrive ou part', hint: 'Démarrage, sous-agent, fin de session.' }
];
const CHANNELS: { id: Channel; label: string }[] = [{ id: 'island', label: 'Île' }, { id: 'windows', label: 'Notification Windows' }, { id: 'app', label: 'Dans l’app' }];
const SOUND_CATEGORIES = [['requests', 'Un bot a besoin de vous · accord, question'], ['finished', 'Un bot ou Ledge a terminé sa tâche'], ['errors', 'Quelque chose échoue'], ['decisions', 'Vous acceptez ou refusez'], ['team', 'Un bot arrive ou part']] as const;
/** Aliases the simulated ~/.ssh/config of WSL knows. */
const KNOWN_ALIASES: Record<string, string> = { dev: '0.5.4', studio: '0.5.2', 'gpu-box': '0.5.4', nas: '0.5.3' };
const ALIAS = /^[a-zA-Z0-9._-]+$/;
const PROBLEMS = {
  alias: 'Alias introuvable. Ajoutez un bloc Host pour cet alias dans ~/.ssh/config de WSL.',
  unreachable: 'Le serveur ne répond pas. Il est peut-être éteint, ou hors du réseau.'
};
const GLOBAL_KEYS = [['Ouvrir la liste de l’île', 'island'], ['Nouvelle session', 'Ctrl Alt N'], ['Changer le thème', 'Ctrl Alt T'], ['Ne pas déranger, depuis l’île', 'D']] as const;

/* ---------- Controls ---------- */

function Row({ label, hint, children, htmlFor, labelId, stack }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; htmlFor?: string; labelId?: string; stack?: boolean }) {
  const hintId = useId();
  return <div className={`set-row ${stack ? 'stack' : ''}`}>
    <div className="set-copy">{htmlFor ? <label htmlFor={htmlFor} id={labelId} className="set-label">{label}</label> : <span id={labelId} className="set-label">{label}</span>}{hint && <span className="set-hint" id={hintId}>{hint}</span>}</div>
    {children && <div className="set-control">{children}</div>}
  </div>;
}

/** A switch row: the whole label names the switch (role="switch", aria-checked). */
function SwitchRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: ReactNode; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return <Row label={label} hint={hint} labelId={id + 'l'}>
    <button type="button" role="switch" aria-checked={checked} aria-labelledby={id + 'l'} disabled={disabled} className="set-switch" onClick={() => onChange(!checked)}><i /></button>
  </Row>;
}

/** Segmented choice: native radios in a radiogroup, so arrows and Tab behave as usual. */
function Segmented<T extends string | number>({ label, value, options, onChange, name, disabled }: { label: string; value: T; options: { value: T; label: ReactNode; wide?: boolean }[]; onChange: (v: T) => void; name: string; disabled?: boolean }) {
  return <div className="set-seg" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
    {options.map(o => <label key={String(o.value)} className={`${o.value === value ? 'on' : ''} ${o.wide ? 'wide' : ''}`}>
      <input type="radio" name={name} value={String(o.value)} checked={o.value === value} disabled={disabled} onChange={() => onChange(o.value)} />{o.label}
    </label>)}
  </div>;
}

function Card({ title, note, children, id }: { title?: string; note?: ReactNode; children: ReactNode; id?: string }) {
  return <section className="set-card" aria-labelledby={title ? id : undefined}>{title && <h2 id={id}>{title}</h2>}{note && <p className="set-card-note">{note}</p>}<div className="set-rows">{children}</div></section>;
}

const Dot = ({ status }: { status: 'online' | 'offline' | 'connecting' }) => <span className={`set-status ${status}`}><i aria-hidden="true" />{{ online: 'Connectée', offline: 'Hors ligne', connecting: 'Connexion…' }[status]}</span>;

/* ---------- Island preview ---------- */

function IslandPreview({ prefs, theme, paused }: { prefs: Prefs; theme: 'dark' | 'light'; paused: boolean }) {
  const [covered, setCovered] = useState(false);
  const scale = prefs.islandScale === 'auto' ? 1 : prefs.islandScale;
  const screens = [{ id: 'primary', name: 'Principal', size: '2560 × 1440', w: 236 }, { id: 'second', name: 'Écran 2', size: '1920 × 1080', w: 176 }] as const;
  return <figure className="island-preview" aria-label="Aperçu de l’île">
    <div className="preview-desk">
      {screens.map(s => {
        const here = prefs.island && prefs.screen === s.id;
        const strip = here && covered && prefs.discreet;
        return <div key={s.id} className={`preview-screen ${here ? 'here' : ''}`} style={{ width: s.w }}>
          <div className="preview-glass">
            {covered && <div className="preview-window" aria-hidden="true"><i /><i /><i /></div>}
            {here && <div className={`preview-notch pos-${prefs.position} ${strip ? 'strip' : ''}`} style={{ '--k': scale } as React.CSSProperties}>
              {!strip && <><span className="preview-mascot"><ResidentMascot size={12 * scale} theme={theme} paused={paused || prefs.reduced} /></span><i className="d-approval" /><i className="d-question" /><i className="d-working" /></>}
            </div>}
            {here && !strip && !prefs.dnd && prefs.islandShows.say && <div className={`preview-bubble pos-${prefs.position}`}>Otto attend votre accord</div>}
          </div>
          <span className="preview-caption"><strong>{s.name}</strong> {s.size}</span>
        </div>;
      })}
    </div>
    <figcaption>
      {prefs.island ? <span>{prefs.dnd ? 'Ne pas déranger : les demandes restent dans l’île, sans bulle.' : covered && prefs.discreet ? 'Mode discret : un simple trait sous la fenêtre maximisée.' : covered ? 'Mode discret désactivé : l’île reste entière au-dessus de la fenêtre.' : 'L’île au repos, trois agents qui l’habitent.'}</span> : <span>L’île est masquée. Ledge Desktop continue de vous prévenir.</span>}
      <Button size="sm" variant="ghost" aria-pressed={covered} disabled={!prefs.island} onClick={() => setCovered(!covered)}>{covered ? 'Retirer la fenêtre' : 'Simuler une fenêtre maximisée'}</Button>
    </figcaption>
  </figure>;
}

/* ---------- Machines ---------- */

function MachinesSection(p: { machines: MachineEntry[]; setMachines: (m: MachineEntry[]) => void; statusOf: (m: MachineEntry) => 'online' | 'offline'; sessionsOn: (label: string) => number; onReconnect: (label: string) => void; saved: (s: string) => void }) {
  const [form, setForm] = useState<string | null>(null);
  const [label, setLabel] = useState(''), [ssh, setSsh] = useState('');
  const [help, setHelp] = useState(true);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, 'probe' | 'reconnect'>>({});
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const editing = form && form !== 'add' ? p.machines.find(m => m.id === form) : undefined;
  const alias = ssh.trim();
  const duplicate = p.machines.some(m => m.ssh === alias && m.id !== editing?.id);
  const valid = !!label.trim() && ALIAS.test(alias) && !duplicate;
  const probe = (key: string, a: string, offline = false) => {
    setBusy(b => ({ ...b, [key]: 'probe' })); setResults(r => { const n = { ...r }; delete n[key]; return n; });
    later(() => {
      setBusy(b => { const n = { ...b }; delete n[key]; return n; });
      const v = KNOWN_ALIASES[a];
      const res = !v ? { ok: false, text: PROBLEMS.alias } : offline ? { ok: false, text: PROBLEMS.unreachable } : { ok: true, text: (n => `Ledge ${v} répond · ${n} session${n > 1 ? 's' : ''}`)(p.sessionsOn(p.machines.find(m => m.ssh === a)?.label ?? '')) };
      setResults(r => ({ ...r, [key]: res }));
    }, 1100);
  };
  const reconnect = (m: MachineEntry) => {
    setBusy(b => ({ ...b, [m.id]: 'reconnect' }));
    later(() => { setBusy(b => { const n = { ...b }; delete n[m.id]; return n; }); setResults(r => ({ ...r, [m.id]: { ok: true, text: `${m.label} est de nouveau connectée. Ses sessions reprennent leur état réel.` } })); p.onReconnect(m.label); }, 1500);
  };
  const openForm = (m?: MachineEntry) => { setForm(m ? m.id : 'add'); setLabel(m?.label ?? ''); setSsh(m?.ssh ?? ''); setHelp(!m); setConfirm(null); setResults(r => { const n = { ...r }; delete n.draft; return n; }); };
  const save = (e: React.FormEvent) => {
    e.preventDefault(); if (!valid) return;
    const known = KNOWN_ALIASES[alias];
    if (editing) p.setMachines(p.machines.map(m => m.id === editing.id ? { ...m, label: label.trim(), ssh: alias } : m));
    else p.setMachines([...p.machines, { id: 'm-' + Date.now(), label: label.trim(), ssh: alias, version: known ?? '—', install: 'npm', reachable: !!known }]);
    p.saved(editing ? `${label.trim()} modifiée` : `${label.trim()} ajoutée`); setForm(null);
  };
  return <>
    <Card title="Vos machines" id="set-machines" note={<>Ledge rejoint vos serveurs par SSH, depuis WSL. <strong>Liste partagée</strong> : le daemon local la garde, l’île et Ledge Desktop affichent les mêmes machines.</>}>
      {p.machines.map(m => {
        const st = busy[m.id] ? 'connecting' : p.statusOf(m);
        const res = results[m.id];
        if (form === m.id) return null;
        return <article key={m.id} className="machine-entry" aria-label={m.label}>
          <span className="machine-glyph" aria-hidden="true"><Icon d={m.ssh ? ['M4 3h16v7H4z', 'M4 14h16v7H4z', 'M7 6.5h.01', 'M7 17.5h.01'] : ['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8']} size={16} /></span>
          <div className="machine-main">
            <div className="machine-top"><strong>{m.label}</strong>{m.id === 'local' && <span className="set-tag">Cette machine</span>}<span className="spacer" /><Dot status={st} /></div>
            <span className="set-hint mono">{m.ssh ? `SSH · ${m.ssh}` : 'Local · WSL'} · Ledge {m.version} · {p.sessionsOn(m.label)} session{p.sessionsOn(m.label) > 1 ? 's' : ''}</span>
            {res && <div role="status" className={`set-well ${res.ok ? 'ok' : 'bad'}`}><Icon d={res.ok ? ICONS.check.d : ICONS.close.d} size={14} /><span>{res.text}</span></div>}
            {busy[m.id] && <div role="status" className="set-well"><span className="ledge-spin"><Icon d={ICONS.refresh.d} size={14} /></span><span>{busy[m.id] === 'probe' ? <>Connexion à <code>{m.ssh}</code>…</> : <>Reconnexion à <code>{m.ssh}</code>…</>}</span></div>}
            {m.ssh && (confirm === m.id
              ? <div role="alert" className="set-well warn"><span>Retirer <strong>{m.label}</strong> ? Ses sessions disparaissent de la liste, dans l’île comme ici. Rien n’est arrêté ni supprimé sur le serveur.</span>
                  <div className="set-actions"><Button size="sm" variant="primary" onClick={() => { p.setMachines(p.machines.filter(x => x.id !== m.id)); setConfirm(null); p.saved(`${m.label} retirée`); }}>Retirer</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Annuler</Button></div></div>
              : <div className="set-actions">
                  {st === 'offline' ? <Button size="sm" variant="outline" disabled={!!busy[m.id] || m.reachable === false} onClick={() => reconnect(m)}><Icon d={ICONS.refresh.d} size={14} />Reconnecter</Button> : null}
                  <Button size="sm" variant="ghost" disabled={!!busy[m.id]} onClick={() => probe(m.id, m.ssh!, st === 'offline')}>Tester</Button>
                  <Button size="sm" variant="ghost" onClick={() => openForm(m)}>Modifier</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(m.id)}>Retirer</Button>
                </div>)}
          </div>
        </article>;
      })}
      {form ? <form className="machine-form" onSubmit={save} aria-label={editing ? `Modifier ${editing.label}` : 'Ajouter une machine'}>
        <h3>{editing ? `Modifier ${editing.label}` : 'Ajouter une machine'}</h3>
        <div className="form-grid">
          <label>Nom<span className="set-hint">Comme il apparaît dans l’atelier et l’île.</span><input autoFocus value={label} maxLength={80} placeholder="Serveur de dev" onChange={e => setLabel(e.target.value)} /></label>
          <label>Alias SSH<span className="set-hint">Nom d’un bloc Host de ~/.ssh/config dans WSL.</span><input className="mono" value={ssh} maxLength={64} spellCheck={false} placeholder="gpu-box" aria-invalid={(!!alias && !ALIAS.test(alias)) || duplicate} onChange={e => { setSsh(e.target.value); setResults(r => { const n = { ...r }; delete n.draft; return n; }); }} />
            {duplicate && <span role="alert" className="set-error">Cet alias est déjà ajouté.</span>}
            {!!alias && !ALIAS.test(alias) && <span role="alert" className="set-error">Lettres, chiffres, point, tiret ou souligné, sans espace.</span>}</label>
        </div>
        <button type="button" className="set-disclosure" aria-expanded={help} onClick={() => setHelp(!help)}><span aria-hidden="true" style={{ transform: help ? 'rotate(90deg)' : undefined }}><Icon d={ICONS.chevronRight.d} size={12} /></span>Avant d’ajouter un serveur</button>
        {help && <ol className="set-well steps"><li>L’alias fonctionne depuis WSL, sans mot de passe : <code>ssh mon-serveur</code></li><li>La clé du serveur est déjà approuvée (première connexion faite à la main).</li><li>Node 22+ et tmux sont installés sur le serveur.</li><li>Ledge est installé et démarré sur le serveur : <code>npm i -g @paradow/ledge && ledge setup</code></li></ol>}
        {busy.draft && <div role="status" className="set-well"><span className="ledge-spin"><Icon d={ICONS.refresh.d} size={14} /></span><span>Connexion à <code>{alias}</code>…</span></div>}
        {results.draft && <div role="status" className={`set-well ${results.draft.ok ? 'ok' : 'bad'}`}><Icon d={results.draft.ok ? ICONS.check.d : ICONS.close.d} size={14} /><span>{results.draft.ok ? `Ledge ${KNOWN_ALIASES[alias]} répond · 0 session` : results.draft.text}</span></div>}
        <div className="set-actions"><Button size="sm" disabled={!valid || !!busy.draft} onClick={() => probe('draft', alias)}>Tester la connexion</Button><span className="spacer" /><Button size="sm" variant="ghost" onClick={() => setForm(null)}>Annuler</Button><Button size="sm" variant="primary" type="submit" disabled={!valid}>Enregistrer</Button></div>
        <span className="set-hint">Le test est facultatif : une machine injoignable peut être enregistrée. Essayez <code>gpu-box</code> ou <code>nas</code> dans cette maquette.</span>
      </form> : <div className="set-row"><Button size="sm" onClick={() => openForm()}><Icon d={ICONS.plus.d} size={14} />Ajouter une machine</Button><span className="set-hint">{p.machines.length} machines · 20 au plus</span></div>}
    </Card>
  </>;
}

/* ---------- Page ---------- */

export interface SettingsPageProps {
  section: SectionId; onSection: (s: SectionId) => void; onBack: () => void;
  prefs: Prefs; setPrefs: (p: Prefs) => void;
  theme: 'dark' | 'light'; onTheme: (t: 'dark' | 'light') => void; paused: boolean;
  machines: MachineEntry[]; setMachines: (m: MachineEntry[]) => void; statusOf: (m: MachineEntry) => 'online' | 'offline'; sessionsOn: (label: string) => number; onReconnect: (label: string) => void;
  projects: Project[]; rules: FolderRule[]; setRules: (r: FolderRule[]) => void; projectAgents: (id: string) => number;
  agentsLite: { id: string; name: string; tool: Tool; project: string; machine: string; repos: string; parent?: string }[];
  onNewProject: () => void; onEditProject: (id: string) => void; onDeleteProject: (id: string) => void; onReviewProposal: (pr: Proposal) => void;
  shortcuts: string[][]; notify: (s: string) => void;
}

export function SettingsPage(p: SettingsPageProps) {
  const { prefs } = p;
  const saved = (what: string) => p.notify(`Réglage enregistré · ${what}`);
  const set = <K extends keyof Prefs>(key: K, value: Prefs[K], what: string) => { p.setPrefs({ ...prefs, [key]: value }); saved(what); };
  const meta = SECTIONS.find(s => s.id === p.section)!;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 0 }); }, [p.section]);
  const [checking, setChecking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [hex, setHex] = useState(prefs.accent ?? DEFAULT_ACCENT);
  useEffect(() => { setHex(prefs.accent ?? DEFAULT_ACCENT); }, [prefs.accent]);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.key === 'Escape') { setRecording(false); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      if (!e.ctrlKey && !e.altKey && !e.metaKey) { p.notify('Ajoutez Ctrl, Alt ou ⊞ : le raccourci doit marcher partout dans Windows.'); return; }
      const combo = [e.ctrlKey && 'Ctrl', e.metaKey && '⊞', e.altKey && 'Alt', e.shiftKey && 'Maj', e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join(' ');
      setRecording(false); p.setPrefs({ ...prefs, islandKey: combo }); saved(`Ouvrir l’île : ${combo}`);
    };
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, prefs]);
  const check = () => { setChecking(true); setTimeout(() => { setChecking(false); p.setPrefs({ ...prefs, checkedAt: Date.now() }); p.notify('Ledge 0.5.4 est à jour. Aucune mise à jour disponible.'); }, 1200); };
  const ago = Math.max(1, Math.round((Date.now() - prefs.checkedAt) / 60e3));
  const applyAccent = (v: string) => { setHex(v); const ok = parseAccent(v); if (ok) set('accent', ok === DEFAULT_ACCENT ? null : ok, `Couleur de Ledge ${ok}`); };
  const daemonsBehind = p.machines.filter(m => m.version !== '0.5.4' && m.version !== '—');

  return <div className="settings-page">
    <nav className="settings-nav" aria-label="Sections des réglages">
      <Button variant="ghost" size="sm" className="settings-back" onClick={p.onBack}><Icon d={ICONS.chevronLeft.d} size={14} />Retour à l’atelier<Kbd>Échap</Kbd></Button>
      {SECTIONS.map(s => <button key={s.id} type="button" className={`settings-tab ${s.id === p.section ? 'active' : ''}`} aria-current={s.id === p.section ? 'page' : undefined} onClick={() => p.onSection(s.id)}>
        <Icon d={s.icon} size={15} /><span>{s.label}</span>{s.id === 'machines' && p.machines.some(m => p.statusOf(m) === 'offline') && <b className="side-alert" aria-label="Une machine est hors ligne" />}{s.id === 'about' && daemonsBehind.length > 0 && <b className="side-alert" aria-label="Une mise à jour du daemon est possible" />}
      </button>)}
    </nav>
    <div className="settings-scroll" ref={scrollRef}>
      <div className="settings-content" key={p.section}>
        <header className="settings-head"><h1>{meta.label}</h1><p>{meta.hint}</p></header>

        {p.section === 'general' && <>
          <Card>
            <Row label="Langue" hint="S’applique tout de suite, à l’île et au menu de la zone de notification.">
              <Segmented name="lang" label="Langue" value={prefs.lang} onChange={v => { set('lang', v, v === 'fr' ? 'Français' : 'English'); if (v === 'en') p.notify('Réglage enregistré · English. La maquette reste en français.'); }} options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]} />
            </Row>
            <SwitchRow label="Lancer au démarrage" hint="Ledge Desktop et l’île s’ouvrent avec votre session Windows." checked={prefs.autostart} onChange={on => set('autostart', on, on ? 'Lancer au démarrage' : 'Pas de lancement au démarrage')} />
            <Row label="Harnais par défaut" hint="Les nouvelles sessions et le chat Ledge. À changer si un quota est saturé." stack>
              <Segmented name="tool" label="Harnais par défaut" value={prefs.tool} onChange={v => set('tool', v, `Harnais par défaut : ${TOOLS.find(t => t.id === v)!.label}`)} options={TOOLS.map(t => ({ value: t.id, label: <><Bot tool={t.id} state={prefs.tool === t.id ? 'working' : 'idle'} pose={1} size={20} theme={p.theme} seed={'set-' + t.id} paused={p.paused} />{t.label}</> }))} />
            </Row>
          </Card>
          <Card title="Mises à jour" id="set-updates">
            <Row label="Ledge 0.5.4" hint={<>Application Windows et daemon WSL de cette machine. Dernière version : 0.5.4.</>}><span className="set-tag ok"><Icon d={ICONS.check.d} size={12} />À jour</span></Row>
            <SwitchRow label="Rechercher les mises à jour" hint="Au démarrage, puis toutes les 6 heures. Ledge ne met jamais à jour sans votre clic." checked={prefs.autoUpdate} onChange={on => set('autoUpdate', on, on ? 'Recherche automatique' : 'Recherche manuelle')} />
            <Row label={checking ? 'Vérification…' : `Vérifié il y a ${ago} min`} hint="Sur les releases GitHub de Lyssaen/ledge."><Button size="sm" variant="outline" disabled={checking} onClick={check}>{checking ? <span className="ledge-spin" style={{ display: 'inline-flex' }}><Icon d={ICONS.refresh.d} size={14} /></span> : <Icon d={ICONS.refresh.d} size={14} />}Vérifier</Button></Row>
          </Card>
        </>}

        {p.section === 'appearance' && <>
          <Card>
            <Row label="Thème" hint="Change aussi la matière des mascottes. Ctrl Alt T partout dans Windows." stack>
              <div className="theme-picks" role="radiogroup" aria-label="Thème">
                {(['light', 'dark'] as const).map(t => <label key={t} className={`theme-pick ${p.theme === t ? 'on' : ''}`} data-preview={t}>
                  <input type="radio" name="theme" checked={p.theme === t} onChange={() => { p.onTheme(t); saved(t === 'light' ? 'Thème clair · Galet' : 'Thème sombre · Signal'); }} />
                  <span className="theme-swatch"><Bot tool="claude" state="working" pose={1} size={34} theme={t} seed={'theme-' + t} paused={p.paused} /></span>
                  <span><strong>{t === 'light' ? 'Clair' : 'Sombre'}</strong><small>{t === 'light' ? 'Galet' : 'Signal'}</small></span>
                </label>)}
              </div>
            </Row>
            <Row label="Couleur de Ledge" hint="Le point, les boutons et le halo de Ledge. Les couleurs des états restent inchangées." stack>
              <div className="accent-row">
                <div className="accent-swatches" role="radiogroup" aria-label="Couleurs proposées">
                  {ACCENTS.map(([name, c]) => <label key={c} className={(prefs.accent ?? DEFAULT_ACCENT) === c ? 'on' : ''} title={name} style={{ '--c': c } as React.CSSProperties}><input type="radio" name="accent" aria-label={name} checked={(prefs.accent ?? DEFAULT_ACCENT) === c} onChange={() => applyAccent(c)} /></label>)}
                </div>
                <input type="color" aria-label="Couleur personnalisée" value={parseAccent(hex) ?? DEFAULT_ACCENT} onChange={e => applyAccent(e.target.value)} />
                <input className="mono set-input hex" aria-label="Code hexadécimal" value={hex} maxLength={7} spellCheck={false} aria-invalid={!parseAccent(hex)} onChange={e => applyAccent(e.target.value)} />
                <Button size="sm" variant="ghost" disabled={!prefs.accent} onClick={() => applyAccent(DEFAULT_ACCENT)}>Corail</Button>
              </div>
              {!parseAccent(hex) && <span className="set-error" role="alert">Couleur invalide : utilisez # et six caractères hexadécimaux.</span>}
              <div className="accent-sample" aria-hidden="true"><Button size="sm" variant="primary" tabIndex={-1}>Valider le plan</Button><span className="side-count">3</span><ResidentMascot size={28} theme={p.theme} paused={p.paused || prefs.reduced} /><span className="set-hint">Bouton, compteur et halo de Ledge.</span></div>
            </Row>
            <Row label="Échelle de l’interface" hint="Taille du texte et des contrôles de Ledge Desktop. Auto suit la mise à l’échelle de Windows." stack>
              <Segmented name="scale" label="Échelle de l’interface" value={prefs.scale} onChange={v => set('scale', v, `Échelle ${v === 'auto' ? 'Auto' : pct(v)}`)} options={scaleOptions(1)} />
            </Row>
            <SwitchRow label="Mouvements réduits" hint="Les mascottes s’immobilisent ; les états restent lisibles sans animation. La préférence de Windows reste prioritaire." checked={prefs.reduced} onChange={on => set('reduced', on, on ? 'Mouvements réduits' : 'Animations')} />
          </Card>
        </>}

        {p.section === 'island' && <>
          <div className="set-banner" role="note"><Icon d={gearIcon} size={16} /><div><strong>L’île n’a plus de réglages à elle.</strong><span>Le menu de son chat Ledge ouvre cette page, « Réglages dans Ledge Desktop ». L’île garde l’essentiel : vous prévenir, autoriser ou répondre d’un geste, ouvrir une session, parler à Ledge.</span></div></div>
          <Card>
            <SwitchRow label="Afficher l’île" hint="La petite île en haut de l’écran. Masquée, Ledge Desktop continue de vous prévenir." checked={prefs.island} onChange={on => set('island', on, on ? 'Île affichée' : 'Île masquée')} />
            <div className="set-row stack"><IslandPreview prefs={prefs} theme={p.theme} paused={p.paused} /></div>
            <Row label="Écran" hint={prefs.screen === 'primary' ? 'L’île se pose en haut de cet écran (2560 × 1440).' : 'L’île se pose en haut de cet écran (1920 × 1080).'}>
              <Segmented name="screen" label="Écran" disabled={!prefs.island} value={prefs.screen} onChange={v => set('screen', v, v === 'primary' ? 'Écran principal' : 'Écran 2')} options={[{ value: 'primary', label: 'Principal' }, { value: 'second', label: 'Écran 2' }]} />
            </Row>
            <Row label="Position de l’île" hint="Au centre du bord supérieur, ou décalée au quart de l’écran pour laisser libres les titres et les onglets.">
              <Segmented name="position" label="Position de l’île" disabled={!prefs.island} value={prefs.position} onChange={v => set('position', v, `Position : ${{ center: 'Centre', left: 'À gauche', right: 'À droite' }[v]}`)} options={[{ value: 'left', label: 'À gauche' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'À droite' }]} />
            </Row>
            <SwitchRow label="Mode discret sous une fenêtre" hint="Un simple trait quand une fenêtre maximisée occupe l’écran ; un survol la redéploie." checked={prefs.discreet} disabled={!prefs.island} onChange={on => set('discreet', on, on ? 'Mode discret' : 'Île toujours entière')} />
            <Row label="Taille de l’île" hint="L’île et ses compagnons en haut de l’écran." stack><Segmented name="island-scale" label="Taille de l’île" disabled={!prefs.island} value={prefs.islandScale} onChange={v => set('islandScale', v, `Taille de l’île ${v === 'auto' ? 'Auto' : pct(v)}`)} options={scaleOptions(1.25)} /></Row>
            <Row label="Taille des fenêtres de l’île" hint="Bulle, liste, session et chat qui s’ouvrent depuis l’île." stack><Segmented name="panel-scale" label="Taille des fenêtres de l’île" disabled={!prefs.island} value={prefs.panelScale} onChange={v => set('panelScale', v, `Taille des fenêtres ${v === 'auto' ? 'Auto' : pct(v)}`)} options={scaleOptions(1)} /></Row>
          </Card>
          <Card title="Ce que fait l’île" id="set-island-does" note="Les demandes d’accord et les questions s’affichent toujours dans l’île. Le reste est à votre choix.">
            <SwitchRow label="Autoriser et répondre depuis l’île" hint="Autoriser, refuser (Y / N) ou répondre en une ligne sans ouvrir Ledge Desktop." checked={prefs.islandShows.quick} disabled={!prefs.island} onChange={on => set('islandShows', { ...prefs.islandShows, quick: on }, on ? 'Réponses rapides dans l’île' : 'Réponses dans Ledge Desktop seulement')} />
            <SwitchRow label="Bulle quand un agent a terminé" hint="Une bulle de 6 s sous l’île." checked={prefs.islandShows.finished} disabled={!prefs.island} onChange={on => set('islandShows', { ...prefs.islandShows, finished: on }, on ? 'Bulle de fin de tâche' : 'Pas de bulle de fin de tâche')} />
            <SwitchRow label="Paroles des agents" hint="Une phrase d’un agent, en bulle, qui s’efface après 5 s." checked={prefs.islandShows.say} disabled={!prefs.island} onChange={on => set('islandShows', { ...prefs.islandShows, say: on }, on ? 'Paroles des agents' : 'Paroles masquées')} />
            <SwitchRow label="Sous-agents dans l’île" hint="Les petits bots sur l’épaule de leur agent principal." checked={prefs.islandShows.helpers} disabled={!prefs.island} onChange={on => set('islandShows', { ...prefs.islandShows, helpers: on }, on ? 'Sous-agents affichés' : 'Sous-agents masqués')} />
            <Row label="Raccourci pour ouvrir l’île" hint={recording ? 'Appuyez sur la combinaison voulue. Échap pour annuler.' : 'Ouvre la liste des sessions de l’île, partout dans Windows.'}>
              <button type="button" className={`key-recorder ${recording ? 'recording' : ''}`} disabled={!prefs.island} aria-label={`Raccourci pour ouvrir l’île : ${prefs.islandKey}. Modifier`} onClick={() => setRecording(!recording)}>{recording ? 'Appuyez…' : <Kbd>{prefs.islandKey}</Kbd>}<span>{recording ? 'Annuler' : 'Modifier'}</span></button>
            </Row>
          </Card>
        </>}

        {p.section === 'notifications' && <>
          <Card>
            <SwitchRow label="Ne pas déranger" hint="Suspend les bulles, les notifications Windows et les sons. Les demandes restent visibles dans l’île et dans les sessions." checked={prefs.dnd} onChange={on => set('dnd', on, on ? 'Ne pas déranger activé' : 'Ne pas déranger désactivé')} />
            <SwitchRow label="Programmer Ne pas déranger" hint="Chaque jour choisi, sur une plage horaire." checked={prefs.dndSchedule} onChange={on => set('dndSchedule', on, on ? 'Plage programmée' : 'Plage désactivée')} />
            {prefs.dndSchedule && <div className="set-row stack schedule">
              <div className="time-range"><label>De<input type="time" className="set-input" value={prefs.dndFrom} onChange={e => set('dndFrom', e.target.value, `De ${e.target.value}`)} /></label><label>À<input type="time" className="set-input" value={prefs.dndTo} onChange={e => set('dndTo', e.target.value, `À ${e.target.value}`)} /></label>
                <span className="set-hint">{prefs.dndFrom > prefs.dndTo ? 'Jusqu’au lendemain matin.' : 'Le même jour.'}</span></div>
              <div className="day-chips" role="group" aria-label="Jours">{DAYS.map((d, i) => <label key={i} className={prefs.dndDays[i] ? 'on' : ''}><input type="checkbox" aria-label={DAY_NAMES[i]} checked={prefs.dndDays[i]} onChange={e => set('dndDays', prefs.dndDays.map((x, j) => j === i ? e.target.checked : x), `${DAY_NAMES[i]} ${e.target.checked ? 'ajouté' : 'retiré'}`)} />{d}</label>)}</div>
            </div>}
          </Card>
          <Card title="Qui vous prévient" id="set-events" note="Pour chaque événement, choisissez où il apparaît. L’état de la session reste toujours visible, même sans alerte.">
            <table className="event-grid">
              <thead><tr><th scope="col">Événement</th>{CHANNELS.map(c => <th key={c.id} scope="col">{c.label}</th>)}</tr></thead>
              <tbody>{EVENTS.map(ev => <tr key={ev.id}><th scope="row"><strong>{ev.label}</strong><small>{ev.hint}</small></th>{CHANNELS.map(c => {
                const locked = c.id === 'island' && (ev.id === 'approval' || ev.id === 'question');
                return <td key={c.id}><input type="checkbox" aria-label={`${ev.label} · ${c.label}`} checked={prefs.events[ev.id][c.id]} disabled={locked || (c.id === 'island' && !prefs.island)} title={locked ? 'Toujours affiché dans l’île' : undefined} onChange={e => set('events', { ...prefs.events, [ev.id]: { ...prefs.events[ev.id], [c.id]: e.target.checked } }, `${ev.label} · ${c.label}`)} /></td>;
              })}</tr>)}</tbody>
            </table>
            <p className="set-hint table-note">Les notifications Windows partent quand Ledge Desktop n’a pas le focus. Avec l’île affichée, elles ne doublent pas sa bulle.</p>
          </Card>
          <Card title="Dans l’application" id="set-toasts">
            <Row label="Durée des messages" hint="Le temps que restent les messages en bas de la fenêtre, comme « Réglage enregistré »." htmlFor="toast-seconds">
              <div className="set-slider"><input id="toast-seconds" type="range" min={3} max={12} step={1} value={prefs.toastSeconds} aria-valuetext={`${prefs.toastSeconds} secondes`} onChange={e => set('toastSeconds', Number(e.target.value), `Messages ${e.target.value} s`)} /><output htmlFor="toast-seconds" className="mono">{prefs.toastSeconds} s</output></div>
            </Row>
          </Card>
        </>}

        {p.section === 'sounds' && <>
          <Card>
            <SwitchRow label="Sons" hint={<>Des tons courts et doux pour ce qui vous attend. Jamais en Ne pas déranger.{prefs.dnd && <strong className="set-warn"> Ne pas déranger est activé.</strong>}</>} checked={prefs.sounds} onChange={on => set('sounds', on, on ? 'Sons activés' : 'Sons coupés')} />
            <fieldset className="set-fieldset" disabled={!prefs.sounds}>
              <legend className="visually-hidden">Personnaliser les sons</legend>
              <Row label="Volume" hint="Test joue le signal de question.">
                <div className="set-inline"><Segmented name="volume" label="Volume" disabled={!prefs.sounds} value={prefs.volume} onChange={v => set('volume', v, `Volume ${{ quiet: 'bas', normal: 'normal', loud: 'fort' }[v]}`)} options={[{ value: 'quiet', label: 'Bas' }, { value: 'normal', label: 'Normal' }, { value: 'loud', label: 'Fort' }]} />
                  <Button size="sm" variant="outline" onClick={() => p.notify(prefs.dnd ? 'Ne pas déranger est activé : aucun son.' : 'Signal de question joué (simulation).')}>Test</Button></div>
              </Row>
              <div className="set-row stack"><span className="set-label" id="play-when">Jouer un son quand</span>
                <div className="check-list" role="group" aria-labelledby="play-when">{SOUND_CATEGORIES.map(([k, l]) => <label key={k}><input type="checkbox" checked={prefs.categories[k]} onChange={e => set('categories', { ...prefs.categories, [k]: e.target.checked }, l)} />{l}</label>)}</div>
              </div>
              <SwitchRow label="Seulement quand le terminal est derrière" hint="Si Windows Terminal est la fenêtre au premier plan, vous regardez déjà : pas de son, la bulle s’affiche quand même." checked={prefs.behind} disabled={!prefs.sounds} onChange={on => set('behind', on, on ? 'Sons seulement terminal derrière' : 'Sons toujours')} />
            </fieldset>
          </Card>
          <p className="set-footnote">Un seul son à la fois, pour l’île et Ledge Desktop ensemble : une rafale de demandes ne joue qu’une fois. Ouvrir, fermer et survoler restent silencieux.</p>
        </>}

        {p.section === 'machines' && <MachinesSection machines={p.machines} setMachines={p.setMachines} statusOf={p.statusOf} sessionsOn={p.sessionsOn} onReconnect={p.onReconnect} saved={saved} />}

        {p.section === 'projects' && <>
          <LedgeSuggestions projects={p.projects} agents={p.agentsLite} theme={p.theme} paused={p.paused} onReview={p.onReviewProposal} />
          <Card title="Projets" id="set-projects" note="Un projet regroupe des dépôts de travail, sur une ou plusieurs machines, et leurs conversations. Sa table apparaît dans l’atelier dès qu’un agent y travaille.">
            {p.projects.map(pr => <div key={pr.id} className="project-entry">
              <i className={`side-swatch swatch-${pr.id}`} aria-hidden="true" />
              <div className="project-main"><strong title={pr.name}>{pr.name}</strong><span className="repo-chips">{pr.repoList.length ? pr.repoList.map(r => <span key={r.machine + r.path} className="set-tag" title={`${r.path} · ${r.machine}`}><Icon d={r.branch ? ICONS.branch.d : ICONS.folder.d} size={11} />{basename(r.path)}<span className="tag-machine">{r.machine}</span></span>) : <span className="set-hint">Aucun dépôt</span>}</span></div>
              <span className="set-hint project-count">{p.projectAgents(pr.id)} agent{p.projectAgents(pr.id) > 1 ? 's' : ''}</span>
              <span className="project-actions"><Button size="sm" variant="ghost" aria-label={`Modifier ${pr.name}`} onClick={() => p.onEditProject(pr.id)}>Modifier</Button><Button size="sm" variant="ghost" aria-label={`Supprimer ${pr.name}`} onClick={() => p.onDeleteProject(pr.id)}>Supprimer</Button></span>
            </div>)}
            <div className="set-row"><Button size="sm" onClick={p.onNewProject}><Icon d={ICONS.plus.d} size={14} />Nouveau projet</Button><span className="set-hint">Ou demandez au chat : « Crée un projet Paper Rendering avec les dépôts paper ».</span></div>
          </Card>
          <Card title="Dossiers mémorisés" id="set-rules" note="Quand vous rangez un agent sans projet à une table, Ledge retient son dossier : les prochaines sessions qui y démarrent rejoignent le même projet.">
            <SwitchRow label="Mémoriser le dossier quand je range un agent" hint="Désactivé, chaque session hors dépôt connu reste « Sans projet »." checked={prefs.rememberFolders} onChange={on => set('rememberFolders', on, on ? 'Dossiers mémorisés' : 'Dossiers non mémorisés')} />
            {p.rules.length ? p.rules.map(r => <div key={r.id} className="rule-entry">
              <code className="mono">{r.folder}</code><span className="set-hint">{r.machine}</span><span className="rule-arrow" aria-hidden="true">→</span>
              <select className="set-input" aria-label={`Projet pour ${r.folder}`} value={r.project} onChange={e => { p.setRules(p.rules.map(x => x.id === r.id ? { ...x, project: e.target.value } : x)); saved(`${r.folder} → ${p.projects.find(x => x.id === e.target.value)?.name}`); }}>{p.projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <Button size="sm" variant="ghost" aria-label={`Oublier ${r.folder}`} onClick={() => { p.setRules(p.rules.filter(x => x.id !== r.id)); saved(`${r.folder} oublié`); }}>Oublier</Button>
            </div>) : <p className="set-hint empty">Aucun dossier mémorisé. Rangez un agent « Sans projet » depuis l’atelier pour en créer un.</p>}
          </Card>
        </>}

        {p.section === 'shortcuts' && <>
          <Card title="Partout dans Windows" id="set-global" note="Ces raccourcis marchent même quand Ledge Desktop est fermé dans la zone de notification.">
            {GLOBAL_KEYS.map(([l, k]) => <Row key={l} label={l}>{k === 'island' ? <span className="set-inline"><Kbd>{prefs.islandKey}</Kbd><Button size="sm" variant="ghost" onClick={() => p.onSection('island')}>Modifier</Button></span> : <Kbd>{k}</Kbd>}</Row>)}
          </Card>
          <Card title="Dans Ledge Desktop" id="set-local">
            <Row label="Ouvrir les réglages"><Kbd>Ctrl ,</Kbd></Row>
            {p.shortcuts.filter(([k]) => k !== 'Ctrl ,').map(([k, l]) => <Row key={k} label={l}><Kbd>{k}</Kbd></Row>)}
          </Card>
          <p className="set-footnote">Aucun raccourci ne valide une autorisation dans Ledge Desktop : Y et N n’agissent que dans l’île, sur la demande affichée.</p>
        </>}

        {p.section === 'about' && <>
          <Card>
            <div className="about-hero"><ResidentMascot size={56} theme={p.theme} paused={p.paused || prefs.reduced} /><div><strong>Ledge</strong><span className="set-hint">Une nouvelle façon de travailler avec vos agents. L’île et Ledge Desktop, une seule application.</span></div></div>
          </Card>
          <Card title="Versions" id="set-versions" note={daemonsBehind.length ? <span className="set-warn">{daemonsBehind.map(m => m.label).join(', ')} n’a pas la même version que l’application.</span> : 'Toutes les moitiés de Ledge ont la même version.'}>
            <dl className="version-list">
              <div><dt>Ledge Desktop et l’île</dt><dd className="mono">0.5.4</dd></div>
              {p.machines.map(m => <div key={m.id}><dt>Daemon · {m.label}</dt><dd className="mono">{m.version}{m.version !== '—' && <span className="set-hint">· {m.install === 'git' ? 'clone git' : 'npm'}</span>}{m.version !== '0.5.4' && m.version !== '—' && <span className="set-tag warn">À mettre à jour</span>}</dd></div>)}
              <div><dt>Dernière version</dt><dd className="mono">0.5.4</dd></div>
            </dl>
            {daemonsBehind.some(m => m.install === 'git') && <div className="set-well">Le daemon de {daemonsBehind.filter(m => m.install === 'git').map(m => m.label).join(', ')} tourne depuis un clone git : mettez-le à jour vous-même. <code>git pull && pnpm build && ledge setup</code></div>}
          </Card>
          <Card title="Données" id="set-data">
            <Row label="Ouvrir le journal" hint="Le daemon local écrit son journal dans WSL."><Button size="sm" variant="outline" onClick={() => p.notify('Journal ouvert (simulation) : ~/.local/state/ledge/daemon.log')}><Icon d={ICONS.external.d} size={13} />Ouvrir</Button></Row>
            <Row label="Réinitialiser les réglages" hint="Remet les réglages de l’île et de Ledge Desktop par défaut. Machines et projets sont conservés."><Button size="sm" variant="outline" onClick={() => { p.setPrefs({ ...DEFAULT_PREFS, checkedAt: prefs.checkedAt }); p.onTheme('dark'); p.notify('Réglages réinitialisés. Machines et projets conservés.'); }}>Réinitialiser</Button></Row>
          </Card>
        </>}
      </div>
    </div>
  </div>;
}
