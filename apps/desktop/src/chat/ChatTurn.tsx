import { Fragment } from 'react';
import type { MachineState } from '@ledge/fleet';
import { hideProposal, type ChatStep, type ChatTurn, type Session } from '@ledge/protocol';
import { useI18n, type Messages } from '../i18n/lang';
import { LaunchCard } from './LaunchCard';
import { RelayCard } from './RelayCard';
import { answerBlocks, cardKind, isRunning, mentionable, turnLinks, type Inline } from './turns';
import type { ChatApi } from './useChat';

type ChatTexts = Messages['chat'];
const stepLabel = (s: ChatStep, c: ChatTexts): string =>
  s.kind === 'sessions' ? c.step.sessions : s.kind === 'repo' ? c.step.repo(s.path ?? '') : c.step[s.kind](s.name ?? s.id ?? '');
const sourceLabel = (s: ChatStep, c: ChatTexts): string =>
  s.kind === 'sessions' ? c.source.sessions : s.kind === 'repo' ? c.source.repo(s.path ?? '') : c.source[s.kind](s.name ?? s.id ?? '');

function Inlines({ parts, onOpen }: { parts: Inline[]; onOpen: (id: string) => void }) {
  return <>{parts.map((p, i) =>
    p.kind === 'text' ? <Fragment key={i}>{p.text}</Fragment>
    : p.kind === 'strong' ? <strong key={i}>{p.text}</strong>
    : p.kind === 'code' ? <code key={i}>{p.text}</code>
    : <button key={i} type="button" className="ledge-inline-session" data-ledge-mention={p.id} onClick={() => onOpen(p.id)}>{p.name}</button>)}</>;
}

function Answer({ text, names, onOpen }: { text: string; names: ReadonlyMap<string, string>; onOpen: (id: string) => void }) {
  return (
    <div className="ledge-answer">
      {answerBlocks(text, names).map((b, i) =>
        b.kind === 'h' ? <h4 key={i}><Inlines parts={b.text} onOpen={onOpen} /></h4>
        : b.kind === 'ul' ? <ul key={i}>{b.items.map((it, j) => <li key={j}><Inlines parts={it} onOpen={onOpen} /></li>)}</ul>
        : <p key={i}>{b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inlines parts={l} onOpen={onOpen} /></Fragment>)}</p>)}
    </div>
  );
}

export interface ChatTurnProps { turn: ChatTurn; last: boolean; chat: ChatApi; sessions: readonly Session[]; machines: readonly MachineState[]; onOpenSession: (id: string) => void }

/** One question to Ledge and what came of it (spec §9.3; the island's ChatView): the steps while it reads, the answer as it comes,
 *  the machines to choose on a clarification (last turn only), the destination, the card, the sessions it mentions, its sources,
 *  and Cancel while it runs. Errors and cancellations are statuses, never alerts. */
export function ChatTurnView({ turn: tr, last, chat, sessions, machines, onOpenSession }: ChatTurnProps) {
  const { t, lang } = useI18n();
  const c = t.chat;
  const running = isRunning(tr);
  const live = running && chat.live?.qid === tr.qid ? hideProposal(chat.live.text) : '';
  const answer = tr.answer || live;
  const kind = cardKind(tr);
  const available = chat.available(tr.qid);
  const busy = chat.card?.qid === tr.qid;
  const disabled = !available || (chat.card !== null && !busy);
  const machineLabel = machines.find(m => m.id === tr.machineId)?.label ?? tr.machineName;
  const cardError = kind === 'launch' ? tr.proposal?.error : kind === 'relay' ? tr.relay?.error : undefined;
  const note = chat.note?.qid === tr.qid && chat.note.message !== cardError ? chat.note.message : null;
  const links = turnLinks(tr, sessions);
  const names = mentionable(tr, sessions);
  const find = (id: string | undefined) => (id ? sessions.find(s => s.id === id) : undefined);
  const sources = [...new Set(tr.steps.map(s => sourceLabel(s, c)))];
  const time = tr.answeredAt ? new Date(tr.answeredAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="ledge-turn" data-turn={tr.qid}>
      <article className="thread-message user"><div className="message-author">{t.conversation.thread.you}</div><p>{tr.question}</p></article>
      {tr.error === 'cancelled' ? <p className="thread-notice" role="status">{c.stopped}</p>
      : tr.error !== undefined ? <p className="thread-notice ledge-error" role="status">{c.error(tr.error)}</p>
      : (
        <article className="thread-message agent">
          <div className="message-author">{c.author}</div>
          {running && !answer && (
            <ul className="ledge-steps" aria-live="polite">
              {tr.steps.length === 0 ? <li>{c.thinking}</li>
                : tr.steps.map((s, i) => <li key={i} data-step={s.kind}>{i < tr.steps.length - 1 && <span aria-hidden="true">✓ </span>}{stepLabel(s, c)}</li>)}
            </ul>
          )}
          {answer && <Answer text={answer} names={names} onOpen={onOpenSession} />}
          {last && tr.choices && tr.choices.length > 0 && <>
            <div className="ledge-choices" role="group" aria-label={c.choices}>
              {tr.choices.map(ch => <button key={ch.id} type="button" className="settings-button" disabled={!chat.canAsk} onClick={() => chat.ask(c.choose(ch.label))}>{ch.label}</button>)}
            </div>
            <small className="ledge-clarification">{c.clarification}</small>
          </>}
          {kind && machineLabel && <p className="ledge-destination">{c.destination(machineLabel)}{!available && ` · ${c.unavailable}`}</p>}
          {kind === 'relay' && <RelayCard relay={tr.relay!} session={find(tr.relay!.id)} busy={busy} disabled={disabled} onSend={() => chat.relay(tr.qid)} onCancel={() => chat.relayCancel(tr.qid)} />}
          {kind === 'launch' && <LaunchCard proposal={tr.proposal!} session={find(tr.proposal!.launchedId)} busy={busy} disabled={disabled} onLaunch={() => chat.launch(tr.qid)} />}
          {note && <p className="ledge-card-error" role="status">{note}</p>}
          {links.length > 0 && (
            <div className="ledge-session-links" role="group" aria-label={c.links}>
              {links.map(l => <button key={l.id} type="button" data-ledge-session={l.id} disabled={!l.live} onClick={() => onOpenSession(l.id)}>{c.open(l.name)}<span aria-hidden="true"> ↗</span></button>)}
            </div>
          )}
          {tr.answeredAt && <small className="ledge-source">{c.sourcesLine(sources.length ? sources.join(', ') : c.sourcesNone, time)}</small>}
          {running && <button type="button" className="settings-button ledge-stop" aria-label={c.stopLabel} disabled={!chat.canCancel} onClick={chat.cancel}>{c.stop}</button>}
        </article>
      )}
    </div>
  );
}
