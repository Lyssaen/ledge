/** The glyphs the TUI draws; ASCII when the terminal may not show them (`LEDGE_TUI_ASCII=1`, or a locale that is not UTF-8). */
const UNICODE = {
  approval: '◆', question: '?', working: '●', idle: '○', starting: '◌', done: '·', error: '✗', readonly: '○',
  branch: '⎇', helper: '↳', message: '✉', arrow: '→', ok: '✓', fail: '✗', live: '◌', folded: '▸', unfolded: '▾', project: '■', machine: '●',
  logo: '◖', cursor: '❯', radioOn: '◉', radioOff: '○', boxOn: '✓', boxOff: '☐', prev: '◂', next: '▸', ellipsis: '…', bar: '│',
  /** A team's table and the common table (roles spec §3.9). */
  team: '▣', common: '▭'
};
export type Glyphs = typeof UNICODE;
const ASCII: Glyphs = {
  approval: '!', question: '?', working: '*', idle: 'o', starting: '.', done: '-', error: 'x', readonly: 'o',
  branch: 'git:', helper: '>', message: '@', arrow: '->', ok: 'v', fail: 'x', live: '~', folded: '+', unfolded: '-', project: '#', machine: '*',
  logo: '(', cursor: '>', radioOn: '(*)', radioOff: '( )', boxOn: '[x]', boxOff: '[ ]', prev: '<', next: '>', ellipsis: '...', bar: '|',
  team: '[T]', common: '[ ]'
};

export function glyphsFor(env: NodeJS.ProcessEnv): Glyphs {
  if (env.LEDGE_TUI_ASCII === '1') return ASCII;
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  // No locale at all is common over SSH and in containers whose terminal still shows UTF-8: only a named non-UTF-8 locale falls back.
  return locale && !/utf-?8/i.test(locale) && locale !== 'C.UTF-8' ? ASCII : UNICODE;
}
