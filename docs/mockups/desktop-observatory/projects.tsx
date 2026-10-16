import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ResidentMascot } from '../../../apps/overlay/src/bots/ResidentMascot';
import { Bot } from '../../../apps/overlay/src/bots/Bot';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Kbd } from '../../../apps/overlay/src/ui/Kbd';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';

/* Projects: a name, a colour, a note and working repositories (machine + path, with the detected branch).
   Ledge can propose a project itself from a simulated scan of the machines. Nothing is created without a click. */

export type Repo = { machine: string; path: string; branch: string | null; why?: string; checked?: boolean };
export type Project = { id: string; name: string; color: string; note: string; repoList: Repo[]; repos: string; branch: string };
export type Draft = { id?: string; name: string; color: string; note: string; repos: Repo[]; agents?: { id: string; name: string; tool: 'claude' | 'codex' | 'cursor'; checked: boolean }[] };
export type Proposal = Draft & { pid: string; targetId?: string; summary: string };
type AgentLite = { id: string; name: string; tool: 'claude' | 'codex' | 'cursor'; project: string; machine: string; repos: string; parent?: string };
type MachineLite = { name: string; online: boolean };

export const COLORS = [['Bleu', '#3b82f6'], ['Vert', '#10b981'], ['Ambre', '#f59e0b'], ['Violet', '#8b5cf6'], ['Sarcelle', '#14b8a6'], ['Rose', '#ec4899'], ['Rouge', '#ef4444'], ['Ardoise', '#64748b']] as const;
export const basename = (p: string) => p === '~' ? '~' : p.slice(p.lastIndexOf('/') + 1);
const derive = (p: Omit<Project, 'repos' | 'branch'>): Project => ({ ...p, repos: [...new Set(p.repoList.map(r => basename(r.path)))].join(' · ') || 'aucun dépôt', branch: p.repoList.find(r => r.branch)?.branch ?? '—' });
export const makeProject = derive;

/* ---------- The simulated file systems ---------- */

type Entry = { path: string; git?: { branch: string; remote?: string } };
const g = (branch: string, remote?: string) => ({ branch, remote });
const FS: Record<string, Entry[]> = {
  'PC local': [
    { path: '~/Workspace/ledge/application', git: g('desktop', 'paradow/ledge') }, { path: '~/Workspace/ledge/documentation', git: g('main', 'paradow/ledge-docs') },
    { path: '~/Workspace/payment/api', git: g('checkout', 'paradow/payment-api') }, { path: '~/Workspace/portfolio', git: g('main', 'paradow/portfolio') },
    { path: '~/Workspace/factory/pipelines', git: g('nightly', 'paradow/pipelines') }, { path: '~/Workspace/doccle/app', git: g('offline-mode', 'paradow/doccle-app') }, { path: '~/Workspace/doccle/api', git: g('main', 'paradow/doccle-api') },
    { path: '~/Workspace/ui/site', git: g('main', 'paradow/ui-site') }, { path: '~/Workspace/ui/guides', git: g('main', 'paradow/ui-guides') },
    { path: '~/Workspace/paper/paper-channel-templates', git: g('main', 'paradow/paper-channel-templates') }, { path: '~/Workspace/paper/paper-fonts', git: g('main', 'paradow/paper-fonts') },
    { path: '~/Workspace/scratch/dotfiles', git: g('main', 'paradow/dotfiles') }, { path: '~/Workspace/scratch/notes' }, { path: '~/Workspace/ledge-notes' }, { path: '~/Téléchargements' }
  ],
  'Dev SSH': [
    { path: '~/Workspace/ledge/application', git: g('desktop', 'paradow/ledge') }, { path: '~/Workspace/payment/api', git: g('checkout', 'paradow/payment-api') }, { path: '~/Workspace/payment/storefront', git: g('checkout', 'paradow/storefront') },
    { path: '~/Workspace/factory/pipelines', git: g('nightly', 'paradow/pipelines') }, { path: '~/Workspace/factory/entrepôt', git: g('main', 'paradow/entrepot') }, { path: '~/Workspace/doccle/app', git: g('offline-mode', 'paradow/doccle-app') }, { path: '~/Workspace/doccle/api', git: g('main', 'paradow/doccle-api') },
    { path: '~/Workspace/paper/paper-render-worker', git: g('main', 'paradow/paper-render-worker') }, { path: '~/Workspace/paper/paper-channel-api', git: g('develop', 'paradow/paper-channel-api') },
    { path: '~/Workspace/infra-scripts', git: g('main', 'paradow/infra-scripts') }, { path: '/var/log' }, { path: '/srv/shop/scripts' }
  ],
  'Studio SSH': [{ path: '~/sites/portfolio', git: g('main', 'paradow/portfolio') }]
};
const parentOf = (p: string) => p === '~' || /^\/[^/]+$/.test(p) ? '/' : p.slice(0, p.lastIndexOf('/'));
const dirsOf = (machine: string) => { const s = new Set<string>(); for (const e of FS[machine] ?? []) { let p = e.path; while (p !== '/') { s.add(p); p = parentOf(p); } } return [...s]; };
const entryAt = (machine: string, path: string) => (FS[machine] ?? []).find(e => e.path === path);
export const exists = (machine: string, path: string) => dirsOf(machine).includes(path);
const childrenOf = (machine: string, dir: string) => dirsOf(machine).filter(d => parentOf(d) === dir).sort((a, b) => (a === '~' ? -1 : b === '~' ? 1 : a.localeCompare(b)));
const repoAt = (machine: string, path: string, why?: string): Repo => ({ machine, path, branch: entryAt(machine, path)?.git?.branch ?? null, why, checked: why ? true : undefined });

