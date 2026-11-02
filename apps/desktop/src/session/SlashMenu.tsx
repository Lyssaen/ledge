import type { JSX } from 'react';
import type { SlashCommandsState } from '@ledge/fleet/slashCommands';
import type { SlashMatch } from '@ledge/ui/slash/match';
import { Kbd } from '@ledge/ui/ui/Kbd';
import { useI18n } from '../i18n/lang';
import { cls } from '../shell/cls';

export const slashOptionId = (listId: string, i: number) => `${listId}-${i}`;

/**
 * The « / » list above the reply field (mockup docs/mockups/ledge-slash-commands.html): the commands of the session's
 * agent that match what is typed, the one `selected` highlighted. A command Ledge does not send is shown greyed with its
 * reason, and cannot be picked. The field keeps the focus: it drives the list with ↑↓, Tab / ↵ and Esc.
 */
export function SlashMenu({ id, state, query, matches, selected, tool, name, onPick, onHover }: {
  id: string; state: SlashCommandsState; query: string; matches: readonly SlashMatch[]; selected: number;
  /** The agent's name (« Claude Code ») and the session's (« Otto »). */ tool: string; name: string;
  onPick(i: number): void; onHover(i: number): void;
}): JSX.Element {
  const { t } = useI18n();
  const ts = t.session.slash;
  if (state.status !== 'ready') {
    return (
      <div className="slash-menu" role="status">
        <div className="slash-head"><span className="slash-spin" aria-hidden="true" /><strong>{tool}</strong> · {ts.loading}</div>
        <div className="slash-skel m" /><div className="slash-skel s" /><div className="slash-skel m" />
      </div>
    );
  }
  if (state.error) return <div className="slash-menu" role="status"><p className="slash-empty"><strong>{ts.unavailable}</strong>{ts.unavailableBody(name)}</p></div>;
  if (matches.length === 0) return <div className="slash-menu" role="status"><p className="slash-empty">{ts.none(`/${query}`, name)}</p></div>;
  return (
    <div className="slash-menu">
      <div className="slash-head"><strong>{tool}</strong> · {ts.count(matches.length)}</div>
      <ul id={id} role="listbox" aria-label={ts.label(tool)}>
        {matches.map((m, i) => {
          const c = m.command;
          const blocked = c.blocked !== undefined;
          const at = m.at, q = query.length;
          return (
            <li key={c.name} id={slashOptionId(id, i)} role="option" aria-selected={i === selected} aria-disabled={blocked || undefined}
              className={cls(blocked && 'blocked')}
              onMouseDown={e => { e.preventDefault(); if (!blocked) onPick(i); }} onMouseMove={() => { if (!blocked && i !== selected) onHover(i); }}>
              <span className="slash-name">
                /{at >= 0 && q > 0 ? <>{m.shown.slice(0, at)}<mark>{m.shown.slice(at, at + q)}</mark>{m.shown.slice(at + q)}</> : m.shown}
                {c.argumentHint && <span className="slash-arg"> {c.argumentHint}</span>}
                {m.shown !== c.name && <span className="slash-arg"> · /{c.name}</span>}
              </span>
              <span className={cls('slash-src', c.source === 'project' && 'project')}>{ts.source[c.source]}</span>
              <span className="slash-desc">{blocked ? ts.blocked[c.blocked!] : c.description}</span>
            </li>
          );
        })}
      </ul>
      <div className="slash-foot" aria-hidden="true">
        <span><Kbd>↑↓</Kbd> {ts.choose}</span><span><Kbd>Tab</Kbd> <Kbd>↵</Kbd> {ts.complete}</span><span><Kbd>{t.session.reply.escKey}</Kbd> {ts.close}</span>
      </div>
    </div>
  );
}
