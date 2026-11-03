import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { UNTYPABLE, type PhoneSlashCommand } from '@ledge/protocol';
import { completed, draftCommand, matchCommands, slashQuery } from '@ledge/ui/slash/match';
import { copy } from '../copy';
import { MESSAGE_MAX, QUICK_REPLIES, type Composer } from '../model/thread';
import type { Op } from '../state/operations';
import { useBusy } from '../useBusy';
import { Notice } from '../ui/Notice';
import type { Attachments } from '../ui/useAttachments';
import { buttonClass, chipClass } from '../ui/Button';
import { MessageField } from '../ui/MessageField';
import { SlashList } from '../ui/SlashList';

const TONE = { ok: 'text-ok', info: 'text-info', approval: 'text-approval', attention: 'text-attention', muted: 'text-muted' } as const;
const C = copy.thread.composer;

/** What stops an instruction from going, checked as the PC checks it, on the text as it will be sent (trimmed). */
export function replyProblem(draft: string): 'long' | 'untypable' | null {
  const text = draft.trim();
  if (text.length > MESSAGE_MAX) return 'long';
  if (UNTYPABLE.test(text)) return 'untypable';
  return null;
}

/** Why an instruction did not go, in words; the draft always stays. */
export function replyFailure(o: Op): { title: string; body: string } {
  if (o.phase === 'uncertain' || o.reason === 'not_taken') return { title: C.uncertainTitle, body: C.uncertain };
  const body = o.reason === 'busy' ? C.busy : o.reason === 'invalid' ? C.invalid(MESSAGE_MAX) : o.reason === 'untypable' ? C.untypable
    : o.reason === 'read_only' ? C.readOnly : o.reason === 'attachment_missing' ? C.imageGone : o.reason === 'attachments_not_accepted' ? copy.images.dialog : C.lost;
  return { title: C.failTitle, body };
}

/**
 * The composer of a thread (boards Continue and Sent): an instruction for an agent that is free, with quick ones. A
 * text the PC would refuse (too long, or not typable on one line) is said so here and never sent.
 */
/** The « / » list of a field: the session's agent, its commands as the PC said (undefined until it answers), and how to ask them. */
export interface ReplySlash { tool: string; listing: { commands: readonly PhoneSlashCommand[]; error?: true } | undefined; ask(): void }

export function Reply({ name, focusAtEnd = false, composer, draft, onDraft, onSend, fresh, taken, checking, error, alert, onReconnect, images, dialog, lead, leadNote, slash }: {
  /** The « / » list, where the agent's commands can be listed; left out, none. */ slash?: ReplySlash | undefined;
  /** Focus the field on open, the cursor after its text (« Répondre » on an OpenRig message). */ focusAtEnd?: boolean;
  /** The chip that opens at the head of the quick row, and the line under the row it may need. */ lead?: ReactNode; leadNote?: ReactNode;
  /** Said above the field instead of `error`: why the session was not closed (the composer is back, the draft kept). */ alert?: ReactNode;
  name: string; composer: Composer; draft: string; onDraft: (t: string) => void; onSend: () => void; fresh: boolean;
  /** The images waiting under the field. */ images: Attachments;
  /** A dialog waits: the images would be refused, they go after the answer. */ dialog: boolean;
  taken: boolean; checking: boolean; error: { title: string; body: string } | null; onReconnect?: (() => void) | undefined;
}) {
  const [busy, setBusy] = useBusy();
  const status = taken ? { tone: 'ok' as const, label: C.status.taken } : checking ? { tone: 'muted' as const, label: copy.decide.checking } : composer.status;
  const problem = replyProblem(draft);
  const ref = useRef<HTMLTextAreaElement>(null);
  const withImages = images.items.length > 0;
  useEffect(() => {
    const el = ref.current;
    if (!focusAtEnd || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // « / » at the head of the draft: the agent's commands in the place of the quick instructions, asked once it is typed.
  const query = slash && composer.enabled && !dialog ? slashQuery(draft) : null;
  const open = query !== null;
  useEffect(() => { if (open) slash?.ask(); }, [open]);
  const commands = slash?.listing?.error ? [] : slash?.listing?.commands ?? [];
  const matches = useMemo(() => (query !== null ? matchCommands(commands, query) : []), [query, commands]);
  const chosen = slash && !dialog ? draftCommand(draft, commands) as PhoneSlashCommand | undefined : undefined;
  const pick = (c: PhoneSlashCommand) => { onDraft(completed(c)); ref.current?.focus(); };
  // Once completed: the arguments it takes under the field, or why it will not go as it is.
  const commandNote = !chosen || query !== null ? null
    : chosen.blocked ? { warn: true, text: copy.thread.slash.blocked[chosen.blocked]! }
    : chosen.bare && /^\/\S+\s*$/.test(draft) ? { warn: true, text: copy.thread.slash.bare(chosen.name) }
    : chosen.argumentHint ? { warn: false, text: `/${chosen.name} ${chosen.argumentHint}` } : null;
  // Text or images; an image still uploading, or refused, holds the send back.
  const canSend = composer.enabled && (!!draft.trim() || withImages) && problem === null && images.ready && !(withImages && dialog);
  return (
    <footer className="flex-none border-t border-line bg-bg pt-2 pb-3 [@media(max-height:650px)]:pb-2">
      <div className={`flex items-center gap-1.5 pb-2 text-meta ${TONE[status.tone]}`}><i className="inline-block size-1.5 flex-none rounded-full bg-current" />{status.label}</div>
      {alert && <div className="mb-2.5">{alert}</div>}
      {!alert && error && (
        <div className="mb-2.5">
          <Notice title={error.title} tone="warning" role="alert">
            <p>{error.body}</p>
            {!fresh && onReconnect && (
              <button type="button" disabled={busy} onClick={() => { setBusy(true); onReconnect(); }} className={buttonClass({ block: true, className: 'mt-2' })}>
                {busy ? copy.link.reconnecting : C.reconnect}
              </button>
            )}
          </Notice>
        </div>
      )}
      {open && <SlashList listing={slash!.listing} query={query} matches={matches} tool={slash!.tool} name={name} onPick={pick} />}
      {!open && (composer.enabled || lead) && (
        <div role="group" aria-label={C.quickLabel} className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none]">
          {lead}
          {composer.enabled && QUICK_REPLIES.map(q => (
            <button key={q} type="button" onClick={() => { onDraft(q); ref.current?.focus(); }} className={`${chipClass()} whitespace-nowrap`}>{q}</button>
          ))}
        </div>
      )}
      {leadNote}
      <MessageField
        id="draft" label={C.label(name)} sendLabel={C.send(name)} value={draft} onChange={onDraft} onSend={onSend} canSend={canSend}
        oneLine images={images} placeholder={composer.placeholder} disabled={!composer.enabled} fieldRef={ref}
        invalid={problem !== null} describedBy={problem ? 'draft-problem' : undefined}
      />
      {commandNote && <p role="status" className={`pt-1.5 text-meta ${commandNote.warn ? 'text-attention' : 'font-mono text-muted'}`}>{commandNote.text}</p>}
      {withImages && dialog && <p role="status" className="pt-1.5 text-meta text-attention">{copy.images.dialog}</p>}
      {images.error && <p role="alert" className="pt-1.5 text-meta text-attention">{images.error}</p>}
      {problem && <p id="draft-problem" role="status" className="pt-1.5 text-meta text-attention">{problem === 'long' ? C.tooLong(MESSAGE_MAX) : C.untypable}</p>}
    </footer>
  );
}
