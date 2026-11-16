import type { Catalogue } from '../i18n/index.ts';

// The `ledge tui` demonstration: thirteen real frames stacked in one image (`public/media/tui-tui-sprite.png`), shown one
// at a time. Each frame names the key that led to it (none when the screen moved by itself), how long it stays, and the
// caption that explains it, taken from the catalogue.

export const sprite = { file: 'tui-tui-sprite.png', width: 1750, frameHeight: 1056 };

export const frames: { key: string; ms: number; caption: keyof Catalogue['everywhere']['terminal']['frames'] }[] = [
  { key: '', ms: 2800, caption: 'overview' },
  { key: 'y', ms: 2400, caption: 'approve' },
  { key: 'tab', ms: 2400, caption: 'next' },
  { key: '2', ms: 2400, caption: 'answer' },
  { key: 'j', ms: 1700, caption: 'down' },
  { key: '', ms: 1500, caption: 'progress' },
  { key: '', ms: 1900, caption: 'green' },
  { key: '↵', ms: 2800, caption: 'thread' },
  { key: 'esc', ms: 1300, caption: 'back' },
  { key: '/', ms: 2000, caption: 'ask' },
  { key: '↵', ms: 3400, caption: 'summary' },
  { key: '+', ms: 3000, caption: 'newSession' },
  { key: 'esc', ms: 2400, caption: 'allWorking' }
];
