import type { JSX } from 'react';
import type { Pending, Tool } from '@ledge/protocol';
import { Badge } from '@ledge/ui/ui/Badge';
import { Button } from '@ledge/ui/ui/Button';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';

/** The mockup's three sorts of request: a permission or a diff is an « approval ». */
export type Sort = 'approval' | 'plan' | 'question';
export const sortOf = (p: Pending): Sort => (p.kind === 'question' ? 'question' : p.kind === 'plan' ? 'plan' : 'approval');

/** Tools whose request is a command to run. */
const COMMANDS = new Set(['Bash', 'shell', 'exec_command']);
/** Claude Code's file tools: their « always » turns on accept-edits for the whole session. */
const EDITS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** What « always » really grants (the option adapters/claude.ts and codex.ts pick on the dialog): Claude's Bash rule goes to
 *  the project's settings, its file tools switch the session to accept-edits, its plan option is accept-edits or auto mode
 *  (2.1); Codex's « don't ask again » holds for that command or those files until the session ends. */
export function alwaysScope(tool: Tool, p: Pending): 'project' | 'edits' | 'session' | 'plan' {
  if (tool !== 'claude') return 'session';
  if (p.kind === 'plan') return 'plan';
  return p.kind === 'diff' || EDITS.has(p.tool ?? '') ? 'edits' : 'project';
}

/** A plan's title: its first line without the heading marks. */
const titleOf = (text: string): string => (text.split('\n').find(l => l.trim() !== '') ?? '').replace(/^\s*#+\s*/, '').trim();

export interface PendingActions {
  busy: boolean;
  /** offers(tool, kind, 'always'), and what it grants (the button's title). */
  always: boolean; alwaysTitle: string;
  decide(decision: 'accept' | 'deny' | 'always'): void;
  /** « Continuer à planifier » : sends the draft back as the note, else asks for one. */
  keepPlanning(): void;
  choose(i: number): void;
}

/** The request pinned above the reply field (session.tsx `pendingCard`): who asks what, since when, and its answers;
 *  without `actions` (a subagent's page, a read-only session) the answers are only shown, and `relay` says who passes them on. */
export function PendingCard({ pending, asker, since, actions, relay }: { pending: Pending; asker: string; since: string; actions: PendingActions | null; relay: string | null }): JSX.Element {
  const { t } = useI18n();
  const tp = t.session.pending;
  const sort = sortOf(pending);
  const title = sort === 'plan' ? tp.plan(asker, titleOf(pending.text))
    : sort === 'question' ? tp.question(asker)
    : COMMANDS.has(pending.tool ?? '') ? tp.command(asker) : pending.kind === 'diff' ? tp.edit(asker) : tp.approval(asker);
  const busy = actions?.busy ?? false;
  return (
    <div className={`pending-card ${sort}`} role="region" aria-label={tp.regions[sort]}>
      <div className="pending-head">
        <Badge state={sort === 'question' ? 'question' : 'approval'} label={sort === 'plan' ? tp.planBadge : undefined} />
        <strong>{title}</strong><span className="spacer" /><span className="muted pending-since">{since}</span>
      </div>
      {sort === 'approval' && (
        <div className="pending-command">{pending.tool && <span className="tool-tag">{pending.tool}</span>}<code>{pending.text}</code></div>
      )}
      {sort === 'question' && <>
        <p className="pending-question">{pending.text}</p>
        {(pending.options?.length ?? 0) > 0 && (
          <ol className="pending-choices">
            {pending.options!.map((label, i) => (
              <li key={`${i}:${label}`}>
                <button type="button" disabled={!actions || busy} onClick={() => actions?.choose(i)}>
                  <Kbd>{i + 1}</Kbd><span><strong>{label}</strong>{pending.optionDetails?.[i] ? <small>{pending.optionDetails[i]}</small> : null}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </>}
      {relay !== null ? <p className="pending-relay muted">{sort === 'question' ? tp.relayAnswer(relay) : tp.relay(relay)}</p>
        : actions && sort === 'approval' ? (
          <div className="pending-actions">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => actions.decide('accept')}>{tp.allow}<Kbd accent>Y</Kbd></Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => actions.decide('deny')}>{tp.deny}<Kbd>N</Kbd></Button>
            {actions.always && <Button variant="ghost" size="sm" disabled={busy} title={actions.alwaysTitle} onClick={() => actions.decide('always')}>{tp.always}</Button>}
          </div>
        ) : actions && sort === 'plan' ? (
          <div className="pending-actions">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => actions.decide('accept')}>{tp.approvePlan}<Kbd accent>Y</Kbd></Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={actions.keepPlanning}>{tp.keepPlanning}<Kbd>N</Kbd></Button>
            {actions.always && <Button variant="ghost" size="sm" disabled={busy} title={actions.alwaysTitle} onClick={() => actions.decide('always')}>{tp.approveAuto}</Button>}
          </div>
        ) : null}
    </div>
  );
}
