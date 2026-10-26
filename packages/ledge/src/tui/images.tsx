import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useRef, useState } from 'react';
import { Text } from 'ink';
import { AttachmentFailure, getImage } from '@ledge/fleet';
import { ATTACHMENTS_MAX, type AttachmentRef, type ImageMime, type ImageUpload } from '@ledge/protocol';
import { useTui } from './context.js';
import type { ClipboardImage } from './clipboard.js';
import { C } from './theme.js';

/** An image waiting under a field: stored on the daemon (`id`, session replies) or kept for the message (`image`, the Ledge chat). */
export interface Chip { key: number; width: number; height: number; state: 'uploading' | 'ready' | 'refused'; image?: ImageUpload; id?: string; reason?: string }

export interface Chips {
  items: Chip[];
  /** Adds a pasted image, or says why not (five at most). */
  add(c: ClipboardImage): void;
  /** Drops the last one (a refused one included). */
  removeLast(): void;
  /** Nothing still uploading, nothing refused. */
  ready: boolean;
  ids(): string[];
  uploads(): ImageUpload[];
  /** Empties the field after a send and gives back what it held, for `putBack` if the send is refused. */
  clear(): Chip[];
  putBack(taken: Chip[]): void;
}

let counter = 0;

/** The chips under a field. With `put`, each image is stored as soon as it is added; without, it stays in the chip. */
export function useChips(put: ((image: ImageUpload) => Promise<AttachmentRef>) | null): Chips {
  const { t, toast } = useTui();
  const [items, setItems] = useState<Chip[]>([]);
  // A synchronous mirror: two pastes in a row count against the limit before React renders.
  const held = useRef<Chip[]>([]);
  const commit = (next: Chip[]) => { held.current = next; setItems(next); };
  const patch = (key: number, over: Partial<Chip>) => commit(held.current.map(c => (c.key === key ? { ...c, ...over } : c)));
  const reasonOf = (e: unknown) => {
    const reason = e instanceof AttachmentFailure ? e.reason : null;
    return reason === 'too_large' ? t.images.tooLarge : reason === 'not_image' ? t.images.notImage : t.images.failed;
  };

  return {
    items,
    add({ image, width, height }) {
      if (held.current.length >= ATTACHMENTS_MAX) { toast({ text: t.images.max, tone: 'info' }); return; }
      const key = counter++;
      if (!put) { commit([...held.current, { key, width, height, state: 'ready', image }]); return; }
      commit([...held.current, { key, width, height, state: 'uploading' }]);
      put(image).then(ref => patch(key, { state: 'ready', id: ref.id }), e => patch(key, { state: 'refused', reason: reasonOf(e) }));
    },
    removeLast() { commit(held.current.slice(0, -1)); },
    ready: items.every(c => c.state === 'ready'),
    ids: () => held.current.flatMap(c => (c.state === 'ready' && c.id ? [c.id] : [])),
    uploads: () => held.current.flatMap(c => (c.state === 'ready' && c.image ? [c.image] : [])),
    clear() { const taken = held.current; commit([]); return taken; },
    putBack(taken) { commit([...taken, ...held.current].slice(0, ATTACHMENTS_MAX)); }
  };
}

/** The chips line above the field: `▣ capture 1440×900 ✕`, `…` while it uploads, the reason in red when refused. */
export function ChipsLine({ chips }: { chips: Chip[] }) {
  const { t } = useTui();
  if (chips.length === 0) return null;
  return (
    <Text wrap="truncate">
      {chips.map((c, i) => (
        <Text key={c.key}>{i ? '  ' : ''}<Text color={c.state === 'refused' ? C.red : C.dim}>▣ {t.images.capture} {c.width}×{c.height} {c.state === 'uploading' ? '…' : '✕'}</Text>{c.reason ? <Text color={C.red}> {c.reason}</Text> : null}</Text>
      ))}
    </Text>
  );
}

const EXT: Record<ImageMime, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** Reads the clipboard picture and adds it, or says there is none. */
export function usePaste(chips: Chips): () => void {
  const { readImage, toast, t } = useTui();
  const reading = useRef(false);
  return () => {
    if (reading.current) return;
    reading.current = true;
    void readImage().then(got => { if (got) chips.add(got); else toast({ text: t.images.none, tone: 'info' }); }, () => toast({ text: t.images.none, tone: 'info' })).finally(() => { reading.current = false; });
  };
}

/** An image to open and where to fetch it: the session it belongs to, or the machine of a chat turn. */
export interface Openable { ref: AttachmentRef; route: { id?: string; machine?: string } }

/** Opens the newest of `items` in the viewer, each further call the one before it (wrapping); `items` is oldest first. */
export function useOpenImage(): (items: readonly Openable[]) => void {
  const { client, openFile, toast, t } = useTui();
  const presses = useRef(0);
  const last = useRef<string>('');
  return items => {
    // A new list (a turn arrived, a thread unfolded or folded) starts again at the newest.
    const signature = items.map(x => x.ref.id).join(',');
    if (signature !== last.current) { last.current = signature; presses.current = 0; }
    const item = items[items.length - 1 - (presses.current++ % items.length)];
    if (!item) return;
    const { ref, route } = item;
    void (async () => {
      const { mime, data } = await getImage(client, ref.id, route);
      const dir = join(tmpdir(), 'ledge-images');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const file = join(dir, `${ref.id}.${EXT[mime]}`);
      await writeFile(file, Buffer.from(data, 'base64'), { mode: 0o600 });
      await openFile(file);
    })().catch((e: unknown) => toast({ text: t.images.openFailed(e instanceof AttachmentFailure ? e.reason : (e as Error).message), tone: 'error' }));
  };
}
