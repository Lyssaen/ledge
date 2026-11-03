import React, { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopView, type DesktopState } from './desktop';
import { TuiAttached, TuiOverview, Who } from './tui';

type View = 'desktop' | 'tui' | 'who' | 'texts';
const VIEWS: Array<[View, string]> = [['desktop', '1 · Desktop'], ['tui', '2 · ledge tui'], ['who', '3 · ledge who'], ['texts', '4 · Textes FR / EN']];
const DESK: Array<[DesktopState, string]> = [['live', 'Au travail · inactif'], ['stopped', 'Siège arrêté'], ['stoppedOpen', 'Clic sur un siège arrêté']];
type Tui = 'overview' | 'attached' | 'stopped';
const TUI: Array<[Tui, string]> = [['overview', 'Vue d’ensemble (1)'], ['attached', '↵ sur Ivo'], ['stopped', '↵ sur Tom (arrêté)']];

const read = (k: string) => new URLSearchParams(location.hash.slice(1)).get(k);

function Seg<T extends string>({ items, value, onChange, label }: { items: Array<[T, string]>; value: T; onChange(v: T): void; label: string }) {
  return <div className="mk-seg" role="radiogroup" aria-label={label}>{items.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={k === value} onClick={() => onChange(k)}>{l}</button>)}</div>;
}

function Notes({ title, children, open }: { title: string; children: ReactNode; open?: ReactNode }) {
  return (
    <aside className="mk-notes">
      <div className="mk-card"><p className="mk-kicker">Ce qui change</p><h3>{title}</h3>{children}</div>
      {open && <div className="mk-card"><h3>À trancher</h3>{open}</div>}
    </aside>
  );
}


