import { useEffect, useRef, useState, type JSX } from 'react';
import { DockviewReact, type DockviewApi, type DockviewReadyEvent, type IDockviewPanelProps } from 'dockview-react';
import { Thread } from './Thread';
import { allTerms, getTerm, hidden, mount, startFloods, stats, budget } from './terms';
import { inTauri, type Kind } from './pty';
import { runBench } from './bench';

type TermSpec = { id: string; kind: Kind };

/** One or two terminals stacked in a panel: a popout window holds a single group, this keeps several visible. */
function TermsPanel(props: IDockviewPanelProps<{ terms: TermSpec[] }>): JSX.Element {
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    const ts = props.params.terms.map(s => getTerm(s.id, s.kind));
    const show = () => ts.forEach((t, i) => { const el = refs.current[i]; if (el) mount(t, el); });
    if (props.api.isVisible) show();
    const v = props.api.onDidVisibilityChange(e => (e.isVisible ? show() : ts.forEach(hidden)));
    const d = props.api.onDidDimensionsChange(() => { if (props.api.isVisible) show(); });
    return () => { v.dispose(); d.dispose(); };
  }, [props.api, props.params.terms]);
  return <div className="terms">{props.params.terms.map((s, i) => <div key={s.id} className="term-slot"><span className="term-label">{s.id} · {s.kind}</span><div className="term-box" ref={el => { refs.current[i] = el; }} /></div>)}</div>;
}

function ThreadPanel(props: IDockviewPanelProps<{ seed: number }>): JSX.Element {
  return <div className="scroll"><Thread seed={props.params.seed} /></div>;
}

const components = { terms: TermsPanel, thread: ThreadPanel };
const T = (id: string, kind: Kind): TermSpec => ({ id, kind });

export interface PopoutNote { opened: boolean; reason?: string; scriptable?: boolean; tauriInPopout?: boolean; label?: string | null; sameThread?: boolean }