export const INITIAL_PROJECTS: Project[] = [
  { id: 'ledge', name: 'Ledge', color: '#3b82f6', note: 'Une nouvelle façon de travailler avec vos agents.', repoList: [repoAt('PC local', '~/Workspace/ledge/application'), repoAt('PC local', '~/Workspace/ledge/documentation'), repoAt('Dev SSH', '~/Workspace/ledge/application')] },
  { id: 'commerce', name: 'Payment Service', color: '#10b981', note: 'Paiement et migration des données.', repoList: [repoAt('Dev SSH', '~/Workspace/payment/api'), repoAt('Dev SSH', '~/Workspace/payment/storefront'), repoAt('PC local', '~/Workspace/payment/api')] },
  { id: 'studio', name: 'Paper Channel', color: '#f59e0b', note: 'Identité visuelle et portfolio.', repoList: [repoAt('PC local', '~/Workspace/portfolio'), repoAt('Studio SSH', '~/sites/portfolio')] },
  { id: 'atlas', name: 'Software Factory', color: '#8b5cf6', note: 'Données et rapports quotidiens.', repoList: [repoAt('Dev SSH', '~/Workspace/factory/pipelines'), repoAt('Dev SSH', '~/Workspace/factory/entrepôt'), repoAt('PC local', '~/Workspace/factory/pipelines')] },
  { id: 'mobile', name: 'Doccle Channel', color: '#14b8a6', note: 'Application iOS et Android.', repoList: [repoAt('PC local', '~/Workspace/doccle/app'), repoAt('Dev SSH', '~/Workspace/doccle/app'), repoAt('PC local', '~/Workspace/doccle/api')] },
  { id: 'docs', name: 'UI Migration', color: '#ec4899', note: 'Site public et guides.', repoList: [repoAt('PC local', '~/Workspace/ui/site'), repoAt('PC local', '~/Workspace/ui/guides')] }
].map(p => derive({ ...p, repoList: p.repoList.map(({ why, checked, ...r }) => r) }));

/* ---------- What Ledge proposes ---------- */

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ownerOf = (projects: Project[], machine: string, path: string, except?: string) => projects.find(p => p.id !== except && p.repoList.some(r => r.machine === machine && r.path === path));
const remoteOf = (machine: string, path: string) => entryAt(machine, path)?.git?.remote;
let seq = 0;
const pid = () => `prop-${Date.now().toString(36)}-${++seq}`;
const agentsFor = (agents: AgentLite[], names: string[]) => agents.filter(a => names.includes(a.name) && !a.project).map(a => ({ id: a.id, name: a.name, tool: a.tool, checked: true }));

