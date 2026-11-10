import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CONTEXT_NEAR, CONTEXT_NEAR_MAX, CONTEXT_NEAR_MIN, DEFAULT_DEVICE_PREFS, type DevicePrefs, type MutableNotification, type Tool } from '@ledge/protocol';
import { copy, locale } from '../copy';
import { setReducedMotion, useReducedMotion } from '../motion';
import { useMobile, type MobileStore } from '../state/store';
import { FIELD } from '../ui/field';
import { Segmented } from '../ui/Segmented';
import { Switch } from '../ui/Switch';
import { useNow } from '../useNow';

const S = copy.settings;
const CARD = 'flex flex-col rounded-[10px] border border-line bg-surface text-body';
const ROW = 'flex flex-col gap-1 border-b border-line px-4 py-3 last:border-b-0';
/** « Contexte max »: 50 % to 95 %, by 5, as the desktop offers it. */
export const NEARS = Array.from({ length: Math.round((CONTEXT_NEAR_MAX - CONTEXT_NEAR_MIN) * 20) + 1 }, (_, i) => Math.round((CONTEXT_NEAR_MIN + i * 0.05) * 100));
const KINDS: readonly MutableNotification[] = ['finished', 'chat', 'decision'];
type ToolChoice = Tool | 'pc';
const TOOL_CHOICES: readonly ToolChoice[] = ['pc', 'claude', 'codex', 'cursor', 'omp'];

/** A labelled row: the label (and its hint) on the left, the control on the right. */
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: (describedBy: string | undefined) => ReactNode }) {
  const id = useId();
  return (
    <div className={ROW}>
      <div className="flex items-center justify-between gap-4">
        <span className="min-w-0">{label}</span>
        {children(hint ? id : undefined)}
      </div>
      {hint && <p id={id} className="text-small text-muted">{hint}</p>}
    </div>
  );
}

/** When a pause of `kind` started at `at` ends: in an hour, in four, or tomorrow at 8:00 (local time). */
export function pauseEnd(kind: 'hour' | 'four' | 'morning', at: Date): Date {
  if (kind === 'hour') return new Date(at.getTime() + 3_600_000);
  if (kind === 'four') return new Date(at.getTime() + 4 * 3_600_000);
  const d = new Date(at);
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d;
}

/** The end of a pause as the user reads it: its time, « demain » before it when it is not today. */
export function shownUntil(until: Date, now: Date): string {
  const time = until.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (until.toDateString() === now.toDateString()) return time;
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
  return until.toDateString() === tomorrow.toDateString() ? S.tomorrow(time) : `${until.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`;
}

/**
 * This device's settings as the controls show them: the last change sent while one waits (so a second change builds on the
 * first), else the PC's. A change the PC does not take is said once, and the controls go back to the PC's.
 */
function usePrefs(store: MobileStore) {
  const state = useMobile(store);
  const [pending, setPending] = useState<DevicePrefs | null>(null);
  const [failed, setFailed] = useState(false);
  const last = useRef(0);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const prefs = pending ?? state.device?.prefs ?? DEFAULT_DEVICE_PREFS;
  const send = (next: DevicePrefs) => {
    const turn = ++last.current;
    setPending(next); setFailed(false);
    void store.setDevicePrefs(next).then(r => {
      if (!live.current || turn !== last.current) return;
      setPending(null);
      if (r.status !== 'applied') setFailed(true);
    });
  };
  return { prefs, send, failed, fresh: state.fresh };
}

/** « Notifications » once they are on: which kinds come to this device, and a pause of them all. Nothing from an older PC. */
export function NotificationPrefs({ store }: { store: MobileStore }) {
  const state = useMobile(store);
  const p = usePrefs(store);
  const now = useNow();
  if (!state.daemon?.settings || !state.device?.prefs || state.device.push !== 'on') return null;
  const { prefs } = p;
  const until = prefs.quietUntil !== null ? new Date(prefs.quietUntil) : null;
  const paused = until !== null && until.getTime() > now;
  const pause = (kind: 'hour' | 'four' | 'morning') => p.send({ ...prefs, quietUntil: pauseEnd(kind, new Date(now)).toISOString() });
  return (
    <>
      <div className={CARD}>
        {KINDS.map(k => (
          <Row key={k} label={S.notify[k]} hint={S.notify[`${k}Hint`]}>
            {d => <Switch on={prefs.notify[k]} label={S.notify[k]} describedBy={d} disabled={!p.fresh} onChange={on => p.send({ ...prefs, notify: { ...prefs.notify, [k]: on } })} />}
          </Row>
        ))}
        <div className={ROW}>
          <div className="flex items-center justify-between gap-4">
            <span>{S.pause}</span>
            {paused && <span role="status" className="text-right text-attention">{S.pausedUntil(shownUntil(until, new Date(now)))}</span>}
          </div>
          <p className="text-small text-muted">{S.pauseHint}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {paused
              ? <button type="button" disabled={!p.fresh} onClick={() => p.send({ ...prefs, quietUntil: null })} className="inline-flex min-h-10 items-center justify-center rounded-control border border-line px-3 font-medium disabled:opacity-45">{S.resume}</button>
              : (['hour', 'four', 'morning'] as const).map(k => (
                <button key={k} type="button" aria-label={S.pauseLabel[k]} disabled={!p.fresh} onClick={() => pause(k)} className="inline-flex min-h-10 items-center justify-center rounded-control border border-line px-3 font-medium disabled:opacity-45">{S.pauseFor[k]}</button>
              ))}
          </div>
        </div>
      </div>
      <p className="text-small text-muted">{S.notify.always}</p>
      {p.failed && <p role="alert" className="text-small text-danger-fg">{S.failed}</p>}
    </>
  );
}

