// #299: the shell integration of a free shell (bash, zsh, fish), on VS Code's model: around each prompt and command the shell writes
// OSC 633 marks, which reach Desktop in the pane's raw output (a tmux control client gets the bytes as the program wrote them):
//   ESC ] 633 ; A BEL                    the prompt starts
//   ESC ] 633 ; B BEL                    the prompt ends, the person types
//   ESC ] 633 ; E ; <line> ; <nonce> BEL the command line about to run (escaped: \ as \\, ; as \x3b, control characters as \xHH),
//                                        signed with the shell's nonce: what a program prints cannot pass for it
//   ESC ] 633 ; C BEL                    it runs: its output follows
//   ESC ] 633 ; D ; <code> BEL           it ended, with its exit code (none after the first prompt, nor after an empty line)
//   ESC ] 633 ; P ; Cwd=<path> BEL       the folder, before each prompt (escaped the same way)
// The shell starts as a login shell, reads the person's own files itself, then the marks are added; their prompt is kept, only
// wrapped, and a DEBUG trap of theirs (bash) still runs. Another shell, or LEDGE_SHELL_INTEGRATION=0 in the person's environment,
// starts as before (`<shell> -l`).
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const HEAD = '# Ledge shell integration (#299): OSC 633 marks around prompts and commands. Written by the Ledge daemon, rewritten when it changes.\n';

/**
 * bash: `bash -l` reads the person's files (a real login shell: `shopt login_shell` is on); Ledge puts `. '<this file>'` in the
 * PROMPT_COMMAND of its environment (LEDGE_SHELL_BOOT says which text), so the first prompt sources it, after their files. It takes
 * that text out of PROMPT_COMMAND again, whatever their files made of it. If their files replaced PROMPT_COMMAND outright, the shell
 * has no marks: it works as before.
 */
const BASH = `${HEAD}
__ledge_b="$LEDGE_SHELL_BOOT"
unset LEDGE_SHELL_BOOT
# What is left once the boot text is out, without the « ; » and spaces it leaves at either end.
__ledge_cut() {
  local s="\${1/"$__ledge_b;"/}"; s="\${s/"$__ledge_b"/}"
  while [[ "$s" == [\\;\\ ]* ]]; do s="\${s#?}"; done
  while [[ "$s" == *[\\;\\ ] ]]; do s="\${s%?}"; done
  printf '%s' "$s"
}
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  __ledge_pc=()
  for __ledge_e in "\${PROMPT_COMMAND[@]}"; do
    __ledge_e="$(__ledge_cut "$__ledge_e")"
    [ -n "$__ledge_e" ] && __ledge_pc+=("$__ledge_e")
  done
  PROMPT_COMMAND=("\${__ledge_pc[@]}")
  unset __ledge_pc __ledge_e
elif [ -n "$__ledge_b" ]; then
  PROMPT_COMMAND="$(__ledge_cut "$PROMPT_COMMAND")"
fi
unset __ledge_b
unset -f __ledge_cut

if [[ $- == *i* ]] && [ -z "$__ledge_si" ]; then
__ledge_si=1
__ledge_file="\${BASH_SOURCE[0]}"
__ledge_nonce="$LEDGE_SHELL_NONCE"
unset LEDGE_SHELL_NONCE
__ledge_cmd=0
__ledge_ready=0
__ledge_esc() {
  local s="$1"
  s=\${s//\\\\/\\\\\\\\}; s=\${s//;/\\\\x3b}
  s=\${s//$'\\n'/\\\\x0a}; s=\${s//$'\\r'/\\\\x0d}; s=\${s//$'\\t'/\\\\x09}; s=\${s//$'\\e'/\\\\x1b}; s=\${s//$'\\a'/\\\\x07}
  printf '%s' "$s"
}
__ledge_precmd() {
  local code="$__ledge_status"
  [ "$__ledge_cmd" = 1 ] && printf '\\e]633;D;%s\\a' "$code"
  __ledge_cmd=0
  printf '\\e]633;P;Cwd=%s\\a' "$(__ledge_esc "$PWD")"
  # The prompt the person's files set (some set it again before each prompt), wrapped in A and B.
  if [[ "$PS1" != *'633;B'* ]]; then
    __ledge_ps1="$PS1"
    PS1='\\[\\e]633;A\\a\\]'"$__ledge_ps1"'\\[\\e]633;B\\a\\]'
  fi
  __ledge_hist="$(HISTTIMEFORMAT= builtin history 1)"
  __ledge_boot=0
  # Last: from here the next command is the person's.
  __ledge_ready=1
}
__ledge_preexec() {
  local rc="\${1:-0}"
  [ "$__ledge_ready" = 1 ] || return "$rc"
  # A command of Ledge's own functions, or of this file while it is sourced, is not the person's.
  [[ "\${FUNCNAME[1]}" == __ledge_* || "\${BASH_SOURCE[1]}" == "$__ledge_file" ]] && return "$rc"
  local line h
  h="$(HISTTIMEFORMAT= builtin history 1)"
  # Right after the boot, the rest of the first PROMPT_COMMAND still runs: only a line the person typed (a new history entry) counts.
  if [ "$__ledge_boot" = 1 ]; then [ -n "$h" ] && [ "$h" != "$__ledge_hist" ] || return "$rc"; fi
  __ledge_ready=0
  __ledge_boot=0
  # The prompt's own commands: an empty line ran nothing.
  [ "$BASH_COMMAND" = '__ledge_status=$?' ] && return "$rc"
  __ledge_cmd=1
  # The line the person typed when history kept it; else the command bash is about to run.
  if [ -n "$h" ] && [ "$h" != "$__ledge_hist" ]; then line="$(printf '%s' "$h" | sed -E '1s/^ *[0-9]+\\*? *//')"; else line="$BASH_COMMAND"; fi
  printf '\\e]633;E;%s;%s\\a\\e]633;C\\a' "$(__ledge_esc "$line")" "$__ledge_nonce"
  return "$rc"
}
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND=('__ledge_status=$?' "\${PROMPT_COMMAND[@]}" '__ledge_precmd')
else
  PROMPT_COMMAND="__ledge_status=\\$?;\${PROMPT_COMMAND:+$PROMPT_COMMAND;}__ledge_precmd"
fi
# Ledge's PROMPT_COMMAND names its own functions: a child shell must not inherit it.
export -n PROMPT_COMMAND
# The person's DEBUG trap, if any, runs first, as it did; Ledge's after it, returning its status (extdebug keeps its meaning). The
# boot wrote it to a file before sourcing this one: a sourced file, a function or a subshell does not see the DEBUG trap.
__ledge_f="\${TMPDIR:-/tmp}/.ledge-trap-$$"
if [ -r "$__ledge_f" ]; then
  __ledge_t="$(< "$__ledge_f")"
  if [ -n "$__ledge_t" ]; then
    __ledge_t="\${__ledge_t#trap -- }"; __ledge_t="\${__ledge_t% DEBUG}"; eval "__ledge_t=$__ledge_t"
    trap "$__ledge_t"$'\n''__ledge_preexec "$?"' DEBUG
  else
    trap '__ledge_preexec "$?"' DEBUG
  fi
fi
rm -f "$__ledge_f"
unset __ledge_f __ledge_t
# This first prompt is already under way: it gets its marks now; the rest of its PROMPT_COMMAND is not a command of the person's.
__ledge_status=0
__ledge_precmd
__ledge_boot=1
fi
`;

