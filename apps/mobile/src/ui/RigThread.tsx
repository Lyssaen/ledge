import { useState, type ReactNode } from 'react';
import { Bot } from '@ledge/ui/bots/Bot';
import { poseFor } from '@ledge/ui/bots/poseFor';
import { copy } from '../copy';
import type { RigElement, RigRaw, RigWho } from '../model/rigThread';
import { href } from '../router';
import { prefillDraft } from '../state/drafts';
import { useTheme } from '../theme';
import { Icon } from './icons';

/**
 * OpenRig's elements in a seat's thread (docs/mockups/openrig-messages, « Téléphone »): the sender's bubble, the
 * violet card of a queue row, a quiet notice line. Full width; the raw text one tap away under each.
 */

const R = copy.thread.rig;
const LINK = 'inline-flex items-center gap-1 whitespace-nowrap text-small text-muted';
const STRONG = 'inline-flex items-center gap-1 whitespace-nowrap text-small font-medium text-fg';
const RAWBOX = 'mt-1.5 rounded-[6px] border border-line bg-well px-2.5 py-2 font-mono text-meta whitespace-pre-wrap text-muted [overflow-wrap:anywhere]';
const Cut = () => <div className="text-meta text-muted">{copy.thread.cut}</div>;

/** The seat's mascot, small, when its Ledge session is known. */
function SeatBot({ session }: { session: NonNullable<RigWho['session']> }) {
  const theme = useTheme();
  const state = session.state === 'exited' ? 'done' : session.state === 'waiting_input' ? 'question' : session.state === 'waiting_permission' ? 'approval' : session.state;
  return <span className="inline-flex flex-none" aria-hidden="true"><Bot tool={session.tool} seed={session.id} state={state} pose={poseFor(session.id, state)} size={16} theme={theme} frozen /></span>;
}

function Who({ lead, who, children }: { lead: string; who: RigWho; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-meta leading-5 font-medium text-muted">
      <span>{lead}</span>
      {who.session && <SeatBot session={who.session} />}
      <strong className="font-semibold text-fg">{who.name}</strong>
      {who.seat && <span className="font-mono font-normal">{who.seat}</span>}
      {children}
    </div>
  );
}

/** « Brut » and the raw it unfolds. */
function useRaw(raw: RigRaw | undefined) {
  const [open, setOpen] = useState(false);
  const toggle = raw && (
    <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className={LINK}>{raw.label}</button>
  );
  const box = raw && open && <pre className={RAWBOX}>{raw.text}</pre>;
  return { toggle, box };
}

function Message({ e, storage }: { e: Extract<RigElement, { kind: 'rig-message' }>; storage?: Storage | undefined }) {
  const { toggle, box } = useRaw(e.raw);
  const out = e.dir === 'out';
  const delivery = e.delivery && R.sent[e.delivery];
  return (
    <div className={`flex flex-col gap-1 ${out ? 'items-end' : 'items-start'}`}>
      <article
        aria-label={out ? `${R.to} ${e.who.name}` : `${R.from} ${e.who.name}`}
        className={`flex max-w-[92%] min-w-0 flex-col gap-1 px-3.5 py-2.5 ${out ? 'rounded-2xl rounded-br-[4px] bg-raised' : 'rounded-2xl rounded-bl-[4px] border border-line bg-surface'}`}
      >
        <Who lead={out ? R.to : R.from} who={e.who}>
          {e.count && <span className="inline-flex h-[18px] items-center rounded-full bg-attention/12 px-1.5 text-[10.5px] text-attention">{R.twice(e.count)}</span>}
          {out && delivery && <><span className="flex-1" /><span className={e.delivery === 'failed' ? 'text-attention' : ''}>{delivery}</span></>}
        </Who>
        <div className="text-body whitespace-pre-wrap [overflow-wrap:anywhere]">{e.text}</div>
        {(e.reply || toggle) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-3">
            {e.reply && (
              <a href={href({ name: 'thread', sessionId: e.reply.sessionId })} onClick={() => prefillDraft(e.reply!.sessionId, e.reply!.draft, storage)}
                aria-label={R.replyTo(e.who.name)} className={STRONG}>
                <Icon name="reply" className="size-3.5" />{R.reply}
              </a>
            )}
            {toggle}
          </div>
        )}
        {box}
      </article>
      {e.cut && <Cut />}
    </div>
  );
}

