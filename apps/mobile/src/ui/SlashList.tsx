import type { PhoneSlashCommand } from '@ledge/protocol';
import type { SlashMatch } from '@ledge/ui/slash/match';
import { copy } from '../copy';

const C = copy.thread.slash;

/**
 * The « / » list above the phone's field (mockup docs/mockups/ledge-slash-commands.html, A): in the place of the quick
 * instructions, the commands of the session's agent that match what is typed, 52 px rows for the thumb. A tap completes
 * the draft as `/name `; a command Ledge does not send is shown with its reason and cannot be tapped.
 */
export function SlashList({ listing, query, matches, tool, name, onPick }: {
  /** Undefined until the PC answers. */ listing: { commands: readonly PhoneSlashCommand[]; error?: true } | undefined;
  query: string; matches: readonly SlashMatch[];
  /** The agent's name (« Claude Code ») and the session's (« Otto »). */ tool: string; name: string;
  onPick(command: PhoneSlashCommand): void;
}) {
  const box = 'mb-2 overflow-hidden rounded-2xl border border-line bg-surface';
  if (!listing) return <div className={`${box} px-3 py-3 text-meta text-muted`} role="status">{C.loading(tool)}</div>;
  if (listing.error) return <div className={`${box} px-3 py-3 text-meta text-muted`} role="status">{C.unavailable(name)}</div>;
  if (matches.length === 0) return <div className={`${box} px-3 py-3 text-meta text-muted`} role="status">{C.none(`/${query}`, name)}</div>;
  return (
    <div className={box}>
      <p className="px-3 pt-2 pb-1 text-meta text-muted">{C.count(tool, matches.length)}</p>
      <ul aria-label={C.label(tool)} className="max-h-[300px] overflow-y-auto overscroll-contain px-1 pb-1">
        {matches.map(m => {
          const c = m.command as PhoneSlashCommand;
          const blocked = c.blocked !== undefined;
          const q = query.length;
          const tag = C.source[c.source];
          return (
            <li key={c.name} className="border-t border-line first:border-t-0">
              <button
                type="button" disabled={blocked} onMouseDown={e => e.preventDefault()} onClick={() => onPick(c)}
                className="flex min-h-[52px] w-full flex-col justify-center rounded-[10px] px-2.5 py-1.5 text-left enabled:active:bg-raised"
              >
                <span className={`font-mono text-[14px] leading-5 ${blocked ? 'text-muted' : ''}`}>
                  /{m.at >= 0 && q > 0 ? <>{m.shown.slice(0, m.at)}<mark className="bg-transparent font-semibold text-fg underline underline-offset-2">{m.shown.slice(m.at, m.at + q)}</mark>{m.shown.slice(m.at + q)}</> : m.shown}
                  {c.argumentHint && <span className="text-[12px] text-muted"> {c.argumentHint}</span>}
                  {tag && <span className={`ml-1.5 font-sans text-[10.5px] ${c.source === 'project' ? 'text-info' : 'text-muted'}`}>{tag}</span>}
                </span>
                <span className={`truncate text-[12px] leading-4 ${blocked ? 'text-attention' : 'text-muted'}`}>{blocked ? C.blocked[c.blocked!] : c.description}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
