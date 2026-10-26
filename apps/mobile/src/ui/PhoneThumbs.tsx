import { useEffect, useRef, useState } from 'react';
import type { AttachmentRef } from '@ledge/protocol';
import { ImageThumb } from '@ledge/ui/images';
import { copy } from '../copy';
import type { MobileStore } from '../state/store';
import { ImageViewer } from './ImageViewer';
import { useImageUrl } from './useImageUrl';

const C = copy.images;

/** One thumbnail: its preview is fetched when its box scrolls into view (at mount where there is no IntersectionObserver, as in jsdom). */
function Thumb({ store, image, onOpen }: { store: MobileStore; image: AttachmentRef; onOpen(): void }) {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (seen || !box.current) return;
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } });
    io.observe(box.current);
    return () => io.disconnect();
  }, [seen]);
  const { url, failed } = useImageUrl(store, image.id, true, seen && image.preview);
  // Nothing small was made: the phone does not fetch the whole picture for a thumbnail.
  if (!image.preview) return <p className="max-w-full rounded-lg border border-line bg-surface p-2.5 text-xs text-muted">{C.noPreview}</p>;
  return <div ref={box} className="max-w-full"><ImageThumb url={url} failed={failed} width={image.width} height={image.height} maxW={240} maxH={240} alt="" unavailable={C.unavailable} onOpen={onOpen} /></div>;
}

/** A message's images as thumbnails (240 px at most), each opening the full-screen view. */
export function PhoneThumbs({ store, refs, align = 'start' }: { store: MobileStore; refs: AttachmentRef[]; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState<number | null>(null);
  if (refs.length === 0) return null;
  return (
    <div data-thumbs className={`flex max-w-full flex-wrap gap-2 ${align === 'end' ? 'justify-end' : ''}`}>
      {refs.map((r, i) => <Thumb key={`${r.id}:${i}`} store={store} image={r} onOpen={() => setOpen(i)} />)}
      {open !== null && <ImageViewer store={store} refs={refs} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