/** The groups a scan of PC local and Dev SSH turns up (Studio SSH is offline and skipped). */
function groups(projects: Project[], agents: AgentLite[]): Proposal[] {
  const free = (r: Repo) => !ownerOf(projects, r.machine, r.path);
  const list: Proposal[] = [
    { pid: pid(), name: 'Paper Rendering', color: '#ef4444', note: 'Gabarits, polices et rendu des documents papier.', summary: '{n} paper-* qu’aucun projet ne regroupe, sur {m}. Paper Channel ne contient que le portfolio.',
      repos: [repoAt('PC local', '~/Workspace/paper/paper-channel-templates', 'Nommé paper-channel-*, remote github.com/paradow/paper-channel-templates'), repoAt('PC local', '~/Workspace/paper/paper-fonts', 'Même organisation GitHub : paradow/paper-*'), repoAt('Dev SSH', '~/Workspace/paper/paper-render-worker', 'Même remote GitHub paradow/paper-*, modifié cette semaine'), repoAt('Dev SSH', '~/Workspace/paper/paper-channel-api', 'Nommé paper-channel-*, branche develop')] },
    { pid: pid(), name: 'Maintenance', color: '#64748b', note: 'Journaux, scripts serveur et petits rangements.', summary: 'Kit et Zed travaillent hors de tout dépôt connu ; leurs dossiers vont avec les scripts d’exploitation.',
      repos: [repoAt('Dev SSH', '/var/log', 'Dossier ouvert par Zed cette semaine'), repoAt('Dev SSH', '~/Workspace/infra-scripts', 'Zed y a lu les scripts de rotation des journaux'), repoAt('PC local', '~/Téléchargements', 'Dossier ouvert par Kit cette semaine')], agents: agentsFor(agents, ['Kit', 'Zed']) },
    { pid: pid(), name: 'Outils perso', color: '#14b8a6', note: 'Configuration et notes personnelles.', summary: 'Votre dépôt de configuration et vos notes, à part des projets d’équipe.',
      repos: [repoAt('PC local', '~/Workspace/scratch/dotfiles', 'Dépôt personnel paradow/dotfiles'), repoAt('PC local', '~/Workspace/scratch/notes', 'Rangé à côté de dotfiles, sans Git')] }
  ];
  const NUM = ['Aucun', 'Un', 'Deux', 'Trois', 'Quatre', 'Cinq'];
  return list.map(p => { const repos = p.repos.filter(free); return { ...p, repos, summary: p.summary.replace('{n}', `${NUM[repos.length] ?? repos.length} dépôt${repos.length > 1 ? 's' : ''}`).replace('{m}', [...new Set(repos.map(r => r.machine))].join(' et ')) }; }).filter(p => p.repos.length).map(p => {
    const same = projects.find(x => norm(x.name) === norm(p.name));
    return same ? { ...p, id: same.id, targetId: same.id, color: same.color, note: same.note, repos: [...same.repoList, ...p.repos], summary: `${p.repos.length} dépôt${p.repos.length > 1 ? 's' : ''} de plus pour ${same.name}. ${p.summary}` } : p;
  });
}
export const scanProposals = groups;

/** "Laisser Ledge faire" from the editor: guided by what is already typed or by the agent being filed. */
export function proposeFor(draft: Draft, projects: Project[], agents: AgentLite[]): Proposal {
  const all = groups(projects, agents);
  const words = norm(draft.name).split(/\s+/).filter(w => w.length > 2);
  if (words.length) {
    const found = Object.entries(FS).flatMap(([m, es]) => m === 'Studio SSH' ? [] : es.filter(e => words.some(w => norm(basename(e.path)).includes(w)) && !ownerOf(projects, m, e.path, draft.id) && !draft.repos.some(r => r.machine === m && r.path === e.path)).map(e => repoAt(m, e.path, `Nommé ${basename(e.path)}${e.git?.remote ? `, remote github.com/${e.git.remote}` : ''}`)));
    if (found.length) return { ...draft, pid: pid(), repos: [...draft.repos, ...found], summary: `${found.length} dossier${found.length > 1 ? 's' : ''} dont le nom rappelle « ${draft.name} », sur ${[...new Set(found.map(r => r.machine))].join(' et ')}.` };
  }
  const filing = draft.agents?.map(a => a.name) ?? [];
  const pick = (filing.length && all.find(p => p.agents?.some(a => filing.includes(a.name)))) || all[0];
  if (!pick) return { ...draft, pid: pid(), summary: 'Tous les dépôts trouvés appartiennent déjà à un projet. Ajoutez-en un à la main.' };
  return { ...pick, id: draft.id ?? pick.id, agents: pick.agents ?? draft.agents, name: draft.name || pick.name, note: draft.note || pick.note };
}

