/** The Ledge mark (mockup `ledgeMark()`): a rounded black square, a white L, a red dot. It is the product's icon (title bars,
 *  app, tray, phone, terminal profile; the SVGs in src-tauri/icons draw the same shapes). The 16 viewBox is drawn for small
 *  sizes, its strokes thicker so they stay legible; the 64 one from 24 px. Fixed colours: the mark is the same in both themes. */
export function LedgeMark({ size = 16 }: { size?: number }) {
  if (size >= 24) return (
    <svg data-ledge-mark width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0A0A0A" />
      <rect x="12" y="12" width="13" height="40" rx="3" fill="#FAFAFA" />
      <rect x="28" y="42" width="24" height="10" rx="3" fill="#FAFAFA" />
      <circle cx="40" cy="26" r="6" fill="#FF6467" />
    </svg>
  );
  return (
    <svg data-ledge-mark width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <rect width="16" height="16" rx="3.5" fill="#0A0A0A" />
      <rect x="3" y="3" width="3" height="10" rx=".5" fill="#FAFAFA" />
      <rect x="7" y="10" width="6" height="3" rx=".5" fill="#FAFAFA" />
      <circle cx="10" cy="6" r="2" fill="#FF6467" />
    </svg>
  );
}
