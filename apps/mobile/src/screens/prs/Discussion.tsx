import { useState } from 'react';
import type { PrDetail, PrThread, PullRequest } from '@ledge/protocol';
import { copy } from '../../copy';
import { href } from '../../router';
import { draftKey, useForge, type ForgeRun, type ForgeStore } from '../../state/forge';
import { useMobile, type MobileStore } from '../../state/store';
import { Icon } from '../../ui/icons';
import { clock } from '../Inbox';
import { Receipt, rigButtonClass } from '../rigs/kit';
import { CheckedButton } from '../rigs/sheets';
import { forgeWords, sessionsOf } from './parts';
import { ForgeRunNote } from './runs';

/*
 * A request's Discussion (m5-mr-pr.html, §6): « 2 ouverts · 1 résolu » and « Tout envoyer à <agent> », each open thread with its line
 * and comments, Répondre (a field in the thread, then the device's check over the exact text), « Envoyer à <agent> » (to the branch's
 * session, no check: it writes on no forge) and Résoudre; the resolved folded; « Ajouter un commentaire… » at the bottom.
 */

const C = copy.prs;

/** Where a thread is: « term/Term.tsx · ligne 88 », or nothing for a comment on the request itself. */
const whereOf = (t: PrThread): string | null => (t.file ? (t.line !== undefined ? C.fileLine(t.file, t.line) : t.file) : null);

/** The last run on `prId` that `match` takes, under way or not dismissed. */
const runOf = (runs: readonly ForgeRun[], prId: string, match: (r: ForgeRun) => boolean): ForgeRun | undefined =>
  runs.filter(r => r.prId === prId && match(r)).at(-1);

/** A run still under way: its buttons wait for its end. */
const GOING: readonly ForgeRun['phase'][] = ['checking', 'sending', 'received'];

type Sent = { id: string; name: string } | 'refused';

/** What a send to the agent left: « Commentaire envoyé à Tom » and « Ouvrir Tom », or why it did not leave. */
function SentNote({ sent, onClose }: { sent: Sent; onClose: () => void }) {
  if (sent === 'refused') return <Receipt mark="bad" title={copy.agents.notSent} onClose={onClose} closeLabel={C.close} />;
  return (
    <Receipt mark="ok" title={C.commentSent(sent.name)} onClose={onClose} closeLabel={C.close}>
      <a href={href({ name: 'thread', sessionId: sent.id })} className={rigButtonClass({ size: 'xs', className: 'mt-1.5' })}>{C.openAgent(sent.name)}</a>
    </Receipt>
  );
}

/** A text for the forge: its field, then the device's check over it and where it goes (« Publié sous ton nom sur GitHub. »). */
function Write({ id, label, placeholder, verb, value, onChange, confirm, live, onPost, host, autoFocus = false }: {
  id: string; label: string; placeholder: string; verb: string; value: string; onChange: (v: string) => void;
  confirm: boolean; live: boolean; onPost: () => void; host: string; autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">{label}</label>
      <textarea
        id={id} rows={2} value={value} placeholder={placeholder} autoFocus={autoFocus} onChange={e => onChange(e.target.value)}
        className="min-h-11 w-full resize-none rounded-[14px] border border-input bg-surface px-3.5 py-[11px] text-base leading-5 text-fg placeholder:text-muted"
      />
      {value.trim() !== '' && (
        <>
          <CheckedButton verb={verb} confirm={confirm} disabled={!live} onClick={onPost} />
          <span className="text-[12px] leading-4 text-muted">{C.postedAs(host)}</span>
        </>
      )}
    </div>
  );
}

/** A comment: who, when, the text; a reply sits under the first, bordered. */
const Comment = ({ who, at, body, reply }: { who: string; at: string; body: string; reply: boolean }) => (
  <p className={`m-0 text-[13.5px] leading-[19px] [overflow-wrap:anywhere] whitespace-pre-wrap ${reply ? 'border-l-2 border-line pl-[9px]' : ''}`}>
    <span className="font-semibold">{who}</span><span className="ml-1 font-mono text-[11px] text-muted">{clock(at)}</span><br />{body}
  </p>
);

const card = 'flex flex-col gap-2 rounded-[10px] border border-line bg-surface p-2.5 dark:bg-transparent';
const small = 'h-9 !px-2.5 text-[12.5px]';

