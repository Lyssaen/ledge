import { ICONS } from '@ledge/ui/ui/icons';

/** The shell's line icons, as the mockup draws them (docs/mockups/desktop-observatory/observatory.tsx; gear: settings.tsx; machine, density: list.tsx; file… offline: session.tsx). */
export const SHELL_ICONS = {
  grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  list: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3.5 6h.01', 'M3.5 12h.01', 'M3.5 18h.01'],
  chat: ['M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z'],
  search: ['M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15', 'm16 16 5 5'],
  // list.tsx: machineIcon and densityIcon (one key per density).
  machine: ['M3 4h18v12H3z', 'M12 16v4', 'M8 20h8'],
  densityComfy: ['M4 5h16', 'M4 12h16', 'M4 19h16'],
  densityTight: ['M4 4h16', 'M4 8h16', 'M4 12h16', 'M4 16h16', 'M4 20h16'],
  unassigned: ['M4 7h16v12H4z', 'M4 7l2-3h4l2 3', 'M9 13h6'],
  subagents: ['M4 4h7v6H4z', 'M13 14h7v6h-7z', 'M7.5 10v7H13'],
  subagentsOff: ['M4 4h7v6H4z', 'M7.5 10v7H11', 'M14 15l5 5', 'M19 15l-5 5'],
  pause: ['M9 5v14', 'M15 5v14'],
  play: ['M7 5l12 7-12 7z'],
  help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18', 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6', 'M12 17h.01'],
  collapse: ['M9 4v5H4', 'M15 4v5h5', 'M9 20v-5H4', 'M15 20v-5h5'],
  gear: ICONS.gear.d,
  // session.tsx: the thread's action kinds, the fold's chevron, « Aller au dernier message », the frozen thread.
  file: ['M14 3H6v18h12V8z', 'M14 3v5h4', 'M9 13h6', 'M9 17h6'],
  terminal: ['m4 6 5 6-5 6', 'M12 18h8'],
  pencil: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  chevronDown: ['m6 9 6 6 6-6'],
  arrowDown: ['M12 5v14', 'm19 12-7 7-7-7'],
  // session.tsx: the view switch (threadIcon, diffIcon), « Copier le chemin », a folded diff's unfold.
  thread: ['M4 6h16', 'M4 12h10', 'M4 18h13'],
  diff: ['M12 3v8', 'M8 7h8', 'M8 17h8', 'M5 21h14'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  unfold: ['M12 5v14', 'm8 9 4-4 4 4', 'm8 15 4 4 4-4'],
  // session.tsx: the side pane's plan tab (planIcon) and « Agrandir » (splitIcon).
  plan: ['M9 4h6v3H9z', 'M7 5H5v16h14V5h-2', 'm9 12 1.5 1.5L14 10', 'M9 17h6'],
  split: ['M3 4h18v16H3z', 'M12 4v16'],
  offline: ['M2 8.8a15 15 0 0 1 4.2-2.6', 'M22 8.8A15 15 0 0 0 10.4 5.1', 'M5 12.6a10 10 0 0 1 5.3-2.5', 'M19 12.6a10 10 0 0 0-2.4-1.6', 'M8.5 16.4a5 5 0 0 1 7 0', 'M12 20h.01', 'M3 3l18 18']
} as const satisfies Record<string, readonly string[]>;
