import { actionCopy as shipped } from '../src/chat/actionCopy';
import { actionWords } from '../src/chat/actionWords';
import type { ChatCopy } from '../src/chat/copy';

export const frTime: ChatCopy['time'] = { seconds: n => `${n} s`, minutes: n => `${n} min`, hours: n => `${n} h`, locale: 'fr-FR' };
const fn = (s: string) => () => s;
export const copy: ChatCopy = {
  chat: {
    removeImage: 'Remove image', title: 'Ledge', subtitle: (n, r) => `${n} sessions · ${r} repos`, ask: 'Ask', askPlaceholder: 'Ask…', open: 'Open', send: 'Send', stop: 'Stop', reset: 'Reset', back: 'Back', close: 'Close',
    emptyTitle: 'Test empty title', emptyHint: n => `${n} visible`, starters: 'Starters', chips: ['First chip'], thinking: 'Thinking',
    step: { sessions: 'sessions', pane: fn('pane'), reply: fn('reply'), git: fn('git'), repo: fn('repo') },
    source: { sessions: 'sessions', pane: fn('pane'), reply: fn('reply'), git: fn('git'), repo: fn('repo') },
    sources: 'Sources', sourcesNone: 'none', ago: w => `${w} ago`, error: w => `error ${w}`, stopped: 'Stopped',
    card: { label: 'Card', folder: 'Folder', tool: 'Tool', byDefault: t => t, prompt: 'Prompt', noPrompt: 'None', launch: 'Launch', launching: 'Launching', retry: 'Retry', orRephrase: 'or', orFolder: 'or folder', failed: w => w, started: 'started', startedUnknown: 'Started', terminal: 'Terminal' },
    group: { label: n => `${n} sessions`, launchAll: n => `Launch all (${n})`, launchRow: 'Launch', pick: p => `Launch ${p}` },
    closeGroup: { label: n => n === 1 ? 'Session to close' : `${n} sessions to close`, row: 'Close', all: n => `Close all (${n})`, closing: 'Closing', closed: 'Closed', killed: 'Force closed', ended: 'Ended', retry: 'Retry', failed: w => `Failed: ${w}` },
    relay: { label: 'Relay', session: 'Session', instruction: 'Instruction', send: 'Send', sending: 'Sending', cancel: 'Cancel', retry: 'Retry', orRephrase: 'or', queued: 'queued', sentTo: 'Sent to', failed: w => w, pill: { yours: 'yours', working: 'working', waiting: 'waiting', stopped: 'stopped' } },
    project: { label: 'Project proposal', title: n => `Project proposal · ${n}`, complete: n => `Complete ${n}`, repos: n => `${n} repos`, review: 'Review the proposal' }
  },
  machines: { destination: 'Destination', local: 'This machine', offline: 'Offline', choose: n => `On ${n}.`, clarification: 'Or answer in the chat.' },
  time: frTime,
  offline: 'Offline: reconnecting'
};

/** The generic card's words (#94), in English as the rest of the fixture. */
export const actionCopy: NonNullable<ChatCopy['chat']['action']> = {
  label: n => n > 1 ? `Plan of ${n} actions` : 'Proposed action',
  risk: { read: 'Read', reversible: 'Reversible', destructive: 'Irreversible' },
  riskTip: { read: 'nothing changes', reversible: 'Ledge can undo it', destructive: 'Ledge cannot undo it' },
  step: k => `Step ${k}`, stepState: { done: k => `Step ${k}, applied`, failed: k => `Step ${k}, failed`, refused: k => `Step ${k}, refused`, running: k => `Step ${k}, running` },
  askAgain: 'I will ask again',
  verbs: { 'session.model': 'Change', 'session.archive': 'Archive', 'team.dissolve': 'Dissolve', 'session.decide': 'Accept' },
  apply: 'Apply', deny: 'Deny', ignore: 'Ignore', review: 'Review', retry: 'Retry', running: 'Running…',
  done: at => `Applied${at ? ` · ${at}` : ''}`, refusedState: 'Refused', denied: at => `Denial sent${at ? ` · ${at}` : ''}`, open: n => `Open ${n}`,
  failed: w => `Failed: ${w}`, refused: w => `Refused: ${w} Nothing was sent.`, held: k => `Not applied: the plan stopped at step ${k}.`,
  stale: n => `${n}'s request changed since my answer: nothing was sent.`, deniedNote: n => `${n} got your denial: the command did not run.`,
  all: n => `Apply all (${n})`, resume: (k, n) => `Resume at step ${k} (${n})`, skip: (k, n) => `Continue without step ${k} (${n})`,
  inOrder: 'in order, stops at the first failure', destructiveLater: n => `${n} irreversible, I will ask again`, notReplayed: 'steps done are not replayed',
  progress: (k, n) => `Step ${k} of ${n}…`, planDone: at => `Plan applied${at ? ` at ${at}` : ''}`,
  confirm: {
    label: 'Confirmation', many: (n, all) => `Apply ${all ? 'these' : 'the'} ${n} actions, in order?`, one: s => `${s}?`, oneWhy: 'Ledge cannot undo it once sent.',
    manyWhy: d => `${d} irreversible: read the detail above. If a step fails, the next ones are not applied.`, cancel: 'Cancel', go: n => `Apply the ${n}`, alreadyDone: 'already done'
  },
  // The shipped words: a plan ignored once begun counts what went.
  ignored: shipped.en.ignored,
  words: actionWords.en
};
