/** An image in a thread: as large as its picture allows within maxW × maxH, opens full size on click. `url` is null while the bytes load. */
export function ImageThumb({ url, failed, width, height, maxW, maxH, alt, unavailable, onOpen }: { url: string | null; failed: boolean; width: number; height: number; maxW: number; maxH: number; alt: string; unavailable: string; onOpen(): void }) {
  // The box keeps the picture's shape (never upscaled past its own size) so the thread does not jump when the bytes arrive.
  const scale = Math.min(1, maxW / width, maxH / height);
  const box = { width: Math.round(width * scale), height: Math.round(height * scale), maxWidth: '100%' as const, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--well)', boxSizing: 'border-box' as const, overflow: 'hidden' as const };
  if (failed) return <div data-thumb="failed" style={{ ...box, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 8, fontSize: 12, color: 'var(--muted-foreground)', textAlign: 'center' }}>{unavailable}</div>;
  if (!url) return <div data-thumb="loading" aria-busy="true" style={box} />;
  return (
    <button type="button" data-thumb="ready" onClick={onOpen} style={{ ...box, padding: 0, display: 'block', cursor: 'zoom-in' }}>
      <img src={url} alt={alt} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </button>
  );
}
