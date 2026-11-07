/** The glyphs the TUI draws; ASCII when the terminal may not show them (`LEDGE_TUI_ASCII=1`, or a locale that is not UTF-8). */
const UNICODE = {
  approval: '◆', question: '?', working: '●', idle: '○', starting: '◌', done: '·', error: '✗', readonly: '○',
  branch: '⎇', helper: '↳', message: '✉', arrow: '→', ok: '✓', fail: '✗', live: '◌', folded: '▸', unfolded: '▾', project: '■', machine: '●',
  cont: '↪', logo: '◖', cursor: '❯', radioOn: '◉', radioOff: '○', boxOn: '✓', boxOff: '☐', prev: '◂', next: '▸', ellipsis: '…', bar: '│',
  /** Markdown: a list's marks, a quote's bar, a rule, a code block's corners, a link's arrow, the end of a streamed answer. */
  bullet: '•', subBullet: '◦', quote: '▎', rule: '─', codeTop: '╭', codeEnd: '╰', link: '↗', caret: '▍',
  /** Where a table's rule crosses its columns' bars. */
  cross: '┼',
  /** An action card's row (#94): proposed is `idle`, applied `ok`, failed or refused `fail`. */
  running: '◐', held: '·', stale: '!',
  /** Links are clickable (OSC 8); without, their address follows them. */
  links: true as boolean,
  /** A task handed between sessions in « Échanges » (#92). */
  task: '▤',
  /** A role's value: written here, inherited, not declared, unknown; the margin's rail (docs/mockups/ledge-openrig-roles-tui.html). */
  pvHere: '●', pvInh: '↳', pvAbs: '○', pvUnk: '?', rail: '▎',
  /** OpenRig's blocks in a thread (docs/mockups/openrig-messages): a message, a queue row, a notice; the raw's box. */
  /** The harnesses' limits (docs/mockups/ledge-harness-usage.html): Claude Code's ✻, Codex's >_, a gauge's full and empty
   *  cells, a reset, a usage alert or a context near its limit. */
  markClaude: '✻', markCodex: '>_', markCursor: '◇', barFull: '█', barEmpty: '░', reset: '↺', gauge: '◔',
  rigMessage: '✉', rigRow: '▤', rigNotice: '·', boxTL: '┌', boxTR: '┐', boxBL: '└', boxBR: '┘', boxH: '─', boxV: '│'
};
export type Glyphs = typeof UNICODE;
const ASCII: Glyphs = {
  approval: '!', question: '?', working: '*', idle: 'o', starting: '.', done: '-', error: 'x', readonly: 'o',
  branch: 'git:', helper: '>', message: '@', arrow: '->', ok: 'v', fail: 'x', live: '~', folded: '+', unfolded: '-', project: '#', machine: '*',
  cont: '>', logo: '(', cursor: '>', radioOn: '(*)', radioOff: '( )', boxOn: '[x]', boxOff: '[ ]', prev: '<', next: '>', ellipsis: '...', bar: '|',
  bullet: '-', subBullet: 'o', quote: '|', rule: '-', codeTop: '+', codeEnd: '+', link: '', caret: '_',
  cross: '+',
  running: '~', held: '.', stale: '!',
  task: '[=]',
  pvHere: '*', pvInh: '>', pvAbs: 'o', pvUnk: '?', rail: '|',
  markClaude: '*', markCodex: '>_', markCursor: '<>', barFull: '#', barEmpty: '.', reset: '@', gauge: '%',
  rigMessage: '@', rigRow: '=', rigNotice: '-', boxTL: '+', boxTR: '+', boxBL: '+', boxBR: '+', boxH: '-', boxV: '|',
  links: false
};

/** Without colour (NO_COLOR, https://no-color.org: set and not empty), OpenRig's blocks tell themselves apart by their glyph. */
const NO_COLOR_RIG = { rigMessage: '@', rigRow: '=', rigNotice: '-' } as const;

export function glyphsFor(env: NodeJS.ProcessEnv): Glyphs {
  if (env.NO_COLOR) return { ...glyphsFor({ ...env, NO_COLOR: '' }), ...NO_COLOR_RIG };
  if (env.LEDGE_TUI_ASCII === '1') return ASCII;
  // A terminal that shows the escape of a link as text: LEDGE_TUI_LINKS=0.
  if (env.LEDGE_TUI_LINKS === '0') return { ...glyphsFor({ ...env, LEDGE_TUI_LINKS: '1' }), links: false };
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  // No locale at all is common over SSH and in containers whose terminal still shows UTF-8: only a named non-UTF-8 locale falls back.
  return locale && !/utf-?8/i.test(locale) && locale !== 'C.UTF-8' ? ASCII : UNICODE;
}
