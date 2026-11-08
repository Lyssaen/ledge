import { useLayoutEffect, type JSX, type ReactNode } from 'react';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../../i18n/lang';
import { cls } from '../../shell/cls';
import { providerOf } from '../../workspace/sessionTab';
import { ProviderLogo } from '../ProviderLogo';

/** What Ctrl+Enter runs: the chosen mode's main button while it is active, nothing otherwise. */
export type GoRef = { current: (() => void) | null };

/** Hands the mode's main action to the modal's Ctrl+Enter, only while the button would take a click. */
export function useGo(ref: GoRef, go: (() => void) | null): void {
  useLayoutEffect(() => { ref.current = go; return () => { ref.current = null; }; });
}

/** One row of the mockup's `.fld` grid: the label, then the field. `htmlFor` ties a label to its input. */
export function Row({ label, htmlFor, id, children }: { label: ReactNode; htmlFor?: string; id?: string; children: ReactNode }): JSX.Element {
  return <>
    {htmlFor ? <label className="ide-rl-lbl" htmlFor={htmlFor} id={id}>{label}</label> : <span className="ide-rl-lbl" id={id}>{label}</span>}
    {children}
  </>;
}

/** A seat's harness as its provider's logo (Claude Code, Codex; anything else as OMP, as the Rig tab does). */
export const RuntimeLogo = ({ runtime }: { runtime: string }): JSX.Element =>
  <span className="ide-rl-logo" aria-hidden="true"><ProviderLogo provider={providerOf(runtime === 'codex' ? 'codex' : runtime === 'claude-code' ? 'claude' : 'omp')} size={14} /></span>;

/** The command a mode runs, exactly as Ledge runs it. */
export const Command = ({ text }: { text: string }): JSX.Element => {
  const { t } = useI18n();
  return <Row label={t.ide.launchRig.command}><code className="ide-rl-cmd">{text}</code></Row>;
};

/** The machines a launch can go to: the one shown, and every other connected one where OpenRig is installed. */
export function MachineSeg({ machines, current, onPick }: { machines: ReadonlyArray<{ id: string; label: string }>; current: string; onPick(id: string): void }): JSX.Element {
  const { t } = useI18n();
  return (
    <Row label={t.ide.launchRig.machine}>
      <div className="ide-rl-seg" role="radiogroup" aria-label={t.ide.launchRig.machine}>
        {machines.map(m => <button key={m.id} type="button" role="radio" aria-checked={m.id === current} className={cls(m.id === current && 'on')} onClick={() => { if (m.id !== current) onPick(m.id); }}>{m.label}</button>)}
      </div>
    </Row>
  );
}

/** The row of the main button (with its Ctrl Enter), « Annuler », and a note or the problem that holds the button back. */
export function GoRow({ text, disabled, onGo, onClose, note, alert }: { text: string; disabled: boolean; onGo(): void; onClose(): void; note?: ReactNode; alert?: ReactNode }): JSX.Element {
  const { t } = useI18n();
  const L = t.ide.launchRig;
  return <>
    <span />
    <div className="ide-rl-go">
      <Button variant="primary" disabled={disabled} onClick={onGo}>{text}<Kbd accent>{L.keys}</Kbd></Button>
      <Button variant="outline" onClick={onClose}>{L.cancel}</Button>
      {alert ? <span className="ide-rl-alert" role="alert">{alert}</span> : note ? <span className="ide-rl-note">{note}</span> : null}
    </div>
  </>;
}
