import { useEffect, useRef, useState } from 'react';
import { AttachmentFailure, getImage, putImage, type DaemonClient } from '@ledge/fleet';
import { ATTACHMENTS_MAX, type ImageUpload } from '@ledge/protocol';
import { encodeImage, type ChipItem } from '@ledge/ui/images';
import { useI18n } from '../i18n/lang';

/** `put`: each image is stored on the daemon of that session as soon as it is added (a reply sends the ids).
 *  `inline`: the images stay here and travel with the message (the Ledge chat's `chat.ask`). */
export type AttachmentMode = { put: { id: string } } | { inline: true };

/** An image waiting under a field: the chip, plus what the send needs (its stored id, or its bytes in `inline` mode). */
export interface Attachment { item: ChipItem; id?: string; upload?: ImageUpload }

export interface Attachments {
  items: ChipItem[];
  /** Encodes then stores (or keeps) each file; the sixth is refused with `error`. */
  add(files: File[]): void;
  remove(key: string): void;
  /** No image still being encoded or uploaded, none refused. */
  ready: boolean;
  /** The stored ids of the ready images (`put` mode). */
  ids(): string[];
  /** The ready images' bytes (`inline` mode). */
  uploads(): ImageUpload[];
  /** Empties the field after a send and gives back what it held, for `putBack` if the send is refused. */
  clear(): Attachment[];
  putBack(taken: Attachment[]): void;
  /** Brings back images the daemon returned by id (an OMP queue taken back); `dropped`: some could not be returned. */
  restore(ids: string[], dropped?: boolean): void;
  error: string | null;
}

let counter = 0;
const dataUrl = (i: { mime: string; data: string }) => `data:${i.mime};base64,${i.data}`;

export function useAttachments(client: DaemonClient | undefined, mode: AttachmentMode): Attachments {
  const { t } = useI18n();
  const copy = t.images;
  const [entries, setEntries] = useState<Attachment[]>([]);
  const [encoding, setEncoding] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Synchronous mirrors: a paste of several files, or two pastes in a row, count against the limit before React renders.
  const held = useRef<Attachment[]>([]);
  const encodingNow = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const latest = useRef({ client, mode, copy });
  latest.current = { client, mode, copy };

  const commit = (next: Attachment[]) => { held.current = next; setEntries(next); };
  const patch = (key: string, over: Omit<Partial<Attachment>, 'item'> & { item?: Partial<ChipItem> }) => {
    if (!alive.current) return;
    commit(held.current.map(a => a.item.key === key ? { ...a, ...over, item: { ...a.item, ...over.item } } : a));
  };
  const encodingBy = (n: number) => { encodingNow.current += n; setEncoding(encodingNow.current); };

  const reasonOf = (e: unknown): string => {
    const c = latest.current.copy;
    const reason = e instanceof AttachmentFailure ? e.reason : null;
    return reason === 'too_large' ? c.tooLarge : reason === 'not_image' ? c.notImage : c.failed;
  };

  const take = async (file: File): Promise<void> => {
    const { client: c, mode: m, copy: words } = latest.current;
    const r = await encodeImage(file);
    encodingBy(-1);
    if (!alive.current) return;
    if (!r.ok) { setError(r.reason === 'tooLarge' ? words.tooLarge : words.notImage); return; }
    const { image, width, height, bytes } = r.value;
    const key = `att-${counter++}`;
    const item: ChipItem = { key, url: dataUrl(image.preview ?? image), width, height, bytes, state: 'uploading' };
    if ('inline' in m) { commit([...held.current, { item: { ...item, state: 'ready' }, upload: image }]); return; }
    commit([...held.current, { item }]);
    try {
      const ref = await putImage(c!, image, m.put);
      patch(key, { id: ref.id, item: { state: 'ready' } });
    } catch (e) {
      const reason = reasonOf(e);
      patch(key, { item: { state: 'refused', reason } });
      if (alive.current) setError(reason);
    }
  };

  const add = (files: File[]) => {
    if (files.length === 0 || (!client && 'put' in mode)) return;
    setError(null);
    for (const file of files) {
      if (held.current.length + encodingNow.current >= ATTACHMENTS_MAX) { setError(copy.max); return; }
      encodingBy(1);
      void take(file);
    }
  };

  const remove = (key: string) => {
    const gone = held.current.find(a => a.item.key === key);
    commit(held.current.filter(a => a.item.key !== key));
    if (gone?.item.state === 'refused') setError(null);
  };

  // Restored images only know their id: their dimensions are 0×0 and only the bytes are shown.
  const restore = (ids: string[], dropped = false) => {
    setError(dropped ? copy.lost : null);
    const route = 'put' in mode ? mode.put : {};
    for (const id of ids) {
      if (!client || held.current.length + encodingNow.current >= ATTACHMENTS_MAX || held.current.some(a => a.id === id)) continue;
      const key = `att-${counter++}`;
      commit([...held.current, { id, item: { key, url: '', width: 0, height: 0, bytes: 0, state: 'uploading' } }]);
      // The preview when there is one, else the image itself.
      getImage(client, id, route, true).catch(() => getImage(client, id, route)).then(
        img => patch(key, { item: { url: dataUrl(img), bytes: Math.floor(img.data.length * 3 / 4), state: 'ready' } }),
        () => { if (!alive.current) return; commit(held.current.filter(a => a.item.key !== key)); setError(latest.current.copy.lost); }
      );
    }
  };

  const clear = () => { const taken = held.current; commit([]); setError(null); return taken; };
  const putBack = (taken: Attachment[]) => { if (alive.current) commit([...taken, ...held.current].slice(0, ATTACHMENTS_MAX)); };

  const items = entries.map(a => a.item);
  return {
    items, add, remove, restore, clear, putBack, error,
    ready: encoding === 0 && items.every(i => i.state === 'ready'),
    ids: () => held.current.filter(a => a.item.state === 'ready' && a.id).map(a => a.id!),
    uploads: () => held.current.filter(a => a.item.state === 'ready' && a.upload).map(a => a.upload!)
  };
}
