import { actionCopy } from '@ledge/ui/chat/actionCopy';
import { formatBytes } from '@ledge/ui/images/encode';
import type { Messages } from './lang.js';

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

export const en: Messages = {
  lang: { fr: 'Français', en: 'English' },
  state: { approval: 'Needs you', question: 'A question', starting: 'Starting', idle: 'Available', working: 'Working', done: 'Finished', error: 'Error', readonly: 'Read-only' },
  time: { now: 'just now', decimal: '.', s: n => `${n}s`, min: n => `${n} min`, h: n => `${n} h`, d: n => `${n} d` },
  tabs: { overview: 'Home', session: 'Session', ask: 'Ask Ledge', launch: 'New session', settings: 'Settings' },
  bar: {
    machines: n => `${n} ${plural(n, 'machine', 'machines')}`,
    rigs: n => `${n} ${plural(n, 'rig', 'rigs')}`,
    agents: n => `${n} ${plural(n, 'agent', 'agents')}`,
    solo: n => `${n} ${plural(n, 'standalone session', 'standalone sessions')}`,
    waiting: n => `${n} waiting for you`,
    connecting: 'connecting to the daemon…',
    unreachable: 'daemon unreachable, retrying…',
    tokenMissing: 'no token: start a session with `ledge claude` or run `ledge daemon`'
  },
  keys: {
    seats: 'seats', openSeat: 'open the seat', attachSeat: 'attach', ledge: 'Ledge',
    image: 'image', openImage: 'open image',
    navigate: 'move', open: 'open', answer: 'answer', attach: 'attach (tmux)', ask: 'ask Ledge', launch: 'new session',
    settings: 'settings', help: 'help', quit: 'quit', back: 'back', write: 'write', diffs: 'diffs', terminal: 'terminal', model: 'model',
    interrupt: 'interrupt', next: 'next waiting', unfold: 'unfold', send: 'send / launch', nextCard: 'next card',
    newChat: 'new conversation', stopAnswer: 'stop the answer', nextField: 'next field', choose: 'choose', tick: 'tick',
    start: 'launch', cancel: 'cancel', change: 'change', scroll: 'scroll', space: 'space', redraw: 'another name',
    handover: 'hand over',
    sendOnly: 'send', newLine: 'new line', keepAndLeave: 'keep and leave', lineHistory: 'line · history', history: 'history',
    word: 'word', clear: 'clear', resend: 'send again', backToDraft: 'back to the draft', keep: 'keep', wipe: 'clear',
    line: 'line', page: 'page', end: 'end', question: 'question', conversation: 'conversation', cycle: 'cards · conversation',
    applyRow: 'apply the line', apply: 'apply', applyAll: 'apply all', deny: 'deny', ignore: 'ignore', review: 'review',
    openSession: name => `open ${name}`,
    screens: 'Ledge · rig · session',
    decide: 'decide', revisit: 'revisit', fold: 'fold', talk: 'talk it over', complete: 'complete',
    tabs: 'tabs', summarize: 'sum up', point: 'the summary', close: 'close', mandate: 'the mandate'
  },
  home: {
    ledge: 'Ledge', crumb: '1 Ledge · 2 Rig · 3 Session',
    decision: n => (n > 1 ? `${n} decisions wait for you` : 'A decision waits for you'),
    grace: 'Ledge is on it…', calm: 'Nothing to decide.',
    projects: 'Projects · standalone sessions', rigs: 'Rigs',
    working: (w, n) => `${w}/${n} working`,
    inProject: name => `in ${name}`, offProject: 'outside any project', onMachine: m => `on ${m}`,
    available: names => `${names} · available`,
    kernel: 'OpenRig kernel',
    kernelState: { idle: 'resting', working: 'working', absent: 'absent', stopped: 'stopped', starting: 'starting', unsupported: 'unsupported', error: 'in error', unreachable: 'unreachable' },
    noOpenRig: 'OpenRig is not installed · + to launch a rig',
    conversation: 'Ledge · Conversation',
    noSeat: 'No seat.', seatAlone: 'This seat has no Ledge session: nothing to show here yet.'
  },
  ledgeTabs: { conversation: 'Conversation', rigs: 'Rigs', mandat: 'Mandate' },
  rail: {
    rigs: n => `Rigs · ${n}`, kernel: 'kernel', room: '2 · the rig’s room',
    settled: n => `Settled today · ${n}`, revisit: 'u revisit',
    mandate: 'Mandate', alone: 'Ledge settles alone:', always: 'Always yours:', more: 'm the mandate and its memories',
    summary: 'Sum up the day',
    summaryAsk: 'Sum up my day: what the rigs did, what I settled, what awaits me.',
    folded: n => `${n} settled`, detail: 'detail',
    noRig: 'No rig.', spec: s => `spec ${s}`,
    coming: 'The mandate comes with Ledge’s brain.', rules: 'Rules', toValidate: 'to approve',
    applied: n => `applied ${n} ${plural(n, 'time', 'times')}`
  },
  conv: {
    days: { today: 'Today', yesterday: 'Yesterday', date: day => `${day.slice(8, 10)}/${day.slice(5, 7)}` },
    age: { now: 'just now', minutes: n => `${n} min`, hours: n => `${n} h`, days: n => `${n} d`, ago: span => `${span} ago` },
    you: 'you', ledge: 'Ledge',
    advice: text => `My take: ${text}`, talk: 'Talk it over', seen: 'Seen',
    by: { user: 'by you', ledge: 'by Ledge' },
    already: 'Already answered', closed: 'Settled elsewhere', grace: 'Ledge is on it…', sending: 'sending…',
    refused: (code, reason) => `Refused: ${reason ?? code}`,
    decided: { before: 'I settled for ', after: summary => `: ${summary.replace(/[.\s]+$/, '')}.` },
    rule: rule => `Rule ${rule}`, revisit: 'Revisit',
    revisitRefused: reason => `Revisit: ${reason === 'not supported yet' ? 'not possible yet, Ledge’s brain is coming' : reason}`,
    exchanges: n => (n === 1 ? '1 exchange' : `${n} exchanges between agents`),
    unfold: '↵ unfold', fold: 'z fold', missing: n => `${n} older ${plural(n, 'exchange', 'exchanges')} not loaded yet`,
    choose: 'j k to choose it, then 1 2…',
    about: summary => `Question · about ${summary}`
  },
  compose: {
    title: 'Write to Ledge', placeholder: 'Write to Ledge… (@build for an agent of a rig)',
    foot: 'decides within its mandate · design, architecture and critique are yours', footShort: 'design, architecture, critique are yours',
    launchRig: 'Launch a rig…', whereIs: rig => `Where is ${rig}?`, decided: 'What did you decide?', needsMe: 'Who needs me?',
    alt: n => `alt+1…${n}`, mentionTitle: '@ an agent of a rig'
  },
  room: {
    rig: 'rig', mark: 'its room, its table', seats: (n: number) => `${n} ${n > 1 ? 'seats' : 'seat'}`, since: (at: string) => `since ${at}`,
    lead: (seat: string) => `lead ${seat}`, unreachable: 'unreachable',
    head: { seat: 'SEAT', name: 'NAME', state: 'STATE', agent: 'AGENT', context: 'CONTEXT', on: 'ON', role: 'ROLE' },
    exchanges: (rig: string) => `Exchanges · ${rig}`, rigSend: 'rig send', loading: 'Loading the exchanges…',
    queue: (scope: string) => `OpenRig queue · ${scope}`, all: 'all', emptyQueue: 'Queue empty.',
    queueState: { 'en cours': 'in progress', 'à toi': 'yours', fait: 'done' },
    terminal: (seat: string, where: string) => `Terminal · ${seat} · ${where}`, noTerminal: 'No terminal followed yet.',
    kernel: 'OpenRig core · the machinery', kernelMark: 'always on', kernelWhere: 'core', orders: 'Ledge’s orders to the operator',
    daemon: { running: 'daemon running', stopped: 'daemon stopped', starting: 'daemon starting', error: 'daemon failing', unreachable: 'unreachable', absent: 'OpenRig absent', unsupported: 'unsupported version' },
    version: (v: string) => `OpenRig ${v}`, human: (address: string) => `human: ${address}`, noHuman: 'human not registered',
    tucked: (n: number) => `+${n} tucked away`, advisor: '(Ledge’s double)', humanSeat: '(replaced by Ledge)',
    roles: { operator: 'runs OpenRig, takes Ledge’s orders', queue: 'sorts the incoming flow into tasks' },
    you: 'you', noTerminalCommand: (seat: string) => `No terminal to attach for ${seat}.`
  },
  rigAct: {
    keys: { restart: 'restart', stop: 'stop…', adopt: 'file in a project…', resume: 'resume', choose: 'choose', confirm: 'confirm', cancel: 'cancel' },
    restartSeat: 'Restart a seat…', stopRig: 'Stop the rig…', adoptRig: 'File in a project…', resumeRig: 'Resume',
    viaOpenRig: 'Restarting and stopping go through OpenRig: a kill on Ledge’s side would read as a crash.',
    restartAsk: seat => `Restart ${seat} through OpenRig?`, yes: '↵ yes', no: 'esc no',
    stopTitle: rig => `Stop ${rig}?`, stopAll: 'Stop the rig', stopSeat: seat => `Only this seat · ${seat}`,
    stopBody: n => `${n > 1 ? `Its ${n} seats stop` : 'Its seat stops'}. OpenRig keeps a snapshot to resume it. The files stay.`,
    adoptTitle: rig => `File ${rig} in a project?`, holds: repos => `already holds ${repos}`, leaveOut: 'Leave outside any project',
    adoptNote: (rig, project) => `${rig} keeps its room; its plate will say “in ${project}”. It does not become a second table of ${project}.`,
    stayNote: rig => `${rig} keeps its room, outside any project.`, adopt: 'File', cancel: 'Cancel',
    repos: 'Repos found on the way', how: { cloned: 'cloned by', opened: 'opened by', created: 'created by' },
    found: 'Spotted from the workspace’s git folders, then tied to the seat that cloned or opened them (hooks).',
    already: (repo, project) => `${repo} is already a repo of the project ${project}.`, noRepo: 'No repo found yet.',
    done: { down: rig => `${rig} is stopping`, stop: seat => `${seat} is stopping`, restart: seat => `${seat} is restarting`, up: rig => `${rig} is resuming`, adopted: (rig, project) => `${rig} filed in ${project}` },
    refused: {
      rig_managed: 'This seat belongs to its rig: stop or restart it from its room.', openrig_down: 'OpenRig is not answering.',
      unreachable: 'Machine unreachable.', failed: 'The action failed.', timeout: 'OpenRig did not answer (5 s).'
    }
  },
  seat: { waitsLedge: 'Waits for Ledge', working: 'Working', idle: 'Available', attention: 'Needs attention', starting: 'Starting', stopped: 'Stopped', crashed: 'Crashed', unreachable: 'Unreachable' },
  omp: { title: 'thread · OMP', foot: 'driven over RPC · nothing is typed in a terminal', you: 'you', writing: 'writing…', empty: 'The thread is coming…' },
  overview: {
    yours: n => `Yours · ${n}`, projects: 'Projects', exchanges: 'Messages', terminal: name => `Terminal · ${name}`, inColor: '· in color',
    nobodyWaits: 'Nobody is waiting for you.', noSession: 'No session. Press + to start one.', noPreview: 'No preview.', noExchange: 'No message yet.',
    sessions: n => `${n} ${plural(n, 'session', 'sessions')}`, outside: 'No project', offline: 'offline', readOnly: 'read-only',
    wantsToRun: 'Wants to run:', asks: 'Asks:', plan: 'Proposes a plan:', diff: 'Wants to edit:',
    allow: 'Allow', deny: 'Deny', always: 'Always', denyWithNote: 'Deny with a note',
    askLine: (name, question) => `? ${name} : ${question}`, askHint: (id) => `ledge decide ${id} "<answer>"`,
    near: (name, pct) => `${name} · ctx ${pct} % · H hand over`,
    reliefFailed: (name, why) => `The relief of ${name} failed: ${why}`,
    context: pct => `ctx ${pct} %`,
    relief: { briefing: 'relief: brief asked', launching: 'relief: launching…', done: 'relieved', failed: 'relief failed' },
    relievedBy: name => `relieved by ${name}`, relieves: name => `relieves ${name}`,
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
    loading: 'Loading the thread…', empty: 'Nothing in this thread yet.', noSession: 'Pick a session on the home screen.',
    model: m => `model: ${m}`, defaultModel: 'default', notice: 'Ledge',
    seatTitle: (name, address, rig) => `Write to ${name} · ${address} · ${rig}`, seatPlaceholder: name => `Write to ${name}…`,
    seatRemote: 'This seat is on another machine: write to it from there.',
    seatFoot: 'rig send signed by Ledge · the exchange also shows in Ledge’s thread'
  },
  ask: {
    title: (s, m) => `Ledge · sees ${s} ${plural(s, 'session', 'sessions')}, ${m} ${plural(m, 'machine', 'machines')}`,
    read: 'read', reading: 'Ledge is reading…', you: 'you', empty: 'Ask anything: who needs me, how a session is doing, what to start…',
    launchCard: 'New session', relayCard: name => `Relay to ${name}`, closeCard: 'Close sessions', launch: 'Launch the session',
    relay: 'Send', cancelRelay: 'Take it back', close: 'Close', ignore: 'Ignore', nothingWithoutYou: 'Ledge starts nothing without you.',
    folder: 'Folder', agent: 'Agent', instruction: 'Instruction', launched: 'launched', queued: 'queued', sentAt: 'sent', closed: 'closed',
    offline: 'The local daemon is offline: the question will wait.',
    steps: { sessions: 'the sessions', pane: n => `${n}'s terminal`, reply: n => `${n}'s reply`, git: n => `${n}'s git state`, repo: p => p },
    operator: (s, m) => `Ledge · Operator · sees ${s} ${plural(s, 'session', 'sessions')}, ${m} ${plural(m, 'machine', 'machines')}`,
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
    launching: 'Launching…', launched: name => `✓ ${name} is started`,
  },
  rigLaunch: {
    title: 'New rig · the goal, the spec, where', planTitle: 'New rig · Ledge’s plan', startTitle: 'New rig · the start',
    crumb: 'Launch › the goal · (the plan) · the start', mode: 'Mode', rig: 'rig', session: 'session',
    goal: 'Goal', goalHint: 'Ledge uses it to propose the plan, then to decide along the way.',
    spec: 'Spec', specsLoading: 'reading the specs…', specsFailed: 'The specs could not be read.', noSpec: 'no spec', recommended: 'recommended by Ledge',
    seatsOf: (n, names, runtimes) => `${n} ${plural(n, 'seat', 'seats')}: ${names} · ${runtimes}`,
    where: 'Where', inProject: 'in a project', offProject: 'off any project (new space)',
    whereHint: project => `The rig gets its own room, “in ${project}” on its plate.`, offHint: 'Ledge makes an empty space, named after the goal.',
    repo: 'Repository', noRepo: (project, machine) => `${project} has no repository on ${machine}`,
    branch: 'Branch', newBranch: '(new)', copyRow: 'Copy', copy: 'Work in a copy', machine: 'Machine',
    name: 'Name', nameHint: '(from the goal · ctrl+r for another)', preview: 'Preview',
    previewLine: (spec, where, n, machine) => ` · rig ${spec} · ${where} · ${n} ${plural(n, 'seat', 'seats')} · ${machine}`,
    inProjectOf: project => `in ${project}`, offPlace: 'off any project',
    launch: 'Launch', seePlan: 'See the plan', cancel: 'Cancel', launchRig: 'Launch the rig', back: 'Back',
    planOptional: 'Optional plan: the rig writes in a .worktrees/ copy.', planImposed: 'The plan is asked once: the rig would write in your repository.',
    why: {
      absent: m => `OpenRig is not installed on ${m}`, unsupported: m => `The OpenRig version on ${m} is not supported`,
      offline: m => `${m} is offline`, unreachable: m => `OpenRig is unreachable on ${m}`
    },
    install: 'To install it:',
    missing: { goal: 'Give the lead a goal.', spec: 'Pick a spec.', repo: 'Pick a repository.', branch: 'Name the new branch.', name: 'Invalid name: lowercase letters, digits and dashes.' },
    preparing: 'Ledge is preparing the plan…', launching: 'Launching…', refused: why => `Refused: ${why}`, timeout: s => `no answer after ${s} s`,
    plan: {
      intro: 'Here is how I would set the rig up. Nothing is launched.', head: { seat: 'SEAT', agent: 'AGENT', autonomy: 'AUTONOMY' },
      folder: 'Folder', writes: 'Adds to the folder:', command: 'Command'
    },
    starting: {
      openrig: 'OpenRig', preparing: 'preparing the launch…', running: 'running', copy: 'Copy', folder: 'Folder', space: 'Space',
      human: 'Ledge, the rig’s human', humanCommand: 'rig gateway human add ledge', up: name => `rig up ${name}`,
      upDetail: (spec, n) => `spec ${spec} · ${n} ${plural(n, 'seat', 'seats')}`,
      seats: 'Seats', ready: (k, n) => `${k}/${n} ready`,
      coming: names => `${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]} ${names.length > 1 ? 'are' : 'is'} starting…`,
      attention: names => `${names.join(', ')}: needs attention`,
      tasks: 'First tasks', tasksWait: 'queued as soon as the seats are ready', tasksSent: lead => `goal given to ${lead}`
    },
    trust: seat => `${seat} waits for your trust in the folder · ↵ open the prompt`,
    openRoom: 'Open its room', cancelLaunch: 'Cancel the launch', backToLedge: 'Back to Ledge',
    leave: 'You can go: Ledge will tell you if the start gets stuck.', notNamed: 'The rig has no name yet: nothing to cancel for now.',
    cancelled: name => `${name}: launch cancelled`,
    keys: { mode: 'rig or session', seePlan: 'see the plan', openRoom: 'open its room', trust: 'open the prompt', cancelLaunch: 'cancel the launch', ledge: 'Ledge' }
  },
  settings: { title: 'Settings', language: 'Language', theme: 'Theme', themes: { auto: 'Auto', dark: 'Dark', light: 'Light' }, themeAuto: tone => `Auto (${tone} background)`, context: 'Max context', contextHint: 'past it: hand over', contextUnknown: 'update the daemon', contextSaved: pct => `Max context: ${pct} %`, saved: 'Setting saved.', saveFailed: m => `Setting applied, but not saved: ${m}` },
  help: { title: 'Help', global: 'Everywhere', overview: 'Home', ledge: 'Ledge screen', rig: 'A rig’s room', session: 'Session', launch: 'Launch', settings: 'Settings', screens: 'switch screen', writeToSeat: 'write (local rig)', suggestions: 'suggestions', foldExchanges: 'fold exchanges', backNarrow: 'back (narrow)', launchRig: 'new rig/session', resumeSent: 'resume', answerFocus: 'decide', tabsKeys: 'tabs', rail: 'the summary · 100-139', fileIn: 'file (off-project)', field: 'Typing', wordBefore: 'delete the word before',
    more: (above, below) => [above ? `↑ ${above} above` : '', below ? `↓ ${below} below` : ''].filter(Boolean).join(' · ') },
  images: {
    capture: 'capture', size: (n: number) => formatBytes(n, 'en'), open: (key: string) => `${key} open in viewer`,
    tooLarge: 'Image too large, even reduced', notImage: 'This file is not an image', failed: 'Image not sent',
    max: '5 images per message at most', dialog: 'Answer the question first, the image will go after', none: 'No image in the clipboard',
    openFailed: (why: string) => `Image not opened: ${why}`
  },
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
