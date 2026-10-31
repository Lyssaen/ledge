import type { LedgeDecision } from '@ledge/protocol';
import { useLedgeThreadCopy } from './copy';

/** What Ledge settled alone (« J'ai tranché pour build : … »), its rule, and « Revenir dessus » when the app offers it. */
export function DecidedLine({ decision, to, onRevisit }: { decision: LedgeDecision; to: string; onRevisit?: () => void }) {
  const copy = useLedgeThreadCopy();
  return (
    <div className="lt-decided">
      <span className="lt-decided-text">{copy.decided.line(to, decision.summary)}</span>
      {decision.rule && <span className="lt-decided-rule">{copy.decided.rule(decision.rule)}</span>}
      {onRevisit && <button type="button" className="ledge-btn lt-btn" data-variant="outline" onClick={onRevisit}>{copy.decided.revisit}</button>}
    </div>
  );
}