/** An open thread: its line and the diff's, the comments, then Répondre, Envoyer à <agent>, Résoudre (a review thread only). */
function Thread({ pr, t, agent, forge, store, live, pc, readOnly = false }: {
  pr: PullRequest; t: PrThread; agent: { id: string; name: string } | null; forge: ForgeStore; store: MobileStore; live: boolean; pc: string; readOnly?: boolean;
}) {
  const f = useForge(forge);
  const m = useMobile(store);
  const [replying, setReplying] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const key = draftKey(pr.id, t.id);
  const draft = f.drafts[key] ?? '';
  const w = forgeWords(pr);
  const where = whereOf(t);
  const first = t.comments[0]!;
  const run = runOf(f.runs, pr.id, r => (r.action.kind === 'reply' || r.action.kind === 'resolve') && r.action.threadId === t.id);
  const toAgent = () => {
    if (!agent) return;
    setSent(store.reply(agent.id, C.threadText(pr.ref, first.author, where, first.body)) ? agent : 'refused');
  };
  const post = () => { setReplying(false); void forge.act(pr.id, { kind: 'reply', threadId: t.id, body: draft.trim() }); };
  const busy = !!run && GOING.includes(run.phase);
  // A reply not posted keeps its text: the field opens again on it.
  const open = !busy && (replying || (draft !== '' && run?.action.kind === 'reply' && !(run.phase === 'done' && run.done?.ok)));
  return (
    <article data-thread={t.id} className={card}>
      {where && <span className="font-mono text-[11px] text-muted">{where}</span>}
      {t.code && <code className="block truncate rounded-md bg-ok/15 px-2 py-[3px] font-mono text-[11.5px] leading-[17px] whitespace-pre">{t.code}</code>}
      {t.comments.map((c, i) => <Comment key={c.id} who={c.author} at={c.at} body={c.body} reply={i > 0} />)}
      {!readOnly && (
        <>
          {open ? (
            <Write
              id={`reply-${t.id}`} label={C.reply} placeholder={C.replyPh} verb={C.reply} value={draft} onChange={v => forge.setDraft(key, v)}
              confirm={!!m.device?.confirm} live={live} onPost={post} host={w.host} autoFocus={replying}
            />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              <button type="button" disabled={!live || busy} onClick={() => setReplying(true)} className={rigButtonClass({ className: small })}>{C.reply}</button>
              {agent && <button type="button" disabled={!m.fresh} onClick={toAgent} className={rigButtonClass({ className: small })}>{C.sendTo(agent.name)}</button>}
              {t.resolvable && (
                <button type="button" disabled={!live || busy} onClick={() => void forge.act(pr.id, { kind: 'resolve', threadId: t.id })} className={`${rigButtonClass({ className: small })} border-transparent`}>{C.resolve}</button>
              )}
            </div>
          )}
          {sent && <SentNote sent={sent} onClose={() => setSent(null)} />}
          {run && <ForgeRunNote run={run} pr={pr} detail={undefined} forge={forge} pc={pc} />}
        </>
      )}
    </article>
  );
}

/** A resolved thread, folded: « Résolu · term/copy.ts · ligne 12 · reviewer »; a tap reads it. */
function Resolved({ pr, t, forge, store, pc }: { pr: PullRequest; t: PrThread; forge: ForgeStore; store: MobileStore; pc: string }) {
  const [open, setOpen] = useState(false);
  const where = whereOf(t);
  return (
    <>
      <button
        type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} data-thread={t.id}
        className="flex items-center gap-2 rounded-[10px] border border-dashed border-line px-2.5 py-2 text-left text-[12.5px] text-muted"
      >
        <span aria-hidden="true" className="text-ok">✓</span>
        <span className="min-w-0 flex-1 truncate">{C.resolvedRow([...(where ? [where] : []), t.comments[0]!.author])}</span>
        <Icon name={open ? 'down' : 'chevron'} className="size-3.5" />
      </button>
      {open && <Thread pr={pr} t={t} agent={null} forge={forge} store={store} live={false} pc={pc} readOnly />}
    </>
  );
}

/** The Discussion view's list: its head, the open threads, the resolved folded, or « Aucun commentaire. ». */
export function Discussion({ detail, forge, store, live, pc }: { detail: PrDetail; forge: ForgeStore; store: MobileStore; live: boolean; pc: string }) {
  const m = useMobile(store);
  const pr = detail.pr;
  const [sent, setSent] = useState<Sent | null>(null);
  const first = sessionsOf(pr, m.sessions)[0];
  const agent = first ? { id: first.id, name: first.name } : null;
  const open = detail.threads.filter(t => !t.resolved);
  const resolved = detail.threads.filter(t => t.resolved);
  if (!detail.threads.length) return <p className="m-0 p-2.5 text-center text-[12.5px] text-muted">{C.noComment}</p>;
  const sendAll = () => {
    if (!agent) return;
    const notes = open.map(t => C.note(t.comments[0]!.author, whereOf(t), t.comments[0]!.body));
    setSent(store.reply(agent.id, C.notesText(pr.ref, notes)) ? agent : 'refused');
  };
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-[12.5px] text-muted">{C.discSub(open.length, resolved.length)}</span>
        <span className="flex-1" />
        {agent && open.length > 0 && (
          <button type="button" disabled={!m.fresh} onClick={sendAll} className={rigButtonClass({ size: 'sm' })}><Icon name="send" className="size-4" />{C.sendAll(agent.name)}</button>
        )}
      </div>
      {sent && <SentNote sent={sent} onClose={() => setSent(null)} />}
      {open.map(t => <Thread key={t.id} pr={pr} t={t} agent={agent} forge={forge} store={store} live={live} pc={pc} />)}
      {resolved.map(t => <Resolved key={t.id} pr={pr} t={t} forge={forge} store={store} pc={pc} />)}
    </>
  );
}

/** The footer of the Discussion view: « Ajouter un commentaire… », then the device's check over the text (« Publier avec Face ID »). */
export function CommentFoot({ pr, forge, store, live, pc }: { pr: PullRequest; forge: ForgeStore; store: MobileStore; live: boolean; pc: string }) {
  const f = useForge(forge);
  const m = useMobile(store);
  const key = draftKey(pr.id);
  const draft = f.drafts[key] ?? '';
  const run = runOf(f.runs, pr.id, r => r.action.kind === 'comment');
  const busy = !!run && GOING.includes(run.phase);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      {run && <ForgeRunNote run={run} pr={pr} detail={undefined} forge={forge} pc={pc} />}
      <Write
        id={`comment-${pr.id}`} label={C.addComment} placeholder={C.addComment} verb={C.post} value={draft} onChange={v => forge.setDraft(key, v)}
        confirm={!!m.device?.confirm} live={live && !busy} onPost={() => void forge.act(pr.id, { kind: 'comment', body: draft.trim() })} host={forgeWords(pr).host}
      />
    </div>
  );
}
