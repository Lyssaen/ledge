import { useEffect, useState } from 'react';
import type { AttachmentErrorReason, AttachmentRef, ClientMessage, ImageMime, ImageUpload, ServerMessage } from '@ledge/protocol';
import type { DaemonClient } from './client';

/** Why an attachment request failed: the daemon's reason, `offline` from the fleet, or `timeout` when nothing answered. */
export class AttachmentFailure extends Error {
  constructor(readonly reason: AttachmentErrorReason | 'timeout') { super(`attachment: ${reason}`); this.name = 'AttachmentFailure'; }
}

const TIMEOUT_MS = 20_000;
let counter = 0;
const nextRequestId = () => `att-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Sends `build(requestId)` and settles on the first answer for that request: `pick` returns the value, or undefined to keep waiting. */
function request<T>(client: DaemonClient, build: (requestId: string) => ClientMessage, pick: (m: ServerMessage) => T | undefined, timeoutMs: number): Promise<T> {
  const requestId = nextRequestId();
  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = client.onMessage(m => {
      if (!('requestId' in m) || m.requestId !== requestId) return;
      if (m.type === 'attachment.error') { done(); reject(new AttachmentFailure(m.reason)); return; }
      const value = pick(m);
      if (value !== undefined) { done(); resolve(value); }
    });
    const done = () => { off(); if (timer) clearTimeout(timer); };
    timer = setTimeout(() => { off(); reject(new AttachmentFailure('timeout')); }, timeoutMs);
    client.send(build(requestId));
  });
}

/** Stores an image on the daemon of `route.id`'s session (the local one without it). */
export function putImage(client: DaemonClient, image: ImageUpload, route: { id?: string } = {}, timeoutMs = TIMEOUT_MS): Promise<AttachmentRef> {
  return request(client, requestId => ({ type: 'attachment.put', requestId, image, ...(route.id ? { id: route.id } : {}) }), m => m.type === 'attachment.stored' ? m.ref : undefined, timeoutMs);
}

/** Reads a stored image (or its preview) as base64, from the daemon `route` names (the local one without it). */
export function getImage(client: DaemonClient, attachment: string, route: { id?: string; machine?: string } = {}, preview = false, timeoutMs = TIMEOUT_MS): Promise<{ mime: ImageMime; data: string }> {
  return request(client, requestId => ({ type: 'attachment.get', requestId, attachment, ...(preview ? { preview: true } : {}), ...(route.id ? { id: route.id } : {}), ...(route.machine ? { machine: route.machine } : {}) }),
    m => m.type === 'attachment.data' ? { mime: m.mime, data: m.data } : undefined, timeoutMs);
}

/** Object URLs by machine|attachment|preview. Kept for the page's life: a thumbnail seen again costs nothing. A failed fetch is dropped. */
const urls = new Map<string, Promise<string>>();

function blobUrl({ mime, data }: { mime: string; data: string }): string {
  const bin = atob(data), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

/** An object URL for an attachment, fetched once per (route, id, preview); `failed` once the fetch was refused or timed out. */
export function useImageUrl(client: DaemonClient, ref: AttachmentRef | undefined, route: { id?: string; machine?: string } = {}, preview = false): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ key: string; url: string | null; failed: boolean }>({ key: '', url: null, failed: false });
  const key = ref ? `${route.machine ?? route.id ?? ''}|${ref.id}|${preview}` : '';
  const attachment = ref?.id;
  useEffect(() => {
    if (!attachment) return;
    let live = true;
    let pending = urls.get(key);
    if (!pending) {
      pending = getImage(client, attachment, route, preview).then(blobUrl);
      urls.set(key, pending);
      pending.catch(() => { if (urls.get(key) === pending) urls.delete(key); });
    }
    pending.then(url => { if (live) setState({ key, url, failed: false }); }, () => { if (live) setState({ key, url: null, failed: true }); });
    return () => { live = false; };
    // `route` is a fresh object each render: its parts are in `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, attachment, preview]);
  return state.key === key && key !== '' ? { url: state.url, failed: state.failed } : { url: null, failed: false };
}
