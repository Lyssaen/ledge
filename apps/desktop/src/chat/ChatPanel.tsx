import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { daemonStore, useDaemon, type DaemonClient } from '@ledge/fleet';
import { ChatView } from '@ledge/ui/chat/ChatView';
import { ChatCopyProvider } from '@ledge/ui/chat/copy';
import type { FleetView } from '../fleet/useFleet';
import { chatCopy, useI18n } from '../i18n/lang';
import { useMotionPreferences } from '../motionPreferences';
import { useTheme } from '../shell/theme';
import { useDefaultTool } from '../settings/tool';
import { useAgentHighlight } from './useAgentHighlight';
import { useChatCards } from './useChatCards';

export interface ChatPanelProps {
  client: DaemonClient; view: FleetView;
  /** « Figer les animations »: the mascots stand still, as with reduced motion. */
  paused: boolean;
  /** Changes each time the chat is asked for (/, an open button), even already open: the field takes the focus again. */
  focus?: number;
  onClose(): void; onOpenSession(id: string): void; onLaunched(id: string): void;
}

/** Desktop's Ledge chat, docked on the right (observatory.tsx, `ledge-chat-panel`): the island's ChatView in its docked mode, on
 *  the real fleet. Questions go to the daemon with the default agent (Settings › General); nothing is sent while the local daemon is offline. A name hovered or
 *  focused lights its agent; a session card launches in one click and seats the agent (`onLaunched`); a relay card sends as in the island. */
export function ChatPanel({ client, view, paused, focus, onClose, onOpenSession, onLaunched }: ChatPanelProps): JSX.Element {
  const { t } = useI18n();
  const copy = useMemo(() => chatCopy(t), [t]);
  const theme = useTheme();
  const { reduced } = useMotionPreferences();
  const { chat, chatLive } = useDaemon();
  // The default agent of Settings › General: a change there applies to the next question, the chat open or not.
  const [tool] = useDefaultTool();
  const send = useCallback((m: Parameters<DaemonClient['send']>[0]) => client.send(m), [client]);
  // « En ligne » is the local machine's `ready` (lot 7): until then the field says why it waits.
  const offline = view.machines.find(m => m.id === 'local')?.ready ? null : copy.offline;
  const turnReady = useCallback((qid: string) => !!view.fleet.turnMachine(qid)?.ready, [view.fleet]);
  const turnMachine = useCallback((qid: string) => view.fleet.turnMachine(qid)?.id, [view.fleet]);
  const cards = useChatCards({ send, chat, lastLaunched: view.lastLaunched, errors: view.errors, sessions: view.sessions, turnReady, turnMachine, onLaunched });
  const [hovered, setHovered] = useState<string | null>(null);
  useAgentHighlight(hovered);
  // Every way in (/, the sidebar, the top bar, the footer, Ledge's desk) mounts the panel: the field takes the focus; asked for
  // again while open (/ from the page, the top bar, the footer), it takes it back.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, [focus]);

  const ask = (text: string) => {
    if (offline) return;
    const qid = `q-${crypto.randomUUID()}`;
    daemonStore.beginTurn({ qid, question: text, askedAt: new Date().toISOString(), steps: [] });
    send({ type: 'chat.ask', qid, text, tool });
  };
  // Opening a name opens the agent's page, which closes the chat (the mockup's `open`); the light goes out first.
  const open = (id: string) => { setHovered(null); onOpenSession(id); };

  return (
    // Escape anywhere in the panel, its field included (which keeps Escape from the window's shortcuts, as in the island), closes
    // the chat and nothing else: the window's Escape (leave the page, clear the filter, leave full screen) does not hear it.
    <aside className="ledge-chat-panel" aria-label={t.side.chat} onKeyDownCapture={e => {
      if (e.key !== 'Escape' || e.nativeEvent.isComposing) return;
      e.preventDefault(); e.stopPropagation(); onClose();
    }}>
      <div className="chat-drawer-content">
        <ChatCopyProvider value={copy}>
          <ChatView docked visible turns={chat} live={chatLive} sessions={view.sessions} offline={offline}
            onAsk={ask} onCancel={qid => send({ type: 'chat.cancel', qid })} onReset={() => send({ type: 'chat.reset' })} onBack={onClose} onClose={onClose}
            onOpenSession={open} onTerminal={open} turnAvailable={turnReady}
            launchingQid={cards.launchingQid} onLaunchProposal={cards.launch}
            relayingQid={cards.relayingQid} onRelay={cards.relay} onRelayCancel={cards.cancelRelay}
            onAgentHover={setHovered} inputRef={inputRef}
            theme={theme} frozen={offline !== null} reducedMotion={paused || reduced} />
        </ChatCopyProvider>
      </div>
    </aside>
  );
}
