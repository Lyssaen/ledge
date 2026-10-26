import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AttachmentRef } from '@ledge/protocol';
import { copy } from '../copy';
import type { MobileStore } from '../state/store';
import { useImageUrl } from './useImageUrl';

const C = copy.images;
const MIN_SCALE = 1;
const MAX_SCALE = 4;
/** A vertical swipe past this many pixels (image not zoomed) closes the view. */
const SWIPE_CLOSE = 120;
const clamp = (n: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));
const EXT: Record<string, string> = { 'image/png': 'png', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** The image as a file to hand to the share sheet, once it can be (the sheet takes files only where `canShare` says so). */
function useShareable(url: string | null, name: string, mime: string): File | null {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => {
    setFile(null);
    if (!url || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return;
    let live = true;
    fetch(url).then(r => r.blob()).then(blob => {
      const f = new File([blob], name, { type: mime });
      if (live && navigator.canShare({ files: [f] })) setFile(f);
    }, () => undefined);
    return () => { live = false; };
  }, [url, name, mime]);
  return file;
}

/**
 * One of a message's images, full screen. Two fingers zoom (1× to 4×), a vertical swipe of more than 120 px or ✕ closes.
 * Only the shown image is fetched whole.
 */
export function ImageViewer({ store, refs, index, onIndex, onClose }: { store: MobileStore; refs: AttachmentRef[]; index: number; onIndex(i: number): void; onClose(): void }) {
  const shown = refs[index]!;
  const { url, failed } = useImageUrl(store, shown.id, false);
  const name = `capture-${index + 1}.${EXT[shown.mime] ?? 'img'}`;
  const file = useShareable(url, name, shown.mime);

  const [scale, setScale] = useState(1);
  const [drag, setDrag] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ pinch0: 0, scale0: 1, y0: 0 });
  useEffect(() => { setScale(1); setDrag(0); pointers.current.clear(); }, [index]);

  const gap = () => { const [a, b] = [...pointers.current.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const down = (e: PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) gesture.current = { ...gesture.current, pinch0: gap(), scale0: scale };
    else gesture.current = { ...gesture.current, y0: e.clientY };
  };
  const move = (e: PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) { if (gesture.current.pinch0 > 0) setScale(clamp(gesture.current.scale0 * gap() / gesture.current.pinch0)); }
    else if (scale === 1) setDrag(e.clientY - gesture.current.y0);
  };
  const up = (e: PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 0) {
      if (scale === 1 && Math.abs(drag) > SWIPE_CLOSE) { onClose(); return; }
      setDrag(0);
    }
  };

  const share = () => { if (file) void navigator.share({ files: [file] }).catch(() => undefined); };
  // The gesture container captures the pointer: the buttons must not start a gesture of its own.
  const stop = (e: React.PointerEvent) => e.stopPropagation();
  const button = 'inline-flex min-h-11 items-center rounded-full bg-white/15 px-4 text-[13px] font-medium text-white';
  const nav = (to: number, label: string, side: string, d: string) => to >= 0 && to < refs.length && (
    <button type="button" aria-label={label} title={label} onPointerDown={stop} onClick={() => onIndex(to)} className={`absolute top-1/2 ${side} grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/15 text-white`}>
      <svg className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
    </button>
  );

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={C.view} className="fixed inset-0 z-50 flex flex-col bg-black/90 text-white" style={{ opacity: drag ? Math.max(0.4, 1 - Math.abs(drag) / 400) : 1 }}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="min-w-0 flex-1 text-xs text-white/70">{shown.width}×{shown.height}{refs.length > 1 ? ` · ${index + 1}/${refs.length}` : ''}</span>
        {file && <button type="button" onPointerDown={stop} onClick={share} className={button}>{C.share}</button>}
        {url && <a href={url} download={name} onPointerDown={stop} className={button}>{C.save}</a>}
        <button type="button" aria-label={C.close} title={C.close} onPointerDown={stop} onClick={onClose} className="grid size-11 place-items-center rounded-full bg-white/15">
          <svg className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-width:1.8]" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden" style={{ touchAction: 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {url && <img src={url} alt="" draggable={false} className="max-h-full max-w-full select-none object-contain" style={{ transform: `translateY(${drag}px) scale(${scale})`, transition: pointers.current.size ? 'none' : 'transform .15s' }} />}
        {!url && <p role="status" className="text-sm text-white/70">{failed ? C.unavailable : '…'}</p>}
        {nav(index - 1, C.prev, 'left-3', 'm15 18-6-6 6-6')}
        {nav(index + 1, C.next, 'right-3', 'm9 18 6-6-6-6')}
      </div>
    </div>,
    document.body
  );
}