/** « Ledge »: the PC's « Contexte max » (shared with every front) and the agent of this device's chat. Nothing from an older PC. */
export function LedgePrefs({ store }: { store: MobileStore }) {
  const state = useMobile(store);
  const p = usePrefs(store);
  const [near, setNear] = useState<number | null>(null);
  const [nearFailed, setNearFailed] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  if (!state.daemon?.settings || !state.device?.prefs) return null;
  const shownNear = Math.round((near ?? state.device.contextNear ?? CONTEXT_NEAR) * 100);
  const chooseNear = (pct: number) => {
    setNear(pct / 100); setNearFailed(false);
    void store.setContextNear(pct / 100).then(r => {
      if (!live.current) return;
      setNear(null);
      if (r.status !== 'applied') setNearFailed(true);
    });
  };
  const tool: ToolChoice = p.prefs.chatTool ?? 'pc';
  return (
    <section aria-labelledby="ledge-title" className="flex flex-col gap-2.5">
      <h2 id="ledge-title" className="text-small font-medium text-muted">{S.ledge}</h2>
      <div className={CARD}>
        <Row label={S.context} hint={S.contextHint}>
          {d => (
            <select className={`${FIELD} w-auto`} aria-label={S.context} aria-describedby={d} disabled={!state.fresh || near !== null} value={shownNear} onChange={e => chooseNear(Number(e.target.value))}>
              {NEARS.map(n => <option key={n} value={n}>{n} %</option>)}
            </select>
          )}
        </Row>
        {state.device.chat && (
          <div className={ROW}>
            <span>{S.chatTool}</span>
            <p className="text-small text-muted">{S.chatToolHint}</p>
            <div className="mt-1">
              <Segmented name="chat-tool" legend={S.chatTool} value={tool} options={TOOL_CHOICES.map(v => ({ value: v, label: S.tools[v] }))}
                onChange={v => { if (state.fresh) p.send({ ...p.prefs, chatTool: v === 'pc' ? null : v }); }} />
            </div>
            <p className="text-meta text-muted">{S.toolPcHint}</p>
          </div>
        )}
      </div>
      {!state.fresh && <p className="text-small text-muted">{S.offline}</p>}
      {(nearFailed || p.failed) && <p role="alert" className="text-small text-danger-fg">{S.failed}</p>}
    </section>
  );
}

/** « Réduire les animations »: this device's own, kept in the browser. */
export function MotionRow() {
  const reduced = useReducedMotion();
  return (
    <div className={CARD}>
      <Row label={S.motion} hint={S.motionHint}>
        {d => <Switch on={reduced} label={S.motion} describedBy={d} onChange={setReducedMotion} />}
      </Row>
    </div>
  );
}

/** « Réglés sur le PC »: what a device sees but never changes, by design (a phone does not widen its own rights). */
export function ManagedOnPc({ store }: { store: MobileStore }) {
  const daemon = useMobile(store).daemon;
  return (
    <section aria-labelledby="managed-title" className="flex flex-col gap-2.5">
      <h2 id="managed-title" className="text-small font-medium text-muted">{S.managed}</h2>
      {daemon?.terminal && (
        <dl className={CARD}>
          <div className="flex items-baseline justify-between gap-4 px-4 py-3">
            <dt className="text-muted">{S.terminal}</dt>
            <dd>{daemon.terminalInput ? S.allowed : S.notAllowed}</dd>
          </div>
        </dl>
      )}
      <p className="text-small text-muted">{S.managedBody}</p>
    </section>
  );
}
