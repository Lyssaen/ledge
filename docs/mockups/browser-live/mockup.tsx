// Mockup: following, from a session, the real Playwright browser the agent drives (Desktop). Real Button and Icon, real
// session.css classes for the page, its heading and the side pane; the thread is drawn schematically. The "frames" of
// the live view are drawn with an inert iframe: in the app they are JPEG images filmed from the agent's own Chrome.
import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../../packages/ui/src/ui/Button';
import { Icon, ICONS } from '../../../packages/ui/src/ui/icons';
import { SHELL_ICONS } from '../../../apps/desktop/src/shell/icons';

type Theme = 'dark' | 'light';
type Width = 'wide' | 'narrow';
type Step = 'none' | 'appears' | 'live' | 'closed' | 'back';
type View = 'flow' | 'three' | 'states' | 'choices';

const URL_ = 'localhost:8733/ledge-openrig-omp.html';

/** The agent's page, as its browser shows it: `tab` is the view the agent has clicked. */
const fake = (tab: number) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{height:100%}body{margin:0;font:13px/1.45 system-ui,sans-serif;background:#f6f5f2;color:#1d1b16;pointer-events:none}
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
.tui{background:#0d1117;color:#c9d1d9;font:11px/1.6 ui-monospace,monospace;border-radius:8px;padding:12px 14px;white-space:pre}
.tui b{color:#7ee787;font-weight:400}.tui i{color:#8b949e;font-style:normal}
</style></head><body>
<header><b>Sièges OMP dans Ledge</b><div class="seg"><span class="${tab === 1 ? 'on' : ''}">1 · Desktop</span><span class="${tab === 2 ? 'on' : ''}">2 · ledge tui</span><span>3 · ledge who</span><span>4 · Textes</span></div></header>
${tab === 1 ? `<main><div class="side"><h4>Rigs</h4><div class="row"><i class="dot b"></i>dev-omp<small>2</small></div><div class="row sel"><i class="dot"></i>Ivo<small>au travail</small></div><div class="row"><i class="dot"></i>Pia<small>inactif</small></div><div class="row"><i class="dot b"></i>split-omp<small>3</small></div><div class="row"><i class="dot"></i>Ana<small>inactif</small></div><div class="row off"><i class="dot g"></i>Tom<small>arrêté</small></div></div>
<div><div class="card"><h3>Ivo [dev-omp] · dev.agent · OMP · au travail</h3><p>Pas de fil pour ce siège. Sa vue Terminal montre son écran : ce que tu y tapes lui est envoyé.</p>
<div class="term">● ST7-412 · lecture de packages/ledge/src/daemon/omp/catalog.ts<br>● 3 tests verts · 1 en cours…<br>&gt; _</div></div></div></main>`
    : `<main style="grid-template-columns:1fr"><div class="tui"><i>── RIGS ──────────────────────────────────────────</i>
<b>●</b> dev-omp        2 sessions
  <b>●</b> Ivo   dev.agent · omp      Au travail
  ○ Pia   design.ux · omp      Inactif
<b>●</b> split-omp      2 sessions sur 3
  ○ Ana   dev.agent · omp      Inactif
  <i>· Tom   review.qa · omp      Arrêté</i>

<i>↵ attacher son terminal · 6 OpenRig · ? aide</i></div></main>`}
</body></html>`;

/** A filmed frame: the agent's 1280×800 viewport, scaled to fit like an image. */
function Frame({ html, title }: { html: string; title: string }): JSX.Element {
  const box = useRef<HTMLSpanElement>(null);
  const [k, setK] = useState(0.4);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const fit = () => setK(Math.min(el.clientWidth / 1280, el.clientHeight / 800));
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, []);
  return <span ref={box} className="mk-fit"><iframe key={html} title={title} srcDoc={html} sandbox="" tabIndex={-1} scrolling="no" style={{ transform: `translate(-50%, -50%) scale(${k})` }} /></span>;
}

function App(): JSX.Element {
  // Captures drive the mockup from the URL: ?view=flow&step=closed&theme=light&width=narrow
  const q = new URLSearchParams(location.search);
  const [theme, setTheme] = useState<Theme>((q.get('theme') as Theme) ?? 'dark');
  const [width, setWidth] = useState<Width>((q.get('width') as Width) ?? 'wide');
  const [view, setView] = useState<View>((q.get('view') as View) ?? 'flow');
  const [step, setStep] = useState<Step>((q.get('step') as Step) ?? 'live');
  document.documentElement.dataset.theme = theme;
  const VIEWS: [View, string][] = [['flow', '1 · Parcours'], ['three', '2 · Direct, captures, dernière image'], ['states', '3 · Cas limites'], ['choices', '4 · Limites, choix, textes']];
  const STEPS: [Step, string][] = [['none', 'a · Pas de navigateur'], ['appears', 'b · Le bouton apparaît'], ['live', 'c · Direct'], ['closed', 'd · Navigateur fermé'], ['back', 'e · Reprise']];
  return (
    <>
      <div className="mk-bar">
        <strong>Maquette · Suivre le navigateur de l'agent</strong>
        <div className="mk-seg" role="radiogroup">{VIEWS.map(([v, l]) => <button key={v} role="radio" aria-checked={view === v} onClick={() => setView(v)}>{l}</button>)}</div>
        <span className="mk-fill" />
        <div className="mk-seg">{(['dark', 'light'] as Theme[]).map(x => <button key={x} aria-checked={theme === x} onClick={() => setTheme(x)}>{x === 'dark' ? 'Sombre' : 'Clair'}</button>)}</div>
      </div>
      {view === 'flow' && (
        <div className="mk-bar mk-bar2">
          <div className="mk-seg">{STEPS.map(([s, l]) => <button key={s} aria-checked={step === s} onClick={() => setStep(s)}>{l}</button>)}</div>
          <span className="mk-fill" />
          <div className="mk-seg">{(['wide', 'narrow'] as Width[]).map(w => <button key={w} aria-checked={width === w} onClick={() => setWidth(w)}>{w === 'wide' ? 'Large' : 'Étroit'}</button>)}</div>
        </div>
      )}
      <main className="mk-main">
        {view === 'flow' && <FlowView step={step} width={width} />}
        {view === 'three' && <ThreeView />}
        {view === 'states' && <StatesView />}
        {view === 'choices' && <ChoicesView />}
      </main>
    </>
  );
}

/* ───────────── 1 · Parcours ───────────── */

const INTRO: Record<Step, ReactNode> = {
  none: <>Otto n'a pas ouvert de navigateur : <b>pas de bouton Navigateur</b> dans l'en-tête (ni capture, ni navigateur).</>,
  appears: <>Otto appelle Playwright : son Chrome démarre sous le terminal de la session. Ledge le voit (le processus, puis son port qui répond) et le bouton <b>Navigateur · direct</b> <b>apparaît</b>, avec un point rouge. Rien ne s'ouvre seul.</>,
  live: <>Un clic ouvre l'onglet <b>Navigateur</b> du volet, sur <b>Direct</b> : l'onglet du <b>vrai Chrome d'Otto</b>, filmé (≈ 11 images/s quand la page bouge). Lecture seule : un clic ne fait rien, c'est Otto qui conduit. Sous l'image, sa dernière action, lue dans le fil.</>,
  closed: <>Otto a fermé son navigateur (ou sa session s'est arrêtée). Le direct s'arrête : l'onglet garde la <b>dernière image</b>, grisée et datée, avec l'adresse et <b>« Ouvrir dans mon navigateur »</b>. Le bouton de l'en-tête reste, en gris : <b>Navigateur · fermé</b>.</>,
  back: <>Otto revient sur la maquette et rouvre son navigateur : le bouton redevient <b>direct</b>, et l'onglet, s'il est ouvert, repasse seul sur <b>Direct</b> avec un avis. Les captures prises entre-temps s'ajoutent à <b>Captures</b>.</>
};

function FlowView({ step, width }: { step: Step; width: Width }): JSX.Element {
  const pane = step === 'live' || step === 'closed' || step === 'back';
  return (
    <>
      <p className="mk-intro">{INTRO[step]}</p>
      <div className={`mk-app ${width}`}>
        <section className="conversation session-page">
          <Heading pill={step === 'none' ? null : step === 'closed' ? 'closed' : 'live'} hot={step === 'appears'} count={step === 'back' ? 4 : 3} />
          <div className={`session-split${pane ? ' has-pane' : ''}`} style={{ '--split': '56%' } as React.CSSProperties}>
            <div className="session-main"><ThreadSketch step={step} /></div>
            {pane && <>
              <div className="split-handle" role="separator" />
              <aside className="side-pane">
                <SideHead on={step === 'closed' ? 'closed' : 'live'} captures={step === 'back' ? 4 : 3} />
                <div className="side-body mk-page">
                  {step === 'closed' ? <ClosedView /> : <LiveView tab={step === 'back' ? 2 : 1} back={step === 'back'} />}
                </div>
              </aside>
            </>}
          </div>
        </section>
      </div>
      {width === 'narrow' && <p className="mk-note">En disposition étroite (page ≤ 860 px), le volet se pose sur le fil comme aujourd'hui ; Échap le retire.</p>}
    </>
  );
}

/** The session heading: the view switch, then the Navigateur pill, live (red dot), closed (grey), or absent. */
function Heading({ pill, hot = false, remote = false, count = 3 }: { pill: 'live' | 'closed' | 'captures' | null; hot?: boolean; remote?: boolean; count?: number }): JSX.Element {
  return (
    <div className="pane-heading">
      <div className="view-switch" role="tablist">
        <button type="button" role="tab" aria-selected="true"><Icon d={SHELL_ICONS.thread} size={13} />Fil</button>
        <button type="button" role="tab" aria-selected="false"><Icon d={SHELL_ICONS.terminal} size={13} />Terminal<span className="view-dot" /></button>
      </div>
      <span className="pane-meta mono">{remote ? 'desktop-02 · ledge' : 'Local · ledge'}</span>
      <span className="spacer" />
      {pill && (
        <button type="button" className={`kids-pill browser-pill mk-pill-${pill}${hot ? ' mk-hot' : ''}`}
          title={pill === 'live' ? `Navigateur d’Otto, en direct · ${count} captures` : pill === 'closed' ? `Navigateur d’Otto, fermé · ${count} captures` : `Navigateur, ${count} captures`}>
          {pill === 'live' ? <i className="mk-live-dot" aria-hidden="true" /> : <Icon d={SHELL_ICONS.browser} size={13} />}
          Navigateur{pill !== 'captures' && <span className="mk-pill-state">· {pill === 'live' ? 'direct' : 'fermé'}</span>}
          <span className="tab-count mono">{count}</span>
        </button>
      )}
    </div>
  );
}

/** The pane's head: « Navigateur », its Direct | Captures switch, « Agrandir », « Fermer ». */
function SideHead({ on, captures = 3, live = true }: { on: 'live' | 'closed' | 'captures'; captures?: number; live?: boolean }): JSX.Element {
  return (
    <div className="side-head">
      <span className="side-title"><strong>Navigateur</strong></span>
      <div className="mk-switch" role="tablist" aria-label="Contenu du navigateur">
        <button role="tab" aria-selected={on !== 'captures'}>
          {on === 'closed' || !live ? <span className="mk-off-dot" aria-hidden="true" /> : <i className="mk-live-dot" aria-hidden="true" />}
          {on === 'closed' ? 'Fermé' : 'Direct'}
        </button>
        <button role="tab" aria-selected={on === 'captures'}>Captures<span className="tab-count mono">{captures}</span></button>
      </div>
      <Button variant="ghost" size="sm" className="side-grow"><Icon d={SHELL_ICONS.split} size={13} />Agrandir</Button>
      <Button variant="ghost" size="sm" className="side-close" aria-label="Fermer le volet (Échap)"><Icon d={ICONS.close.d} size={14} /><span>Fermer</span></Button>
    </div>
  );
}

/** The live view: who drives, where, the filmed tab, the last action read in the thread. */
function LiveView({ tab = 1, back = false }: { tab?: number; back?: boolean }): JSX.Element {
  return (
    <>
      <div className="mk-live-head">
        <span className="mk-live-badge"><i className="mk-live-dot" aria-hidden="true" />Direct</span>
        <span className="mk-driver"><span className="mk-bot" />Otto conduit · lecture seule</span>
        <span className="mk-fill" />
        <span className="mk-fps mono">11 im/s</span>
      </div>
      <div className="mk-url" title={`http://${URL_}`}><Icon d={SHELL_ICONS.browser} size={12} /><code>{URL_}</code><span className="muted">· Sièges OMP dans Ledge</span></div>
      <div className="mk-screen live" title="Lecture seule : c'est Otto qui conduit.">
        <Frame title="Onglet du navigateur d'Otto" html={fake(tab)} />
        {back && <div className="mk-toast" role="status"><i className="mk-live-dot" aria-hidden="true" />Otto a rouvert son navigateur</div>}
        {!back && <span className="mk-click" style={{ left: '50%', top: '9%' }} aria-hidden="true" />}
      </div>
      <div className="mk-last">
        <span className="mk-verb">{back ? 'Clique' : 'Clique'}</span>
        <code>{back ? '« 2 · ledge tui »' : '« 1 · Desktop »'}</code>
        <span className="muted">· il y a 2 s</span>
        <span className="mk-fill" />
        <Button variant="ghost" size="sm"><Icon d={SHELL_ICONS.thread} size={13} />dans le fil</Button>
      </div>
    </>
  );
}

/** The browser closed: the last image, grey and dated; the address; « Ouvrir dans mon navigateur ». */
function ClosedView({ remoteUrl = false }: { remoteUrl?: boolean }): JSX.Element {
  return (
    <>
      <div className="mk-live-head">
        <span className="mk-closed-badge"><span className="mk-off-dot" aria-hidden="true" />Navigateur fermé à 14:58</span>
        <span className="mk-fill" />
        <Button variant="outline" size="sm"><Icon d={ICONS.external.d} size={13} />Ouvrir dans mon navigateur</Button>
      </div>
      <div className="mk-url" title={`http://${URL_}`}><Icon d={SHELL_ICONS.browser} size={12} /><code>{remoteUrl ? 'file:///home/gch/…/ledge-openrig-omp.html' : URL_}</code><span className="muted">· dernière adresse</span></div>
      <div className="mk-screen closed">
        <Frame title="Dernière image du navigateur d'Otto" html={fake(2)} />
        <span className="mk-stamp">Dernière image · 14:58</span>
      </div>
      <p className="mk-hint">Le bouton ouvre l'adresse dans votre navigateur ; il faut que le serveur de la maquette tourne encore. Si Otto rouvre son navigateur, le direct revient ici.</p>
    </>
  );
}

/** The thread, drawn: the turn where Otto drives the browser. */
function ThreadSketch({ step }: { step: Step }): JSX.Element {
  const browsing = step !== 'none';
  return (
    <div className="messages mk-thread">
      <div className="mk-ex"><span className="mk-chev">›</span><b>Échange de 14:48</b><span className="muted"> · Maquette OMP · {browsing ? '6 actions' : '2 actions'}</span><span className="mk-fill" /><span className="mono muted">14:48</span></div>
      <div className="mk-you"><small className="muted">Vous</small><div>Vérifie la vue TUI de la maquette, puis capture-la.</div></div>
      <div className="mk-act"><span className="mk-pip" /><span className="mk-verb">Écrit</span><code>docs/mockups/omp-seat/tui.tsx</code></div>
      <div className="mk-act"><span className="mk-pip" /><span className="mk-verb">Commande</span><code>python3 -m http.server 8733</code></div>
      {browsing && <>
        <div className="mk-act"><span className="mk-pip" /><span className="mk-verb">Navigateur</span><code>ouvre {URL_}</code></div>
        <div className={`mk-act${step === 'live' ? ' mk-hit' : ''}`}><span className={`mk-pip${step === 'live' || step === 'appears' ? ' run' : ''}`} /><span className="mk-verb">Navigateur</span><code>clique « 1 · Desktop »</code></div>
        {(step === 'closed' || step === 'back') && <>
          <div className="mk-act"><span className="mk-pip" /><span className="mk-verb">Navigateur</span><code>clique « 2 · ledge tui »</code></div>
          <div className="mk-act"><span className="mk-pip" /><span className="mk-verb">Navigateur</span><code>capture</code><span className="mk-thumb" /></div>
          <div className="mk-act"><span className="mk-pip" /><span className="mk-verb">Navigateur</span><code>ferme le navigateur</code></div>
          <div className="mk-say"><div className="mk-say-who"><span className="mk-bot" />Otto</div><p>La vue TUI est bonne ; capture dans <code>docs/mockups/</code>.</p></div>
        </>}
        {step === 'back' && <>
          <div className="mk-you"><small className="muted">Vous</small><div>Mets « Arrêté » en gris aussi dans la vue TUI.</div></div>
          <div className="mk-act"><span className="mk-pip" /><span className="mk-verb">Modifie</span><code>docs/mockups/omp-seat/tui.tsx</code></div>
          <div className="mk-act mk-hit"><span className="mk-pip run" /><span className="mk-verb">Navigateur</span><code>clique « 2 · ledge tui »</code></div>
        </>}
      </>}
    </div>
  );
}

/* ───────────── 2 · Les trois choses ───────────── */

function Mini({ title, sub, children }: { title: string; sub: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <figure className="mk-mini">
      <figcaption><strong>{title}</strong><span>{sub}</span></figcaption>
      {children}
    </figure>
  );
}

function ThreeView(): JSX.Element {
  return (
    <>
      <p className="mk-intro">Trois choses, trois apparences, dans le même onglet. <b>Direct</b> : point rouge, cadre vif, « Otto conduit ». <b>Dernière image</b> : gris, datée, jamais présentée comme en cours. <b>Captures</b> : les images que l'agent a prises lui-même (PR #163), en bande, inchangées.</p>
      <div className="mk-three">
        <Mini title="Direct" sub="Le vrai onglet de l'agent, maintenant.">
          <aside className="side-pane mk-mini-pane"><SideHead on="live" /><div className="side-body mk-page"><LiveView /></div></aside>
        </Mini>
        <Mini title="Navigateur fermé · dernière image" sub="Ce que l'onglet montrait quand il s'est fermé.">
          <aside className="side-pane mk-mini-pane"><SideHead on="closed" /><div className="side-body mk-page"><ClosedView /></div></aside>
        </Mini>
        <Mini title="Captures (existant)" sub="Les images prises par l'agent, une par appel de capture.">
          <aside className="side-pane mk-mini-pane"><SideHead on="captures" /><div className="side-body mk-page"><CapturesSketch /></div></aside>
        </Mini>
      </div>
    </>
  );
}

function CapturesSketch(): JSX.Element {
  return (
    <div className="mk-caps">
      <div className="browser-meta"><span className="browser-url mono">{URL_}</span><span className="mono">14:56</span><span className="mono">1280×720</span><span>Otto</span></div>
      <div className="mk-screen"><Frame title="Capture" html={fake(2)} /></div>
      <div className="mk-strip">{[1, 2, 2].map((t, i) => <span key={i} className={`mk-cell${i === 2 ? ' sel' : ''}`}><Frame title="" html={fake(t)} /></span>)}</div>
    </div>
  );
}

/* ───────────── 3 · Cas limites ───────────── */

function StatesView(): JSX.Element {
  const box = (icon: string | readonly string[], title: string, body: ReactNode, action?: string) => (
    <div className="changes-empty mk-problem"><Icon d={icon} size={22} /><strong>{title}</strong><p>{body}</p>{action && <Button variant="outline" size="sm">{action}</Button>}</div>
  );
  return (
    <>
      <p className="mk-intro">Les cas où le direct ne peut pas se montrer. Le bouton de l'en-tête ne promet jamais un direct qu'il n'a pas : sans navigateur filmable, il reste le bouton des captures d'aujourd'hui.</p>
      <div className="mk-grid">
        <Mini title="Direct pas encore activé" sub={<>Otto se sert de Playwright, mais son Chrome n'ouvre pas de port à Ledge (config sans <code>--remote-debugging-port=0</code>). Le bouton reste celui des captures ; le volet le dit une fois.</>}>
          <aside className="side-pane mk-mini-pane"><SideHead on="live" live={false} /><div className="side-body mk-page">
            {box(SHELL_ICONS.browser, 'Le direct n’est pas activé.', <>Le navigateur d'Otto ne laisse pas Ledge le regarder. Ledge peut ajouter une ligne à la config Playwright ; elle vaudra pour les prochains navigateurs.</>, 'Activer le direct…')}
          </div></aside>
        </Mini>
        <Mini title="En attente de la première image" sub="Le navigateur vient de démarrer, ou la page n'a encore rien dessiné.">
          <aside className="side-pane mk-mini-pane"><SideHead on="live" /><div className="side-body mk-page">
            <div className="mk-live-head"><span className="mk-live-badge"><i className="mk-live-dot" aria-hidden="true" />Direct</span><span className="mk-driver"><span className="mk-bot" />Otto conduit · lecture seule</span></div>
            <div className="mk-url"><Icon d={SHELL_ICONS.browser} size={12} /><code>about:blank</code></div>
            <div className="mk-screen live mk-wait"><span className="muted">En attente de la première image…</span></div>
          </div></aside>
        </Mini>
        <Mini title="Session d'une autre machine (lot 2)" sub="Le direct passe par le daemon de la machine et ledge bridge : prévu au lot 2. Les captures marchent déjà.">
          <aside className="side-pane mk-mini-pane"><SideHead on="live" live={false} /><div className="side-body mk-page">
            {box(SHELL_ICONS.machine, 'Direct pas encore disponible pour une machine distante.', 'Otto travaille sur desktop-02. Ses captures restent visibles dans Captures.', 'Voir les captures')}
          </div></aside>
        </Mini>
        <Mini title="Activer le direct (confirmation)" sub="Le seul geste qui modifie la machine : une ligne dans la config Playwright, sur accord explicite.">
          <aside className="side-pane mk-mini-pane"><SideHead on="live" live={false} /><div className="side-body mk-page">
            <div className="mk-confirm">
              <strong>Activer le direct du navigateur des agents ?</strong>
              <p>Ledge ajoute <code>--remote-debugging-port=0</code> à <code>~/.config/playwright-mcp/config.json</code>. Chaque navigateur d'agent ouvrira alors un port local (127.0.0.1) que Ledge regarde, sans jamais cliquer ni taper.</p>
              <p className="muted">Un programme de cette machine qui trouve ce port pourrait aussi piloter ce navigateur, comme pour les sièges OMP aujourd'hui. Vaut pour les prochains navigateurs.</p>
              <div className="mk-confirm-btns"><Button variant="outline" size="sm">Annuler</Button><Button variant="primary" size="sm">Activer</Button></div>
            </div>
          </div></aside>
        </Mini>
      </div>
    </>
  );
}

/* ───────────── 4 · Limites, choix, textes ───────────── */

const LIMITS: [string, string][] = [
  ['Lot 1', 'Sessions Claude dans WSL (sièges OpenRig compris), Desktop sous Windows : le daemon filme dans WSL et relaie les images par sa liaison. Prouvé par dev-back sur le vrai serveur Playwright MCP : un seul Chrome, l\'agent clique et capture sans gêne, ≈ 11 images/s, 7 Ko l\'image, 7 ms de retard en local.'],
  ['Prérequis', 'Une ligne dans la config Playwright de Guillaume (--remote-debugging-port=0). Sans elle, pas de direct : seulement les captures, comme aujourd\'hui.'],
  ['Lecture seule', 'Garantie par Ledge, pas par Chrome : le daemon n\'envoie au navigateur que la liste fermée « lister, s\'attacher, filmer » ; jamais de clic, de frappe ni de script. Un test le vérifie.'],
  ['Coût', 'Ledge ne filme que quand l\'onglet Navigateur est visible ; une page immobile n\'envoie presque rien.'],
  ['Après l\'agent', 'Plus rien à filmer : la dernière image et l\'adresse. « Ouvrir dans mon navigateur » ne marche que si le serveur de la maquette tourne encore.'],
  ['Lot 2', 'Autre machine (relais par ledge bridge) ; sièges OMP (leur navigateur a déjà un port, mais leur périmètre validé est « état seul ») ; voir la maquette à jour sans le navigateur de l\'agent.'],
  ['Hors périmètre', 'Codex (pas de Playwright configuré aujourd\'hui) ; un agent qui tournerait sous Windows.']
];

const TEXTS: [string, string, string][] = [
  ['session.browser.pillLive / pillClosed', 'Navigateur · direct / Navigateur · fermé', 'Browser · live / Browser · closed'],
  ['session.browser.pillTitle(n, state, k)', 'Navigateur d’Otto, en direct · 3 captures', 'Otto’s browser, live · 3 captures'],
  ['session.browser.live / closed / captures', 'Direct / Fermé / Captures', 'Live / Closed / Captures'],
  ['session.browser.driver(n)', 'Otto conduit · lecture seule', 'Otto is driving · read-only'],
  ['session.browser.readOnly(n)', 'Lecture seule : c’est Otto qui conduit.', 'Read-only: Otto is driving.'],
  ['session.browser.fps(k)', '11 im/s', '11 fps'],
  ['session.browser.closedAt(t)', 'Navigateur fermé à 14:58', 'Browser closed at 14:58'],
  ['session.browser.lastImage(t) / lastUrl', 'Dernière image · 14:58 / dernière adresse', 'Last image · 14:58 / last address'],
  ['session.browser.openMine / openHint', 'Ouvrir dans mon navigateur / Le bouton ouvre l’adresse dans votre navigateur ; il faut que le serveur de la maquette tourne encore. Si Otto rouvre son navigateur, le direct revient ici.', 'Open in my browser / Opens the address in your browser; the mockup’s server must still be running. If Otto reopens the browser, the live view comes back here.'],
  ['session.browser.reopened(n)', 'Otto a rouvert son navigateur', 'Otto reopened the browser'],
  ['session.browser.waiting', 'En attente de la première image…', 'Waiting for the first image…'],
  ['session.browser.off / offBody(n) / enable', 'Le direct n’est pas activé. / Le navigateur d’Otto ne laisse pas Ledge le regarder. Ledge peut ajouter une ligne à la config Playwright ; elle vaudra pour les prochains navigateurs. / Activer le direct…', 'Live view is off. / Otto’s browser does not let Ledge watch it. Ledge can add one line to the Playwright config; it applies to the next browsers. / Turn on live view…'],
  ['session.browser.enableTitle / enableBody / enableRisk', 'Activer le direct du navigateur des agents ? / Ledge ajoute … : chaque navigateur d’agent ouvrira un port local que Ledge regarde, sans jamais cliquer ni taper. / Un programme de cette machine qui trouve ce port pourrait aussi piloter ce navigateur…', 'Turn on live view of the agents’ browser? / Ledge adds …: each agent browser opens a local port Ledge watches, never clicking or typing. / A program on this machine that finds this port could also drive that browser…'],
  ['session.browser.remote / remoteBody(n, m)', 'Direct pas encore disponible pour une machine distante. / Otto travaille sur desktop-02. Ses captures restent visibles dans Captures.', 'Live view not available for a remote machine yet. / Otto works on desktop-02. Otto’s captures stay in Captures.'],
  ['session.browser.seeCaptures', 'Voir les captures', 'See the captures']
];

function ChoicesView(): JSX.Element {
  return (
    <div className="mk-cards">
      <div className="mk-card mk-reco">
        <p className="mk-kicker">Recommandation</p>
        <p>Lot 1 : le bouton <b>Navigateur</b> apparaît quand le vrai Chrome de l'agent tourne ; l'onglet montre son <b>direct</b>, en lecture seule ; à la fermeture, la <b>dernière image</b>, l'adresse et « Ouvrir dans mon navigateur » ; le direct revient seul quand l'agent rouvre son navigateur. Les captures restent à côté. Activation par une ligne de config, sur accord.</p>
        <p className="mk-kicker" style={{ marginTop: 14 }}>La seule ambiguïté qui change le résultat</p>
        <p><b>« Une fois fini, je peux voir sa maquette et par la suite ses changements »</b> : la dernière image et « Ouvrir dans mon navigateur » suffisent-ils ? Ou faut-il, dans Ledge, la maquette <b>vivante</b> (cliquable, à jour à chaque modification) même quand l'agent n'a plus de navigateur ? Le second demande le lecteur HTML de la maquette précédente (<code>ledge-html-viewer.html</code>) ou un navigateur tenu par Ledge : un lot de plus. Je recommande le premier pour le lot 1 : l'agent qui modifie la maquette la rouvre presque toujours dans son navigateur, et le direct revient.</p>
        <p className="mk-kicker" style={{ marginTop: 14 }}>Deux accords à donner (pas de dessin en jeu)</p>
        <ul>
          <li>Un port CDP local par navigateur d'agent Claude, comme les sièges OMP l'ont déjà. Recommandé : oui, via le bouton « Activer le direct… ».</li>
          <li>Le navigateur des sièges OMP : hors du périmètre « état seul » validé. Recommandé : pas au lot 1.</li>
        </ul>
      </div>
      <div className="mk-card">
        <p className="mk-kicker">Limites techniques (note de dev-back, qitem-20261103144722)</p>
        <table className="mk-can"><tbody>{LIMITS.map(([k, v]) => <tr key={k}><td><b>{k}</b></td><td className="muted">{v}</td></tr>)}</tbody></table>
      </div>
      <div className="mk-card mk-texts">
        <p className="mk-kicker">Textes FR / EN</p>
        <table><tbody>{TEXTS.map(([k, fr, en]) => <tr key={k}><td><code>{k}</code></td><td>{fr}</td><td className="muted">{en}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
