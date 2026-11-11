import { ICONS as SHARED } from '@ledge/ui/ui/icons';

/** A circle and a rounded rectangle as path data, so the mockups' shapes (docs/mockups/ledge-mobile-refonte/refonte.js) draw here. */
const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const rect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

/** The phone's line icons (24 px grid, currentColor): the desktop's glyphs where they exist, the phone's own after. */
export const ICONS = {
  back: SHARED.chevronLeft.d,
  chevron: SHARED.chevronRight.d,
  close: SHARED.close.d,
  check: SHARED.check.d,
  plus: SHARED.plus.d,
  gear: [
    'M15 12a3 3 0 1 1-6 0a3 3 0 1 1 6 0',
    'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z'
  ],
  terminal: ['m4 17 6-6-6-6', 'M12 19h8'],
  /** « Masquer les sous-agents » (m2-sessions.html §7). */
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z', circle(12, 12, 3)],
  arrowRight: ['M5 12h14', 'm13 6 6 6-6 6'],
  arrowUp: ['m5 12 7-7 7 7', 'M12 19V5'],
  plane: ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'],
  external: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
  stop: ['M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'],
  /** Closing a session. */
  power: ['M12 3v9', 'M6.3 6.3a8 8 0 1 0 11.4 0'],
  /** Resuming an ended session (the desktop's). */
  resume: ['M4 12a8 8 0 1 0 2.3-5.6', 'M4 4v4h4', 'M10 9l5 3-5 3z'],
  monitor: ['M5 4h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M8 20h8', 'M12 16v4'],
  warning: ['m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3', 'M12 9v4', 'M12 17h.01'],
  edit: ['M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7', 'M18.38 2.62a2.12 2.12 0 1 1 3 3L12.36 14.64a2 2 0 0 1-.85.51l-2.87.84.84-2.87a2 2 0 0 1 .5-.85z'],
  spinner: ['M21 12a9 9 0 1 1-6.22-8.56'],
  /** The five tabs and the rail (docs/mockups/ledge-mobile-refonte/m0-socle.html, §1 and §2). */
  inbox: ['M4 13l3-8h10l3 8v6H4z', 'M4 13h5l1 2h4l1-2h5'],
  sessions: [rect(3, 4, 18, 16, 2), 'M7 9h10M7 13h6'],
  pr: [circle(6, 5, 2.2), circle(6, 19, 2.2), circle(18, 19, 2.2), 'M6 7.2v9.6M18 16.8V10a3 3 0 0 0-3-3h-4', 'M13 5l-2 2 2 2'],
  rigs: [circle(6, 6, 2.5), circle(18, 6, 2.5), circle(12, 18, 2.5), 'M8 7.5l3 8M16 7.5l-3 8M8.5 6h7'],
  ledge: [rect(4, 8, 16, 12, 3), 'M12 8V4.5', circle(9, 14, 1), circle(15, 14, 1)],
  search: [circle(11, 11, 7), 'M20 20l-4-4'],
  more: [circle(12, 5, 1.4), circle(12, 12, 1.4), circle(12, 19, 1.4)],
  send: ['M12 19V5M5 12l7-7 7 7'],
  /** The shell's banners (§4): the PC not answering, the relay out of reach, « Réessayer ». */
  wifioff: ['M12 20h.01M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.7M19 12.9a10 10 0 0 0-1.9-1.3M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 10.7 5M2 2l20 20'],
  cloud: ['M2 2l20 20M5.8 5.8A7 7 0 0 0 7 20h10a5 5 0 0 0 2.6-.7M20.8 16.4A5 5 0 0 0 17 10h-1.3A7 7 0 0 0 10 5.1'],
  refresh: ['M3 12a9 9 0 0 1 15.7-6L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.7 6L3 16M3 21v-5h5'],
  /** The Atelier's entry in the rail (m0-socle.html, §2): a table and its two seats. */
  atelier: [rect(3, 10, 18, 5, 1), circle(7, 6, 2), circle(17, 6, 2), 'M6 15v4M18 15v4'],
  /** A clipboard with a check: an agent's checklist. */
  plan: ['M9 4h6v3H9z', 'M7 5H5v16h14V5h-2', 'm9 12 1.5 1.5L14 10', 'M9 17h6'],
  keyboard: ['M3 7h18v10H3z', 'M7 11h.01', 'M11 11h.01', 'M15 11h.01', 'M8 14h8'],
  /** OpenRig's messages (docs/mockups/openrig-messages): a queue row's card, and « Répondre ». */
  task: ['M6.9 3.75h10.2a2.4 2.4 0 0 1 2.4 2.4v11.7a2.4 2.4 0 0 1-2.4 2.4H6.9a2.4 2.4 0 0 1-2.4-2.4V6.15a2.4 2.4 0 0 1 2.4-2.4z', 'M8.25 9h7.5', 'M8.25 13.5h5.25'],
  reply: ['M9.75 6 3.75 12l6 6', 'M4.5 12h9.75a6 6 0 0 1 6 6v.75'],
  passkey: ['M12 3a6 6 0 0 0-6 6v3h12V9a6 6 0 0 0-6-6z', 'M5 12h14v9H5z'],
  /** A linked device, after its kind (the desktop's glyphs, apps/desktop/src/settings/PairingDialog.tsx). */
  phone: ['M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M11 18h2'],
  tablet: ['M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M11 18h2'],
  /** The passkey screens (docs/mockups/ledge-mobile-passkey/passkey-reinstall.html). */
  key: [circle(7.5, 15.5, 5.5), 'm21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3'],
  shield: ['M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z'],
  laptop: [rect(4, 4, 16, 11, 1.5), 'M2 19h20'],
  face: ['M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9v1M15 9v1M12 9v4h-1M9 15.5a4 4 0 0 0 6 0'],
  unlink: ['M18.8 13.4l1.6-1.6a4.5 4.5 0 0 0-6.4-6.4l-1.6 1.6M5.2 10.6l-1.6 1.6a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6M8 2v3M2 8h3M16 22v-3M22 16h-3'],
  clock: [circle(12, 12, 9), 'M12 7v5l3 2'],
  lock: [rect(3, 11, 18, 11, 2), 'M7 11V7a5 5 0 0 1 10 0v4'],
  bell: ['M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0'],
  alert: ['M12 3l10 18H2z', 'M12 10v4M12 17.5v.01'],
  /** The Rigs tab (docs/mockups/ledge-mobile-refonte/m4-rigs.html): the daemon, a snapshot, the snapshots' list; a session's screen (m2-sessions.html §3 to §5): the model, the folder of a session without Git. */
  cpu: [rect(6, 6, 12, 12, 2), 'M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', circle(12, 13, 3.5)],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  list: ['M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18h2'],
  down: ['M6 9l6 6 6-6']
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof ICONS;

/** A decorative icon: the control around it carries the name. `className` sets the size (20 px by default) and the colour. */
export function Icon({ name, className = 'size-5', stroke = 1.6 }: { name: IconName; className?: string; stroke?: number }) {
  return (
    <svg className={`flex-none ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
