import { useEffect, useRef, useState, type JSX } from 'react';
import type { OpenRigAction, OpenRigState, Session } from '@ledge/protocol';
import type { OpenRigView } from '@ledge/fleet/openrig';
import { useI18n } from '../../i18n/lang';
import { targetOf } from '../../openrig/model';
import { needsConfirm, type DaemonPrefs } from '../openrig/prefs';
import { confirmOf } from './model';
import '../../styles/ide-rigs.css';

/** The confirmation of a stop or restart: what it interrupts, the commands it runs. Escape closes it here and goes no further. */
export interface RigConfirmProps {
  action: OpenRigAction; state: OpenRigState; sessions: readonly Session[]; machine: string; label: string;
  onConfirm(): void; onCancel(): void;
}

export function RigConfirm({ action, state, sessions, machine, label, onConfirm, onCancel }: RigConfirmProps): JSX.Element {
  const { t } = useI18n();
  const c = t.openrig.confirm, v = t.ide.rigsView;
  const target = targetOf(action);
  const { working, commands, restart } = confirmOf(state, action, sessions, machine);
  const w = target === 'daemon' ? c.daemon : target === 'kernel' ? c.kernel : c.rig(target);
  const title = (restart ? c.restartTitle : c.title)(w, label);
  return (
    // Escape here only closes the confirmation: it goes no further, so neither the window's navigation nor an outer layer sees it.
    <div className="ide-rigs-conf" role="group" aria-label={title} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <b>{title}</b>
      <span>{c.working(working.length)}</span>
      {working.length > 0 && <span className="ide-rigs-seats">{working.join(', ')}</span>}
      {restart && <p>{c.restartNote}</p>}
      {commands.map(cmd => <code key={cmd}>{cmd}</code>)}
      <div className="ide-rigs-go">
        <button type="button" className="pri" onClick={onConfirm}>{restart ? v.confirmRestart : v.confirmStop}</button>
        <button type="button" autoFocus onClick={onCancel}>{v.cancel}</button>
      </div>
    </div>
  );
}

export interface RigConfirmControl {
  /** The action being confirmed, or null. */
  confirm: OpenRigAction | null;
  /** The target of the last action run, for its failure line (`view.last` is shown under this target). */
  lastTarget: string | null;
  /** Opens the confirmation for a stop or restart (remembering `opener` for the focus), starts a start at once. `back` finds where the focus goes if `opener` has left the page. */
  ask(action: OpenRigAction, opener: HTMLElement | null, back?: () => HTMLElement | null | undefined): void;
  run(action: OpenRigAction): void;
  /** Closes the confirmation and gives the focus back. */
  close(): void;
  /** Drops the confirmation and the last target without moving the focus (the machine changed). */
  reset(): void;
}

/** The state of a confirmation (`opts`: the machine's preferences can run a stop at once when nothing is working): it closes when `offered` is no longer true of its action, and the focus returns to its opener. */
export function useRigConfirm(view: OpenRigView, offered: (action: OpenRigAction) => boolean, opts?: { prefs: DaemonPrefs; state: OpenRigState | null }): RigConfirmControl {
  const [confirm, setConfirm] = useState<OpenRigAction | null>(null);
  const [lastTarget, setLastTarget] = useState<string | null>(null);
  const opener = useRef<{ button: HTMLElement | null; back?: () => HTMLElement | null | undefined } | null>(null);
  const close = () => {
    const o = opener.current; opener.current = null; setConfirm(null);
    if (!o) return;
    // After React removed the confirmation: the opener if it is still there, else the fallback.
    queueMicrotask(() => (o.button?.isConnected ? o.button : o.back?.())?.focus());
  };
  const stillOffered = confirm !== null && offered(confirm);
  useEffect(() => { if (confirm && !stillOffered) close(); }, [confirm, stillOffered]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = (action: OpenRigAction) => { close(); setLastTarget(targetOf(action)); void view.act(action); };
  const ask: RigConfirmControl['ask'] = (action, button, back) => {
    // Decided at the click, from the latest state: a seat that started working since the last render asks again.
    if (action.kind.endsWith('.start') || (opts && opts.state && !needsConfirm(action, opts.state, opts.prefs))) run(action);
    else { opener.current = { button, ...(back ? { back } : {}) }; setConfirm(action); }
  };
  const reset = () => { opener.current = null; setConfirm(null); setLastTarget(null); };
  return { confirm: stillOffered ? confirm : null, lastTarget, ask, run, close, reset };
}
