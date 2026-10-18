import type { ChatCopy } from '../src/chat/copy';

export const frTime: ChatCopy['time'] = { seconds: n => `${n} s`, minutes: n => `${n} min`, hours: n => `${n} h`, locale: 'fr-FR' };
const fn = (s: string) => () => s;
export const copy: ChatCopy = {
  chat: {
    title: 'Ledge', subtitle: (n, r) => `${n} sessions · ${r} repos`, ask: 'Ask', askPlaceholder: 'Ask…', open: 'Open', send: 'Send', stop: 'Stop', reset: 'Reset', back: 'Back', close: 'Close',
    emptyTitle: 'Test empty title', emptyHint: n => `${n} visible`, starters: 'Starters', chips: ['First chip'], thinking: 'Thinking',
    step: { sessions: 'sessions', pane: fn('pane'), reply: fn('reply'), git: fn('git'), repo: fn('repo') },
    source: { sessions: 'sessions', pane: fn('pane'), reply: fn('reply'), git: fn('git'), repo: fn('repo') },
    sources: 'Sources', sourcesNone: 'none', ago: w => `${w} ago`, error: w => `error ${w}`, stopped: 'Stopped',
    card: { label: 'Card', folder: 'Folder', tool: 'Tool', byDefault: t => t, prompt: 'Prompt', noPrompt: 'None', launch: 'Launch', launching: 'Launching', retry: 'Retry', orRephrase: 'or', orFolder: 'or folder', failed: w => w, started: 'started', startedUnknown: 'Started', terminal: 'Terminal' },
    relay: { label: 'Relay', session: 'Session', instruction: 'Instruction', send: 'Send', sending: 'Sending', cancel: 'Cancel', retry: 'Retry', orRephrase: 'or', queued: 'queued', sentTo: 'Sent to', failed: w => w, pill: { yours: 'yours', working: 'working', waiting: 'waiting', stopped: 'stopped' } },
    project: { label: 'Project proposal', title: n => `Project proposal · ${n}`, complete: n => `Complete ${n}`, repos: n => `${n} repos`, review: 'Review the proposal' }
  },
  machines: { destination: 'Destination', local: 'This machine', offline: 'Offline', choose: n => `On ${n}.`, clarification: 'Or answer in the chat.' },
  time: frTime,
  offline: 'Offline: reconnecting'
};
