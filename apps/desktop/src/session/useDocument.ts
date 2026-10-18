import { useEffect, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { DocumentErrorCode } from '@ledge/protocol';
import { splitMarkdownFrontmatter } from '@ledge/ui/documents/markdown';

export type DocState = { status: 'loading' } | { status: 'ready'; text: string; title?: string } | { status: 'error'; code: DocumentErrorCode | 'offline' | 'timeout' };
/** A document that has not come by then is said not to come (the overlay's reader waits as long). */
export const DOCUMENT_TIMEOUT_MS = 10_000;

const LOADING: DocState = { status: 'loading' };
const OFFLINE: DocState = { status: 'error', code: 'offline' };
let sequence = 0;

/** `document.read` correlated by requestId (the overlay's useDocumentReader, reduced to one document): the reply to the
 *  request in flight counts, any other is ignored; no reply within DOCUMENT_TIMEOUT_MS is a 'timeout'. The machine offline
 *  is an 'offline' error, nothing sent; the daemon not connected (or dropping the request) too, until it connects again:
 *  then the document is read. Another path asks again, and shows loading until its own reply. */
export function useDocument(client: DaemonClient, sessionId: string, path: string, online: boolean): DocState {
  const key = `${sessionId}\n${path}\n${online}`;
  // The state of the request for `key`: a render for another key shows loading until its effect has asked.
  const [state, setState] = useState<{ key: string; doc: DocState }>({ key: '', doc: LOADING });
  useEffect(() => {
    if (!online) { setState({ key, doc: OFFLINE }); return; }
    let requestId: string | null = null;
    // The daemon answered (the document or its error): a reconnection does not ask again.
    let answered = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (doc: DocState) => { requestId = null; clearTimeout(timer); setState({ key, doc }); };
    const read = () => {
      const id = `document-${Date.now()}-${++sequence}`;
      requestId = id;
      setState({ key, doc: LOADING });
      timer = setTimeout(() => { if (requestId === id) settle({ status: 'error', code: 'timeout' }); }, DOCUMENT_TIMEOUT_MS);
      client.send({ type: 'document.read', requestId: id, path, sessionId });
    };
    const offMessage = client.onMessage(m => {
      if ((m.type !== 'document.content' && m.type !== 'document.error') || requestId === null || m.requestId !== requestId) return;
      answered = true;
      if (m.type === 'document.error') { settle({ status: 'error', code: m.code }); return; }
      const { title } = splitMarkdownFrontmatter(m.text);
      settle({ status: 'ready', text: m.text, ...(title !== undefined && { title }) });
    });
    const offStatus = client.onStatus(s => {
      if (s === 'open') { if (requestId === null && !answered) read(); }
      else if (requestId !== null) settle(OFFLINE);
    });
    if (client.status() === 'open') read(); else setState({ key, doc: OFFLINE });
    return () => { requestId = null; clearTimeout(timer); offMessage(); offStatus(); };
  }, [client, key, sessionId, path, online]);
  return state.key === key ? state.doc : LOADING;
}
