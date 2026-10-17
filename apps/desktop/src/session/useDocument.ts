import { useEffect, useState } from 'react';
import type { DaemonClient } from '@ledge/fleet';
import type { DocumentErrorCode } from '@ledge/protocol';
import { splitMarkdownFrontmatter } from '@ledge/ui/documents/markdown';

export type DocState = { status: 'loading' } | { status: 'ready'; text: string; title?: string } | { status: 'error'; code: DocumentErrorCode | 'offline' | 'timeout' };
/** A document that has not come by then is said not to come (the overlay's reader waits as long). */
export const DOCUMENT_TIMEOUT_MS = 10_000;

const LOADING: DocState = { status: 'loading' };
let sequence = 0;

/** `document.read` correlated by requestId (the overlay's useDocumentReader, reduced to one document): the reply to the
 *  request in flight counts, any other is ignored; a machine or a daemon offline is an 'offline' error, nothing sent; no
 *  reply within DOCUMENT_TIMEOUT_MS is a 'timeout'. Another path asks again, and shows loading until its own reply. */
export function useDocument(client: DaemonClient, sessionId: string, path: string, online: boolean): DocState {
  const key = `${sessionId}\n${path}\n${online}`;
  // The state of the request for `key`: a render for another key shows loading until its effect has asked.
  const [state, setState] = useState<{ key: string; doc: DocState }>({ key: '', doc: LOADING });
  useEffect(() => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let offMessage = () => {}, offStatus = () => {};
    const finish = (doc: DocState) => {
      if (done) return;
      done = true;
      clearTimeout(timer); offMessage(); offStatus();
      setState({ key, doc });
    };
    if (!online || client.status() !== 'open') { finish({ status: 'error', code: 'offline' }); return; }
    setState({ key, doc: LOADING });
    const requestId = `document-${Date.now()}-${++sequence}`;
    offMessage = client.onMessage(m => {
      if ((m.type !== 'document.content' && m.type !== 'document.error') || m.requestId !== requestId) return;
      if (m.type === 'document.error') { finish({ status: 'error', code: m.code }); return; }
      const { title } = splitMarkdownFrontmatter(m.text);
      finish({ status: 'ready', text: m.text, ...(title !== undefined && { title }) });
    });
    offStatus = client.onStatus(s => { if (s !== 'open') finish({ status: 'error', code: 'offline' }); });
    timer = setTimeout(() => finish({ status: 'error', code: 'timeout' }), DOCUMENT_TIMEOUT_MS);
    client.send({ type: 'document.read', requestId, path, sessionId });
    return () => { done = true; clearTimeout(timer); offMessage(); offStatus(); };
  }, [client, key, sessionId, path, online]);
  return state.key === key ? state.doc : LOADING;
}