/** zsh reads its files from ZDOTDIR: Ledge's own files read the person's (LEDGE_USER_ZDOTDIR, else HOME), then give it back. */
const zdot = (file: string, before = '', after = '') => `${HEAD}${before}
__ledge_zdotdir="$ZDOTDIR"
ZDOTDIR="\${LEDGE_USER_ZDOTDIR:-$HOME}"
[[ -r "$ZDOTDIR/${file}" ]] && . "$ZDOTDIR/${file}"
LEDGE_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$__ledge_zdotdir"
unset __ledge_zdotdir
${after}`;

/** The nonce out of the environment, first thing: the person's files and what they start do not see it. */
const ZNONCE = `typeset -g __ledge_nonce="$LEDGE_SHELL_NONCE"
unset LEDGE_SHELL_NONCE
`;

/** The person's ZDOTDIR back, once Ledge's last file is read (.zlogin for a login shell, else .zshrc). */
const ZRESTORE = `if [[ "$LEDGE_USER_ZDOTDIR" == "$HOME" ]]; then unset ZDOTDIR; else ZDOTDIR="$LEDGE_USER_ZDOTDIR"; fi
unset LEDGE_USER_ZDOTDIR
`;

const ZSH_MARKS = `if [[ -o interactive ]] && [[ -z "$__ledge_si" ]]; then
__ledge_si=1
__ledge_cmd=0
__ledge_esc() {
  local s="$1"
  s=\${s//\\\\/\\\\\\\\}; s=\${s//;/\\\\x3b}
  s=\${s//$'\\n'/\\\\x0a}; s=\${s//$'\\r'/\\\\x0d}; s=\${s//$'\\t'/\\\\x09}; s=\${s//$'\\e'/\\\\x1b}; s=\${s//$'\\a'/\\\\x07}
  print -rn -- "$s"
}
__ledge_precmd() {
  local code=$?
  [[ $__ledge_cmd == 1 ]] && printf '\\e]633;D;%s\\a' "$code"
  __ledge_cmd=0
  printf '\\e]633;P;Cwd=%s\\a' "$(__ledge_esc "$PWD")"
  # The prompt the person's files set (a theme sets it again before each prompt), wrapped in A and B.
  if [[ "$PS1" != *'633;B'* ]]; then
    PS1=$'%{\\e]633;A\\a%}'"$PS1"$'%{\\e]633;B\\a%}'
  fi
  return $code
}
__ledge_preexec() {
  __ledge_cmd=1
  printf '\\e]633;E;%s;%s\\a\\e]633;C\\a' "$(__ledge_esc "$1")" "$__ledge_nonce"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __ledge_precmd
add-zsh-hook preexec __ledge_preexec
fi
`;