export function App(): JSX.Element {
  const api = useRef<DockviewApi | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<string>('');
  const popNotes = useRef<PopoutNote[]>([]);
  const drags = useRef<Array<Record<string, unknown>>>([]);
  const say = (s: string) => setLog(l => [...l.slice(-30), `${new Date().toLocaleTimeString()} ${s}`]);

  const onReady = (e: DockviewReadyEvent) => {
    const a = e.api; api.current = a;
    a.onDidAddPopoutGroup(p => {
      const w = p.window as Window & { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } };
      let scriptable = false; try { scriptable = !!w.document.body; } catch { scriptable = false; }
      // Same JS thread: a global set here is read there synchronously only if both share one event loop.
      let sameThread = false; try { (window as unknown as { __probe: number }).__probe = Math.random(); sameThread = (w as unknown as { opener: Window }).opener === window; } catch { sameThread = false; }
      popNotes.current.push({ opened: true, scriptable, tauriInPopout: !!w.__TAURI_INTERNALS__, label: w.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null, sameThread });
      w.document.addEventListener('dragend', ev => tearOut(ev, w));
      say(`popout ouverte (scriptable : ${scriptable}, Tauri dans la popout : ${!!w.__TAURI_INTERNALS__})`);
    });
    a.onDidOpenPopoutWindowFail(f => { popNotes.current.push({ opened: false, reason: f.reason }); say(`popout refusée : ${f.reason}`); });
    a.onWillClosePopoutWindow(ev => {
      const label = (ev.window as Window & { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
      if (label && inTauri()) void import('@tauri-apps/api/core').then(c => c.invoke('close_window', { label }));
    });
    let dragged: string | null = null;
    a.onWillDragPanel(ev => { dragged = ev.panel.id; });
    // Tear-out: a tab dropped outside every window opens in a new window.
    const tearOut = (ev: DragEvent, w: Window) => {
      const outside = ev.clientX < 0 || ev.clientY < 0 || ev.clientX > w.innerWidth || ev.clientY > w.innerHeight;
      drags.current.push({ panel: dragged, clientX: ev.clientX, clientY: ev.clientY, screenX: ev.screenX, screenY: ev.screenY, dropEffect: ev.dataTransfer?.dropEffect, outside, from: w === window ? 'main' : 'popout' });
      const p = dragged ? a.getPanel(dragged) : undefined; dragged = null;
      if (outside && p) { say(`onglet ${p.id} lâché hors de la fenêtre : nouvelle fenêtre`); void a.addPopoutGroup(p, { popoutUrl: '/popout.html', position: { left: ev.screenX, top: ev.screenY, width: 900, height: 600 } }); }
    };
    document.addEventListener('dragend', ev => tearOut(ev, window));

    // Main window: five groups, six terminals visible, two threads.
    a.addPanel({ id: 'thread-a', component: 'thread', title: 'Fil · Pim', params: { seed: 1 } });
    a.addPanel({ id: 'flood-steady-1', component: 'terms', title: 'flood-1 + steady-1', params: { terms: [T('flood-1', 'flood'), T('steady-1', 'steady')] }, position: { referencePanel: 'thread-a', direction: 'right' } });
    a.addPanel({ id: 'echo-main-pair', component: 'terms', title: 'echo-main + shell-1', params: { terms: [T('echo-main', 'shell'), T('shell-1', 'shell')] }, position: { referencePanel: 'flood-steady-1', direction: 'right' } });
    a.addPanel({ id: 'thread-b', component: 'thread', title: 'Fil · Nova', params: { seed: 2 }, position: { referencePanel: 'thread-a', direction: 'below' } });
    a.addPanel({ id: 'hidden-shells', component: 'terms', title: 'shell-2 (masqué)', params: { terms: [T('shell-2', 'shell')] }, position: { referencePanel: 'thread-b', direction: 'within' } });
    a.addPanel({ id: 'flood-2-pair', component: 'terms', title: 'flood-2 + shell-3', params: { terms: [T('flood-2', 'flood'), T('shell-3', 'shell')] }, position: { referencePanel: 'thread-b', direction: 'right' } });
    for (const n of [4, 5, 6, 7, 8]) a.addPanel({ id: `shell-${n}-panel`, component: 'terms', title: `shell-${n} (masqué)`, params: { terms: [T(`shell-${n}`, 'shell')] }, position: { referencePanel: 'flood-2-pair', direction: 'within' } });
    a.getPanel('flood-2-pair')?.api.setActive();
    a.getPanel('thread-b')?.api.setActive();

    // Two popout windows, four terminals visible, one thread.
    const pop1 = a.addPanel({ id: 'echo-pop-pair', component: 'terms', title: 'echo-pop + flood-3', params: { terms: [T('echo-pop', 'shell'), T('flood-3', 'flood')] }, position: { referencePanel: 'echo-main-pair', direction: 'below' } });
    a.addPanel({ id: 'thread-c', component: 'thread', title: 'Fil · Ida', params: { seed: 3 }, position: { referencePanel: 'echo-pop-pair', direction: 'within' } });
    pop1.api.setActive();
    const pop2 = a.addPanel({ id: 'steady-pair', component: 'terms', title: 'steady-2 + steady-3', params: { terms: [T('steady-2', 'steady'), T('steady-3', 'steady')] }, position: { referencePanel: 'echo-pop-pair', direction: 'right' } });
    setTimeout(async () => {
      say('ouverture des deux fenêtres popout…');
      const ok1 = await a.addPopoutGroup(pop1.group, { popoutUrl: '/popout.html', position: { left: 80, top: 80, width: 1100, height: 700 } });
      const ok2 = await a.addPopoutGroup(pop2.group, { popoutUrl: '/popout.html', position: { left: 260, top: 200, width: 1100, height: 600 } });
      say(`popouts : ${ok1 ? 'ok' : 'échec'} / ${ok2 ? 'ok' : 'échec'}`);
    }, 1500);
  };

  const minimize = async (on: boolean) => {
    if (!inTauri()) return;
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const w = getCurrentWindow();
    if (on) await w.minimize(); else { await w.unminimize(); await w.setFocus(); }
  };

  const bench = async () => {
    const a = api.current; if (!a) return;
    const showPopThread = (on: boolean) => a.getPanel(on ? 'thread-c' : 'echo-pop-pair')?.api.setActive();
    const realistic = await runBench(a, 'réaliste', say, minimize, showPopThread);
    say('démarrage des 3 terminaux qui impriment à pleine vitesse…');
    startFloods();
    await new Promise(r => setTimeout(r, 3000));
    const max = await runBench(a, 'charge max', say, minimize, showPopThread);
    let labels: string[] = [];
    if (inTauri()) { const c = await import('@tauri-apps/api/core'); labels = await c.invoke<string[]>('window_labels'); }
    const full = {
      at: new Date().toISOString(), userAgent: navigator.userAgent, budget,
      popoutWindows: popNotes.current, tauriWindows: labels, drags: drags.current,
      realistic, max,
      webgl: { ...stats, errors: stats.errors.slice(0, 20) },
      terminals: allTerms().map(t => ({ id: t.id, kind: t.kind, window: t.host.ownerDocument === document ? 'main' : 'popout', webgl: !!t.webgl, bytes: t.bytes })),
    };
    const json = JSON.stringify(full, null, 2);
    setResult(json);
    if (inTauri()) { const c = await import('@tauri-apps/api/core'); say(`résultats : ${await c.invoke<string>('save_results', { json })}`); }
    (window as unknown as { __results: unknown }).__results = full;
  };

  useEffect(() => { (window as unknown as { __bench: () => Promise<void> }).__bench = bench; });

  return (
    <div className="app">
      <header>
        <b>Ledge · POC lot 0</b>
        <span className="mut">3 fenêtres · 16 terminaux (6 qui impriment) · 3 fils · budget WebGL {budget}</span>
        <button onClick={() => void bench()}>Lancer la mesure (≈ 1 min)</button>
        <span className="mut">WebGL actifs : {stats.webglActive}</span>
      </header>
      <main className="dock"><DockviewReact className="dockview-theme-abyss" components={components} onReady={onReady} /></main>
      <footer>
        <div className="log">{log.map((l, i) => <div key={i}>{l}</div>)}</div>
        {result && <pre className="result">{result}</pre>}
      </footer>
    </div>
  );
}
