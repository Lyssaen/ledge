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
  /** A branch: a trunk, a side commit and the line joining them. */
  branch: { d: ['M6 3v12', 'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 9a9 9 0 0 1-9 9'] },
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
  text: { d: ['M4 7V4h16v3', 'M9 20h6', 'M12 4v16'] },
  plus: { d: ['M12 5v14', 'M5 12h14'] },
  folder: { d: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'] },
  folderPlus: { d: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z', 'M12 10v6', 'M9 13h6'] },
  folderUp: { d: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z', 'M12 10v6', 'm9 13 3-3 3 3'] },
  /** A die: another companion name. */
  dice: { d: ['M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z'], fill: ['M8.5 7.5a1 1 0 1 0 0 2a1 1 0 1 0 0-2', 'M15.5 7.5a1 1 0 1 0 0 2a1 1 0 1 0 0-2', 'M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2', 'M8.5 14.5a1 1 0 1 0 0 2a1 1 0 1 0 0-2', 'M15.5 14.5a1 1 0 1 0 0 2a1 1 0 1 0 0-2'] },
  /** A rocket: a companion is starting. */
  rocket: { d: ['M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z', 'm12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z'] }
} as const;