const FISH = `${HEAD}
if status is-interactive; and not set -q __ledge_si
  set -g __ledge_si 1
  set -g __ledge_nonce $LEDGE_SHELL_NONCE
  set -e LEDGE_SHELL_NONCE
  function __ledge_esc
    string join \\n -- $argv | string replace -a '\\\\' '\\\\\\\\' | string replace -a ';' '\\\\x3b' | string replace -ra '\\n' '\\\\x0a' | string replace -ra '\\r' '\\\\x0d' | string replace -ra '\\t' '\\\\x09' | string replace -ra '\\e' '\\\\x1b' | string replace -ra '\\a' '\\\\x07' | string join '\\\\x0a'
  end
  function __ledge_preexec --on-event fish_preexec
    printf '\\e]633;E;%s;%s\\a\\e]633;C\\a' (__ledge_esc $argv) $__ledge_nonce
  end
  function __ledge_postexec --on-event fish_postexec
    printf '\\e]633;D;%s\\a' $status
  end
  function __ledge_status
    return $argv[1]
  end
  # The person's prompt, wrapped in A and B; its $status is the last command's, as before.
  if functions -q fish_prompt
    functions -c fish_prompt __ledge_user_prompt
  else
    function __ledge_user_prompt; printf '%s> ' (prompt_pwd); end
  end
  function fish_prompt
    set -l s $status
    printf '\\e]633;P;Cwd=%s\\a\\e]633;A\\a' (__ledge_esc $PWD)
    __ledge_status $s
    __ledge_user_prompt
    printf '\\e]633;B\\a'
  end
end
`;

/** The scripts, by file name under the integration folder. */
export const SCRIPTS: Readonly<Record<string, string>> = {
  'bash.sh': BASH,
  'zsh/.zshenv': zdot('.zshenv', ZNONCE),
  'zsh/.zprofile': zdot('.zprofile'),
  'zsh/.zshrc': zdot('.zshrc', '', `${ZSH_MARKS}[[ -o login ]] || { ${ZRESTORE.trim().replace(/\n/g, '; ')}; }\n`),
  'zsh/.zlogin': zdot('.zlogin', '', ZRESTORE),
  'fish.fish': FISH
};

/** Writes the scripts under `dir` when they are missing or changed. */
function install(dir: string): void {
  for (const [name, text] of Object.entries(SCRIPTS)) {
    const path = join(dir, name);
    let cur: string | null = null;
    try { cur = readFileSync(path, 'utf8'); } catch { cur = null; }
    if (cur === text) continue;
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text, { mode: 0o644 });
  }
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * How to start `shell` with the integration, or null to start it as before: another shell, the integration turned off
 * (LEDGE_SHELL_INTEGRATION=0 in the person's environment), or its scripts not writable. `nonce` signs the shell's command lines
 * (E); the front gets it with the screen and trusts only an E that carries it.
 */
export function withIntegration(shell: string, env: Record<string, string>, dir: string, nonce = randomBytes(16).toString('hex')): { command: string[]; env: Record<string, string>; nonce: string } | null {
  if (env.LEDGE_SHELL_INTEGRATION === '0') return null;
  const kind = basename(shell);
  if (kind !== 'bash' && kind !== 'zsh' && kind !== 'fish') return null;
  try { install(dir); } catch { return null; }
  const keyed = { ...env, LEDGE_SHELL_NONCE: nonce };
  if (kind === 'bash') {
    // The DEBUG trap is read where the shell itself runs the boot: the sourced file would not see it.
    const boot = `builtin trap -p DEBUG > "\${TMPDIR:-/tmp}/.ledge-trap-$$"; . ${quote(join(dir, 'bash.sh'))}`;
    const prompt = env.PROMPT_COMMAND ? `${boot};${env.PROMPT_COMMAND}` : boot;
    return { command: [shell, '-l'], env: { ...keyed, PROMPT_COMMAND: prompt, LEDGE_SHELL_BOOT: boot }, nonce };
  }
  if (kind === 'zsh') {
    const own: Record<string, string> = env.ZDOTDIR ? { LEDGE_USER_ZDOTDIR: env.ZDOTDIR } : {};
    return { command: [shell, '-l'], env: { ...keyed, ...own, ZDOTDIR: join(dir, 'zsh') }, nonce };
  }
  return { command: [shell, '-l', '--init-command', `source ${quote(join(dir, 'fish.fish'))}`], env: keyed, nonce };
}
