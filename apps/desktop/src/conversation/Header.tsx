import { useState, type SyntheticEvent } from 'react';
import type { Session } from '@ledge/protocol';
import type { DaemonClient } from '@ledge/fleet';
import { useI18n } from '../i18n/lang';
import { Avatar, StateBadge, TOOL_NAMES } from '../shell/Person';
import { story } from '../grouping/story';
import { toggled } from '../state/threadPrefs';
import { SESSION_ACTIONS, sessionActions, type SessionAction } from './actions';
import { openSessionTerminal } from './terminal';
import type { Conversations } from './useConversations';

export interface ConversationProps { session: Session; client: DaemonClient; api: Conversations; expanded: boolean; onExpand: (on: boolean) => void }

const TOPIC_MAX = 500;
const COMMANDS: ReadonlySet<string> = new Set(['interrupt', 'kill', 'dismiss', 'rename']);
const minutes = (s: Session): number =>
  Math.max(0, Math.round(((s.exitedAt ? Date.parse(s.exitedAt) : Date.now()) - Date.parse(s.startedAt)) / 60_000));

/** The conversation's head (mockup conversation.js `render`): subject, agent, machine, state, folded session details, then
 *  the session actions of spec §9.1. Mounted per session (`key`), so a confirmation or a rename never follows another one. */
export function ConversationHeader({ session: s, client, api, expanded, onExpand }: ConversationProps) {
  const { t } = useI18n();
  const c = t.conversation;
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const actions = sessionActions(s, client.fleet?.terminal(s.id) ?? null);
  const open = api.pref(s.id).open;
  const jira = story(s);
  const jiraText = jira.key && jira.source ? c.meta.jira(jira.key, jira.source) : jira.ambiguous ? c.meta.ambiguous(jira.keys) : c.meta.noJira;
  const sent = api.sends.sent[s.id];
  const failed = api.sends.failed[s.id];
  const note = missing ? c.actions.why.unavailable
    : sent && COMMANDS.has(sent.kind) ? c.actions.sent
    : failed && COMMANDS.has(failed.kind) ? c.actions.failed(failed.message)
    : null;

  const run = (a: SessionAction) => {
    setMissing(false);
    if (a === 'terminal') { void openSessionTerminal(client, s).then(ok => setMissing(!ok)); return; }
    if (a === 'kill') { setConfirming(true); return; }
    if (a === 'rename') { setRenaming(s.topic ?? ''); return; }
    api.command(s, a);
  };
  const onMeta = (e: SyntheticEvent<HTMLDetailsElement>) => api.setPref(s.id, { open: toggled(open, 'metadata', e.currentTarget.open) });

  return (
    <header className="conversation-header">
      <div className="conversation-top">
        <span>{c.eyebrow}</span>
        <button type="button" data-expand-conversation aria-expanded={expanded} onClick={() => onExpand(!expanded)}>{expanded ? c.collapse : c.expand}</button>
      </div>
      {renaming === null
        ? <h3>{s.topic || s.title}</h3>
        : <form className="conversation-rename" onSubmit={e => { e.preventDefault(); api.rename(s, renaming); setRenaming(null); }}>
            <input aria-label={c.actions.renameLabel} aria-describedby="rename-hint" value={renaming} maxLength={TOPIC_MAX} autoFocus
              onChange={e => setRenaming(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); } }} />
            <div className="conversation-rename-bottom">
              <small id="rename-hint">{c.actions.renameHint}</small>
              <button type="submit" className="settings-button">{c.actions.save}</button>
            </div>
          </form>}
      <div className="conversation-person">
        <Avatar session={s} size={28} />
        <strong>{s.name}</strong>
        <span>{TOOL_NAMES[s.tool]} · {s.machineName ?? c.local}</span>
        <StateBadge session={s} />
      </div>
      <details className="conversation-meta" data-fold="metadata" open={open.includes('metadata')} onToggle={onMeta}>
        <summary>{c.meta.summary}</summary>
        <div className="detail-meta">
          {s.project} · {c.meta.duration(minutes(s))}
          {s.cwd && <><br />{c.meta.folder} · {s.cwd}</>}
          {s.branch && <><br /><span className="branch">⑂ {s.branch}</span></>}
          <br />{jiraText}
        </div>
      </details>
      <div className="conversation-actions" role="group" aria-label={c.actions.label}>
        {SESSION_ACTIONS.filter(a => actions[a].shown).map(a => {
          const state = actions[a];
          const busy = a !== 'terminal' && sent?.kind === a;
          return (
            <button key={a} type="button" className="settings-button" data-action={a} disabled={!state.enabled || busy}
              title={state.reason ? c.actions.why[state.reason] : undefined} onClick={() => run(a)}>{c.actions[a]}</button>
          );
        })}
      </div>
      {confirming && !s.offline && (
        <div className="conversation-confirm" role="group" aria-label={c.actions.kill}>
          <p>{c.actions.confirmKill(s.name)}</p>
          <button type="button" className="settings-button" onClick={() => setConfirming(false)}>{c.actions.cancel}</button>
          <button type="button" className="settings-button danger" data-confirm-kill onClick={() => { setConfirming(false); api.command(s, 'kill'); }}>{c.actions.confirm}</button>
        </div>
      )}
      {note && <p className="conversation-note" role="status">{note}</p>}
    </header>
  );
}
