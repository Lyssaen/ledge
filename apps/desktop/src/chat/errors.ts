import type { Messages } from '../i18n/lang';

type Errors = Messages['chat']['errors'];
/** What the chat says for a daemon or fleet error: a sentence in the UI's language, and the daemon's own words when the sentence
 *  does not carry them (a tool's stderr, an error nobody mapped). */
export interface ErrorText { text: string; detail?: string }

const TOOL = '(Claude Code|Codex|Cursor Agent)';
/** The messages the daemon (`packages/ledge/src/daemon/server.ts`, `daemon/relay.ts`, `daemon/folders.ts`, `chat/service.ts`,
 *  `chat/routing.ts`, `tmux.ts`) and the fleet (`packages/fleet/src/fleet.ts`) send on the chat, launch and relay paths. They are
 *  English protocol text, not codes: matched exactly, or by their fixed shape around a name, a path or a tool. */
const RULES: [RegExp, (e: Errors, m: RegExpExecArray) => ErrorText][] = [
  [/^one (question|routing request) at a time(: wait for the answer)?$/, e => ({ text: e.oneAtATime })],
  [/^Update a connected daemon to enable multi-machine chat$/, e => ({ text: e.noRouting })],
  [/^Routing timed out$/, e => ({ text: e.routingTimeout })],
  [/^(Routing failed|Unknown routing destination|Unknown clarification choice|Conflicting routing result)$/, e => ({ text: e.routingFailed })],
  [new RegExp(`^${TOOL} did not answer within 3 minutes$`), (e, m) => ({ text: e.noAnswer(m[1]!) })],
  [new RegExp(`^${TOOL} could not start: (.*)$`, 's'), (e, m) => ({ text: e.couldNotStart(m[1]!), detail: m[2] })],
  [new RegExp(`^${TOOL} exited with code (\\d+)$`), (e, m) => ({ text: e.exited(m[1]!, m[2]!) })],
  [new RegExp(`^${TOOL} reported an error$`), (e, m) => ({ text: e.reported(m[1]!) })],
  [/^unknown proposal$/, e => ({ text: e.unknownProposal })],
  [/^already launched$/, e => ({ text: e.alreadyLaunched })],
  [/^unknown relay$/, e => ({ text: e.unknownRelay })],
  [/^already sent$/, e => ({ text: e.alreadySent })],
  [/^already queued$/, e => ({ text: e.alreadyQueued })],
  [/^nothing queued$/, e => ({ text: e.nothingQueued })],
  [/^Unknown conversation destination$/, e => ({ text: e.unknownDestination })],
  [/^(.+) stopped before it got the instruction$/, (e, m) => ({ text: e.stoppedBefore(m[1]!) })],
  [/^unknown session$/, e => ({ text: e.unknownSession })],
  [/^session started without ledge, read only$/, e => ({ text: e.readOnly })],
  [/^a \w+ prompt takes accept or deny, not a reply$/, e => ({ text: e.choicePrompt })],
  [/^empty reply$/, e => ({ text: e.emptyReply })],
  [/^free-text answers are not supported yet, answer in the terminal$/, e => ({ text: e.freeText })],
  [/^no prompt visible in the terminal, open the tab$/, e => ({ text: e.noPrompt })],
  [/^the terminal did not take it$/, e => ({ text: e.notTaken })],
  [/^invalid message$/, e => ({ text: e.invalidMessage })],
  [/^no such folder: (.+)$/s, (e, m) => ({ text: e.noFolder(m[1]!) })],
  [/^not a folder: (.+)$/s, (e, m) => ({ text: e.notFolder(m[1]!) })],
  [/^not an absolute path: (.+)$/s, (e, m) => ({ text: e.notAbsolute(m[1]!) })],
  [/^tmux [\w-]+ failed: .*$/s, (e, m) => ({ text: e.tmuxFailed, detail: m[0] })],
  [/^(.+) is offline$/, (e, m) => ({ text: e.offline(m[1]!) })]
];

function known(raw: string, e: Errors): ErrorText | null {
  for (const [re, say] of RULES) { const m = re.exec(raw); if (m) return say(e, m); }
  return null;
}

/** A daemon or fleet error in the UI's language. With several machines the fleet prefixes a daemon's id-less error with the machine
 *  (`Devbox: already launched`); the prefix is kept as the machine's name. Anything else is a generic sentence, its raw text the detail. */
export function errorText(raw: string, e: Errors): ErrorText {
  const direct = known(raw, e);
  if (direct) return direct;
  const prefixed = /^([^:]+): (.+)$/s.exec(raw);
  const inner = prefixed ? known(prefixed[2]!, e) : null;
  if (prefixed && inner) return { ...inner, text: e.from(prefixed[1]!, inner.text) };
  return { text: e.unknown, detail: raw };
}
