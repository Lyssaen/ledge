import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../../apps/overlay/src/ui/Button';
import { Icon, ICONS } from '../../../apps/overlay/src/ui/icons';
import { Tabs } from '../../../apps/overlay/src/ui/Tabs';
import { LangProvider } from '../../../apps/overlay/src/i18n/lang';
import { DetailHeader } from '../../../apps/overlay/src/surface/DetailHeader';
import { Shoulders } from '../../../apps/overlay/src/surface/Shoulders';
import '../../../apps/overlay/src/styles/base.css';
import '../multi-machine-chat/preview.css';
import './machines.css';

type Status = 'online' | 'offline' | 'checking';
interface Machine { id: string; label: string; ssh?: string; status: Status; version?: string; sessions?: number; error?: { raw: string; hint: string } }
type Scenario = 'overview' | 'add' | 'error' | 'remove';
type Test = { state: 'idle' | 'running' } | { state: 'ok'; version: string; sessions: number } | { state: 'fail'; raw: string; hint: string };

const monitor = { d: ['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8'] };
const server = { d: ['M4 3h16v7H4z', 'M4 14h16v7H4z', 'M7 6.5h.01', 'M7 17.5h.01'] };
const LOCAL: Machine = { id: 'local', label: 'Cette machine', status: 'online', version: '0.4.0', sessions: 3 };
const AGENTS: Machine = { id: 'agents', label: 'dev-server', ssh: 'dev-server', status: 'online', version: '0.4.0', sessions: 12 };
const BUILD: Machine = { id: 'build', label: 'Build box', ssh: 'build-box', status: 'offline', error: { raw: 'ssh: connect to host build-box port 22: Connection timed out', hint: 'Le serveur ne répond pas. Il est peut-être éteint, ou hors du réseau.' } };
const initial = (s: Scenario): Machine[] => s === 'error' ? [LOCAL, AGENTS, BUILD] : s === 'add' ? [LOCAL] : [LOCAL, AGENTS];

/** What the test would answer, by alias, to show the main SSH failures in plain words. */
function probe(alias: string): Test {
  if (alias === 'dev-server' || alias === 'mon-serveur') return { state: 'ok', version: '0.4.0', sessions: alias === 'dev-server' ? 12 : 0 };
  if (/ancien|old/.test(alias)) return { state: 'fail', raw: 'error: unknown command \'bridge\'', hint: 'Ledge est trop ancien sur ce serveur. Mettez-le à jour, puis relancez « ledge setup ».' };
  if (/cle|key/.test(alias)) return { state: 'fail', raw: 'Permission denied (publickey).', hint: 'La clé SSH est refusée. Vérifiez IdentityFile pour cet alias dans ~/.ssh/config de WSL.' };
  if (/nouveau|new/.test(alias)) return { state: 'fail', raw: 'Host key verification failed.', hint: 'La clé du serveur n’est pas encore approuvée. Connectez-vous une fois depuis WSL : ssh ' + alias };
  return { state: 'fail', raw: `ssh: Could not resolve hostname ${alias}: Name or service not known`, hint: 'Alias introuvable. Ajoutez un bloc « Host ' + alias + ' » dans ~/.ssh/config de WSL.' };
}

function Dot({ status }: { status: Status }) {
  return <span className="ms-status" data-status={status}><span className="ms-dot" />{status === 'online' ? 'Connectée' : status === 'checking' ? 'Connexion…' : 'Hors ligne'}</span>;
}

