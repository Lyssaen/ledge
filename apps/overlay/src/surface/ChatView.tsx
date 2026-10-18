import { useMemo } from 'react';
import { ChatView as SharedChatView, type ChatViewProps } from '@ledge/ui/chat/ChatView';
import { ChatCopyProvider } from '@ledge/ui/chat/copy';
import { MarkdownLinks } from '@ledge/ui/documents/links';
import { chatCopy, useI18n } from '../i18n/lang';
import { openUrl } from '../tauri/bridge';
export { CHAT_HEADER_H, CHAT_COMPOSER_H, type ChatViewProps } from '@ledge/ui/chat/ChatView';

/** The shared Ledge chat with the island's words (its active language) and its browser opener. */
export function ChatView(p: ChatViewProps) {
  const { t } = useI18n();
  const copy = useMemo(() => chatCopy(t), [t]);
  return <ChatCopyProvider value={copy}><MarkdownLinks.Provider value={openUrl}><SharedChatView {...p} /></MarkdownLinks.Provider></ChatCopyProvider>;
}
