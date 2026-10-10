import { transition, initialSurface, ELAPSED, type SurfaceEvent, type SurfaceState, type TimerName } from './machine';

type Handle = ReturnType<typeof globalThis.setTimeout>;
interface Running { handle: Handle; deadline: number; rev: number }

/** Runs the machine's timer effects. Owns time: `now()` is monotonic and injectable; a paused timer keeps its exact remainder. */
export function createSurfaceController(opts: {
  onState: (s: SurfaceState) => void;
  setTimeout?: typeof globalThis.setTimeout;
  clearTimeout?: typeof globalThis.clearTimeout;
  now?: () => number;
}) {
  const setT = opts.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearT = opts.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const now = opts.now ?? (() => performance.now());
  let state = initialSurface();
  const running = new Map<TimerName, Running>();
  const paused = new Map<TimerName, { remaining: number; rev: number }>();

  function arm(name: TimerName, ms: number, rev: number) {
    const handle = setT(() => {
      if (running.get(name)?.handle !== handle) return;
      running.delete(name);
      dispatch({ type: ELAPSED[name], rev });
    }, ms);
    running.set(name, { handle, deadline: now() + ms, rev });
  }
  function stop(name: TimerName) {
    const r = running.get(name); if (r) { clearT(r.handle); running.delete(name); }
    paused.delete(name);
  }

  function dispatch(e: SurfaceEvent) {
    const r = transition(state, e);
    for (const fx of r.effects) {
      switch (fx.type) {
        case 'startTimer': stop(fx.name); arm(fx.name, fx.ms, r.state.rev); break;
        case 'cancelTimer': stop(fx.name); break;
        case 'pauseTimer': {
          const run = running.get(fx.name); if (!run) break;
          clearT(run.handle); running.delete(fx.name);
          paused.set(fx.name, { remaining: Math.max(0, run.deadline - now()), rev: run.rev });
          break;
        }
        case 'resumeTimer': {
          const p = paused.get(fx.name); if (!p) break;
          paused.delete(fx.name); arm(fx.name, p.remaining, p.rev);
          break;
        }
      }
    }
    if (r.state !== state) { state = r.state; opts.onState(state); }
  }

  return {
    dispatch,
    state: () => state,
    /** Remaining bubble time in ms (running or paused), or null when no bubble clock exists; feeds the visible bar. */
    bubbleRemaining: (): number | null => {
      const p = paused.get('bubble'); if (p) return p.remaining;
      const r = running.get('bubble'); return r ? Math.max(0, r.deadline - now()) : null;
    },
    dispose: () => { for (const r of running.values()) clearT(r.handle); running.clear(); paused.clear(); }
  };
}
