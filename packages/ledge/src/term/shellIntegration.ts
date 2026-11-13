// #299: the shell integration of a free shell (bash, zsh, fish), on VS Code's model: around each prompt and command the shell writes
// OSC 633 marks, which reach Desktop in the pane's raw output (a tmux control client gets the bytes as the program wrote them):
//   ESC ] 633 ; A BEL            the prompt starts
//   ESC ] 633 ; B BEL            the prompt ends, the person types
//   ESC ] 633 ; E ; <line> BEL   the command line about to run (escaped: \ as \\, ; as \x3b, control characters as \xHH)
//   ESC ] 633 ; C BEL            it runs: its output follows
//   ESC ] 633 ; D ; <code> BEL   it ended, with its exit code (none after the first prompt, nor after an empty line)
//   ESC ] 633 ; P ; Cwd=<path> BEL   the folder, before each prompt (escaped the same way)
// The person's own startup files are read as a login shell reads them, then the marks are added; their prompt is kept, only wrapped.
// Another shell, or LEDGE_SHELL_INTEGRATION=0 in the person's environment, starts as before (`<shell> -l`).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const HEAD = '# Ledge shell integration (#299): OSC 633 marks around prompts and commands. Written by the Ledge daemon, rewritten when it changes.\n';

const BASH = `${HEAD}
# A login shell's files, as \`bash -l\` reads them (this file replaces them through --init-file).
if [ -n "$LEDGE_SHELL_LOGIN" ]; then
  unset LEDGE_SHELL_LOGIN
  [ -r /etc/profile ] && . /etc/profile
  if [ -r ~/.bash_profile ]; then . ~/.bash_profile
  elif [ -r ~/.bash_login ]; then . ~/.bash_login
  elif [ -r ~/.profile ]; then . ~/.profile
  fi
else
  [ -r ~/.bashrc ] && . ~/.bashrc
fi

if [[ $- == *i* ]] && [ -z "$__ledge_si" ]; then
__ledge_si=1
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
  __ledge_ready=1
  return "$code"
}
__ledge_preexec() {
  [ "$__ledge_ready" = 1 ] || return 0
  __ledge_ready=0
  # The prompt's own commands: an empty line ran nothing.
  [ "$BASH_COMMAND" = '__ledge_status=$?' ] && return 0
  __ledge_cmd=1
  local line h
  h="$(HISTTIMEFORMAT= builtin history 1)"
  # The line the person typed when history kept it; else the command bash is about to run.
  if [ -n "$h" ] && [ "$h" != "$__ledge_hist" ]; then line="$(printf '%s' "$h" | sed -E '1s/^ *[0-9]+\\*? *//')"; else line="$BASH_COMMAND"; fi
  printf '\\e]633;E;%s\\a\\e]633;C\\a' "$(__ledge_esc "$line")"
}
if [[ "$(declare -p PROMPT_COMMAND 2>/dev/null)" == "declare -a"* ]]; then
  PROMPT_COMMAND=('__ledge_status=$?' "\${PROMPT_COMMAND[@]}" '__ledge_precmd')
else
  PROMPT_COMMAND="__ledge_status=\\$?;\${PROMPT_COMMAND:+$PROMPT_COMMAND;}__ledge_precmd"
fi
# A DEBUG trap of the person's own stays: then no C or E, the other marks still come.
if [ -z "$(trap -p DEBUG)" ]; then trap '__ledge_preexec' DEBUG; fi
fi
`;

/** zsh reads its files from ZDOTDIR: Ledge's own files read the person's (LEDGE_USER_ZDOTDIR, else HOME), then give it back. */
const zdot = (file: string, after = '') => `${HEAD}
__ledge_zdotdir="$ZDOTDIR"
ZDOTDIR="\${LEDGE_USER_ZDOTDIR:-$HOME}"
[[ -r "$ZDOTDIR/${file}" ]] && . "$ZDOTDIR/${file}"
LEDGE_USER_ZDOTDIR="$ZDOTDIR"
ZDOTDIR="$__ledge_zdotdir"
unset __ledge_zdotdir
${after}`;

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
  printf '\\e]633;E;%s\\a\\e]633;C\\a' "$(__ledge_esc "$1")"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __ledge_precmd
add-zsh-hook preexec __ledge_preexec
fi
`;

const FISH = `${HEAD}
if status is-interactive; and not set -q __ledge_si
  set -g __ledge_si 1
  function __ledge_esc
    string join \\n -- $argv | string replace -a '\\\\' '\\\\\\\\' | string replace -a ';' '\\\\x3b' | string replace -ra '\\n' '\\\\x0a' | string replace -ra '\\r' '\\\\x0d' | string replace -ra '\\t' '\\\\x09' | string replace -ra '\\e' '\\\\x1b' | string replace -ra '\\a' '\\\\x07' | string join '\\\\x0a'
  end
  function __ledge_preexec --on-event fish_preexec
    printf '\\e]633;E;%s\\a\\e]633;C\\a' (__ledge_esc $argv)
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
  'zsh/.zshenv': zdot('.zshenv'),
  'zsh/.zprofile': zdot('.zprofile'),
  'zsh/.zshrc': zdot('.zshrc', `${ZSH_MARKS}[[ -o login ]] || { ${ZRESTORE.trim().replace(/\n/g, '; ')}; }\n`),
  'zsh/.zlogin': zdot('.zlogin', ZRESTORE),
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

/**
 * How to start `shell` with the integration, or null to start it as before: another shell, the integration turned off
 * (LEDGE_SHELL_INTEGRATION=0 in the person's environment), or its scripts not writable.
 */
export function withIntegration(shell: string, env: Record<string, string>, dir: string): { command: string[]; env: Record<string, string> } | null {
  if (env.LEDGE_SHELL_INTEGRATION === '0') return null;
  const kind = basename(shell);
  if (kind !== 'bash' && kind !== 'zsh' && kind !== 'fish') return null;
  try { install(dir); } catch { return null; }
  if (kind === 'bash') return { command: [shell, '--init-file', join(dir, 'bash.sh')], env: { ...env, LEDGE_SHELL_LOGIN: '1' } };
  if (kind === 'zsh') {
    const own: Record<string, string> = env.ZDOTDIR ? { LEDGE_USER_ZDOTDIR: env.ZDOTDIR } : {};
    return { command: [shell, '-l'], env: { ...env, ...own, ZDOTDIR: join(dir, 'zsh') } };
  }
  return { command: [shell, '-l', '--init-command', `source ${quote(join(dir, 'fish.fish'))}`], env };
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