/** The chat: "Crée un projet X avec les dépôts Y", "range Kit et Zed dans un projet". */
export function proposeFromChat(question: string, projects: Project[], agents: AgentLite[]): Proposal | null {
  const q = norm(question);
  if (!/projet/.test(q) || !/(cree|creer|nouveau|range|ranger|regroupe|propose)/.test(q)) return null;
  const loose = agents.filter(a => !a.project && q.includes(norm(a.name)));
  if (loose.length || /range|ranger/.test(q)) {
    const g2 = groups(projects, agents).find(p => p.agents?.length);
    if (!g2) return null;
    const names = loose.length ? loose.map(a => a.name) : g2.agents!.map(a => a.name);
    return { ...g2, agents: g2.agents!.filter(a => names.includes(a.name)), repos: g2.repos.filter(r => !/Kit|Zed/.test(r.why ?? '') || names.some(n => r.why!.includes(n))) };
  }
  const nameMatch = /projet\s+(.+?)(?:\s+avec\b|\s+pour\b|[?.!]|$)/i.exec(question);
  const name = nameMatch ? nameMatch[1].trim().replace(/^["«“]\s*|\s*["»”]$/g, '') : '';
  const word = /(?:depots?|repos?|dossiers?)\s+([\w-]+)/.exec(q)?.[1];
  const target = projects.find(p => norm(p.name) === norm(name));
  const base: Draft = target ? { id: target.id, name: target.name, color: target.color, note: target.note, repos: target.repoList } : { name, color: '#ef4444', note: '', repos: [] };
  if (word) {
    const found = Object.entries(FS).flatMap(([m, es]) => m === 'Studio SSH' ? [] : es.filter(e => e.git && norm(basename(e.path)).includes(word) && !base.repos.some(r => r.machine === m && r.path === e.path) && !ownerOf(projects, m, e.path, target?.id)).map(e => repoAt(m, e.path, `Nommé ${basename(e.path)}${e.git?.remote ? `, remote github.com/${e.git.remote}` : ''}`)));
    return { ...base, pid: pid(), targetId: target?.id, repos: [...base.repos, ...found], summary: found.length ? `${found.length} dépôt${found.length > 1 ? 's' : ''} « ${word} » trouvé${found.length > 1 ? 's' : ''} sur ${[...new Set(found.map(r => r.machine))].join(' et ')}${target ? `, à ajouter à ${target.name}` : ''}.` : `Aucun dépôt « ${word} » libre sur PC local ni Dev SSH.` };
  }
  const p = proposeFor(base, projects, agents);
  return { ...p, targetId: target?.id };
}

/* ---------- Folder picker ---------- */

function FolderPicker({ machines, taken, onAdd }: { machines: MachineLite[]; taken: (m: string, p: string) => boolean; onAdd: (r: Repo) => void }) {
  const [machine, setMachine] = useState(machines.find(m => m.online)?.name ?? 'PC local');
  const [dir, setDir] = useState('~/Workspace');
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const online = machines.find(m => m.name === machine)?.online;
  const crumbs: string[] = []; for (let p = dir; ; p = parentOf(p)) { crumbs.unshift(p); if (p === '/') break; }
  const pickMachine = (m: string) => { setMachine(m); setDir(m === 'Studio SSH' ? '~/sites' : '~/Workspace'); setError(''); };
  const addTyped = () => {
    const path = typed.trim().replace(/\/+$/, '') || '';
    if (!path) return;
    if (!online) { setError(`${machine} est hors ligne : impossible de vérifier ce chemin.`); return; }
    if (!exists(machine, path)) { setError(`Dossier introuvable sur ${machine}.`); return; }
    if (taken(machine, path)) { setError('Ce dépôt est déjà dans la liste.'); return; }
    onAdd(repoAt(machine, path)); setTyped(''); setError('');
  };
  return <div className="picker">
    <div className="picker-machines" role="radiogroup" aria-label="Machine à parcourir">
      {machines.map(m => <label key={m.name} className={`chip ${machine === m.name ? 'selected' : ''}`}><input type="radio" name="picker-machine" checked={machine === m.name} onChange={() => pickMachine(m.name)} /><i className={`machine-dot ${m.online ? '' : 'off'}`} />{m.name}{!m.online && <small>hors ligne</small>}</label>)}
    </div>
    {online ? <>
      <nav className="picker-crumbs mono" aria-label="Dossier courant">{crumbs.map((c, i) => <React.Fragment key={c}>{i > 0 && <span aria-hidden="true">/</span>}<button type="button" onClick={() => setDir(c)} aria-current={c === dir ? 'location' : undefined}>{c === '/' ? 'racine' : basename(c)}</button></React.Fragment>)}</nav>
      <ul className="picker-list" aria-label={`Contenu de ${dir} sur ${machine}`}>
        {dir !== '/' && <li><button type="button" className="picker-name" onClick={() => setDir(parentOf(dir))}><Icon d={['M9 14 4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-1']} size={14} />Dossier parent</button></li>}
        {childrenOf(machine, dir).map(c => { const git = entryAt(machine, c)?.git; const kids = childrenOf(machine, c).length; const added = taken(machine, c);
          return <li key={c} className={git ? 'is-git' : ''}>
            <button type="button" className="picker-name" disabled={!kids} onClick={() => setDir(c)} title={kids ? `Ouvrir ${basename(c)}` : undefined}><Icon d={git ? ICONS.branch.d : ICONS.folder.d} size={14} /><span>{basename(c)}</span>{kids > 0 && <Icon d={ICONS.chevronRight.d} size={12} />}</button>
            {git ? <span className="picker-branch mono">⎇ {git.branch}</span> : <span className="picker-branch">{kids ? '' : 'sans Git'}</span>}
            <Button size="sm" variant={git ? 'outline' : 'ghost'} disabled={added} onClick={() => onAdd(repoAt(machine, c))} aria-label={added ? `${basename(c)} déjà ajouté` : `Ajouter ${basename(c)} (${machine})`}>{added ? <><Icon d={ICONS.check.d} size={13} />Ajouté</> : 'Ajouter'}</Button>
          </li>; })}
      </ul>
    </> : <p className="picker-offline">{machine} est hors ligne. Reconnectez-la dans Réglages › Machines pour parcourir ses dossiers.</p>}
    <div className="picker-typed">
      <label className="visually-hidden" htmlFor="typed-path">Chemin sur {machine}</label>
      <input id="typed-path" className="mono" value={typed} placeholder={`Ou saisissez un chemin sur ${machine}`} spellCheck={false} onChange={e => { setTyped(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); addTyped(); } }} aria-invalid={!!error} aria-describedby={error ? 'typed-error' : undefined} />
      <Button size="sm" disabled={!typed.trim()} onClick={() => addTyped()}>Ajouter</Button>
    </div>
    {error && <p id="typed-error" className="set-error" role="alert">{error}</p>}
  </div>;
}

