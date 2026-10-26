import { actionCopy } from '@ledge/ui/chat/actionCopy';
import type { Messages } from './lang.js';

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export const en: Messages = {
  lang: { fr: 'Français', en: 'English' },
  state: { approval: 'Needs you', question: 'A question', starting: 'Starting', idle: 'Available', working: 'Working', done: 'Finished', error: 'Error', readonly: 'Read-only' },
  time: { now: 'just now', decimal: '.', s: n => `${n}s`, min: n => `${n} min`, h: n => `${n} h`, d: n => `${n} d` },
  tabs: { overview: 'Overview', session: 'Session', ask: 'Ask Ledge', launch: 'New session', settings: 'Settings', teams: 'Teams' },
  bar: {
    sessions: n => `${n} ${plural(n, 'session', 'sessions')}`,
    machines: n => `${n} ${plural(n, 'machine', 'machines')}`,
    waiting: n => `${n} waiting for you`,
    connecting: 'connecting to the daemon…',
    unreachable: 'daemon unreachable, retrying…',
    tokenMissing: 'no token: start a session with `ledge claude` or run `ledge daemon`'
  },
  keys: {
    navigate: 'move', open: 'open', answer: 'answer', attach: 'attach (tmux)', ask: 'ask Ledge', launch: 'new session',
    settings: 'settings', help: 'help', quit: 'quit', back: 'back', write: 'write', diffs: 'diffs', terminal: 'terminal', model: 'model',
    interrupt: 'interrupt', next: 'next waiting', unfold: 'unfold', send: 'send / launch', nextCard: 'next card',
    newChat: 'new conversation', stopAnswer: 'stop the answer', nextField: 'next field', choose: 'choose', tick: 'tick',
    start: 'launch', cancel: 'cancel', change: 'change', scroll: 'scroll', space: 'space', redraw: 'another name',
    save: 'save the team', tasks: 'team tasks', join: 'join a team', resume: 'resume the team', teamMode: 'session or team', handover: 'hand over',
    sendOnly: 'send', newLine: 'new line', keepAndLeave: 'keep and leave', lineHistory: 'line · history', history: 'history',
    word: 'word', clear: 'clear', resend: 'send again', backToDraft: 'back to the draft', keep: 'keep', wipe: 'clear',
    line: 'line', page: 'page', end: 'end', question: 'question', conversation: 'conversation', cycle: 'cards · conversation',
    applyRow: 'apply the line', apply: 'apply', applyAll: 'apply all', deny: 'deny', ignore: 'ignore', review: 'review',
    openSession: name => `open ${name}`,
    rolesTemplates: 'roles / templates', folder: 'folder', launchRole: 'launch with this role', launchTeam: 'launch this team', openFile: 'open the file', ignored: 'ignored', reread: 'read again'
  },
  overview: {
    yours: n => `Yours · ${n}`, projects: 'Projects', exchanges: 'Messages', terminal: name => `Terminal · ${name}`,
    nobodyWaits: 'Nobody is waiting for you.', noSession: 'No session. Press + to start one.', noPreview: 'No preview.', noExchange: 'No message yet.',
    sessions: n => `${n} ${plural(n, 'session', 'sessions')}`, outside: 'No project', offline: 'offline', readOnly: 'read-only',
    wantsToRun: 'Wants to run:', asks: 'Asks:', plan: 'Proposes a plan:', diff: 'Wants to edit:',
    allow: 'Allow', deny: 'Deny', always: 'Always', denyWithNote: 'Deny with a note',
    common: 'common table', teamLine: (done, given) => `team · ${done}/${given}`, resting: 'resting · R to resume',
    tasks: team => `Tasks · ${team}`, noTask: 'No task.', ledge: 'Ledge',
    near: (name, pct) => `${name} · ctx ${pct} % · H hand over`,
    reliefFailed: (name, why) => `The relief of ${name} failed: ${why}`,
    context: pct => `ctx ${pct} %`,
    relief: { briefing: 'relief: brief asked', launching: 'relief: launching…', done: 'relieved', failed: 'relief failed' },
    relievedBy: name => `relieved by ${name}`, relieves: name => `relieves ${name}`,
    ledgeTask: (owner, title, state) => `${owner} ${state === 'done' ? 'finished' : state === 'refused' ? 'refused' : 'dropped'} “${title}” · Ledge’s task`,
    joinWhich: name => `${name} joins which team? (↑↓ ↵, esc)`, noTeamHere: 'No team in this project.', notInTeam: 'This session is in no team.'
  },
  session: {
    you: 'You', unfold: 'unfold', fold: 'fold', actions: n => `${n} ${plural(n, 'action', 'actions')}`,
    files: n => `${n} ${plural(n, 'file changed', 'files changed')}`,
    since: (label, t) => `${label} · for ${t}`,
    wants: name => `${name} wants to run`, colon: ':', sentTo: 'sent to', receivedFrom: 'from',
    decision: { accept: 'allowed', deny: 'denied', always: 'always allowed', unknown: 'answered in the terminal' },
    above: n => `↑ ${n} above`, scrolled: (above, below) => `${above ? `↑ ${above} above · ` : ''}↓ ${below} · G end`,
    sent: { sending: 'sending…', delivered: 'delivered', read: 'read', failed: 'failed' },
    helperWorking: n => `working · ${n} ${plural(n, 'action', 'actions')}`, helperDone: 'done',
    replyTo: name => `Reply to ${name}…`, noteFor: name => `Tell ${name} why…`,
    replyTitle: name => `Reply to ${name}`, noteTitle: name => `Deny and tell ${name} why`, writeDraft: 'Write · draft',
    draftLines: n => `${n} ${plural(n, 'line', 'lines')} · r to pick it up`,
    loading: 'Loading the thread…', empty: 'Nothing in this thread yet.', noSession: 'Pick a session in the overview.',
    model: m => `model: ${m}`, defaultModel: 'default', notice: 'Ledge'
  },
  ask: {
    title: (s, m) => `Ledge · sees ${s} ${plural(s, 'session', 'sessions')}, ${m} ${plural(m, 'machine', 'machines')}`,
    question: 'Question', read: 'read', reading: 'Ledge is reading…', you: 'you', empty: 'Ask anything: who needs me, how a session is doing, what to start…',
    launchCard: 'New session', relayCard: name => `Relay to ${name}`, closeCard: 'Close sessions', launch: 'Launch the session',
    relay: 'Send', cancelRelay: 'Take it back', close: 'Close', ignore: 'Ignore', nothingWithoutYou: 'Ledge starts nothing without you.',
    folder: 'Folder', agent: 'Agent', instruction: 'Instruction', launched: 'launched', queued: 'queued', sentAt: 'sent', closed: 'closed',
    offline: 'The local daemon is offline: the question will wait.',
    steps: { sessions: 'the sessions', pane: n => `${n}'s terminal`, reply: n => `${n}'s reply`, git: n => `${n}'s git state`, repo: p => p },
    operator: (s, m) => `Ledge · Operator · sees ${s} ${plural(s, 'session', 'sessions')}, ${m} ${plural(m, 'machine', 'machines')}`,
    teamCard: name => `Team · ${name}`, taskCard: 'Tasks to give', launchTeam: 'Launch the team', save: 'Save', saved: 'saved',
    seats: 'Seats', table: 'Table', newTable: project => `new table in the ${project} room`,
    autonomy: { ask: 'asks', edits: 'edits without asking', auto: 'autonomous' },
    autoWarning: roles => `${roles} will work without asking.`, teamLaunched: at => `✓ Team launched at ${at}`,
    give: 'Give', waitTeam: 'active once the team is launched',
    given: (owner, id, state) => `✓ Given to ${owner} · ${id} · ${state}`,
    taskState: { open: 'to take', taken: 'taken', done: 'done', refused: 'refused', dropped: 'dropped' },
    placeholder: 'A question for Ledge…',
    resetTitle: 'New conversation?',
    resetBody: (n, since) => `Today's conversation (${n} ${plural(n, 'question', 'questions')}, since ${since}) will be cleared.`,
    draftStays: 'Your draft stays.', keep: 'Keep', wipe: 'Clear and start over',
    above: n => `↑ ${n} ${plural(n, 'line', 'lines')} above · PgUp`, answering: '↓ Ledge is answering · G to follow',
    action: {
      copy: actionCopy.en,
      plan: n => `Plan · ${n} actions`, request: (kind, name) => `${kind} · ${name}`,
      confirmOne: line => `Confirm · ${line}`, confirmMany: (n, d) => `Confirm · ${n} actions, ${d} irreversible`,
      state: { done: at => `applied${at ? ` ${at}` : ''}`, running: 'running', held: 'not applied', refused: 'refused', cut: 'cut', denied: at => `denial sent${at ? ` ${at}` : ''}` },
      cutMark: '… (truncated, see the session: o)',
      stale: name => `${name}’s request has changed since my answer: nothing was sent.`,
      hint: { one: 'Ledge does nothing without you.', choose: '↑↓ choose', cut: '↵ does not accept: read it first', stale: 'ask Ledge again for the new request', confirm: '↵ does not confirm: type y', inOrder: 'In order; if a step fails, the next ones are not applied.' },
      ignored: (n, at) => `· ${n > 1 ? `plan of ${n} actions ignored` : 'card ignored'} at ${at}, nothing was sent · review: ctrl+r`,
      denied: (name, at) => `Denial sent to ${name}${at ? ` · ${at}` : ''}: the command did not run`,
      done: (line, at) => `${line}${at ? ` · ${at}` : ''}`
    }
  },
  field: {
    above: n => `↑ ${n} ${plural(n, 'line', 'lines')}`, below: n => `↓ ${n}`,
    pasted: n => `${n} lines pasted`, line: (k, n) => `line ${k}/${n} · alt+↵ new line`,
    history: (k, n) => `history ${k}/${n} · ↓ your draft`
  },
  launch: {
    title: 'New session', preview: 'Preview', instruction: 'Instruction', agent: 'Agent', model: 'Model', effort: 'Effort', project: 'Project', machine: 'Machine',
    repos: 'Repositories', folder: 'Folder', name: 'Name', none: 'none', defaultModel: 'default', loading: 'loading…', drawn: '(drawn at random · ctrl+r for another)',
    folderHint: 'path on the machine (~ allowed)', joins: (name, table) => `${name} will join ${table}`,
    launch: 'Launch', cancel: 'Cancel', thenAttach: 'then a to attach to its terminal',
    missing: { prompt: 'Write an instruction.', machine: 'No machine online.', repos: 'Pick a repository or a folder.' },
    launching: 'Launching…', launched: name => `✓ ${name} is started`,
    teamTitle: 'New team', mode: 'Mode', session: 'session', team: 'team', template: 'Template', custom: 'seats chosen one by one', seats: 'Seats',
    teamName: 'Name', noRole: 'no role: write ~/.ledge/roles/<id>.md', loadingRoles: 'reading the roles…',
    teamPreview: (team, project) => `Team ${team} will sit at a new table in the ${project} room.`,
    teamLaunched: name => `✓ Team ${name} launched`, teamFailed: why => `Team not launched: ${why}`, noSeat: 'Choose at least one seat.'
  },
  catalog: {
    roles: 'roles', templates: 'templates', homeOnly: 'Personal only',
    repoRoles: 'repository · .ledge/roles', homeRoles: 'personal · ~/.ledge/roles', repoTeams: 'repository · .ledge/teams', homeTeams: 'personal · ~/.ledge/teams',
    repo: 'repository', home: 'personal', tool: 'agent', model: 'model', effort: 'effort', autonomy: 'autonomy', file: 'file', usedIn: 'in', heldBy: 'held by',
    teams: 'teams', replaces: path => `replaces ${path}`, toolDefault: 'the agent’s default', noTemplate: 'no template', nobody: 'nobody', noTeam: 'none',
    active: 'active', resting: 'resting', instruction: (n, max) => `Instruction · ${n}/${max}`, noInstruction: 'No instruction.',
    seats: n => `${n} ${plural(n, 'seat', 'seats')}`,
    autonomyShort: { ask: 'asks', edits: 'edits', auto: 'auto' },
    ignored: n => `⚠ ${n} ${plural(n, 'file', 'files')} ignored`, see: 'see', problems: 'Ignored files', noProblem: 'No ignored file.',
    loading: 'reading the roles…', noAnswer: 'The daemon did not answer.',
    offline: m => `${m} is offline.`, outdated: m => `${m}’s daemon is too old for the catalog.`, onMachine: m => `on ${m}`,
    roleElsewhere: (id, cwd) => `@${id} is only read in ${cwd}: launched without a role`, noRole: 'No role here: write .ledge/roles/<id>.md', noTemplateHere: 'No template here: write .ledge/teams/<id>.yaml',
    role: 'Role'
  },
  settings: { title: 'Settings', language: 'Language', theme: 'Theme', themes: { auto: 'Auto', dark: 'Dark', light: 'Light' }, themeAuto: tone => `Auto (${tone} background)`, context: 'Max context', contextHint: 'past it: hand over', contextUnknown: 'update the daemon', contextSaved: pct => `Max context: ${pct} %`, saved: 'Setting saved.', saveFailed: m => `Setting applied, but not saved: ${m}` },
  help: { title: 'Help', global: 'Everywhere', overview: 'Overview', session: 'Session', ask: 'Ask Ledge', launch: 'New session', settings: 'Settings', screens: 'switch screen', teams: 'Teams', field: 'Typing', wordBefore: 'delete the word before',
    more: (above, below) => [above ? `↑ ${above} above` : '', below ? `↓ ${below} below` : ''].filter(Boolean).join(' · ') },
  toast: {
    handover: n => `${n} is writing its brief: a fresh session will take its place`, handoverRefused: why => `Relief refused: ${why}`,
    accept: n => `✓ ${n}: allowed`, deny: n => `✓ ${n}: denied`, always: n => `✓ ${n}: always allowed`,
    option: (n, k) => `✓ ${n}: option ${k} sent`, reply: n => `✓ Reply sent to ${n}`,
    interrupted: n => `${n}: interrupt asked`, model: (n, m) => `${n}: model ${m}`,
    notNow: n => `Nothing to answer for ${n}.`, offline: n => `${n} is offline.`, readOnly: n => `${n} is read-only: answer in its terminal.`,
    busy: n => `A send for ${n} is already in flight.`, noAlways: n => `${n} does not offer “always” here.`,
    noteTooLong: max => `Note too long: ${max} characters at most. It stays in the field.`,
    noNote: n => `${n} takes no note here.`,
    noTerminalOmp: n => `${n} is driven by Ledge over OMP's protocol: there is no terminal to attach to.`,
    noTerminal: n => `No terminal for ${n}.`, attachFailed: code => `tmux stopped with code ${code}.`,
    modelSwitch: 'This daemon cannot change a running session’s model.',
    joined: (n, team) => `${n} joins ${team}.`, resumed: team => `Asked to resume team ${team}.`, saved: path => `Team saved: ${path}`,
    draftKept: 'Draft kept: r to pick it up.', draftQuit: 'Draft in progress: ctrl+c again to quit anyway (it will be lost).',
    exited: (cmd, code) => `${cmd} exited with code ${code}.`
  },
  decisions: {
    failed: (name, message) => `Could not send the decision to ${name}: ${message}`,
    unconfirmed: name => `Ledge did not see the decision for ${name} land. Open the session to check.`,
    replyFailed: (name, message) => `Could not send the reply to ${name}: ${message}`,
    replyUnconfirmed: name => `Ledge did not see the reply to ${name} land. Check the thread.`,
    noteNotTyped: 'Refused, but the note could not be typed.'
  },
  notify: {
    approval: (n, text) => `${n} needs your approval: ${text}`,
    question: (n, text) => `${n} has a question: ${text}`,
    title: n => (n > 0 ? `ledge · ${n} waiting` : 'ledge')
  },
  small: {
    tooSmall: (w, h) => `Window too small: ${w}×${h}`, atLeast: (w, h) => `needs at least ${w}×${h}`,
    waits: (name, question) => (question ? `${name} has a question` : `${name} waits for your approval`), kept: 'draft kept'
  },
  cli: { notTty: 'ledge tui: needs a terminal (stdin and stdout must be a TTY)', movedToTab: 'ledge tui opens in the Ledge tab.', loadingProfile: 'Windows Terminal is loading the Ledge profile…' }
};
