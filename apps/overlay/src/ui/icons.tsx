/** Line icons (24 px grid, 1.5 stroke, currentColor), decorative: the button around them carries the name. */
export function Icon({ d, size = 16, fill }: { d: readonly string[]; size?: number; fill?: readonly string[] }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.map((p, i) => <path key={i} d={p} />)}
      {fill?.map((p, i) => <path key={`f${i}`} d={p} fill="currentColor" stroke="none" />)}
    </svg>
  );
}
/** The mockup's glyphs: ◔ (do not disturb), ⚙ (settings), ‹ (collapse/back), ⤢ (reading), ↗ (terminal), × (close), ↑ (send). */
export const ICONS = {
  /** A circle with its upper-right quarter filled. */
  dnd: { d: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18'], fill: ['M12 3a9 9 0 0 1 9 9h-9z'] },
  gear: { d: ['M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'] },
  chevronLeft: { d: ['m15 18-6-6 6-6'] },
  chevronRight: { d: ['m9 18 6-6-6-6'] },
  close: { d: ['M18 6 6 18', 'm6 6 12 12'] },
  expand: { d: ['M15 3h6v6', 'm21 3-7 7', 'm3 21 7-7', 'M9 21H3v-6'] },
  external: { d: ['M7 17 17 7', 'M8 7h9v9'] },
  send: { d: ['M12 19V5', 'm5 12 7-7 7 7'] },
  stop: { d: ['M6 6h12v12H6z'] },
  check: { d: ['M20 6 9 17l-5-5'] },
  listRemove: { d: ['M11 12H3', 'M16 6H3', 'M16 18H3', 'm19 10-4 4', 'm15 10 4 4'] },
  /** A "T" with its baseline: the reply as written. */
  text: { d: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'] }
} as const;
