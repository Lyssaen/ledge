import { useId, useState, type JSX } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import { useOpenRigGoals } from '@ledge/fleet/openrigGoals';
import type { OpenRigState, Session } from '@ledge/protocol';
import { useI18n } from '../../i18n/lang';
import { operatorOf } from '../../openrig/model';
import { GoRow, Row, useGo, type GoRef } from './parts';

export interface OperatorFieldsProps {
  client: DaemonClient; machine: string; state: OpenRigState; sessions: readonly Session[];
  /** The kernel stopped since the card was chosen: nothing to send. */ off: boolean;
  go: GoRef; onOperator(sessionId: string | null): void; onClose(): void;
}

/** « Composer avec l'operator » (R6): what the person wants, sent to the kernel's operator as a goal; it proposes a team in its thread. */
export function OperatorFields({ client, machine, state, sessions, off, go, onOperator, onClose }: OperatorFieldsProps): JSX.Element {
  const { t } = useI18n();
  const L = t.ide.launchRig;
  const id = useId();
  const goals = useOpenRigGoals(client, machine);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const blocked = off || sending || !text.trim();
  const send = async () => {
    if (blocked) return;
    setSending(true); setFailed(null);
    const r = await goals.send(text.trim());
    setSending(false);
    if (r.ok) onOperator(operatorOf(state, sessions, machine)?.id ?? null);
    else setFailed(L.goalErrors[r.error ?? ''] ?? r.message ?? t.openrig.failed(r.error ?? ''));
  };
  useGo(go, blocked ? null : () => void send());
  return <>
    <Row label={L.want} htmlFor={`${id}-want`}>
      <textarea id={`${id}-want`} className="ide-rl-ta" autoFocus value={text} placeholder={L.wantPlaceholder} onChange={e => { setText(e.target.value); setFailed(null); }} />
    </Row>
    <span /><span className="ide-rl-note">{L.wantHint}</span>
    <GoRow text={sending ? L.asking : L.ask} disabled={blocked} onGo={() => void send()} onClose={onClose} alert={failed ?? (off ? L.kernelOff : null)} />
  </>;
}
