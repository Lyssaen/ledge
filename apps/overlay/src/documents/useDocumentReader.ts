import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentContent, DocumentErrorCode, ServerMessage } from '@ledge/protocol';
import type { DaemonClient, DaemonStatus } from '../daemon/client';
import type { DocumentReference } from './references';

export type DocumentOrigin = { kind: 'session'; sessionId: string } | { kind: 'chat' };
export interface ReadingEntry {
  reference: DocumentReference; document?: DocumentContent;
  error?: DocumentErrorCode | 'timeout' | 'offline';
  loading: boolean; scroll: number; sourceScroll: number; raw: boolean;
}
export interface ReaderState { origin: DocumentOrigin | null; stack: ReadingEntry[]; current: ReadingEntry | null }
const entry = (reference: DocumentReference): ReadingEntry => ({ reference, loading: true, scroll: 0, sourceScroll: 0, raw: !!reference.line });
const current = (stack: ReadingEntry[]) => stack.at(-1) ?? null;

/** The socket reply is correlated to the active request, never broadcast into the session store. */
export function useDocumentReader({ client, onExit }: { client: DaemonClient; onExit: (origin: DocumentOrigin) => void }) {
  const [state, setState] = useState<ReaderState>({ origin: null, stack: [], current: null });
  const stateRef = useRef(state); stateRef.current = state;
  const active = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sequence = useRef(0);
  const status = useRef<DaemonStatus>(client.status());
  const publish = useCallback((next: ReaderState) => { stateRef.current = next; setState(next); }, []);
  const replaceTop = useCallback((patch: Partial<ReadingEntry>) => {
    const old = stateRef.current;
    if (!old.stack.length) return;
    const stack = [...old.stack]; stack[stack.length - 1] = { ...stack[stack.length - 1]!, ...patch };
    publish({ origin: old.origin, stack, current: current(stack) });
  }, [publish]);
  const cancel = useCallback(() => { active.current = null; clearTimeout(timer.current); }, []);
  const request = useCallback((reference: DocumentReference, origin: DocumentOrigin, basePath?: string) => {
    cancel();
    if (status.current !== 'open') { replaceTop({ loading: false, error: 'offline' }); return; }
    const requestId = `document-${Date.now()}-${++sequence.current}`;
    active.current = requestId;
    client.send({ type: 'document.read', requestId, path: reference.path,
      ...(basePath ? { basePath } : origin.kind === 'session' ? { sessionId: origin.sessionId } : {}) });
    timer.current = setTimeout(() => { if (active.current === requestId) { active.current = null; replaceTop({ loading: false, error: 'timeout' }); } }, 10_000);
  }, [cancel, client, replaceTop]);
  useEffect(() => {
    const offMessage = client.onMessage((m: ServerMessage) => {
      if ((m.type !== 'document.content' && m.type !== 'document.error') || m.requestId !== active.current) return;
      cancel();
      if (m.type === 'document.content') replaceTop({ document: m, loading: false, error: undefined });
      else replaceTop({ loading: false, error: m.code });
    });
    const offStatus = client.onStatus(s => {
      status.current = s;
      if (s !== 'open' && active.current) { cancel(); replaceTop({ loading: false, error: 'offline' }); }
    });
    return () => { cancel(); offMessage(); offStatus(); };
  }, [cancel, client, replaceTop]);
  const open = useCallback((reference: DocumentReference, origin: DocumentOrigin) => {
    const stack = [entry(reference)]; publish({ origin, stack, current: current(stack) }); request(reference, origin);
  }, [publish, request]);
  const follow = useCallback((reference: DocumentReference) => {
    const old = stateRef.current; if (!old.origin || !old.current?.document) return;
    const stack = [...old.stack, entry(reference)]; publish({ origin: old.origin, stack, current: current(stack) });
    request(reference, old.origin, old.current.document.path);
  }, [publish, request]);
  const back = useCallback(() => {
    const old = stateRef.current; if (!old.origin) return;
    cancel();
    if (old.stack.length > 1) { const stack = old.stack.slice(0, -1); publish({ origin: old.origin, stack, current: current(stack) }); }
    else { publish({ origin: null, stack: [], current: null }); onExit(old.origin); }
  }, [cancel, onExit, publish]);
  const close = useCallback(() => { cancel(); publish({ origin: null, stack: [], current: null }); }, [cancel, publish]);
  const reload = useCallback(() => {
    const old = stateRef.current; if (!old.origin || !old.current || status.current !== 'open') return;
    replaceTop({ loading: true, error: undefined });
    request(old.current.reference, old.origin, old.stack.length > 1 ? old.stack.at(-2)?.document?.path : undefined);
  }, [replaceTop, request]);
  const setReading = useCallback((patch: Pick<ReadingEntry, 'scroll' | 'raw'> | Partial<Pick<ReadingEntry, 'scroll' | 'sourceScroll' | 'raw'>>) => replaceTop(patch), [replaceTop]);
  return { state, origin: state.origin, canGoBack: state.stack.length > 1, open, follow, back, close, reload, setReading };
}
