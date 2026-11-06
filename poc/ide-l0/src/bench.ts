/**
 * The fluidity bar of the plan (docs/ide-workspace-plan.md, 4.2), measured with everything running:
 * - key → echo on screen under 50 ms in an attached terminal, in the main window and in a popout;
 * - no frame over 100 ms while a thread scrolls, in the main window and in a popout;
 * - no stall while tabs move between groups (the drag's work, done by the API).
 * Plus what a desktop webview may do to a popout: the main window minimized, do the popout's terminals still draw?
 */
import type { DockviewApi } from 'dockview-react';
import { allTerms, echoLatency, stats, type Term } from './terms';

export interface FrameStats { frames: number; fps: number; maxGapMs: number; over100: number; over50: number }
const pct = (xs: number[], p: number) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : null; };

/** Counts frames of `win` for `ms`, while `each` runs on every frame. */
export function frames(win: Window, ms: number, each?: (dt: number) => void): Promise<FrameStats> {
  return new Promise(resolve => {
    const gaps: number[] = []; let last = win.performance.now(); const end = last + ms;
    const tick = (now: number) => {
      gaps.push(now - last); last = now; each?.(gaps[gaps.length - 1]);
      if (now < end) win.requestAnimationFrame(tick);
      else resolve({ frames: gaps.length, fps: +(gaps.length / (ms / 1000)).toFixed(1), maxGapMs: +Math.max(...gaps).toFixed(1), over100: gaps.filter(g => g > 100).length, over50: gaps.filter(g => g > 50).length });
    };
    win.requestAnimationFrame(tick);
  });
}

async function echoSeries(t: Term, n: number): Promise<{ p50: number | null; p95: number | null; max: number | null; lost: number }> {
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const ch = String.fromCharCode(97 + (i % 26));
    xs.push(await echoLatency(t, ch));
    t.pty?.write('\b');
    await new Promise(r => setTimeout(r, 60));
  }
  const ok = xs.filter(Number.isFinite);
  return { p50: pct(ok, 0.5), p95: pct(ok, 0.95), max: ok.length ? +Math.max(...ok).toFixed(1) : null, lost: xs.length - ok.length };
}

function scroller(doc: Document): HTMLElement | null {
  return [...doc.querySelectorAll<HTMLElement>('.thread')].find(e => e.offsetParent !== null)?.parentElement ?? null;
}

/** One profile's measures. `showPopThread`/`showPopTerms` put the popout's thread, then its terminals, in front. */
export async function runBench(api: DockviewApi, profile: string, log: (s: string) => void, minimize: (on: boolean) => Promise<void>, showPopThread: (on: boolean) => void): Promise<Record<string, unknown>> {
  const popouts = api.getPopouts();
  const pop = popouts[0]?.window ?? null;
  const out: Record<string, unknown> = { profile, at: new Date().toISOString(), popouts: popouts.length };
  const echoMain = allTerms().find(t => t.id === 'echo-main');
  const echoPop = allTerms().find(t => t.id === 'echo-pop');
  const p = (s: string) => log(`[${profile}] ${s}`);
  out.terminalsDuringEcho = allTerms().map(t => `${t.id}:${t.host.ownerDocument === document ? 'main' : 'popout'}:${t.webgl ? 'gl' : 'dom'}`).join(' ');

  p('1/5 · écho clavier, fenêtre principale…');
  out.echoMain = echoMain ? await echoSeries(echoMain, 40) : 'absent';
  p('2/5 · écho clavier, popout…');
  out.echoPopout = echoPop ? await echoSeries(echoPop, 40) : 'absent';
  out.echoPopoutDocument = echoPop ? (echoPop.host.ownerDocument === document ? 'main' : 'popout') : null;

  p('3/5 · défilement d\'un fil, 5 s par fenêtre…');
  const sMain = scroller(document);
  out.scrollMain = await frames(window, 5000, () => { if (sMain) sMain.scrollTop = (sMain.scrollTop + 40) % (sMain.scrollHeight - sMain.clientHeight); });
  if (pop) {
    showPopThread(true); await new Promise(r => setTimeout(r, 300));
    const sPop = scroller(pop.document);
    out.scrollPopout = await frames(pop, 5000, () => { if (sPop) sPop.scrollTop = (sPop.scrollTop + 40) % (sPop.scrollHeight - sPop.clientHeight); });
    showPopThread(false); await new Promise(r => setTimeout(r, 300));
  }

  p('4/5 · déplacement d\'un onglet entre deux groupes (20 fois)…');
  // Between the groups of thread-a and of the hidden shells: no visible terminal is covered while it moves.
  const panel = api.getPanel('thread-b');
  const g1 = api.getPanel('thread-a')?.group, g2 = api.getPanel('hidden-shells')?.group;
  const moving = frames(window, 4000);
  if (panel && g1 && g2) for (let i = 0; i < 20; i++) { panel.api.moveTo({ group: i % 2 ? g2 : g1 }); await new Promise(r => setTimeout(r, 150)); }
  out.moveTabs = await moving;

  p('5/5 · fenêtre principale réduite 5 s : les terminaux de la popout dessinent-ils encore ?');
  const inPop = allTerms().filter(t => t.host.ownerDocument !== document);
  const before = inPop.map(t => t.renders), bytesBefore = inPop.map(t => t.bytes);
  await minimize(true);
  const popFrames = pop ? await frames(pop, 5000) : null;
  await minimize(false);
  out.mainMinimized = { popoutFrames: popFrames, popoutTermRenders: inPop.map((t, i) => ({ id: t.id, renders: t.renders - before[i], bytes: t.bytes - bytesBefore[i] })) };

  out.webglActive = stats.webglActive;
  const e = out as { echoMain?: { p95?: number | null }; echoPopout?: { p95?: number | null }; scrollMain?: FrameStats; scrollPopout?: FrameStats; moveTabs?: FrameStats };
  out.verdict = {
    echoUnder50: [e.echoMain?.p95, e.echoPopout?.p95].every(v => typeof v === 'number' && v < 50),
    noFrameOver100: [e.scrollMain, e.scrollPopout, e.moveTabs].every(f => !f || f.over100 === 0),
  };
  p('terminé.');
  return out;
}
