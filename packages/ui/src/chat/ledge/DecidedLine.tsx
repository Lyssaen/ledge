import type { LedgeDecision, LedgeRule } from '@ledge/protocol';
import { useLedgeThreadCopy } from './copy';

/** What Ledge settled alone: « J'ai tranché pour build : …. Règle du 26/10 · <why> · Revenir dessus ». `rule` is the decision's rule
 *  when it is still known (its day); otherwise its id. « Revenir dessus » when the app offers it. */
export function DecidedLine({ decision, to, rule, onRevisit }: { decision: LedgeDecision; to: string; rule?: LedgeRule; onRevisit?: () => void }) {
  const copy = useLedgeThreadCopy();
  const ruleText = decision.rule ? (rule ? copy.decided.ruleOf(rule.since) : copy.decided.rule(decision.rule)) : undefined;
  const sep = <span className="lt-decided-sep" aria-hidden> · </span>;
  return (
    <div className="lt-decided">
      <span className="lt-decided-text">{copy.decided.line(to, decision.summary)}{(ruleText || decision.why) && !/[.!?…]$/.test(decision.summary) ? '.' : ''}</span>
      {ruleText && <> <span className="lt-decided-rule">{ruleText}</span></>}
      {decision.why && <>{ruleText ? sep : ' '}<span className="lt-decided-why">{decision.why}</span></>}
      {onRevisit && (ruleText || decision.why) && sep}
      {onRevisit && <button type="button" className="ledge-btn lt-btn" data-variant="outline" onClick={onRevisit}>{copy.decided.revisit}</button>}
    </div>
  );
}
