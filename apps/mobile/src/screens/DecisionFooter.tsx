import { useEffect, useState } from 'react';
import { copy } from '../copy';
import type { InboxItem } from '../model/requests';
import type { Outcome } from '../model/requestOutcome';
import type { Link } from '../state/store';
import { Notice } from '../ui/Notice';

const btn = 'inline-flex min-h-12 flex-1 items-center justify-center rounded-control border border-line px-4 py-2.5 text-center text-[13px] leading-[1.4] font-medium disabled:opacity-45';
const full = 'inline-flex min-h-12 w-full items-center justify-center rounded-control border px-4 py-2.5 text-[13px] font-medium disabled:opacity-45';

export interface DecisionFooterProps {
  item: InboxItem;
  outcome: Outcome;
  link: Link;
  /** The request changed since the phone showed it: a decision needs a fresh reading first. */
  changed: boolean;
  onReread: () => void;
  onDecide: (decision: 'accept' | 'deny') => void;
  /** High-risk accept (device check, Task 10). Without it the button stays disabled. */
  onVerify?: (() => void) | undefined;
  /** Reconnect and ask the daemon where an uncertain decision ended up. */
  onCheck: () => void;
}

/** A decision is only ever one tap, sent now, never queued: this footer never offers one it could not honour. */
export function DecisionFooter({ item, outcome, link, changed, onReread, onDecide, onVerify, onCheck }: DecisionFooterProps) {
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!checking) return;
    const t = setTimeout(() => setChecking(false), 4000);
    return () => clearTimeout(t);
  }, [checking]);
  const wrap = (children: React.ReactNode) => <footer className="flex flex-none flex-col gap-2.5 border-t border-line bg-bg px-side pt-3 pb-4">{children}</footer>;
  const hint = (t: string) => <p className="text-center text-[10px] text-muted">{t}</p>;

  if (item.readOnly) return wrap(hint(copy.decide.readOnly));
  if (item.kind === 'question') return wrap(hint(copy.decide.answerLater));

  const live = link === 'online' && !changed;
  const buttons = (enabled: boolean) => (
    <div className="flex gap-2.5">
      <button type="button" disabled={!enabled} onClick={() => onDecide('deny')} className={btn}>{copy.decide.deny}</button>
      {item.risk === 'high'
        ? <button type="button" disabled={!enabled || !onVerify} onClick={() => onVerify?.()} className={`${btn} border-[#b34b52] bg-danger-btn text-white`}>{copy.decide.verify}</button>
        : <button type="button" disabled={!enabled} onClick={() => onDecide('accept')} className={`${btn} border-transparent bg-fg text-[#121415]`}>{copy.decide.allow}</button>}
    </div>
  );
  const linkHint = link === 'offline' ? copy.decide.offlineHint : link === 'connecting' ? copy.decide.connectingHint : copy.decide.hint;

  if (changed) {
    return wrap(<>
      <Notice title={copy.decide.changed} tone="warning" role="status" />
      {buttons(false)}
      <button type="button" onClick={onReread} className={`${full} border-line bg-surface`}>{copy.decide.reread}</button>
    </>);
  }

  switch (outcome.kind) {
    case 'sending':
      return wrap(<Notice title={copy.decide.sending} role="status"><p>{copy.decide.sendingBody}</p></Notice>);
    case 'uncertain':
      return wrap(<>
        <Notice title={copy.decide.uncertain} tone="warning" role="alert"><p>{copy.decide.uncertainBody}</p></Notice>
        <button type="button" disabled={checking} onClick={() => { setChecking(true); onCheck(); }} className={`${full} border-transparent bg-fg text-[#121415]`}>{checking ? copy.decide.checking : copy.decide.check}</button>
      </>);
    case 'unknown':
      return wrap(<>
        <Notice title={copy.decide.unknown} tone="warning" role="alert"><p>{outcome.stillPending ? copy.decide.unknownPending : copy.decide.unknownGone}</p></Notice>
        {outcome.stillPending && <>{buttons(live)}{hint(linkHint)}</>}
      </>);
    case 'rejected': case 'failed': {
      const r = outcome.reason;
      if (r === 'forbidden') return wrap(<Notice title={copy.decide.forbidden} tone="danger" role="alert" />);
      if (r === 'no_prompt') return wrap(<Notice title={copy.decide.noPrompt} tone="warning" role="alert" />);
      if (r === 'stale' || r === 'changed') return wrap(<Notice title={copy.decide.changed} tone="warning" role="alert" />);
      const text = r === 'busy' ? copy.decide.busy : r === 'not_taken' ? copy.decide.notTaken : copy.decide.failed;
      return wrap(<><Notice title={text} tone="warning" role="alert" />{buttons(live)}{hint(linkHint)}</>);
    }
    default:
      return wrap(<>{buttons(live)}{hint(linkHint)}</>);
  }
}