function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>((read('theme') as 'dark' | 'light') ?? 'dark');
  const [view, setView] = useState<View>((read('view') as View) ?? 'desktop');
  const [desk, setDesk] = useState<DesktopState>((read('desk') as DesktopState) ?? 'live');
  const [tui, setTui] = useState<Tui>((read('tui') as Tui) ?? 'overview');
  document.documentElement.dataset.theme = theme;
  useEffect(() => { history.replaceState(null, '', `#view=${view}&theme=${theme}&desk=${desk}&tui=${tui}`); }, [view, theme, desk, tui]);

  return (
    <div className="mk">
      <header className="mk-bar">
        <strong>Maquette · sièges OMP dans Ledge</strong>
        <nav className="mk-seg" role="tablist" aria-label="Vues">{VIEWS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={k === view} onClick={() => setView(k)}>{l}</button>)}</nav>
        <span className="mk-fill" />
        <Seg label="Thème" items={[['dark', 'Sombre'], ['light', 'Clair']]} value={theme} onChange={setTheme} />
      </header>

      {view === 'desktop' && <main className="mk-main">
        <div className="mk-col">
          <Seg label="État" items={DESK} value={desk} onChange={setDesk} />
          <div className="mk-app"><DesktopView state={desk} /></div>
        </div>
        <Notes title="Un siège OMP sous son rig, comme les autres" open={<ul>
          <li><b>Siège arrêté</b> (complément) : gardé sous son rig, mascotte figée, nom en gris, « arrêté » à droite. Il ne compte dans aucun chiffre du rig. Seuls les sièges OMP sont concernés.</li>
          <li><b>Clic sur un siège arrêté</b> : sa page s’ouvre, mais son terminal n’existe plus. À la place, « Siège arrêté. Son terminal n’existe plus : la page OpenRig montre son rig. » et un lien « Ouvrir la page OpenRig » qui ouvre la section Rigs sur sa machine, comme le lien vide de la sidebar. Pas de panneau terminal et pas de relance depuis cette page.</li>
        </ul>}>
          <ul>
            <li><b>Sidebar</b> : sous son rig, la mascotte OMP, le nom donné par Ledge, puis <code>rôle · omp</code>. C’est le format actuel des sièges Claude et Codex : aucun changement d’écran, seulement les données.</li>
            <li><b>États</b> : au travail (pose « travail », compté dans le chiffre bleu du rig) et inactif (pose « disponible »). Une fin de tour en erreur compte comme inactive. Pas d’attente d’accord ni de question : un siège OMP n’en pose jamais sous OpenRig.</li>
            <li><b>Clic ou ouverture (le point à trancher)</b> : je recommande d’ouvrir sa page comme pour tout siège, mais <b>sur son terminal</b>. Le pane tmux du siège est attaché dans l’onglet « Ivo · agent » du panneau terminal, le même que pour un siège Claude. On y voit le miroir texte du runner OpenRig (réponses, lignes d’outil, <code>you &gt; …</code>), et ce qu’on y tape part à l’agent. À la place du fil, une ligne dit pourquoi il n’y en a pas. Pas de champ de réponse ni de bouton d’interruption Ledge.</li>
            <li>Pourquoi pas « rien » : la ligne serait alors la seule de la sidebar qui ne s’ouvre pas, et la personne n’aurait aucun moyen de parler au siège depuis Ledge. Pourquoi pas une fenêtre externe : Desktop a déjà ce terminal intégré, sans rien à installer.</li>
          </ul>
        </Notes>
      </main>}

      {view === 'tui' && <main className="mk-main">
        <div className="mk-col">
          <Seg label="Écran" items={TUI} value={tui} onChange={setTui} />
          <div className={'mk-tui tui-' + theme}>{tui === 'overview' ? <TuiOverview /> : tui === 'stopped' ? <TuiOverview stoppedOn /> : <TuiAttached />}</div>
        </div>
        <Notes title="Dans la liste de ledge tui" open={<ul>
          <li><b>Siège arrêté</b> (complément) : gardé dans la boîte RIGS, tout en gris (glyphe <code>·</code>, nom, rôle, harnais, « Arrêté »). Le compte du rig garde « N sessions » et devient « 2 sessions sur 3 » quand un siège OMP y est arrêté.</li>
          <li><b>↵ ou a sur un siège arrêté</b> : rien ne s’attache. Un toast d’information, celui que Ledge montre déjà quand un terminal manque, dit « Tom est arrêté : son terminal n’existe plus. 6 ouvre OpenRig, où est son rig. » Quand un siège arrêté est choisi, la barre de touches ne montre ni ↵ ni a.</li>
        </ul>}>
          <ul>
            <li><b>Boîte RIGS</b> : un siège OMP est une ligne comme les autres, avec le glyphe et le mot de son état (● Au travail, ○ Disponible).</li>
            <li>Changement proposé, pour tous les sièges de rig : la ligne montre son rôle <b>puis son harnais</b>, comme la boîte KERNEL le fait déjà. Sans lui, rien ne distingue un siège OMP d’un siège Claude dans la liste. Si c’est de trop, on garde la ligne actuelle : seule la mascotte de Desktop dit alors le harnais.</li>
            <li><b>↵ sur un siège OMP</b> attache son terminal, comme <code>a</code> le fait pour toute session. Ouvrir l’écran de session n’aurait rien à montrer. <code>ctrl-b d</code> revient à <code>ledge tui</code>. La barre de touches dit « ↵ attacher son terminal » quand un siège OMP est choisi.</li>
          </ul>
        </Notes>
      </main>}

      {view === 'who' && <main className="mk-main">
        <div className="mk-col"><div className={'mk-tui tui-' + theme}><Who /></div></div>
        <Notes title="ledge who : rien de neuf à part les lignes" open={<ul>
          <li><b>Siège arrêté</b> (complément) : <code>ledge who</code> le liste aussi, <code>ÉTAT exited</code>, pour qu’un agent voie que ce siège ne répondra pas. Seuls les sièges OMP arrêtés y figurent ; les autres sessions terminées restent hors de la liste.</li>
        </ul>}>
          <ul>
            <li>Un siège OMP est une ligne ordinaire : <code>OUTIL omp</code>, <code>ÉTAT working</code> ou <code>idle</code>. Son sujet est vide (<code>-</code>) : OpenRig ne lui fait pas passer de première consigne par les hooks, contrairement aux sièges Claude et Codex.</li>
            <li>Aucune colonne nouvelle.</li>
          </ul>
        </Notes>
      </main>}

      {view === 'texts' && <main className="mk-main mk-texts">
        <table>
          <thead><tr><th>Clé (proposée)</th><th>FR</th><th>EN</th></tr></thead>
          <tbody>{TEXTS.map(([k, fr, en]) => <tr key={k}><td><code>{k}</code></td><td>{fr}</td><td>{en}</td></tr>)}</tbody>
        </table>
      </main>}
    </div>
  );
}

const TEXTS: Array<[string, string, string]> = [
  ['desktop session.rigTerminalOnly.title', 'Pas de fil pour ce siège.', 'No thread for this seat.'],
  ['desktop session.rigTerminalOnly.body', 'Ledge ne lit pas la conversation d’un siège OMP lancé par OpenRig. Son terminal est ouvert à côté : ce que tu y tapes lui est envoyé.', 'Ledge does not read the conversation of an OMP seat launched by OpenRig. Its terminal is open alongside: what you type there is sent to it.'],
  ['tui keys.attachSeat', 'attacher son terminal', 'attach its terminal'],
  ['desktop side.seatStopped', 'arrêté', 'stopped'],
  ['desktop session.rigStopped.title', 'Siège arrêté.', 'Seat stopped.'],
  ['desktop session.rigStopped.body', 'Son terminal n’existe plus : la page OpenRig montre son rig.', 'Its terminal is gone: the OpenRig page shows its rig.'],
  ['desktop session.rigStopped.open (= side.empty.openPage)', 'Ouvrir la page OpenRig', 'Open the OpenRig page'],
  ['tui state.stopped', 'Arrêté', 'Stopped'],
  ['tui overview.sessionsOf(live, all)', '${live} session(s) sur ${all} (pluriel sur le premier nombre)', '${live} session(s) of ${all}'],
  ['tui toast.seatStopped(n)', '${n} est arrêté : son terminal n’existe plus. 6 ouvre OpenRig, où est son rig.', '${n} is stopped: its terminal is gone. 6 opens OpenRig, where its rig is.']
];

createRoot(document.getElementById('root')!).render(<App />);
