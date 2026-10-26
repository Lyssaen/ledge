import { useEffect, useRef, useState } from 'react';
import { ATTACHMENTS_MAX } from '@ledge/protocol';
import { encodeImage, type ChipItem } from '@ledge/ui/images';
import { copy } from '../copy';
import type { MobileStore } from '../state/store';

/** An image waiting under a field: the chip, plus its stored id once the PC has it. */
export interface Attachment { item: ChipItem; id?: string }

export interface Attachments {
  items: ChipItem[];
  /** Encodes then stores each file, one at a time; the sixth is refused with `error`. */
  add(files: File[]): void;
  remove(key: string): void;
  /** No image still being encoded or uploaded, none refused. */
  ready: boolean;
  /** The stored ids of the ready images. */
  ids(): string[];
  /** Empties the field after a send and gives back what it held, for `putBack` if the send is not made. */
  clear(): Attachment[];
  putBack(taken: Attachment[]): void;
  error: string | null;
}

const C = copy.images;
let counter = 0;
const dataUrl = (i: { mime: string; data: string }) => `data:${i.mime};base64,${i.data}`;

/** The images of a field on the phone: stored on the PC as they are added (the store sends the puts one at a time), sent by id. */
export function useAttachments(store: MobileStore): Attachments {
  const [entries, setEntries] = useState<Attachment[]>([]);
  const [encoding, setEncoding] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // Synchronous mirrors: two picks in a row count against the limit before React renders.
  const held = useRef<Attachment[]>([]);
  const encodingNow = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const commit = (next: Attachment[]) => { held.current = next; setEntries(next); };
  const patch = (key: string, over: Omit<Partial<Attachment>, 'item'> & { item?: Partial<ChipItem> }) => {
    if (!alive.current) return;
    commit(held.current.map(a => a.item.key === key ? { ...a, ...over, item: { ...a.item, ...over.item } } : a));
  };
  const encodingBy = (n: number) => { encodingNow.current += n; setEncoding(encodingNow.current); };

  const take = async (file: File): Promise<void> => {
    const r = await encodeImage(file);
    encodingBy(-1);
    if (!alive.current) return;
    if (!r.ok) { setError(r.reason === 'tooLarge' ? C.tooLarge : C.notImage); return; }
    const { image, width, height, bytes } = r.value;
    const key = `att-${counter++}`;
    commit([...held.current, { item: { key, url: dataUrl(image.preview ?? image), width, height, bytes, state: 'uploading' } }]);
    try {
      const ref = await store.putImage(image);
      patch(key, { id: ref.id, item: { state: 'ready' } });
    } catch (e) {
      const reason = e instanceof Error && e.message === 'too_large' ? C.tooLarge : e instanceof Error && e.message === 'not_image' ? C.notImage : C.failed;
      patch(key, { item: { state: 'refused', reason } });
      if (alive.current) setError(reason);
    }
  };

  const add = (files: File[]) => {
    if (files.length === 0) return;
    setError(null);
    for (const file of files) {
      if (held.current.length + encodingNow.current >= ATTACHMENTS_MAX) { setError(C.max); return; }
      encodingBy(1);
      void take(file);
    }
  };

  const remove = (key: string) => {
    const gone = held.current.find(a => a.item.key === key);
    commit(held.current.filter(a => a.item.key !== key));
    if (gone?.item.state === 'refused') setError(null);
  };

  const clear = () => { const taken = held.current; commit([]); setError(null); return taken; };
  const putBack = (taken: Attachment[]) => { if (alive.current) commit([...taken, ...held.current].slice(0, ATTACHMENTS_MAX)); };

  const items = entries.map(a => a.item);
  return {
    items, add, remove, clear, putBack, error,
    ready: encoding === 0 && items.every(i => i.state === 'ready'),
    ids: () => held.current.filter(a => a.item.state === 'ready' && a.id).map(a => a.id!)
  };
}
