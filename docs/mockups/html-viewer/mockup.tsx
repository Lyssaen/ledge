// Mockup: an HTML page an agent wrote, read in the session's « Navigateur » tab (Desktop). Real Button and Icon, real
// session.css classes for the page, its heading and the side pane; the thread is drawn schematically.
import { useEffect, useState, type JSX, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../../packages/ui/src/ui/Button';
import { Icon, ICONS } from '../../../packages/ui/src/ui/icons';
import { SHELL_ICONS } from '../../../apps/desktop/src/shell/icons';

type Theme = 'dark' | 'light';
type Width = 'wide' | 'narrow';
type Flow = 'open' | 'picker' | 'reloaded';
type View = 'flow' | 'states' | 'entries' | 'isolation' | 'choices';

const PAGE = 'docs/mockups/ledge-openrig-omp.html';

/** The page the agent wrote: its own look, whatever Ledge's theme (it is someone else's document). */
const FAKE = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;font:13px/1.45 system-ui,sans-serif;background:#f6f5f2;color:#1d1b16}
header{display:flex;align-items:center;gap:10px;padding:10px 16px;background:#fff;border-bottom:1px solid #e3e0d8}
header b{font-size:13px}.seg{display:flex;gap:2px;padding:2px;border:1px solid #e3e0d8;border-radius:7px;background:#f1efe9}
.seg span{padding:2px 9px;border-radius:5px;font-size:11px;color:#6b665a}.seg .on{background:#fff;color:#1d1b16;box-shadow:0 1px 2px #0002}
main{display:grid;grid-template-columns:190px 1fr;gap:16px;padding:16px}
.side{background:#1f1f22;color:#e8e8ea;border-radius:10px;padding:10px;font-size:11.5px}
.side h4{margin:4px 6px 8px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#9a9aa2}
.row{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px}.row.sel{background:#2d2d33}
.dot{width:14px;height:14px;border-radius:50%;background:#e0784f}.dot.b{background:#6c8cff}.dot.g{background:#6b6b70}
.row small{margin-left:auto;color:#9a9aa2}.row.off{opacity:.5}
.card{background:#fff;border:1px solid #e3e0d8;border-radius:10px;padding:14px 16px}
.card h3{margin:0 0 6px;font-size:14px}.card p{margin:0 0 10px;color:#55524a}
.term{background:#111;color:#cfe8cf;font:11px/1.5 ui-monospace,monospace;border-radius:8px;padding:10px 12px}
.note{margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:12px}.note div{background:#fff;border:1px solid #e3e0d8;border-radius:10px;padding:10px 12px;font-size:12px}
</style></head><body>
<header><b>Sièges OMP dans Ledge</b><div class="seg"><span class="on">1 · Desktop</span><span>2 · ledge tui</span><span>3 · ledge who</span><span>4 · Textes</span></div></header>
<main><div class="side"><h4>Rigs</h4><div class="row"><i class="dot b"></i>dev-omp<small>2</small></div><div class="row sel"><i class="dot"></i>Ivo<small>au travail</small></div><div class="row"><i class="dot"></i>Pia<small>inactif</small></div><div class="row"><i class="dot b"></i>split-omp<small>3</small></div><div class="row"><i class="dot"></i>Ana<small>inactif</small></div><div class="row off"><i class="dot g"></i>Tom<small>arrêté</small></div></div>
<div><div class="card"><h3>Ivo [dev-omp] · dev.agent · OMP · au travail</h3><p>Pas de fil pour ce siège. Sa vue Terminal montre son écran : ce que tu y tapes lui est envoyé.</p>
<div class="term">● ST7-412 · lecture de packages/ledge/src/daemon/omp/catalog.ts<br>● 3 tests verts · 1 en cours…<br>&gt; _</div></div>
<div class="note"><div><b>Clic</b> : la page du siège, sur sa vue Terminal.</div><div><b>Arrêté</b> : grisé sous son rig, lien vers OpenRig.</div></div></div></main>
</body></html>`;

function App(): JSX.Element {
  const [theme, setTheme] = useState<Theme>('dark');
  const [width, setWidth] = useState<Width>('wide');
  const [view, setView] = useState<View>('flow');
  const [flow, setFlow] = useState<Flow>('open');
  document.documentElement.dataset.theme = theme;
  useEffect(() => {
    // Captures drive the mockup from the URL: ?view=states&theme=light&width=narrow&flow=picker
    const q = new URLSearchParams(location.search);
    if (q.get('theme')) setTheme(q.get('theme') as Theme);
    if (q.get('view')) setView(q.get('view') as View);
    if (q.get('width')) setWidth(q.get('width') as Width);
    if (q.get('flow')) setFlow(q.get('flow') as Flow);
  }, []);
  const VIEWS: [View, string][] = [['flow', '1 · Parcours'], ['states', '2 · États'], ['entries', '3 · Entrées'], ['isolation', '4 · Rendu isolé'], ['choices', '5 · Choix et textes']];
  return (
    <>
      <div className="mk-bar">
        <strong>Maquette · Lecteur de pages HTML dans « Navigateur »</strong>
        <div className="mk-seg" role="radiogroup">{VIEWS.map(([v, l]) => <button key={v} role="radio" aria-checked={view === v} onClick={() => setView(v)}>{l}</button>)}</div>
        <span className="mk-fill" />
        {view === 'flow' && <div className="mk-seg">{(['open', 'picker', 'reloaded'] as Flow[]).map(f => <button key={f} aria-checked={flow === f} onClick={() => setFlow(f)}>{{ open: 'Page ouverte', picker: 'Choix de la page', reloaded: 'Rechargée' }[f]}</button>)}</div>}
        {view === 'flow' && <div className="mk-seg">{(['wide', 'narrow'] as Width[]).map(w => <button key={w} aria-checked={width === w} onClick={() => setWidth(w)}>{w === 'wide' ? 'Large' : 'Étroit'}</button>)}</div>}
        <div className="mk-seg">{(['dark', 'light'] as Theme[]).map(x => <button key={x} aria-checked={theme === x} onClick={() => setTheme(x)}>{x === 'dark' ? 'Sombre' : 'Clair'}</button>)}</div>
      </div>
      <main className="mk-main">
        {view === 'flow' && <FlowView flow={flow} width={width} />}
        {view === 'states' && <StatesView />}
        {view === 'entries' && <EntriesView />}
        {view === 'isolation' && <IsolationView />}
        {view === 'choices' && <ChoicesView />}
      </main>
    </>
  );
}

/* ───────────── 1 · Parcours ───────────── */

function FlowView({ flow, width }: { flow: Flow; width: Width }): JSX.Element {
  const intro = {
    open: <>Otto vient d'écrire une maquette. Dans le fil, la ligne <b>Écrit … .html</b> et le chemin cité dans sa réponse portent <b>« Voir la page »</b>. Un clic ouvre l'onglet <b>Navigateur</b> du volet, sur <b>Pages</b> : la page tourne à part, comme dans un navigateur.</>,
    picker: <>Le chemin en tête de l'onglet est un sélecteur : les fichiers <code>.html</code> que la session a <b>écrits</b> ou <b>cités</b>, les plus récents d'abord. Pas d'explorateur de dossiers.</>,
    reloaded: <>Otto réécrit la page : le daemon, qui surveille le fichier pendant que la vue est ouverte, prévient le volet ; l'onglet la <b>recharge seul</b> et le dit quelques secondes. « Recharger » reste là : sous <code>/mnt/c</code>, une écriture faite côté Windows peut passer inaperçue.</>
  }[flow];
  return (
    <>
      <p className="mk-intro">{intro}</p>
      <div className={`mk-app ${width}`}>
        <SessionFrame flow={flow} />
      </div>
      {width === 'narrow' && <p className="mk-note">En disposition étroite (page ≤ 860 px), le volet se pose sur le fil comme aujourd'hui ; « Fermer » ou Échap le retire.</p>}
    </>
  );
}

function SessionFrame({ flow }: { flow: Flow }): JSX.Element {
  return (
    <section className="conversation session-page">
      <Heading />
      <div className="session-split has-pane" style={{ '--split': '54%' } as React.CSSProperties}>
        <div className="session-main"><ThreadSketch /></div>
        <div className="split-handle" role="separator" />
        <aside className="side-pane">
          <div className="pane-tabs" role="tablist">
            <PaneTab icon={SHELL_ICONS.browser} label="Navigateur" current />
            <PaneTab icon={SHELL_ICONS.diff} label="± desktop.tsx" />
          </div>
          <SideHead />
          <div className="side-body mk-page">
            <AddressBar picker={flow === 'picker'} />
            <PageFrame reloaded={flow === 'reloaded'} />
          </div>
        </aside>
      </div>
    </section>
  );
}

function Heading(): JSX.Element {
  return (
    <div className="pane-heading">
      <div className="view-switch" role="tablist">
        <button type="button" role="tab" aria-selected="true"><Icon d={SHELL_ICONS.thread} size={13} />Fil</button>
        <button type="button" role="tab" aria-selected="false"><Icon d={SHELL_ICONS.terminal} size={13} />Terminal<span className="view-dot" /></button>
      </div>
      <span className="pane-meta mono">Local · ledge</span>
      <span className="spacer" />
      <button type="button" className="kids-pill browser-pill mk-on" title="Navigateur, 2 pages, 3 captures"><Icon d={SHELL_ICONS.browser} size={13} />Navigateur<span className="tab-count mono">5</span></button>
    </div>
  );
}

function PaneTab({ icon, label, current }: { icon: string | readonly string[]; label: string; current?: boolean }): JSX.Element {
  return (
    <div className={`pane-tab${current ? ' current' : ''}`}>
      <button type="button" role="tab" aria-selected={!!current}><Icon d={icon} size={12} /><span>{label}</span></button>
      <button type="button" className="tab-close" aria-label={`Fermer ${label}`}><Icon d={ICONS.close.d} size={11} /></button>
    </div>
  );
}

/** The pane's head: « Navigateur », its Pages | Captures switch, « Agrandir », « Fermer ». */
function SideHead({ pages = 2, captures = 3, on = 'pages' }: { pages?: number; captures?: number; on?: 'pages' | 'captures' }): JSX.Element {
  return (
    <div className="side-head">
      <span className="side-title"><strong>Navigateur</strong></span>
      <div className="mk-switch" role="tablist" aria-label="Contenu du navigateur">
        <button role="tab" aria-selected={on === 'pages'}>Pages<span className="tab-count mono">{pages}</span></button>
        <button role="tab" aria-selected={on === 'captures'}>Captures<span className="tab-count mono">{captures}</span></button>
      </div>
      <Button variant="ghost" size="sm" className="side-grow"><Icon d={SHELL_ICONS.split} size={13} />Agrandir</Button>
      <Button variant="ghost" size="sm" className="side-close" aria-label="Fermer le volet (Échap)"><Icon d={ICONS.close.d} size={14} /><span>Fermer</span></Button>
    </div>
  );
}

function AddressBar({ picker = false, path = PAGE, meta = 'modifiée à 14:32 par Otto · 412 Ko', live = true }: { picker?: boolean; path?: string; meta?: string; live?: boolean }): JSX.Element {
  return (
    <div className="mk-addr-wrap">
      <div className="mk-addr">
        <button type="button" className="mk-pick" aria-haspopup="listbox" aria-expanded={picker} title="Choisir la page">
          <Icon d={SHELL_ICONS.file} size={13} /><code>{path}</code><Icon d={SHELL_ICONS.chevronDown} size={12} />
        </button>
        <span className="mk-actions">
          <Button variant="ghost" size="sm" disabled={!live}><Icon d={ICONS.refresh.d} size={13} />Recharger</Button>
          <Button variant="ghost" size="sm"><Icon d={SHELL_ICONS.thread} size={13} />dans le fil</Button>
        </span>
      </div>
      <div className="mk-addr-meta">
        <span>{meta}</span>
        {live && <span className="mk-iso" title="La page tourne à part : elle n'atteint ni Ledge, ni vos sessions, ni Internet (sauf ses polices).">Isolée</span>}
      </div>
      {picker && <Picker />}
    </div>
  );
}

function Picker(): JSX.Element {
  const row = (path: string, sub: string, current = false) => (
    <div className={`mk-opt${current ? ' current' : ''}`} role="option" aria-selected={current}>
      <span className="mk-check">{current && <Icon d={ICONS.check.d} size={12} />}</span>
      <span className="mk-opt-main"><code>{path.split('/').pop()}</code><small className="mono">{path.split('/').slice(0, -1).join('/')}/</small></span>
      <small className="mk-opt-sub">{sub}</small>
    </div>
  );
  return (
    <div className="mk-pop" role="listbox" aria-label="Pages de la session">
      <div className="mk-pop-group">Écrites dans la session</div>
      {row(PAGE, 'Otto · 14:32', true)}
      {row('docs/mockups/ledge-projects-eye.html', 'Otto · 11:02')}
      <div className="mk-pop-group">Citées dans le fil</div>
      {row('docs/mockups/ledge-session-fil-terminal.html', 'Vous · 10:40')}
      <div className="mk-pop-foot">Les fichiers .html que la session a écrits ou cités. ↑↓ puis ↵</div>
    </div>
  );
}

function PageFrame({ reloaded = false }: { reloaded?: boolean }): JSX.Element {
  return (
    <div className="mk-frame">
      <iframe title="Page de la session" srcDoc={FAKE} sandbox="" />
      {reloaded && <div className="mk-toast" role="status"><Icon d={ICONS.refresh.d} size={12} />Rechargée : Otto l'a modifiée à 14:35</div>}
    </div>
  );
}

/** The thread, drawn: the turn where the page was written, its rows, the reply that cites it. */
function ThreadSketch({ withButtons = true }: { withButtons?: boolean }): JSX.Element {
  const see = withButtons && <button type="button" className="mk-see"><Icon d={SHELL_ICONS.browser} size={12} />Voir la page</button>;
  return (
    <div className="messages mk-thread">
      <div className="mk-ex"><span className="mk-chev">›</span><b>Échange de 14:28</b><span className="muted"> · Maquette OMP · 4 actions · 3 fichiers modifiés</span><span className="mk-fill" /><span className="mono muted">14:28</span></div>
      <div className="mk-you"><small className="muted">Vous</small><div>Fais la maquette des sièges OMP, avec les captures.</div></div>
      <div className="mk-act"><span className="mk-pip" /><span className="mk-verb">Écrit</span><code>docs/mockups/omp-seat/desktop.tsx</code></div>
      <div className="mk-act"><span className="mk-pip" /><span className="mk-verb">Commande</span><code>node docs/mockups/omp-seat/build.mjs</code></div>
      <div className="mk-act mk-hit"><span className="mk-pip" /><span className="mk-verb">Écrit</span><code>{PAGE}</code>{see}</div>
      <div className="mk-act"><span className="mk-pip" /><span className="mk-verb">Navigateur</span><code>localhost:8731/ledge-openrig-omp.html</code><span className="muted"> · 3 captures</span></div>
      <div className="mk-say">
        <div className="mk-say-who"><span className="mk-bot" />Otto</div>
        <p>La maquette est prête : <span className="mk-doclink">{PAGE}</span>{withButtons && <> <button type="button" className="mk-see small"><Icon d={SHELL_ICONS.browser} size={11} />Voir</button></>}. Elle a quatre vues ; la vue 1 couvre la sidebar et le clic sur un siège.</p>
        <p className="muted">Captures dans <code>docs/mockups/</code>.</p>
      </div>
    </div>
  );
}

/* ───────────── 2 · États ───────────── */

function Mini({ title, note, children, pages = 2, captures = 3 }: { title: string; note: ReactNode; children: ReactNode; pages?: number; captures?: number }): JSX.Element {
  return (
    <figure className="mk-mini">
      <figcaption><strong>{title}</strong></figcaption>
      <aside className="side-pane mk-mini-pane">
        <SideHead pages={pages} captures={captures} />
        <div className="side-body mk-page">{children}</div>
      </aside>
      <p className="mk-mini-note">{note}</p>
    </figure>
  );
}

function Problem({ icon, title, body, action }: { icon: string | readonly string[]; title: string; body: ReactNode; action?: string }): JSX.Element {
  return (
    <div className="changes-empty mk-problem">
      <Icon d={icon} size={22} />
      <strong>{title}</strong>
      <p>{body}</p>
      {action && <Button variant="outline" size="sm">{action}</Button>}
    </div>
  );
}

function StatesView(): JSX.Element {
  return (
    <>
      <p className="mk-intro">Les états du volet sur <b>Pages</b>. Un problème garde la barre d'adresse (on voit quel fichier) et remplace la page par une boîte, comme les autres onglets du volet.</p>
      <div className="mk-grid">
        <Mini title="Aucune page dans la session" pages={0} note={<>Le volet s'ouvre sur <b>Pages</b> seulement s'il y a une page ; sinon sur Captures. Ici, ouvert à la main sur Pages. La pastille de l'en-tête n'apparaît qu'avec au moins une page ou une capture.</>}>
          <Problem icon={SHELL_ICONS.browser} title="Aucune page HTML dans cette session." body="Quand Otto écrit ou cite un fichier .html, il apparaît ici." action="Voir les captures" />
        </Mini>
        <Mini title="Page introuvable" note={<>Le fichier a été déplacé ou supprimé depuis. Le sélecteur le garde (grisé) tant qu'il est dans le fil.</>}>
          <AddressBar path="docs/mockups/ledge-old-draft.html" meta="écrite à 09:12 par Otto" live={false} />
          <Problem icon={ICONS.warning.d} title="Page introuvable" body="Elle n'est plus à cet endroit : déplacée ou supprimée." action="Choisir une autre page" />
        </Mini>
        <Mini title="Page trop volumineuse" note={<>Plafonds (dev-back) : 5 Mo pour la page (la plus grosse maquette fait 988 Ko), 20 Mo par fichier à côté, 50 Mo en tout. Au-delà, cette boîte avec la taille, jamais un rendu partiel.</>}>
          <AddressBar path="docs/report/bundle.html" meta="écrite à 13:50 par Otto · 7,4 Mo" live={false} />
          <Problem icon={ICONS.warning.d} title="Page trop volumineuse" body="7,4 Mo : le lecteur s'arrête à 5 Mo." />
        </Mini>
        <Mini title="Pas une page HTML" note={<>Seuls .html et .htm s'ouvrent ici. Un fichier dont le nom finit en .html mais qui n'est pas du texte (binaire, encodage illisible) tombe aussi là.</>}>
          <AddressBar path="docs/assets/logo.html" meta="citée par Otto à 12:05" live={false} />
          <Problem icon={SHELL_ICONS.file} title="Ce fichier n'est pas une page HTML." body="Le lecteur n'ouvre que des pages .html ou .htm en texte." action="Choisir une autre page" />
        </Mini>
        <Mini title="Session d'une autre machine (lot 1)" note={<>Recommandé : les sessions distantes au lot suivant (il faut relayer la lecture par <code>ledge bridge</code>). Pas de repli local : la page n'est pas sur cette machine.</>}>
          <AddressBar path={PAGE} meta="sur desktop-02 · écrite à 14:32 par Otto" live={false} />
          <Problem icon={SHELL_ICONS.machine} title="Pas encore disponible pour une machine distante." body="Ce lecteur n'ouvre pour l'instant que les pages des sessions de cette machine." />
        </Mini>
        <Mini title="Pas arrivée à temps" note={<>Le daemon ne répond pas en 10 s (même délai que les documents), ou il n'est pas connecté.</>}>
          <AddressBar path={PAGE} meta="modifiée à 14:32 par Otto" live={false} />
          <Problem icon={ICONS.warning.d} title="La page n'est pas arrivée à temps." body="Le daemon n'a pas répondu." action="Réessayer" />
        </Mini>
        <Mini title="Si choix 1 = scripts coupés" note={<>Variante, seulement si Guillaume refuse les scripts : la page s'affiche sans eux. 41 maquettes sur 44 du dépôt sont alors vides.</>}>
          <AddressBar path={PAGE} />
          <div className="mk-band"><Icon d={ICONS.warning.d} size={13} />Scripts coupés : cette page en a besoin et peut paraître vide.</div>
          <div className="mk-frame mk-blank"><span className="muted">(page vide : son contenu est construit par un script)</span></div>
        </Mini>
      </div>
    </>
  );
}

/* ───────────── 3 · Entrées ───────────── */

function EntriesView(): JSX.Element {
  return (
    <>
      <p className="mk-intro">Trois façons d'ouvrir une page, toutes vers le même onglet. Pas de nouvel onglet par page : <b>Navigateur</b> reste unique et son sélecteur change de page.</p>
      <div className="mk-entries">
        <figure className="mk-entry">
          <figcaption><strong>A · Depuis le fil</strong><span>Sur une ligne <b>Écrit / Modifie</b> d'un .html, et sur un chemin .html cité dans une réponse (comme les liens .md d'aujourd'hui). Le bouton n'apparaît qu'au survol ou au focus de la ligne, sauf sur la dernière écriture.</span></figcaption>
          <div className="mk-entry-box mk-entry-thread"><ThreadSketch /></div>
        </figure>
        <figure className="mk-entry">
          <figcaption><strong>B · Depuis « Modifications »</strong><span>Le fichier .html sélectionné gagne <b>« Voir la page »</b> à côté de « Copier le chemin ».</span></figcaption>
          <div className="mk-entry-box right-panel">
            <div className="file-head">
              <div className="file-title"><span className="change-badge change-add">Ajouté</span><code>{PAGE}</code><span className="mono mk-plus">+412</span></div>
              <div className="file-actions">
                <Button variant="ghost" size="sm"><Icon d={SHELL_ICONS.copy} size={13} />Copier le chemin</Button>
                <Button variant="ghost" size="sm" className="mk-on-btn"><Icon d={SHELL_ICONS.browser} size={13} />Voir la page</Button>
                <span className="spacer" /><span className="file-pos mono">3 / 3</span>
              </div>
            </div>
          </div>
        </figure>
        <figure className="mk-entry">
          <figcaption><strong>C · Depuis l'en-tête de la session</strong><span>La pastille <b>Navigateur</b> compte pages et captures (« Navigateur, 2 pages, 3 captures »). Elle ouvre la dernière page écrite, sinon la dernière capture.</span></figcaption>
          <div className="mk-entry-box conversation session-page"><Heading /></div>
        </figure>
      </div>
    </>
  );
}

/* ───────────── 4 · Rendu isolé ───────────── */

function IsolationView(): JSX.Element {
  return (
    <>
      <p className="mk-intro">Le HTML est écrit par un agent : on le traite comme une page web inconnue. Il s'affiche dans un cadre <b>à part</b>, qui ne peut rien demander à Ledge.</p>
      <div className="mk-iso-grid">
        <div className="mk-card">
          <p className="mk-kicker">Comment la page arrive</p>
          <ol className="mk-steps">
            <li>Le volet demande au daemon, par sa liaison authentifiée, d'<b>ouvrir une vue</b> sur le fichier (.html ou .htm, chemin résolu comme pour les documents .md).</li>
            <li>Le daemon répond une adresse à usage unique : <code>127.0.0.1:47831/view/&lt;jeton&gt;/page.html</code>. Elle ne sert que le <b>dossier de la page et ses sous-dossiers</b>, en lecture seule, et meurt à la fermeture de la vue.</li>
            <li>Le cadre est une <code>iframe sandbox="allow-scripts"</code> sans <code>allow-same-origin</code> : origine opaque, ni cookies, ni stockage, ni accès à la fenêtre de Ledge.</li>
            <li>La réponse du daemon porte ses propres règles (CSP) : <code>connect-src 'none'</code>, scripts et styles du seul dossier de la vue, formulaires coupés.</li>
            <li>Le daemon surveille le fichier pendant que la vue est ouverte et prévient le volet, qui recharge.</li>
          </ol>
          <p className="mk-small muted">Voie de dev-back (qitem-20261103143129). Écartés : srcdoc et blob (ils héritent de la CSP de l'app, scripts coupés), schéma Tauri (Desktop sous Windows ne voit pas WSL). Seul ajout côté app : <code>frame-src http://127.0.0.1:47831</code>. Le refus de l'IPC Tauri est attendu ; un test du lot le prouve (une page qui tente <code>invoke</code>, <code>fetch</code> vers le daemon et <code>localStorage</code> doit échouer trois fois).</p>
        </div>
        <div className="mk-card">
          <p className="mk-kicker">Ce que la page peut et ne peut pas</p>
          <table className="mk-can">
            <tbody>
              <tr><td>Afficher son HTML, son CSS, ses images (dossier de la page et sous-dossiers)</td><td className="ok">oui</td></tr>
              <tr><td>Exécuter ses scripts</td><td className="ask">choix 1</td></tr>
              <tr><td>Charger les polices Google (fonts.googleapis.com, fonts.gstatic.com)</td><td className="ask">choix 2</td></tr>
              <tr><td>Ouvrir un lien vers un .md de docs/</td><td className="ask">choix 6</td></tr>
              <tr><td>Appeler Internet (fetch, XHR, WebSocket, formulaires)</td><td className="no">non</td></tr>
              <tr><td>Parler au daemon Ledge (il exige son jeton, que la page n'a pas)</td><td className="no">non</td></tr>
              <tr><td>Appeler l'API Tauri (fenêtres, fichiers, commandes)</td><td className="no">non · testé au lot</td></tr>
              <tr><td>Lire le stockage ou les cookies de Ledge</td><td className="no">non</td></tr>
              <tr><td>Ouvrir des fenêtres, faire naviguer Ledge</td><td className="no">non</td></tr>
              <tr><td>Lire un fichier en <code>../</code>, hors du dossier de la page</td><td className="no">non</td></tr>
            </tbody>
          </table>
        </div>
        <div className="mk-card">
          <p className="mk-kicker">Ce que l'utilisateur voit</p>
          <ul>
            <li>La pastille <b>« Isolée »</b> sous l'adresse ; son infobulle dit : « La page tourne à part : elle n'atteint ni Ledge, ni vos sessions, ni Internet (sauf ses polices). » Sans polices (choix 2), la parenthèse tombe.</li>
            <li>Un lien vers une autre page du même dossier s'ouvre dans le cadre. Un lien externe, ou en <code>../</code>, ne fait rien ; un lien .md suit le choix 6.</li>
            <li>Les vues interactives des maquettes (onglets, bascules Sombre/Clair) marchent comme dans un navigateur.</li>
            <li>Pas de plateforme de publication : l'adresse ne sert que sur cette machine, le temps de la vue.</li>
          </ul>
        </div>
      </div>
    </>
  );
}

/* ───────────── 5 · Choix et textes ───────────── */

const CHOICES: [string, string, string][] = [
  ['1. Les scripts de la page s\'exécutent-ils ?', 'Oui, dans le cadre isolé.', 'Sans scripts, 41 maquettes sur 44 de docs/mockups/ sont vides (React inline). Le cadre isolé les empêche d\'atteindre Ledge, le daemon et Internet.'],
  ['2. La page peut-elle charger les polices Google ?', 'Oui, les polices seulement.', 'Les maquettes sont dessinées en Geist, chargée depuis Google Fonts : sans elle, la police de repli change le rendu qu\'on valide. Le prix : Google voit qu\'une page est ouverte. Rien d\'autre ne sort.'],
  ['3. Les sessions d\'une autre machine dès ce lot ?', 'Non, au lot suivant.', 'Le daemon distant n\'ouvre aucun port : il faut relayer la lecture des fichiers par ledge bridge, un second lot (dev-back). Lot 1 : l\'état « Pas encore disponible pour une machine distante » (vue 2).'],
  ['4. Quel parcours pour choisir la page ?', 'Fil + Modifications + sélecteur des pages de la session.', 'Couvre le cas réel (l\'agent vient d\'écrire la page). Pas d\'explorateur de dossiers : à ajouter plus tard si une page non écrite ni citée doit s\'ouvrir.'],
  ['5. Où vit le lecteur ?', 'Dans l\'onglet Navigateur, à côté des captures (Pages | Captures).', 'Un seul onglet pour « ce que l\'agent montre dans un navigateur ». Variante : un onglet par page dans le volet, comme les documents .md.'],
  ['6. Un lien vers un .md dans la page (souvent une spec de docs/) ?', 'Inactif au lot 1.', 'L\'ouvrir dans le lecteur Markdown du volet demande que Ledge écoute la page (postMessage) et la croie sur le chemin : petit, mais c\'est une porte de plus. À ajouter si le besoin se montre.']
];

const TEXTS: [string, string, string][] = [
  ['session.browser.pages / captures', 'Pages · Captures', 'Pages · Captures'],
  ['session.browser.pill(p, c)', 'Navigateur, 2 pages, 3 captures', 'Browser, 2 pages, 3 captures'],
  ['session.page.see', 'Voir la page', 'View page'],
  ['session.page.pick', 'Choisir la page', 'Choose the page'],
  ['session.page.reload', 'Recharger', 'Reload'],
  ['session.page.meta(t, n, size)', 'modifiée à 14:32 par Otto · 412 Ko', 'changed at 14:32 by Otto · 412 KB'],
  ['session.page.isolated / Title', 'Isolée / La page tourne à part : elle n\'atteint ni Ledge, ni vos sessions, ni Internet (sauf ses polices).', 'Isolated / The page runs apart: it cannot reach Ledge, your sessions or the Internet (except its fonts).'],
  ['session.page.reloaded(n, t)', 'Rechargée : Otto l\'a modifiée à 14:35', 'Reloaded: Otto changed it at 14:35'],
  ['session.page.written / cited', 'Écrites dans la session / Citées dans le fil', 'Written in this session / Cited in the thread'],
  ['session.page.pickHint', 'Les fichiers .html que la session a écrits ou cités.', 'The .html files this session wrote or cited.'],
  ['session.page.none / noneBody(n)', 'Aucune page HTML dans cette session. / Quand Otto écrit ou cite un fichier .html, il apparaît ici.', 'No HTML page in this session. / When Otto writes or cites an .html file, it shows here.'],
  ['session.page.seeCaptures', 'Voir les captures', 'See the captures'],
  ['session.page.errors.not_found', 'Page introuvable / Elle n\'est plus à cet endroit : déplacée ou supprimée.', 'Page not found / It is no longer there: moved or deleted.'],
  ['session.page.errors.too_large(size)', 'Page trop volumineuse / 7,4 Mo : le lecteur s\'arrête à 5 Mo.', 'Page too large / 7.4 MB: the viewer stops at 5 MB.'],
  ['session.page.errors.unsupported_type', 'Ce fichier n\'est pas une page HTML. / Le lecteur n\'ouvre que des pages .html ou .htm en texte.', 'This file is not an HTML page. / The viewer only opens text .html or .htm pages.'],
  ['session.page.errors.remote', 'Pas encore disponible pour une machine distante. / Ce lecteur n\'ouvre pour l\'instant que les pages des sessions de cette machine.', 'Not available for a remote machine yet. / For now this viewer only opens pages of this machine\'s sessions.'],
  ['session.page.errors.timeout', 'La page n\'est pas arrivée à temps. / Le daemon n\'a pas répondu.', 'The page did not arrive in time. / The daemon did not answer.'],
  ['session.page.pickOther / retry', 'Choisir une autre page / Réessayer', 'Choose another page / Try again'],
  ['(si choix 1 = non) session.page.noScripts', 'Scripts coupés : cette page en a besoin et peut paraître vide.', 'Scripts off: this page needs them and may look empty.']
];

function ChoicesView(): JSX.Element {
  return (
    <div className="mk-cards">
      <div className="mk-card">
        <p className="mk-kicker">À trancher par Guillaume</p>
        <table className="mk-choices"><thead><tr><th>Question</th><th>Recommandation</th><th>Pourquoi</th></tr></thead>
          <tbody>{CHOICES.map(([q, r, w]) => <tr key={q}><td><b>{q}</b></td><td>{r}</td><td className="muted">{w}</td></tr>)}</tbody></table>
      </div>
      <div className="mk-card mk-texts">
        <p className="mk-kicker">Textes FR / EN</p>
        <table><tbody>{TEXTS.map(([k, fr, en]) => <tr key={k}><td><code>{k}</code></td><td>{fr}</td><td className="muted">{en}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