/* ---------- Editor ---------- */

export interface EditorProps {
  initial: Draft | Proposal; mode: 'new' | 'edit'; autoLedge?: boolean; startDelete?: boolean;
  projects: Project[]; agents: AgentLite[]; machines: MachineLite[]; theme: 'dark' | 'light'; paused: boolean;
  onSave: (d: Draft) => void; onDelete: (id: string, moveTo: string | null) => void; onCancel: () => void; rulesFor: (id: string) => number;
}

export function ProjectEditor(p: EditorProps) {
  const [d, setD] = useState<Draft>(p.initial);
  const [proposal, setProposal] = useState<Proposal | null>('pid' in p.initial ? p.initial as Proposal : null);
  const [scanning, setScanning] = useState(false);
  const [step, setStep] = useState(0);
  const [tried, setTried] = useState(false);
  const [adding, setAdding] = useState(p.mode === 'new' && !('pid' in p.initial) && p.initial.repos.length === 0);
  const [deleting, setDeleting] = useState(!!p.startDelete);
  const [moveTo, setMoveTo] = useState<string>('');
  const nameRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => { if (p.autoLedge) runLedge(); else if (!p.startDelete) nameRef.current?.focus(); }, []);
  const editingProject = d.id ? p.projects.find(x => x.id === d.id) : undefined;
  const kept = d.repos.filter(r => r.checked !== false);
  const nameTaken = p.projects.some(x => x.id !== d.id && norm(x.name.trim()) === norm(d.name.trim()));
  const missing = !d.name.trim() ? 'Donnez un nom au projet' : nameTaken ? 'Ce nom est déjà utilisé par un autre projet' : null;
  const fresh = p.mode === 'new' && !proposal && !d.name;
  const scanLines = ['PC local · 15 dossiers parcourus', 'Dev SSH · 12 dossiers parcourus', 'Studio SSH hors ligne, ignorée', 'Remotes GitHub et sessions de la semaine comparés'];
  function runLedge() {
    setScanning(true); setStep(0);
    scanLines.forEach((_, i) => timers.current.push(window.setTimeout(() => setStep(i + 1), 380 * (i + 1))));
    timers.current.push(window.setTimeout(() => {
      const prop = proposeFor(d, p.projects, p.agents);
      setProposal(prop); setD({ id: d.id, name: prop.name, color: prop.color, note: prop.note, repos: prop.repos, agents: prop.agents }); setScanning(false); setAdding(false);
    }, 380 * scanLines.length + 350));
  }
  const set = (patch: Partial<Draft>) => setD(x => ({ ...x, ...patch }));
  const taken = (m: string, path: string) => d.repos.some(r => r.machine === m && r.path === path);
  const save = () => { setTried(true); if (missing) { nameRef.current?.focus(); return; } p.onSave({ ...d, name: d.name.trim(), repos: kept.map(({ why, checked, ...r }) => r), agents: d.agents?.filter(a => a.checked) }); };
  const members = editingProject ? p.agents.filter(a => a.project === editingProject.id) : [];
  const others = p.projects.filter(x => x.id !== d.id);
  const title = deleting ? `Supprimer ${editingProject?.name}` : proposal ? (proposal.targetId || p.mode === 'edit' ? `Proposition de Ledge pour ${editingProject?.name ?? d.name}` : 'Proposition de Ledge') : p.mode === 'edit' ? `Modifier ${editingProject?.name}` : 'Nouveau projet';

  if (scanning) return <div className="pe">
    <div className="modal-title"><h2 id="modal-title">Ledge prépare un projet</h2><Button variant="ghost" size="icon" aria-label="Fermer" onClick={p.onCancel}><Icon d={ICONS.close.d} /></Button></div>
    <div className="pe-scan" role="status" aria-live="polite">
      <span className="pe-scan-mascot"><ResidentMascot size={84} theme={p.theme} paused={p.paused} /><span className="pe-dots" aria-hidden="true"><i /><i /><i /></span></span>
      <strong>Ledge parcourt PC local et Dev SSH…</strong>
      <ul>{scanLines.map((l, i) => <li key={l} className={i < step ? 'done' : i === step ? 'now' : ''}>{i < step ? <Icon d={ICONS.check.d} size={13} /> : <i className="pe-wait" />}{l}</li>)}</ul>
      <Button variant="ghost" size="sm" onClick={() => { timers.current.forEach(clearTimeout); setScanning(false); }}>Annuler</Button>
    </div>
  </div>;

  return <form className="pe" onSubmit={e => { e.preventDefault(); save(); }} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}>
    <div className="modal-title"><h2 id="modal-title">{title}</h2><Button variant="ghost" size="icon" aria-label="Fermer" onClick={p.onCancel}><Icon d={ICONS.close.d} /></Button></div>
    {deleting && editingProject ? <div className="pe-body">
      <div className="pe-delete" role="alert">
        <p><strong>{editingProject.name}</strong> disparaît de la barre latérale et de l’atelier. Ses dépôts restent intacts sur vos machines.</p>
        <ul>
          <li>{members.length ? <>{members.length} agent{members.length > 1 ? 's' : ''} ({members.slice(0, 4).map(a => a.name).join(', ')}{members.length > 4 ? '…' : ''}) {moveTo ? <>rejoindront <strong>{p.projects.find(x => x.id === moveTo)?.name}</strong>.</> : <>passeront dans « Sans projet ».</>}</> : 'Aucun agent à cette table.'}</li>
          <li>{p.rulesFor(editingProject.id)} dossier{p.rulesFor(editingProject.id) > 1 ? 's' : ''} mémorisé{p.rulesFor(editingProject.id) > 1 ? 's' : ''} {p.rulesFor(editingProject.id) > 1 ? (moveTo ? 'pointeront vers ce projet.' : 'seront oubliés.') : (moveTo ? 'pointera vers ce projet.' : 'sera oublié.')}</li>
        </ul>
        <fieldset className="pe-move">
          <legend className="composer-label">Ses agents</legend>
          <label className={`chip ${!moveTo ? 'selected' : ''}`}><input type="radio" name="move" checked={!moveTo} onChange={() => setMoveTo('')} />Sans projet</label>
          <label className={`chip ${moveTo ? 'selected' : ''}`}><input type="radio" name="move" checked={!!moveTo} onChange={() => setMoveTo(others[0]?.id ?? '')} />Déplacer vers…</label>
          {moveTo && <select aria-label="Projet de destination" value={moveTo} onChange={e => setMoveTo(e.target.value)}>{others.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        </fieldset>
      </div>
    </div> : <div className="pe-body">
      {fresh && <div className="pe-ledge">
        <ResidentMascot size={44} theme={p.theme} paused={p.paused} />
        <div><strong>Pas envie de chercher les dépôts vous-même ?</strong><span>Ledge parcourt vos machines, regroupe les dépôts qui vont ensemble et vous propose un projet à vérifier.</span></div>
        <Button variant="primary" size="sm" onClick={runLedge}>Laisser Ledge faire</Button>
      </div>}
      {proposal && <div className="pe-proposal"><ResidentMascot size={28} theme={p.theme} paused={p.paused} /><div><strong>Ledge propose</strong><span>{proposal.summary} Décochez ce qui ne va pas, puis validez : rien n’est créé avant.</span></div></div>}
      <div className="pe-identity">
        <label className="pe-field"><span className="composer-label">Nom</span><input ref={nameRef} value={d.name} maxLength={60} placeholder="Ex. Paper Rendering" aria-invalid={tried && !!missing} aria-describedby={tried && missing ? 'pe-name-error' : undefined} onChange={e => set({ name: e.target.value })} />{tried && missing && <span id="pe-name-error" className="set-error" role="alert">{missing}</span>}</label>
        <fieldset className="pe-colors"><legend className="composer-label">Couleur</legend>
          {COLORS.map(([n, c]) => <label key={c} title={n} className={d.color === c ? 'on' : ''} style={{ '--c': c } as React.CSSProperties}><input type="radio" name="pe-color" aria-label={n} checked={d.color === c} onChange={() => set({ color: c })} /></label>)}
        </fieldset>
      </div>
      <label className="pe-field"><span className="composer-label">Description <small>facultatif</small></span><input value={d.note} maxLength={120} placeholder="Une phrase qui dit à quoi sert le projet" onChange={e => set({ note: e.target.value })} /></label>
      <section className="pe-repos" aria-labelledby="pe-repos-title">
        <div className="pe-repos-head"><span className="composer-label" id="pe-repos-title">Dépôts de travail · {kept.length}</span>{!fresh && !proposal && <Button size="sm" variant="ghost" onClick={runLedge}><Icon d={['M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z']} size={14} />Demander à Ledge</Button>}</div>
        {d.repos.length ? <ul className="pe-repo-list">{d.repos.map(r => { const owner = ownerOf(p.projects, r.machine, r.path, d.id); const key = r.machine + r.path;
          return <li key={key} className={r.checked === false ? 'off' : ''}>
            {r.why !== undefined && <input type="checkbox" checked={r.checked !== false} aria-label={`Garder ${basename(r.path)} (${r.machine})`} onChange={e => set({ repos: d.repos.map(x => x.machine + x.path === key ? { ...x, checked: e.target.checked } : x) })} />}
            <span className="pe-repo-main"><span className="pe-repo-line"><strong>{basename(r.path)}</strong><span className="pe-machine"><i className="machine-dot" />{r.machine}</span>{r.branch ? <span className="pe-branch mono" title="Branche par défaut détectée">⎇ {r.branch}</span> : <span className="pe-branch">Dossier sans Git</span>}</span>
              <code className="mono">{r.path}</code>{r.why && <small className="pe-why">{r.why}</small>}{owner && <small className="set-warn">Aussi dans {owner.name}</small>}</span>
            <Button size="icon" variant="ghost" aria-label={`Retirer ${basename(r.path)} (${r.machine})`} onClick={() => set({ repos: d.repos.filter(x => x.machine + x.path !== key) })}><Icon d={ICONS.close.d} size={14} /></Button>
          </li>; })}</ul> : !adding && <p className="pe-empty">Aucun dépôt pour l’instant. Le projet peut exister sans, mais Ledge ne saura pas y ranger les sessions.</p>}
        {d.agents && d.agents.length > 0 && <div className="pe-agents"><span className="composer-label">Ranger aussi</span>{d.agents.map(a => <label key={a.id} className={`chip ${a.checked ? 'selected' : ''}`}><input type="checkbox" checked={a.checked} onChange={e => set({ agents: d.agents!.map(x => x.id === a.id ? { ...x, checked: e.target.checked } : x) })} /><Bot tool={a.tool} state="working" pose={1} size={18} theme={p.theme} seed={a.id} paused /> {a.name}</label>)}</div>}
        {adding ? <FolderPicker machines={p.machines} taken={taken} onAdd={r => set({ repos: [...d.repos, r] })} /> : <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Icon d={ICONS.plus.d} size={14} />Ajouter un dépôt</Button>}
      </section>
    </div>}
    <footer className="composer-footer">
      {deleting ? <>
        <span className="spacer" />
        <Button variant="ghost" onClick={() => p.startDelete ? p.onCancel() : setDeleting(false)}>Annuler</Button>
        <Button variant="primary" onClick={() => p.onDelete(d.id!, moveTo || null)}>{moveTo ? 'Déplacer et supprimer' : `Supprimer ${editingProject?.name}`}</Button>
      </> : <>
        {p.mode === 'edit' && !proposal && <Button variant="ghost" className="pe-delete-btn" onClick={() => setDeleting(true)}>Supprimer le projet</Button>}
        <span className="composer-preview"><i className="side-swatch" style={{ background: d.color }} /><span><span className="preview-line"><strong>{d.name.trim() || 'Nouveau projet'}</strong></span><small>{kept.length} dépôt{kept.length > 1 ? 's' : ''}{kept.length ? ` sur ${[...new Set(kept.map(r => r.machine))].join(', ')}` : ''}{p.mode === 'new' ? ' · la table apparaîtra avec la première session' : ''}</small></span></span>
        {tried && missing && <span className="composer-missing">{missing}</span>}
        <Button variant="ghost" onClick={p.onCancel}>Annuler</Button>
        <Button variant="primary" type="submit" aria-disabled={!!missing}>{editingProject ? (p.mode === 'edit' && !proposal ? 'Enregistrer' : `Ajouter à ${editingProject.name}`) : 'Créer le projet'}<Kbd>Ctrl ↵</Kbd></Button>
      </>}
    </footer>
  </form>;
}

/** Réglages › Projets: "Ledge, propose-moi des projets", several at once. */
export function LedgeSuggestions({ projects, agents, theme, paused, onReview, onDismiss }: { projects: Project[]; agents: AgentLite[]; theme: 'dark' | 'light'; paused: boolean; onReview: (p: Proposal) => void; onDismiss?: () => void }) {
  const [state, setState] = useState<'idle' | 'scanning' | 'done'>('idle');
  const [ignored, setIgnored] = useState<string[]>([]);
  const list = useMemo(() => state === 'done' ? groups(projects, agents) : [], [state, projects, agents]);
  useEffect(() => { if (state !== 'scanning') return; const t = setTimeout(() => setState('done'), 1500); return () => clearTimeout(t); }, [state]);
  const shown = list.filter(x => !ignored.includes(x.name));
  return <section className="set-card ledge-suggest" aria-labelledby="ledge-suggest-title">
    <div className="ledge-suggest-head"><ResidentMascot size={40} theme={theme} paused={paused || state !== 'scanning'} /><div><h2 id="ledge-suggest-title">Laisser Ledge organiser</h2><p className="set-hint">Ledge regarde les dossiers des agents sans projet et les dépôts que vous n’avez rangés nulle part, puis propose des projets.</p></div>
      {state !== 'scanning' && <Button variant={state === 'done' ? 'ghost' : 'primary'} size="sm" onClick={() => { setIgnored([]); setState('scanning'); }}>{state === 'done' ? 'Relancer' : 'Ledge, propose-moi des projets'}</Button>}</div>
    {state === 'scanning' && <p className="ledge-suggest-scan" role="status"><span className="ledge-spin"><Icon d={ICONS.refresh.d} size={14} /></span>Ledge parcourt PC local et Dev SSH…</p>}
    {state === 'done' && <div className="ledge-suggest-list" role="status">{shown.length ? shown.map(x => <article key={x.name} className="suggest-card" aria-label={`Proposition ${x.name}`}>
      <i className="side-swatch" style={{ background: x.color }} /><div><strong>{x.targetId ? `Compléter ${x.name}` : x.name}</strong><span className="set-hint">{x.summary}</span>
        <span className="repo-chips">{x.repos.filter(r => r.why).map(r => <span key={r.machine + r.path} className="set-tag" title={r.why}>{basename(r.path)} · {r.machine}</span>)}{x.agents?.map(a => <span key={a.id} className="set-tag ok">{a.name}</span>)}</span></div>
      <div className="suggest-actions"><Button size="sm" variant="primary" onClick={() => onReview({ ...x, pid: pid() })}>{x.targetId ? 'Vérifier et ajouter…' : 'Vérifier et créer…'}</Button><Button size="sm" variant="ghost" onClick={() => setIgnored([...ignored, x.name])}>Ignorer</Button></div>
    </article>) : <p className="set-hint">Tout est déjà rangé : aucun dépôt libre ni agent sans projet à regrouper.</p>}</div>}
  </section>;
}
