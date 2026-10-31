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
  /** A rig, OpenRig's kernel, an OMP session. */
  rig: '▣', kernel: '◈', omp: 'π',
  /** A task handed between two agents of a rig (an exchange; a message is `message`, one to Ledge `approval`). */
  task: '▤',
  /** A rig's bar in the rail: its seats at work, the others. */
  full: '█', empty: '░',
  /** Links are clickable (OSC 8); without, their address follows them. */
  links: true as boolean
};
export type Glyphs = typeof UNICODE;
const ASCII: Glyphs = {
  approval: '!', question: '?', working: '*', idle: 'o', starting: '.', done: '-', error: 'x', readonly: 'o',
  branch: 'git:', helper: '>', message: '@', arrow: '->', ok: 'v', fail: 'x', live: '~', folded: '+', unfolded: '-', project: '#', machine: '*',
  cont: '>', logo: '(', cursor: '>', radioOn: '(*)', radioOff: '( )', boxOn: '[x]', boxOff: '[ ]', prev: '<', next: '>', ellipsis: '...', bar: '|',
  bullet: '-', subBullet: 'o', quote: '|', rule: '-', codeTop: '+', codeEnd: '+', link: '', caret: '_',
  cross: '+',
  running: '~', held: '.', stale: '!',
  rig: '[R]', kernel: '<>', omp: 'pi',
  task: '[]',
  full: '#', empty: '.',
  links: false
};

export function glyphsFor(env: NodeJS.ProcessEnv): Glyphs {
  if (env.LEDGE_TUI_ASCII === '1') return ASCII;
  // A terminal that shows the escape of a link as text: LEDGE_TUI_LINKS=0.
  if (env.LEDGE_TUI_LINKS === '0') return { ...glyphsFor({ ...env, LEDGE_TUI_LINKS: '1' }), links: false };
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG || '';
  // No locale at all is common over SSH and in containers whose terminal still shows UTF-8: only a named non-UTF-8 locale falls back.
  return locale && !/utf-?8/i.test(locale) && locale !== 'C.UTF-8' ? ASCII : UNICODE;
}