function MachineRow({ m, onTest, onEdit, onRemove }: { m: Machine; onTest: () => void; onEdit: () => void; onRemove: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const meta = [m.ssh ? `SSH · ${m.ssh}` : 'Local · WSL', m.version && `Ledge ${m.version}`, m.sessions !== undefined && m.status === 'online' && `${m.sessions} session${m.sessions > 1 ? 's' : ''}`].filter(Boolean);
  return <div className="ms-row">
    <span className="ms-icon"><Icon {...(m.ssh ? server : monitor)} size={16} /></span>
    <div className="ms-body">
      <div className="ms-line"><span className="ms-name">{m.label}</span><Dot status={m.status} /></div>
      <span className="ms-meta">{meta.join(' · ')}</span>
      {m.error && m.status === 'offline' && <div className="ms-error" role="status"><p>{m.error.hint}</p><code>{m.error.raw}</code></div>}
      {m.ssh && (confirm ? <div className="ms-confirm" role="alert"><p>Retirer <strong>{m.label}</strong> ? Ses sessions disparaissent de la liste. Rien n’est arrêté ni supprimé sur le serveur.</p><div className="ms-actions"><Button size="sm" variant="primary" onClick={onRemove}>Retirer</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Annuler</Button></div></div>
        : <div className="ms-actions"><Button size="sm" variant="ghost" onClick={onTest} disabled={m.status === 'checking'}><Icon {...ICONS.refresh} size={14} />{m.status === 'offline' ? 'Réessayer' : 'Tester'}</Button><Button size="sm" variant="ghost" onClick={onEdit}>Modifier</Button><Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>Retirer</Button></div>)}
    </div>
  </div>;
}

function MachineForm({ initialValue, taken, onSave, onCancel }: { initialValue?: Machine; taken: string[]; onSave: (m: Machine) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(initialValue?.label ?? ''), [ssh, setSsh] = useState(initialValue?.ssh ?? '');
  const [test, setTest] = useState<Test>({ state: 'idle' });
  const [help, setHelp] = useState(!initialValue);
  const alias = ssh.trim();
  const duplicate = taken.includes(alias);
  const valid = !!label.trim() && /^[a-zA-Z0-9._-]+$/.test(alias) && !duplicate;
  useEffect(() => { setTest({ state: 'idle' }); }, [ssh]);
  const run = () => { setTest({ state: 'running' }); setTimeout(() => setTest(probe(alias)), 1100); };
  const save = (e: React.FormEvent) => { e.preventDefault(); if (!valid) return; const r = probe(alias); onSave({ id: initialValue?.id ?? `remote-${alias}`, label: label.trim(), ssh: alias, ...(r.state === 'ok' ? { status: 'online', version: r.version, sessions: r.sessions } : r.state === 'fail' ? { status: 'offline', error: { raw: r.raw, hint: r.hint } } : { status: 'offline' }) }); };
  return <form className="ms-form" onSubmit={save} aria-label={initialValue ? 'Modifier la machine' : 'Ajouter une machine'}>
    <strong className="ms-title">{initialValue ? `Modifier ${initialValue.label}` : 'Ajouter une machine'}</strong>
    <label className="ms-field">Nom<small>Ce que vous verrez dans les sessions et le chat.</small><input className="ledge-field" value={label} onChange={e => setLabel(e.target.value)} placeholder="Serveur de dev" autoFocus /></label>
    <label className="ms-field">Alias SSH<small>Le nom d’un bloc Host de ~/.ssh/config dans WSL.</small><input className="ledge-field mono" value={ssh} onChange={e => setSsh(e.target.value)} placeholder="mon-serveur" spellCheck={false} />{duplicate && <span className="ms-invalid">Cet alias est déjà ajouté.</span>}</label>
    <div className="ms-help">
      <button type="button" aria-expanded={help} onClick={() => setHelp(!help)}><span className="ms-chevron" data-open={help || undefined}><Icon {...ICONS.chevronRight} size={12} /></span>Avant d’ajouter un serveur</button>
      {help && <ol>
        <li>L’alias fonctionne depuis WSL, sans mot de passe : <code>ssh mon-serveur</code></li>
        <li>La clé du serveur est déjà approuvée (première connexion faite à la main).</li>
        <li>Node 22+ et tmux sont installés sur le serveur.</li>
        <li>Ledge est installé et démarré sur le serveur : <code>npm i -g @paradow/ledge && ledge setup</code></li>
      </ol>}
    </div>
    {test.state !== 'idle' && <div className="ms-test" data-state={test.state} role="status">
      {test.state === 'running' && <><span className="ms-spin"><Icon {...ICONS.refresh} size={14} /></span><span>Connexion à <span className="mono">{alias}</span>…</span></>}
      {test.state === 'ok' && <><Icon {...ICONS.check} size={14} /><span>Ledge {test.version} répond · {test.sessions} session{test.sessions > 1 ? 's' : ''}</span></>}
      {test.state === 'fail' && <><Icon {...ICONS.close} size={14} /><span><p>{test.hint}</p><code>{test.raw}</code></span></>}
    </div>}
    <div className="ms-actions"><Button size="sm" onClick={run} disabled={!valid || test.state === 'running'}>Tester la connexion</Button><span style={{ flex: 1 }} /><Button size="sm" variant="ghost" onClick={onCancel}>Annuler</Button><Button size="sm" variant="primary" type="submit" disabled={!valid}>Enregistrer</Button></div>
  </form>;
}

function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [scenario, setScenario] = useState<Scenario>('overview');
  const [machines, setMachines] = useState<Machine[]>(initial('overview'));
  const [form, setForm] = useState<'add' | string | null>(null);
  const [tab, setTab] = useState('machines');
  const [note, setNote] = useState('');
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  const reset = (s: Scenario) => { setScenario(s); setMachines(initial(s)); setForm(s === 'add' ? 'add' : null); setTab('machines'); setNote(s === 'remove' ? 'Cliquez sur « Retirer » sous dev-server.' : ''); };
  const retest = (id: string) => {
    setMachines(ms => ms.map(m => m.id === id ? { ...m, status: 'checking' } : m));
    setTimeout(() => setMachines(ms => ms.map(m => m.id === id ? { ...m, status: m.error ? 'offline' : 'online' } : m)), 1100);
  };
  const editing = form && form !== 'add' ? machines.find(m => m.id === form) : undefined;
  const remotes = machines.filter(m => m.ssh);
  const scenarios = [['overview', '01', 'Vue d’ensemble', 'Chaque machine, son état, ses sessions.'], ['add', '02', 'Ajouter un serveur', 'Nom, alias SSH, test avant d’enregistrer.'], ['error', '03', 'Un serveur injoignable', 'L’erreur SSH, traduite en clair.'], ['remove', '04', 'Retirer une machine', 'Confirmation dans la ligne.']] as const;

  return <LangProvider lang="fr"><div className="design-page">
    <header className="studio-head"><span className="wordmark">Ledge<span>.</span></span><span className="studio-label">RÉGLAGES / MACHINES</span><Button variant="ghost" size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon {...ICONS.dnd} />{theme === 'dark' ? 'Thème clair' : 'Thème sombre'}</Button></header>
    <div className="studio-layout">
      <aside className="notes"><div className="eyebrow">UN ONGLET DÉDIÉ</div><h1>Vos machines,<br />au même endroit.</h1><p>Un nouvel onglet « Machines » dans les réglages.<br />Ajouter, tester, corriger ou retirer un serveur.</p>
        <nav aria-label="Scénarios de la maquette">{scenarios.map(([id, number, title, hint]) => <button key={id} aria-pressed={scenario === id} onClick={() => reset(id)}><span className="step-number">{number}</span><span><strong>{title}</strong><small>{hint}</small></span><Icon {...ICONS.chevronRight} size={14} /></button>)}</nav>
        <div className="design-note"><span className="note-rule" /><strong>Essayez des alias.</strong><p><span className="mono">dev-server</span> répond. <span className="mono">vieux-old</span>, <span className="mono">cle-key</span>, <span className="mono">nouveau-new</span> ou un nom inconnu montrent les erreurs les plus courantes.</p></div>
        <small className="simulation">Maquette interactive · aucune connexion réelle<br />Les tests et les erreurs sont simulés.</small>
      </aside>
      <section className="preview-area" aria-label="Aperçu des réglages Ledge"><div className="desktop-bar"><span>RÉGLAGES / MACHINES</span><span>APERÇU À TAILLE RÉELLE · 480 PX</span></div><div className="desktop">
        <div className="island-frame"><Shoulders left={0} w={480} transition="none" opacity={1} />
          <main data-surface className="chat-panel ms-panel">
            <DetailHeader title="Votre Ledge" onBack={() => {}} onClose={() => {}} />
            <div className="ledge-scroll ms-scroll"><div className="ms-content">
              <Tabs id="ms-tabs" label="Sections des réglages" value={tab} onChange={setTab} tabs={[{ value: 'display', label: 'Affichage' }, { value: 'machines', label: 'Machines' }, { value: 'notifications', label: 'Notifications' }, { value: 'sounds', label: 'Sons' }, { value: 'about', label: 'À propos' }]} />
              {tab !== 'machines' ? <p className="ms-elsewhere">Cet onglet ne change pas. Les machines quittent « Affichage » pour leur propre onglet.</p> : <div className="ms-panel-body" key={scenario}>
                <p className="ms-intro">Ledge rejoint vos serveurs par SSH, depuis WSL. Leurs sessions s’affichent dans vos projets, avec le nom de la machine.</p>
                {machines.map(m => form === m.id ? null : <MachineRow key={m.id} m={m} onTest={() => retest(m.id)} onEdit={() => setForm(m.id)} onRemove={() => { setMachines(ms => ms.filter(x => x.id !== m.id)); setNote(`${m.label} est retiré. Ses sessions ne sont plus affichées.`); }} />)}
                {form ? <MachineForm key={form} initialValue={editing} taken={remotes.filter(m => m.id !== form).map(m => m.ssh!)} onCancel={() => setForm(null)} onSave={m => { setMachines(ms => editing ? ms.map(x => x.id === m.id ? m : x) : [...ms, m]); setForm(null); setNote(m.status === 'online' ? `${m.label} est connectée.` : `${m.label} est enregistrée, mais injoignable pour l’instant.`); }} />
                  : <div className="ms-add"><Button size="sm" onClick={() => { setForm('add'); setNote(''); }}><Icon {...ICONS.plus} size={14} />Ajouter une machine</Button></div>}
                {remotes.length === 0 && !form && <p className="ms-empty">Aucun serveur pour l’instant. Vos sessions locales ne changent pas.</p>}
              </div>}
            </div></div>
          </main>
        </div>
        <div className="desktop-caption" role="status"><span className="caption-line" />{note || (form ? 'Le test est facultatif : une machine injoignable peut être enregistrée.' : 'La machine locale ne peut pas être retirée.')}</div>
      </div></section>
    </div>
  </div></LangProvider>;
}
createRoot(document.getElementById('root')!).render(<App />);
