import { actionCopy } from '@ledge/ui/chat/actionCopy';
import { formatBytes } from '@ledge/ui/images/encode';
import type { Messages } from './lang.js';

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export const en: Messages = {
  lang: { fr: 'Français', en: 'English' },
  state: { approval: 'Needs you', question: 'A question', starting: 'Starting', idle: 'Available', working: 'Working', done: 'Finished', error: 'Error', readonly: 'Read-only' },
  time: { now: 'just now', decimal: '.', s: n => `${n}s`, min: n => `${n} min`, h: n => `${n} h`, d: n => `${n} d` },
  tabs: { overview: 'Overview', session: 'Session', ask: 'Ask Ledge', launch: 'New session', settings: 'Settings', openrig: 'OpenRig' },
  bar: {
    sessions: n => `${n} ${plural(n, 'session', 'sessions')}`,
    machines: n => `${n} ${plural(n, 'machine', 'machines')}`,
    waiting: n => `${n} waiting for you`,
    connecting: 'connecting to the daemon…',
    unreachable: 'daemon unreachable, retrying…',
    tokenMissing: 'no token: start a session with `ledge claude` or run `ledge daemon`'
  },
  keys: {
    image: 'image', openImage: 'open image',
    navigate: 'move', open: 'open', answer: 'answer', attach: 'attach (tmux)', ask: 'ask Ledge', launch: 'new session',
    settings: 'settings', help: 'help', quit: 'quit', back: 'back', write: 'write', diffs: 'diffs', terminal: 'terminal', model: 'model',
    interrupt: 'interrupt', next: 'next waiting', unfold: 'unfold', send: 'send / launch', nextCard: 'next card',
    newChat: 'new conversation', stopAnswer: 'stop the answer', nextField: 'next field', choose: 'choose', tick: 'tick',
    start: 'launch', cancel: 'cancel', change: 'change', scroll: 'scroll', space: 'space', redraw: 'another name',
    handover: 'hand over', decide: 'answer the decision', sendAnswer: 'send the answer', edit: 'edit',
    sendOnly: 'send', newLine: 'new line', keepAndLeave: 'keep and leave', lineHistory: 'line · history', history: 'history',
    word: 'word', clear: 'clear', resend: 'send again', backToDraft: 'back to the draft', keep: 'keep', wipe: 'clear',
    line: 'line', page: 'page', end: 'end', question: 'question', conversation: 'conversation', cycle: 'cards · conversation',
    applyRow: 'apply the line', apply: 'apply', applyAll: 'apply all', deny: 'deny', ignore: 'ignore', review: 'review',
    openSession: name => `open ${name}`
  },
  overview: {
    yours: n => `Yours · ${n}`, projects: 'Projects', exchanges: 'Messages', terminal: name => `Terminal · ${name}`,
    nobodyWaits: 'Nobody is waiting for you.', noSession: 'No session. Press + to start one.', noPreview: 'No preview.', noExchange: 'No message yet.',
    sessions: n => `${n} ${plural(n, 'session', 'sessions')}`, outside: 'No project', offline: 'offline', readOnly: 'read-only',
    wantsToRun: 'Wants to run:', asks: 'Asks:', plan: 'Proposes a plan:', diff: 'Wants to edit:',
    allow: 'Allow', deny: 'Deny', always: 'Always', denyWithNote: 'Deny with a note',
    ledge: 'Ledge',
    near: (name, pct) => `${name} · ctx ${pct} % · H hand over`,
    reliefFailed: (name, why) => `The relief of ${name} failed: ${why}`,
    context: pct => `ctx ${pct} %`,
    relief: { briefing: 'relief: brief asked', launching: 'relief: launching…', done: 'relieved', failed: 'relief failed' },
    relievedBy: name => `relieved by ${name}`, relieves: name => `relieves ${name}`,
    ledgeTask: (owner, title, state) => `${owner} ${state === 'done' ? 'finished' : state === 'refused' ? 'refused' : 'dropped'} “${title}” · Ledge’s task`,
    decision: (giver, title) => `${giver} asks you: ${title}`,
    decisionTitle: (giver, title) => `Answer ${giver} · ${title}`, decisionHint: 'Your answer, as the session will read it…',
    confirmAnswer: giver => `Send to ${giver}? An answer cannot be taken back`
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
    taskCard: 'Tasks to give',
    give: 'Give',
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
      ignored: (n, at, sent = { done: 0, denied: 0, failed: 0 }) => sent.done + sent.denied + sent.failed
        ? n > 1 ? `· plan of ${n} actions: ${[...(sent.done ? [`${sent.done} applied`] : []), ...(sent.denied ? [`${sent.denied} ${sent.denied > 1 ? 'denials' : 'denial'} sent`] : []), ...(sent.failed ? [`${sent.failed} failed`] : [])].join(', ')}, the rest ignored at ${at} · review: ctrl+r`
          : `· card ignored at ${at}, the action was sent but did not go through · review: ctrl+r`
        : `· ${n > 1 ? `plan of ${n} actions ignored` : 'card ignored'} at ${at}, nothing was sent · review: ctrl+r`,
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
    launching: 'Launching…', launched: name => `✓ ${name} is started`
  },
  settings: { title: 'Settings', language: 'Language', theme: 'Theme', themes: { auto: 'Auto', dark: 'Dark', light: 'Light' }, themeAuto: tone => `Auto (${tone} background)`, context: 'Max context', contextHint: 'past it: hand over', contextUnknown: 'update the daemon', contextSaved: pct => `Max context: ${pct} %`, saved: 'Setting saved.', saveFailed: m => `Setting applied, but not saved: ${m}` },
  help: { title: 'Help', global: 'Everywhere', overview: 'Overview', session: 'Session', ask: 'Ask Ledge', launch: 'New session', settings: 'Settings', openrig: 'OpenRig', rigLaunch: 'Launch a rig', screens: 'switch screen', field: 'Typing', wordBefore: 'delete the word before',
    more: (above, below) => [above ? `↑ ${above} above` : '', below ? `↓ ${below} below` : ''].filter(Boolean).join(' · ') },
  images: {
    capture: 'capture', size: (n: number) => formatBytes(n, 'en'), open: (key: string) => `${key} open in viewer`,
    tooLarge: 'Image too large, even reduced', notImage: 'This file is not an image', failed: 'Image not sent',
    max: '5 images per message at most', dialog: 'Answer the question first, the image will go after', none: 'No image in the clipboard',
    openFailed: (why: string) => `Image not opened: ${why}`
  },
  toast: {
    answerFailed: why => `Answer not sent: ${why}`,
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
  openrig: {
    activity: (a) => ({ running: 'working', idle: 'available', unknown: '—' } as Record<string, string>)[a] ?? a,
    title: 'OpenRig', daemon: 'Daemon', kernel: 'Kernel', rigs: 'Rigs',
    machine: 'machine', toggle: 'start/stop', restart: 'restart', unfold: 'unfold', daemonKey: 'daemon', kernelKey: 'kernel',
    daemonState: { running: 'running', stopped: 'stopped', stale: 'stopped uncleanly', unknown: 'unknown' },
    kernelState: { ready: 'ready', starting: 'starting', stopped: 'stopped', skipped: 'no kernel', absent: 'absent', unknown: 'unknown' },
    look: { running: 'running', starting: 'starting', attention: 'needs a look', stopped: 'stopped' },
    daemonMeta: (port, pid) => [port ? `127.0.0.1:${port}` : '', pid ? `pid ${pid}` : ''].filter(Boolean).join(' · '),
    restoreHint: '↻ on start: rigs brought back',
    kernelHint: 'the operator that helps start a rig',
    seats: (running, total) => `${running}/${total}`,
    attention: n => `${n} ${plural(n, 'seat needs', 'seats need')} attention`,
    since: uptime => `up ${uptime}`, snapshot: s => `snapshot ${s}`,
    work: n => (n ? `${n} ${plural(n, 'task', 'tasks')}` : ''),
    stoppedOnPurpose: 'stopped on purpose',
    noRigs: 'No rig on this machine.',
    notInstalled: 'OpenRig is not installed on this machine (no rig command).',
    stoppedDaemon: 'The OpenRig daemon is stopped: D starts it.',
    offline: 'Machine offline.', outdated: 'This machine’s Ledge daemon does not know OpenRig: update it.',
    loading: 'Reading OpenRig…', version: v => `OpenRig ${v}`,
    confirmTitle: 'Confirm',
    confirm: what => `${what}?`,
    what: {
      'daemon.stop': 'Stop the OpenRig daemon', 'daemon.restart': 'Restart the OpenRig daemon', 'kernel.stop': 'Stop the kernel', 'kernel.restart': 'Restart the kernel',
      'rig.stop': rig => `Stop the rig “${rig}”`, 'rig.restart': rig => `Restart the rig “${rig}”`
    },
    busy: (names, n) => (n ? `${n} working ${plural(n, 'agent stops', 'agents stop')}: ${names}.` : 'No agent at work.'),
    yes: 'confirm', no: 'cancel',
    running: cmd => `running: ${cmd}`,
    done: cmd => `done: ${cmd}`,
    failed: why => `failed: ${why}`,
    why: { busy: 'another OpenRig action runs on this machine', not_installed: 'OpenRig is not installed', offline: 'machine offline', outdated: 'Ledge daemon too old' }
  },
  rigLaunch: {
    title: 'Launch a rig', launchKey: 'launch a rig', count: 'number of seats',
    permissions: '4 · Permissions', policyKey: 'permissions',
    policyOf: { auto: 'Auto', standard: 'Standard', open: 'Open', yolo: 'YOLO', locked: 'Locked' },
    specPolicy: p => `the spec’s (${p})`, noSpecPolicy: 'none',
    asRig: 'as the rig',
    policyHint: {
      none: 'no policy: Claude in acceptEdits, Codex in workspace-write',
      auto: 'Claude decides on its own (auto mode); Codex keeps the default posture',
      standard: 'everything passes but PRs, publishing, merging, force push and destructive (asks a person); rules applied once translated into the harness settings',
      open: 'everything passes but destructive; rules applied once translated into the harness settings',
      yolo: 'no prompt: Claude --dangerously-skip-permissions, Codex danger-full-access',
      locked: 'only the toolchain and rig up/down pass; rules applied once translated into the harness settings'
    },
    nonInterruptive: 'accept the first-launch warnings (--non-interruptive)',
    spec: '1 · Starting spec', where: '2 · Where', roles: '3 · Seats per role', delegation: '5 · Who delegates to whom', preview: 'Preview · rig.yaml',
    specHint: 'The rig’s model: its pods, its roles, the links between them.',
    source: { user: 'my specs', builtin: 'OpenRig' },
    seatsOf: n => `${n} ${plural(n, 'seat', 'seats')}`,
    folder: 'Folder', name: 'Name', folderHint: 'a folder of this machine, ~ accepted', projectFolder: p => `project ${p}`,
    model: 'model', defaultModel: 'default', modelKey: 'model',
    rolesHint: 'A counter at 3 gives build, build-2, build-3, the same as the first.',
    pairs: 'in pairs', all: 'each seat → all', pairsHint: 'build-2 → review-2', allHint: 'each build → every review',
    save: 'save in my specs', notScaled: 'one seat per role: nothing more to delegate',
    loading: 'Reading the specs…', noSpecs: 'No spec on this machine.',
    daemonStopped: 'Start the OpenRig daemon first (D on the OpenRig screen).',
    noCheck: 'p checks the launch (rig up --plan) without starting anything.',
    checking: 'Checking…', launching: 'Launching…',
    passes: seats => `✓ the plan passes · ${seats} ${plural(seats, 'seat', 'seats')}`,
    planStatus: s => `plan: ${s}`,
    warning: (text, seats) => (seats ? `${text} (${seats})` : text),
    launched: (name, n) => `Rig “${name}” launched · ${n} ${plural(n, 'seat', 'seats')}.`,
    check: 'check (--plan)', launch: n => `launch ${n} ${plural(n, 'seat', 'seats')}`,
    missing: { spec: 'Pick a spec.', cwd: 'Give the working folder.', name: 'The rig’s name: letters, digits, . _ - (no leading -).', seats: 'At least one seat.' },
    why: {
      busy: 'Another OpenRig action runs on this machine.', cwd_missing: 'This folder does not exist on the machine.', spec_not_found: 'This spec is no longer in the library.',
      daemon_stopped: 'Start the OpenRig daemon first (D on the OpenRig screen).', not_installed: 'OpenRig is not installed on this machine.',
      offline: 'Machine offline.', outdated: 'This machine’s Ledge daemon cannot launch a rig: update it.'
    }
  },
  rigSeats: {
    title: (rig, machine) => `Seats · ${rig} · ${machine}`, key: 'seats',
    stays: now => `The rig keeps running. Now: ${now}.`,
    role: 'role', count: 'number', delegationKey: 'delegation', apply: 'apply', cancel: 'cancel',
    pairs: 'delegation in pairs', all: 'each added → all', linksPairs: 'links added in pairs', linksAll: 'links added to all',
    nothing: 'Change a number: - +', notRunning: 'Only a running rig changes seats.',
    busy: seat => `${seat} is working: its work in progress stops.`,
    applying: 'applying…',
    done: (added, removed, links) => `+${added} −${removed} seats${links !== undefined ? `, ${links} ${plural(links, 'link', 'links')}` : ''}`,
    linksUnsupported: 'this OpenRig cannot link seats added to a running rig (before 0.7)',
    why: {
      rig_not_running: 'The rig is no longer running.', rig_root_unknown: 'Cannot copy a seat: the rig’s agents cannot be found.',
      busy: 'Another OpenRig action runs on this machine.', not_installed: 'OpenRig is not installed on this machine.',
      offline: 'Machine offline.', outdated: 'This machine’s Ledge daemon cannot change a rig’s seats: update it.'
    }
  },
  small: {
    tooSmall: (w, h) => `Window too small: ${w}×${h}`, atLeast: (w, h) => `needs at least ${w}×${h}`,
    waits: (name, question) => (question ? `${name} has a question` : `${name} waits for your approval`), kept: 'draft kept'
  },
  cli: { notTty: 'ledge tui: needs a terminal (stdin and stdout must be a TTY)', movedToTab: 'ledge tui opens in the Ledge tab.', loadingProfile: 'Windows Terminal is loading the Ledge profile…' }
};
