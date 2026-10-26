import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useImageUrl, type DaemonClient } from '@ledge/fleet';
import type { AttachmentRef } from '@ledge/protocol';
import { formatBytes } from './encode';
import { ImageThumb } from './ImageThumb';
import { Lightbox } from './Lightbox';

/** The words of a message's images, from the front's own copy. `capture` heads the lightbox's title (« Capture · Vous, 14:02 »). */
export interface ThumbsCopy { capture: string; unavailable: string; close: string; prev: string; next: string }
export type ThumbsRoute = { id?: string; machine?: string };
/** What a front's lightbox actions work on: the shown image's object URL, its ref and the base name for a saved file (« capture-1402 »). */
export interface ThumbAction { url: string; image: AttachmentRef; fileName: string }

/** One thumbnail: its preview is fetched when its box scrolls into view (at mount where there is no IntersectionObserver, as in jsdom). */
function Thumb({ client, image, route, max, copy, onOpen }: { client: DaemonClient; image: AttachmentRef; route: ThumbsRoute; max: { w: number; h: number }; copy: ThumbsCopy; onOpen(): void }) {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (seen || !box.current) return;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } });
    io.observe(box.current);
    return () => io.disconnect();
  }, [seen]);
  // A ref without preview (nothing small was made) is fetched whole.
  const { url, failed } = useImageUrl(client, seen ? image : undefined, route, image.preview);
  return <div ref={box} style={{ maxWidth: '100%' }}><ImageThumb url={url} failed={failed} width={image.width} height={image.height} maxW={max.w} maxH={max.h} alt="" unavailable={copy.unavailable} onOpen={onOpen} /></div>;
}

function Viewer({ client, refs, route, index, onIndex, onClose, title, at, lang, copy, actions }: { client: DaemonClient; refs: AttachmentRef[]; route: ThumbsRoute; index: number; onIndex(i: number): void; onClose(): void; title: string; at: string; lang: 'fr' | 'en'; copy: ThumbsCopy; actions?: (a: ThumbAction) => ReactNode }) {
  // Only the shown image is fetched whole.
  const shown = refs[index]!;
  const { url } = useImageUrl(client, shown, route, false);
  const images = refs.map((r, i) => ({ url: i === index ? url : null, meta: `${r.width}×${r.height} · ${formatBytes(r.bytes, lang)}` }));
  const fileName = `capture-${at.replace(/\D/g, '')}`;
  // In the body: a transformed ancestor (the island's sliding panels) would otherwise make `position: fixed` relative to itself.
  return createPortal(<Lightbox images={images} index={index} onIndex={onIndex} onClose={onClose} title={title} closeLabel={copy.close} prevLabel={copy.prev} nextLabel={copy.next}
    actions={url && actions ? actions({ url, image: shown, fileName }) : undefined} />, document.body);
}

/** A message's images as thumbnails, each opening the enlarged view. `route` says whose daemon holds them (a session, or a chat turn's machine),
 *  `who` and `at` (« 14:02 ») name the sender in the view's title. `actions` adds a front's own buttons to the view (the island has none). */
export function Thumbs({ client, refs, route, max, who, at, lang, copy, actions, align = 'start', className }: { client: DaemonClient; refs: AttachmentRef[]; route: ThumbsRoute; max: { w: number; h: number }; who: string; at: string; lang: 'fr' | 'en'; copy: ThumbsCopy; actions?: (a: ThumbAction) => ReactNode; align?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (refs.length === 0) return null;
  return (
    <div className={className} data-thumbs style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: align === 'end' ? 'flex-end' : 'flex-start' }}>
      {refs.map((r, i) => <Thumb key={`${r.id}:${i}`} client={client} image={r} route={route} max={max} copy={copy} onOpen={() => setOpen(i)} />)}
      {open !== null && <Viewer client={client} refs={refs} route={route} index={open} onIndex={setOpen} onClose={() => setOpen(null)} title={`${copy.capture} · ${who}, ${at}`} at={at} lang={lang} copy={copy} actions={actions} />}
    </div>
  );
}
