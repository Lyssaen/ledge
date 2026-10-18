import { lazy, Suspense, type JSX } from 'react';
import { ChunkBoundary } from '../shell/ChunkBoundary';
import type { ChatPanelProps } from './ChatPanel';

type ChatModule = typeof import('./ChatPanel');
type Loaded = { default: ChatModule['ChatPanel'] };
let loaded: ChatModule | undefined;

/** Fetches the Ledge chat's chunk (the panel, the shared ChatView and its cards): kept apart from the shell so the first bundle
 *  stays small. Once it is there, the panel renders at once (see Panel). */
export function loadChat(): Promise<ChatModule> {
  return loaded ? Promise.resolve(loaded) : import('./ChatPanel').then(m => (loaded = m));
}

// A chunk already loaded is handed over synchronously: React.lazy then resolves within the same render, without suspending.
const Panel = lazy(() => (loaded
  ? { then: (ok: (m: Loaded) => void) => ok({ default: loaded!.ChatPanel }) } as PromiseLike<Loaded> as Promise<Loaded>
  : loadChat().then(m => ({ default: m.ChatPanel }))));

/** The docked chat, behind a sober wait (the empty column) the first time its chunk is fetched; a chunk that fails to load leaves a note (ChunkBoundary). */
export function ChatPlace(props: ChatPanelProps & { label: string }): JSX.Element {
  const { label, ...rest } = props;
  return (
    <ChunkBoundary around={note => <aside className="ledge-chat-panel" aria-label={label}>{note}</aside>}>
      <Suspense fallback={<aside className="ledge-chat-panel" aria-label={label} aria-busy="true" />}><Panel {...rest} /></Suspense>
    </ChunkBoundary>
  );
}
