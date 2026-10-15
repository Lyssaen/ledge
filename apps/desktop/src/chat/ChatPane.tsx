import { useState } from 'react';
import { groupSessions, type MachineState } from '@ledge/fleet';
import type { Session } from '@ledge/protocol';
import { ResidentMascot } from '@ledge/ui';
import { useI18n } from '../i18n/lang';
import { useTheme } from '../shell/theme';
import { ComposerForm } from '../conversation/ComposerForm';
import { useReadingPosition } from '../conversation/useReadingPosition';
import type { Conversations } from '../conversation/useConversations';
import { ChatTurnView } from './ChatTurn';
import { CHAT_ID } from './turns';
import type { ChatApi } from './useChat';

const IDS = { form: 'ledge-chat-form', field: 'ledge-chat-reply', hint: 'ledge-reply-hint' };

export interface ChatPaneProps {
  chat: ChatApi;
  api: Pick<Conversations, 'draft' | 'setDraft' | 'pref' | 'setPref'>;
  sessions: readonly Session[];
  machines: readonly MachineState[];
  localDown: boolean;
  expanded: boolean;
  onExpand: (on: boolean) => void;
  onOpenSession: (id: string) => void;
}

/** « Parler à Ledge » (spec §9.3; mockup ledge-chat.js): the conversation pane without a session. Never `data-session` (views count
 *  those) nor `data-conversation` (the agents' pane). Draft and reading position under `ledge`, through the conversations' only writer. */
export function ChatPane(p: ChatPaneProps) {
  const { t } = useI18n();
  const c = t.chat;
  const theme = useTheme();
  const { chat } = p;
  const [refused, setRefused] = useState(false);
  const draft = p.api.draft(CHAT_ID);
  const lastTurn = chat.turns.at(-1);
  const tail = `${chat.turns.length}|${lastTurn?.qid ?? ''}|${lastTurn?.steps.length ?? 0}|${lastTurn?.answeredAt ?? lastTurn?.error ?? ''}|${chat.live?.text.length ?? 0}`;
  const { ref, onScroll } = useReadingPosition(CHAT_ID, p.api, true, tail);
  const lost = p.machines.filter(m => m.id !== 'local' && m.status === 'unreachable').map(m => m.label);
  const projects = groupSessions([...p.sessions]).length;
  const hint = p.localDown ? c.composer.readonly : refused ? c.composer.refused : chat.running ? c.composer.busy : c.composer.hint;
  const send = () => {
    if (chat.ask(draft)) { p.api.setDraft(CHAT_ID, ''); setRefused(false); } else setRefused(true);
  };

  return (
    <aside id="conversation-pane" className="detail conversation ledge-chat" data-ledge-chat aria-label={c.label}>
      <header className="conversation-header">
        <div className="conversation-top">
          <span>{c.eyebrow}</span>
          <button type="button" data-expand-conversation aria-expanded={p.expanded} onClick={() => p.onExpand(!p.expanded)}>{p.expanded ? t.conversation.collapse : t.conversation.expand}</button>
        </div>
        <div className="ledge-chat-identity">
          <span aria-hidden="true"><ResidentMascot size={40} theme={theme} frozen={p.localDown} gestureKey={chat.running?.steps.length} gestureKind="pulse" /></span>
          <div>
            <h3>Ledge<span>.</span></h3>
            <p>{c.identity(p.sessions.length, projects)}</p>
          </div>
          <button type="button" className="settings-button ledge-chat-reset" disabled={p.localDown || !!chat.running || !!chat.card || chat.turns.length === 0} onClick={chat.reset}>{c.reset}</button>
        </div>
        <p className="ledge-chat-purpose">{c.purpose}</p>
      </header>
      {p.localDown ? <div className="conversation-offline" role="status">{c.readonly}</div>
        : lost.length > 0 ? <div className="conversation-offline" role="status">{c.frozen(lost.join(', '))}</div> : null}
      <section ref={ref} className="thread-scroll" tabIndex={0} aria-label={c.thread} onScroll={onScroll}>
        <div className="thread-content">
          {chat.turns.length === 0 ? (
            <div className="ledge-chat-welcome">
              <span aria-hidden="true"><ResidentMascot size={64} theme={theme} frozen={p.localDown} /></span>
              <h3>{c.welcome.title}</h3>
              <p>{c.welcome.text}</p>
            </div>
          ) : chat.turns.map((tr, i) => (
            <ChatTurnView key={tr.qid} turn={tr} last={i === chat.turns.length - 1} chat={chat} sessions={p.sessions} machines={p.machines} onOpenSession={p.onOpenSession} />
          ))}
          <div className="ledge-starters" role="group" aria-label={c.starters.label}>
            {c.starters.items.map(s => <button key={s} type="button" disabled={!chat.canAsk} onClick={() => chat.ask(s)}>{s}</button>)}
          </div>
        </div>
      </section>
      <ComposerForm ids={IDS} label={c.composer.label} placeholder={c.composer.placeholder} send={c.composer.send} hint={hint}
        value={draft} frozen={p.localDown} canSend={chat.canAsk}
        onChange={text => { setRefused(false); p.api.setDraft(CHAT_ID, text); }} onSend={send} />
    </aside>
  );
}