function Task({ e }: { e: Extract<RigElement, { kind: 'rig-task' }> }) {
  const { toggle, box } = useRaw(e.raw);
  return (
    <div className="flex flex-col gap-1">
      <section aria-label={e.outgoing ? R.rowOut(e.who.name) : R.rowIn(e.who.name)}
        className="flex w-full flex-col gap-1.5 rounded-[10px] border border-l-[3px] border-task/35 border-l-task bg-surface px-3.5 py-2.5">
        <div className="flex items-center gap-1.5 text-small font-medium text-task">
          <Icon name="task" className="size-3.5" />
          <span className="min-w-0 truncate">{e.outgoing ? R.rowOut(e.who.name) : R.rowIn(e.who.name)}</span>
          <span className="flex-1" />
          {e.refused
            ? <span className="inline-flex h-5 items-center rounded-full bg-danger-bg px-2 text-meta font-medium whitespace-nowrap text-danger-fg">{R.rowState.refused}</span>
            : <span className="inline-flex h-5 items-center rounded-full border border-dashed border-line px-2 text-meta font-medium whitespace-nowrap text-muted">{R.rowState.unknown}</span>}
        </div>
        <h4 className="line-clamp-2 text-[0.90625rem] leading-[1.3125rem] font-semibold [overflow-wrap:anywhere]">{e.title}</h4>
        {e.refused && <p className="text-small text-muted [overflow-wrap:anywhere]">{e.refused.log}</p>}
        {toggle && <div className="flex items-center border-t border-dashed border-line pt-1.5"><span className="flex-1" />{toggle}</div>}
        {box}
      </section>
      {e.cut && <Cut />}
    </div>
  );
}

function NoticeLine({ e }: { e: Extract<RigElement, { kind: 'rig-notice' }> }) {
  const { toggle, box } = useRaw(e.raw);
  const border = e.tone === 'warn' ? 'border-l-attention' : e.tone === 'task' ? 'border-l-task' : 'border-l-line';
  return (
    <div role="note" className={`min-w-0 border-l-2 ${border} py-0.5 pl-2.5 text-small leading-5 text-muted`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[10px] font-medium tracking-[.04em] uppercase ${e.tone === 'task' ? 'text-task' : ''}`}>{R.openrig}</span>
        <span className={`min-w-0 font-medium [overflow-wrap:anywhere] ${e.tone === 'warn' ? 'text-attention' : 'text-fg'}`}>{e.title}</span>
        <span className="flex-1" />
        {toggle}
      </div>
      {box}
      {e.cut && <Cut />}
    </div>
  );
}

function Fold({ e }: { e: Extract<RigElement, { kind: 'rig-fold' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex items-center gap-1.5 py-0.5 text-left text-small text-muted">
        <span className={`inline-flex transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}><Icon name="chevron" className="size-3.5" /></span>
        <strong className="font-medium text-fg">{R.folded(e.notices.length)}</strong>
      </button>
      {open && e.notices.map(n => <NoticeLine key={n.key} e={n} />)}
    </div>
  );
}

function Unreadable({ e }: { e: Extract<RigElement, { kind: 'rig-unreadable' }> }) {
  return (
    <div className="flex flex-col gap-1 border-l-2 border-dashed border-line pl-2.5">
      <div className="text-meta leading-5 font-medium text-muted">{R.unreadable}</div>
      <pre className={RAWBOX.replace('mt-1.5 ', '')}>{e.text}</pre>
      {e.cut && <Cut />}
    </div>
  );
}

export function RigItem({ e, storage }: { e: RigElement; storage?: Storage | undefined }) {
  switch (e.kind) {
    case 'rig-message': return <Message e={e} storage={storage} />;
    case 'rig-task': return <Task e={e} />;
    case 'rig-notice': return <NoticeLine e={e} />;
    case 'rig-fold': return <Fold e={e} />;
    case 'rig-unreadable': return <Unreadable e={e} />;
  }
}
