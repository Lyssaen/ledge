import { MESSAGE_MAX, type ActionErrorCode } from '@ledge/protocol';
import { actionWords, type ActionVars } from '@ledge/ui/chat/actionWords';

import type { Copy, Model } from './copy';

/** English counts only 1 as singular. */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** The first tab's name in English, as on Desktop (`ide.atoi`): design-ux, 2026-11-10 19:53Z. */
const ATOI = 'For you';

/** The phone app's strings in English, key for key with the French table of copy.ts. The words come first from the
 *  mockups' English column (docs/mockups/ledge-mobile-refonte), then from Ledge Desktop's en.ts. */
/** A sentence that opens on a name: « Your PC is offline ». */
const capEn = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const thisEn = (m: Model) => (m ? `this ${m}` : 'this device');
/** The device a passkey names, as the PC calls it: « the iPad », or its own name in quotes. */
const theEn = (name: string | undefined) => (!name || name === 'Android' ? 'the device' : /^(iPhone|iPad)$/.test(name) ? `the ${name}` : `“${name}”`);

export const en: Copy = {
  appName: 'Ledge',
  /** A percentage as the language writes it (« 84 % », "84%"). */
  percent: (n: number) => `${n}%`,
  /** The name beside the mark, in the header of the five tabs. */
  brand: 'Ledge',
  inbox: {
    /** A request's first line when it has no words of its own (Desktop's « Plan to approve »), and an age in the list. */
    plan: 'Plan to approve', diff: (file: string) => `Edit ${file}`,
    age: { s: (n: number) => `${n}s`, min: (n: number) => `${n} min`, h: (n: number) => `${n} h`, d: (n: number) => `${n} d` },
    title: ATOI,
    subtitle: (n: number) => n === 0 ? 'All quiet' : n === 1 ? '1 request. Choose where to start.' : `${n} requests. Choose where to start.`,
    filtersLabel: 'Filter the requests',
    filters: { all: 'All', permission: 'Permissions', question: 'Questions', tasks: 'Tasks' },
    /** With the closed tasks of Ledge (ledge home spec §2.4). */
    subtitleTasks: (requests: number, tasks: number) => {
      const r = requests === 0 ? '' : plural(requests, '1 request', `${requests} requests`);
      const t = plural(tasks, '1 task finished', `${tasks} tasks finished`);
      return `${r ? `${r} and ` : ''}${t}. Choose where to start.`;
    },
    taskDone: 'Task finished', taskClosed: 'Task closed',
    finishedTitle: (title: string) => `Finished “${title}”`, refusedTitle: (title: string) => `Refused “${title}”`, droppedTitle: (title: string) => `Dropped “${title}”`,
    ledgeTask: 'Ledge’s task', seeResult: 'See the result', putAway: 'Dismiss',
    oldestFirst: 'OLDEST FIRST',
    examine: 'Examine',
    lastKnown: 'Last known state',
    upToDate: 'You’re up to date',
    upToDateHint: 'No request is waiting for a decision.',
    seeAgents: 'See the sessions',
    emptyFilter: 'No request in this filter',
    emptyFilterHint: 'The other requests stay in “All”.',
    offlineNote: 'You can read the requests. No decision is sent while offline.'
  },
  nav: {
    label: 'Main navigation',
    /** The five tabs, the rail's Atelier and Settings (m0-socle.html, §1 and §2); the first one named by ATOI. */
    atoi: ATOI, sessions: 'Sessions', prs: 'MR/PR', rigs: 'Rigs', chat: 'Ledge', atelier: 'Atelier', settings: 'Settings',
    /** « Back », named after the screen it leads to; plain when that screen is not known (after a reload). */
    back: 'Back',
    backTo: { atoi: `Back to ${ATOI}`, sessions: 'Back to sessions', prs: 'Back to MR and PR', rigs: 'Back to rigs', chat: 'Back to Ledge', atelier: 'Back to the atelier', thread: 'Back to the thread', terminal: 'Back to the terminal', request: 'Back to the request', connection: 'Back to settings' } as Partial<Record<string, string>>
  },
  images: {
    attach: 'Attach an image', remove: 'Remove image', tooLarge: 'Image too large, even reduced', notImage: 'This file is not an image', max: '5 images per message at most',
    dialog: 'Answer the question first, the image will go after', failed: 'Image not sent',
    noPreview: 'Image too large for this device · open it on the PC', unavailable: 'Image unavailable',
    view: 'Image', share: 'Share', save: 'Save', close: 'Close', prev: 'Previous image', next: 'Next image'
  },
  chat: {
    title: 'Ledge',
    /** The Ledge tab of a PC that does not offer the chat (design-ux, M0 point 2). */
    unavailable: {
      title: (pc: string) => `${pc} does not offer the chat to this device yet`,
      body: 'The chat with Ledge comes with a later version of Ledge on the PC.',
      seeAtoi: `See “${ATOI}”`
    },
    subtitle: (agents: number, repos: number) => `This device’s thread · ${agents} ${plural(agents, 'agent', 'agents')}, ${repos} ${plural(repos, 'repo', 'repos')}`,
    point: {
      title: 'The point', label: 'The point', ago: (s: string) => `${s} ago`,
      yours: 'YOURS', yoursLabel: 'Yours', given: 'GIVEN BY LEDGE', givenLabel: 'Given by Ledge',
      yes: 'Yes', no: 'No', see: 'See', finished: 'finished its task', refused: 'refused its task', dropped: 'dropped its task',
      progress: (done: number, given: number) => `${done}/${given}`,
      state: { open: 'open', taken: 'taken', done: 'done', refused: 'refused', dropped: 'dropped' },
      calm: 'Nothing is waiting for you. Ask Ledge what you want to know or do.',
      near: (pct: number) => `context ${pct}%`, nearHint: 'The relief is started from the PC.',
      /** The harnesses' limits (docs/mockups/ledge-harness-usage.html, « LIMITES »): percent and reset only. */
      limits: 'LIMITS', limitsLabel: 'Limits', harness: { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent' } as Record<string, string>,
      harnessShort: { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' } as Record<string, string>,
      five: '5 h', week: 'Week', month: 'Month', poolCursor: 'Cursor', poolOther: 'Others', model: (m: string) => m,
      resumes: (at: string) => `resumes at ${at}`, resumesOn: (at: string) => `resumes on ${at}`, loading: 'Reading…',
      notOnPc: (harness: string) => `Cannot read: reconnect ${harness} on the PC.`,
      unread: 'Limit not read: Cursor does not give it for this plan.', unreach: (age: string) => `Not read for ${age}.`, unreachNever: 'Cannot read for now.', stale: (age: string) => `Read ${age} ago.`,
      reachedLabel: (h: string, w: string) => `${h} · ${w} reached`, overLabel: (h: string, w: string, p: number) => `${h} · ${w} at ${p}%`,
      /** A decision a session put to the user: answered in the chat, through the card Ledge proposes. */
      decision: 'Decision', asks: 'asks you', answer: 'Answer', answerLabel: (title: string) => `Answer “${title}”`,
      someone: 'A session',
      answerDraft: (title: string, id: string, name: string) => `Answer to the decision “${title}” (${id}) from ${name}: `,
      /** A proposal about the notes (docs/mockups/ledge-brain-notes.html, part 2): answered here, a « yes » with the device's check. */
      note: {
        tag: 'Note', add: (note: string) => `suggests adding to the note ${note}`, create: (note: string) => `suggests a new note ${note}`,
        flag: (note: string) => `flags the note ${note} as wrong or out of date`, source: (s: string) => `Source: ${s}`,
        yes: 'Add', edit: 'Edit', no: 'Refuse', mark: 'Mark to check', ignore: 'Ignore', createYes: 'Create the note', editYes: 'Add this text', cancel: 'Cancel',
        field: 'The text added under “Ajouts”', titleField: 'Title', whenField: 'When to read it',
        failed: 'Not sent: try again.', confirmRequired: 'Protect your accepts from Settings first: adding asks for this device’s passkey.', cancelled: 'Check cancelled. Nothing was written.', expired: 'The check expired. Start again.', stale: 'Already handled elsewhere.'
      }
    },
    task: {
      label: 'Task to give', give: 'Give',
      given: (name: string, id: string, state: string) => `Given to ${name} · ${id} · ${state}`, notGiven: 'Not given.'
    },
    reset: 'New conversation',
    suggestions: {
      waiting: 'Who is waiting on me for something?',
      session: (name: string) => `How far is ${name} with the wait badge?`,
      repo: (repo: string) => `What changed in ${repo} today?`
    },
    stop: 'Stop',
    stepsLabel: 'Steps',
    sources: 'Sources: ',
    field: 'Question for Ledge',
    placeholder: 'Ask Ledge…',
    send: 'Send the question',
    busy: 'Ledge is already answering other questions. Try again in a moment.',
    timeout: 'Ledge did not answer in time.',
    failed: 'Ledge could not answer.',
    cancelled: 'Question stopped.',
    offline: 'Offline: ask the question once the PC can be reached.',
    cut: 'Answer cut: the rest is on the PC.',
    relayLabel: 'Proposed instruction', launchLabel: 'Proposed session',
    relayHead: (name: string) => `Send to ${name}`,
    launchHead: (tool: string, project: string) => `Launch ${tool} in ${project}`,
    ignore: 'Ignore', relayGo: 'Send',
    queued: (name: string) => `Waiting: ${name} is busy.`,
    sentTo: (name: string) => `Sent to ${name} · `, launchedTo: 'Launched · ', seeThread: 'see their thread',
    notSent: 'Not sent.', notLaunched: 'Not launched.',
    relayCancel: 'Cancel', relayRetry: 'Retry',
    /** The target's state on the relay card, as the PC's pill. */
    relayPill: { yours: 'your turn', working: 'working', waiting: 'waiting for you', stopped: 'stopped' },
    /** Why a relay failed, from the PC's code (never its text). */
    relayFailed: (code?: string): string => ({
      read_only: 'Not sent: this session was not started by Ledge.',
      ended: 'Not sent: the session stopped before receiving it.',
      unknown_session: 'Not sent: the session no longer exists.',
      busy: 'Not sent: the session is closing or settling a decision.',
      not_taken: 'Not sent: the terminal did not take it.',
      no_prompt: 'Not sent: the session is waiting for an answer, answer it first.',
      not_offered: 'Not sent: the session is waiting for an answer, answer it first.',
      free_text: 'Not sent: the session is waiting for an answer, answer it first.',
      stale: 'Not sent: the card was ignored in the meantime.'
    } as Record<string, string>)[code ?? ''] ?? 'Not sent.',
    review: 'Review', ignoredRest: (at: string) => `The rest ignored at ${at}`,
    launchSetup: 'Protect your accepts from Settings first.',
    closeLabel: 'Sessions to close', closeRow: 'Close', closeAll: (n: number) => `Close all (${n})`,
    closing: 'Closing…', closed: 'Closed', killed: 'Closed by force', ended: 'Ended',
    closeFailed: 'Could not close', closeSetup: 'Protect your accepts from Settings first.',
    /** The generic card (#94, docs/mockups/ledge-action-card.html, « Téléphone »): the rows' lines are the PC's (actionWords). */
    action: {
      label: (n: number) => n > 1 ? `Plan of ${n} actions` : 'Proposed action',
      risk: { read: 'Read', reversible: 'Reversible', destructive: 'Irreversible' },
      step: (k: number) => `Step ${k}`,
      stepState: { done: (k: number) => `Step ${k}, applied`, failed: (k: number) => `Step ${k}, failed`, refused: (k: number) => `Step ${k}, refused`, running: (k: number) => `Step ${k}, running` },
      verbs: {
        'session.model': 'Change', 'session.interrupt': 'Interrupt', 'session.archive': 'Archive', 'session.restore': 'Restore', 'session.resume': 'Resume',
        'session.decide': 'Accept',
        'task.cancel': 'Drop', 'task.pass': 'Hand over', 'task.answer': 'Answer', 'note.add': 'Add'
      } as Record<string, string>,
      apply: 'Apply', deny: 'Deny', ignore: 'Ignore', review: 'Review', retry: 'Retry', running: 'Running…',
      done: (at: string) => `Applied${at ? ` · ${at}` : ''}`, refusedState: 'Refused', denied: (at: string) => `Denial sent${at ? ` · ${at}` : ''}`,
      open: (name: string) => `Open ${name}`,
      failed: (why: string) => `Failed: ${why}`, refused: (why: string) => `Refused: ${why} Nothing was sent.`,
      held: (k: number) => `Not applied: the plan stopped at step ${k}.`,
      stale: 'The request has changed since: nothing was sent.',
      deniedNote: (name: string) => `${name} got your denial: the command did not run.`,
      cutMark: 'Request cut: the rest is on the PC.',
      cutNote: 'Request too long for this device: it is accepted on the PC. You can deny it from here.',
      all: (n: number) => `Apply all (${n})`, resume: (k: number, n: number) => `Resume at step ${k} (${n})`, skip: (k: number, n: number) => `Continue without step ${k} (${n})`,
      inOrder: 'In order, stops at the first failure.', notReplayed: 'Steps already done are not replayed.',
      progress: (k: number, n: number) => `Step ${k} of ${n}…`, planDone: (at: string) => `Plan applied${at ? ` at ${at}` : ''}`,
      notSent: 'Not sent. Try again.',
      sheet: { many: (n: number) => `Apply these ${n} actions, in order?`, one: (line: string) => `${line}?`, stops: 'If a step fails, the next ones are not applied.', cancel: 'Cancel' },
      ignored: (n: number, at: string, sent: { done: number; denied: number; failed: number }) => {
        const went = [
          ...(sent.done ? [`${sent.done} applied`] : []),
          ...(sent.denied ? [`${sent.denied} ${plural(sent.denied, 'denial sent', 'denials sent')}`] : []),
          ...(sent.failed ? [`${sent.failed} failed`] : [])
        ];
        if (!went.length) return `${n > 1 ? `Plan of ${n} actions ignored` : 'Card ignored'} at ${at} · nothing was sent`;
        return n > 1 ? `Plan of ${n} actions: ${went.join(', ')}, the rest ignored at ${at}` : `Card ignored at ${at} · the action went, but did not go through`;
      },
      /** A row's line, from its words; undefined when one is missing (the daemon's summary then). */
      line: (action: string, v: ActionVars): string | undefined => actionWords.en.line[action]?.(v),
      kind: actionWords.en.kind,
      /** Why a row was refused or failed: the PC's words, with the phone's own sentences where it asks something of the user. */
      why: (code: ActionErrorCode | undefined, action: string | undefined, v: ActionVars): string => {
        if (code === 'changed') return 'things have changed since: ask Ledge again.';
        if (code === 'not_decision') return v.task ? `the task “${v.task}” is not a decision put to you.` : 'this task is not a decision put to you.';
        return actionWords.en.why(code, action, v);
      }
    },
    steps: {
      sessions: (n: number) => `Reads the ${n} sessions…`,
      pane: (name: string) => `Looks at ${name}’s terminal…`,
      reply: (name: string) => `Reads ${name}’s last reply…`,
      look: (name: string) => `Looks at ${name}…`
    }
  },
  agents: {
    title: 'Sessions',
    subtitle: (sessions: number, projects: number) => `${sessions} ${plural(sessions, 'session', 'sessions')} · ${projects} ${plural(projects, 'project', 'projects')} on this PC`,
    offline: 'Last known state · connection lost',
    unread: '● Unread',
    working: 'Working on the latest changes.',
    state: { working: 'Working', idle: 'Available', exited: 'Ended', error: 'Error' },
    empty: 'No session on this PC', emptyHint: 'The agents launched from Ledge appear here.',
    open: (name: string, task: string) => `${name} · ${task}`,
    /** « Write to the group »: one message to every session of a group. */
    writeGroup: 'Write to the group', writeGroupLabel: (group: string) => `Message to the whole group ${group}`, writeGroupPlaceholder: 'A message for the whole group',
    send: 'Send', cancel: 'Cancel', sending: 'Sending…',
    sentTo: (names: string[]) => `Sent to ${names.join(', ')}`,
    refusedLine: (name: string, reason: string) => `${name}: ${reason}`,
    tooMany: (n: number, max: number) => `${n} sessions in this group, ${max} at most: write to them from the PC`,
    nobody: 'Nobody to write to', notSent: 'Message not sent', uncertain: 'Message sent; check on the PC',
    /** A session's context and relief (context handover spec §3.2): shown here, started from the PC. */
    context: (pct: number) => `context ${pct}%`,
    relief: { briefing: 'relief: brief asked', launching: 'relief: launching…', done: 'relieved', failed: 'relief failed' } as Record<'briefing' | 'launching' | 'done' | 'failed', string>,
    relievedBy: (name: string) => `relieved by ${name}`, relieves: (name: string) => `relieves ${name}`
  },
  link: {
    online: 'connected', offline: 'disconnected',
    /** The header's way to the connection screen, for screen readers. */
    openConnection: 'This device’s settings',
    lostTitle: 'Connection to the PC lost',
    lostBody: 'The PC, the network or Tailscale is unavailable. The requests below may have changed.',
    lostDetail: 'Last known state. Reconnect to check whether this request is still waiting for a decision.',
    lastKnownAt: (t: string) => `Last known state · ${t}`,
    /** A tab before the PC's first state (m0-socle.html, §4). */
    connecting: (pc: string) => `Connecting to ${pc}…`,
    reconnect: 'Reconnect and refresh',
    reconnecting: 'Reconnecting…'
  },
  /** A request's badge: the desktop's words for what waits on the user. */
  kind: { permission: 'Your approval', question: 'A question', plan: 'Plan', diff: 'Change' },
  tools: { claude: 'Claude Code', codex: 'Codex', cursor: 'Cursor Agent', omp: 'OMP' },
  /** Changing a live session's model and effort (the chip above the reply field and its sheet). */
  model: {
    title: 'Model and effort',
    subtitle: (tool: string) => `The models of ${tool} known to the PC`,
    byDefault: 'By default',
    defaultHint: 'The one the agent picks itself',
    current: 'current',
    effortTitle: 'Effort',
    effortHint: 'Thinking time per turn',
    noteIdle: (name: string) => `${name} restarts on the same conversation and keeps its context.`,
    noteWorking: (name: string) => `${name} is working: the change waits for the end of its turn.`,
    apply: 'Apply',
    cancel: 'Cancel',
    cancelPending: 'Cancel the change',
    nextTurn: 'next turn',
    listError: 'Model list unavailable',
    applied: 'Applied',
    scheduled: 'Applied at the next turn',
    notApplied: 'Model change not applied',
    uncertain: 'Model change sent; check on the PC',
    failed: {
      not_launched: 'not started by Ledge', ended: 'session ended', no_conversation: 'no conversation to resume',
      not_running: 'the agent is not running', effort_in_model: 'this tool takes the effort in the model',
      restart_failed: 'the restart failed', refused: 'refused by the tool'
    },
    failedLine: (reason: string) => `Model change not applied: ${reason}`,
    chip: (what: string) => `Model and effort: ${what}`,
  },
  detail: {
    back: 'Back to requests',
    heading: { permission: 'A permission', question: 'A question', plan: 'A plan', diff: 'Changes' },
    commandTitle: 'Command to allow',
    branch: 'Branch', asked: 'Asked',
    ago: (age: string) => `${age} ago`,
    context: 'Context of the request',
    options: 'Suggested answers',
    editsInProject: 'Change in the project',
    editsInProjectBody: 'The file will be changed in this session’s folder, and nowhere else.',
    destination: 'Destination'
  },
  decide: {
    deny: 'Deny', allow: 'Allow once',
    onPc: 'To accept on the PC',
    onPcHint: 'A high-impact request is accepted on the PC. You can deny it from here.',
    hint: 'The decision is sent to the PC at once.',
    offlineHint: 'No decision is sent while offline.',
    readOnly: 'Session started outside Ledge: answer in the terminal.',
    answerOnPc: 'This agent cannot receive a free answer from a linked device. Answer on the PC.',
    answerHint: 'The answer is sent to the PC at once.',
    send: 'Send my answer',
    otherInvalid: `The PC did not accept this answer. Fix it: it must fit on one line of ${MESSAGE_MAX} characters at most.`,
    otherUnsupported: 'This agent cannot receive a free answer from a linked device. Pick an option or answer on the PC.',
    sending: 'Sending to the PC…', sendingBody: 'Waiting for the terminal to confirm.',
    uncertain: 'Receipt not confirmed',
    uncertainBody: 'The connection was lost while sending. The decision may have arrived. Check its state before trying again.',
    check: 'Reconnect and check', checking: 'Checking…',
    changed: 'The request was updated. Read it again before deciding.',
    reread: 'I have read the request again',
    busy: 'Another decision is in progress on the PC.',
    notTaken: 'The terminal did not confirm. The request is still waiting.',
    noPrompt: 'The terminal no longer shows the request. Open it on the PC.',
    failed: 'The decision could not be sent.'
  },
  result: {
    header: 'Request handled',
    allowed: 'Permission taken', denied: 'Denial taken', answered: 'Answer taken',
    body: 'The terminal received your decision. It now shows in this session’s thread.',
    thread: (bot: string) => `See ${bot}’s thread`,
    final: 'A decision once sent cannot be cancelled.',
    back: 'Back to requests'
  },
  /** Closing a session from its page, and resuming it once ended (mockup mobile-session-close). */
  sessionEnd: {
    close: (bot: string) => `Close ${bot}`, closingNamed: (bot: string) => `Closing ${bot}`,
    closeTitle: (bot: string) => `Close ${bot}?`,
    closeBody: 'Ledge quits the agent cleanly, like /exit in its terminal. Its conversation is kept: you can resume it from here or from the PC.',
    cutsTitle: 'What closing cuts off',
    working: (bot: string) => `${bot} is working: its current turn will be interrupted. What is done stays done.`,
    turn: (bot: string) => `${bot}’s current turn will be interrupted. What is done stays done.`,
    request: 'The waiting request will be denied.', question: 'The waiting question will stay unanswered.',
    helpers: (n: number) => n === 1 ? '1 sub-agent stops with the session.' : `${n} sub-agents stop with the session.`,
    force: 'If the agent does not respond, Ledge closes its terminal by force.',
    check: 'A check on your device will be asked for.',
    goClose: 'Close with my device', goCloseApple: 'Close with Face ID',
    resumeTitle: (bot: string) => `Resume ${bot}?`,
    resumeBody: 'The agent restarts on its conversation, in the same folder and on the same branch.',
    goResume: 'Resume with my device', goResumeApple: 'Resume with Face ID',
    cancel: 'Cancel',
    offlineTitle: 'PC unreachable',
    offlineClose: (bot: string) => `Reconnect to close ${bot}. Nothing was sent.`,
    offlineResume: (bot: string) => `Reconnect to resume ${bot}. Nothing was sent.`,
    reconnect: 'Reconnect',
    unprotectedTitle: 'Check not possible',
    unprotectedClose: (bot: string) => `Protect your accepts from Settings first. You can also close ${bot} on the PC.`,
    unprotectedResume: (bot: string) => `Protect your accepts from Settings first. You can also resume ${bot} on the PC.`,
    openConnection: 'Open Settings',
    closing: (bot: string) => `Closing ${bot}…`,
    closingHint: 'The agent finishes what it is typing, then quits. This can take up to 30 s.',
    ended: 'Session ended',
    endedBody: 'Its conversation is kept. Resuming restarts the agent on this conversation, in the same folder.',
    endedOnPc: 'Its conversation is kept: resume it from the PC.',
    killed: 'Closed by force: the agent was not responding. Its last turn may be missing.',
    resume: (bot: string) => `Resume ${bot}`,
    resuming: (bot: string) => `Resuming ${bot}…`,
    closedHere: (time: string) => `Session closed from this device · ${time}`,
    notClosed: (bot: string) => `${bot} was not closed`,
    closeFailed: 'The PC could not stop the agent. Check on the PC, or try again.',
    readOnly: 'It was started outside Ledge: close it in its terminal on the PC.',
    uncertainTitle: 'Close not confirmed',
    uncertain: (bot: string) => `The connection was lost. ${bot} may already be closed: its state will update on reconnection.`,
    notResumed: (bot: string) => `${bot} did not resume`,
    resumeUncertainTitle: 'Resume not confirmed',
    resumeUncertain: (bot: string) => `The connection was lost. ${bot} may already have resumed: its state will update on reconnection.`,
    noConversation: 'No conversation to resume for this session.',
    resumeFailed: 'The PC could not restart the agent. Check on the PC, or try again.',
    retry: 'Retry',
    /** Next to « Ended » in the list: today's time, yesterday, or the day. */
    at: (time: string) => `at ${time}`, yesterday: 'yesterday', on: (day: string) => `on ${day}`
  },
  thread: {
    back: 'Back to sessions', title: 'Conversation with an agent',
    terminal: (bot: string) => `Open ${bot}’s terminal`,
    log: (bot: string) => `Exchanges with ${bot}`,
    cut: 'Message shortened', more: 'Older messages on the PC',
    loading: 'Loading the thread…', unavailable: 'Thread unavailable offline', empty: 'No exchange yet.',
    unknown: 'This session no longer exists on the PC.', unknownBack: 'Back to sessions',
    suggestion: 'Suggestion for what’s next',
    capture: 'Capture',
    agentLabel: 'Agent’s answer',
    awaiting: `Decision expected · in “${ATOI}”`, examine: 'Examine the request',
    event: {
      accept: (from: string) => `Accept taken · from ${from}`,
      deny: (from: string) => `Denial taken · from ${from}`,
      answer: (option: string) => `Answer taken · ${option}`,
      resolved: 'Handled in the terminal', interrupt: 'Interrupt sent',
      fromPc: 'the PC', fromHere: 'this device',
      /** Another linked device, by the name it had when it decided. */
      fromDevice: (name: string) => name
    },
    /** Claude Code's `<task-notification>`, as the desktop's task card says it. */
    task: {
      kicker: 'Task', statuses: { killed: 'Stopped', completed: 'Done', failed: 'Failed', other: 'Notified' },
      agent: 'The agent', command: 'The command',
      agentDid: { killed: 'was stopped. It can resume if you write to it.', completed: 'finished in the background.', failed: 'failed in the background.', other: 'stopped.' },
      commandDid: { killed: 'was stopped.', completed: 'finished in the background.', failed: 'failed in the background.', other: 'stopped.' },
      code: (c: string) => `exit ${c}`, raw: 'Raw notification', label: (status: string) => `Task · ${status}`
    },
    delivery: { sending: 'Sending to the PC…', taken: 'Taken by the terminal', takenNow: 'Taken by the terminal · just now', uncertain: 'Receipt not confirmed' },
    /** OpenRig's messages in a seat's thread (docs/mockups/openrig-messages, section « Téléphone » and its copy table). */
    rig: {
      from: 'From', to: 'To', reply: 'Reply', replyTo: (n: string) => `Reply to ${n}`,
      raw: 'Raw', command: 'Command', rawMany: (k: number) => `${k} messages pasted together · raw`,
      twice: (k: number) => `received ${k} times`,
      unreadable: 'Unreadable OpenRig message · shown as is',
      /** Put in the composer of the sender's session: ordinary text the person edits. */
      about: (line: string) => `About: “${line}”`,
      sent: { sending: 'sending…', delivered: '✓ delivered', read: '✓ read', failed: 'not delivered' },
      rowIn: (n: string) => `Handed to you by ${n}`, rowOut: (n: string) => `Passed to ${n}`,
      rowState: { unknown: 'state not tracked', refused: 'not handed off', pending: 'waiting', taken: 'taken', passed: (n: string) => `passed to ${n}`, blocked: 'blocked', done: 'done' },
      /** A row's short log, read live. */
      log: { handed: (t: string) => `handed ${t}`, passed: (t: string) => `passed ${t}`, taken: (t: string) => `taken ${t}`, done: (t: string) => `done ${t}`, notTaken: 'not taken yet' },
      /** The short log of a handoff OpenRig refused: when it was passed, and what OpenRig said. */
      refusedSaid: (time: string, said: string) => `passed ${time} · OpenRig: ${said}`,
      refusedSilent: (time: string) => `passed ${time} · not handed off by OpenRig`,
      openrig: 'OpenRig',
      unblocked: (id: string) => `Blocker cleared: row ${id} is to do again`,
      stalled: (id: string, min: number) => `Row ${id} with no progress for ${min} min`,
      folded: (k: number) => `${k} OpenRig ${plural(k, 'notice', 'notices')}`
    },
    slash: {
      label: (tool: string) => `${tool} commands`, count: (tool: string, n: number) => `${tool} · ${n} ${plural(n, 'command', 'commands')}`,
      loading: (tool: string) => `${tool} · reading the commands…`,
      unavailable: (bot: string) => `Command list unavailable. You can still type the command: Ledge sends it to ${bot} as is.`,
      none: (q: string, bot: string) => `No command “${q}”. It will go to ${bot} as a message.`,
      source: { builtin: '', project: 'Project', user: 'Personal', plugin: 'Plugin', extension: 'Extension' } as Record<string, string>,
      blocked: { panel: 'Opens a terminal panel', close: 'Would end the session: close it from Ledge' } as Record<string, string>,
      bare: (c: string) => `Without arguments, /${c} opens a terminal panel: give it one.`
    },
    composer: {
      label: (bot: string) => `Message for ${bot}`, send: (bot: string) => `Send to ${bot}`,
      quickLabel: 'Quick instructions',
      placeholder: { idle: (bot: string) => `Write to ${bot}…`, working: 'The agent is working…', awaiting: 'Handle the request above', offline: 'Reconnect to write', connecting: 'Connecting…', ended: 'Session ended', readOnly: 'Answer in the terminal' },
      status: { idle: 'Available for your instruction', working: 'Working · see the terminal', awaiting: 'Waiting for a decision', offline: 'Connection lost · last known state', connecting: 'Connecting…', sending: 'Sending to the PC…', taken: 'Instruction received · the agent resumes', ended: 'Session ended', readOnly: 'Session started outside Ledge' },
      reconnect: 'Reconnect', tooLong: (max: number) => `The message is too long: ${max} characters at most.`,
      untypable: 'The message must fit on one line, with no line break or control character.',
      failTitle: 'Message not sent', uncertainTitle: 'Receipt not confirmed',
      lost: 'The PC cannot be reached. Your draft is kept.',
      imageGone: 'An image is no longer available: remove it and paste it again. Your draft is kept.',
      busy: 'The agent is no longer available for an instruction. Your draft is kept.',
      invalid: (max: number) => `The PC did not accept the message (${max} characters at most). Your draft is kept.`,
      readOnly: 'This session was started outside Ledge: write in the terminal.',
      forbidden: 'This device is no longer allowed. Your draft is kept.',
      uncertain: 'The connection was lost or the terminal did not confirm. The message may have arrived: check the terminal before sending it again. Your draft is kept.'
    }
  },
  terminal: {
    title: (bot: string) => `${bot}’s terminal`, back: 'Back to the thread',
    live: 'Read only · live', waiting: 'Read only · waiting', offline: 'Read only · last known state',
    smaller: 'Smaller text', larger: 'Larger text',
    output: 'Terminal output, horizontal scrolling', empty: 'No output yet.', unknown: 'This session no longer exists on the PC.',
    scrollHint: 'Scroll sideways to read long lines.',
    interrupt: (bot: string) => `Interrupt ${bot}`, sending: 'Interrupting…', sent: 'Interrupt sent',
    note: 'Interrupting does not undo actions already done.',
    why: { waiting: 'A decision is waiting: handle it first.', offline: 'Reconnect to interrupt.', idle: 'The agent is not working.' },
    fail: 'The interrupt was not sent. Check the terminal on the PC.',
    readOnly: 'Session started outside Ledge: interrupt it in the PC’s terminal.',
    uncertain: 'Receipt not confirmed: check the terminal before trying again.',
    /** The live terminal (spec 2026-11-02 mobile terminal, mockup docs/mockups/mobile-terminal.html). */
    live2: {
      meta: (project: string, cols: number, rows: number) => `${project} · ${cols} × ${rows}, PC size`,
      ended: (project: string) => `${project} · ended`,
      status: { connecting: 'Connecting to the terminal…', live: 'Live · read only', held: 'At the keyboard', offline: 'Connection lost · last screen known', ended: 'Session ended', refused: 'Terminal unavailable' },
      view: 'View', readable: 'Readable', fit: 'Fit',
      screen: (bot: string) => `${bot}’s terminal`,
      position: 'Visible part of the columns',
      hold: 'Take over', holdAgain: 'Take over again', release: 'Hand back',
      inputOff: 'To type here, turn on “Type into terminals from a linked device” on the PC, in Mobile access.',
      offlineHint: 'The screen comes back as soon as the PC answers.',
      back: 'Back to the thread',
      heldTitle: (bot: string) => `You are typing in ${bot}`,
      heldLeft: (left: string) => `Hand given back in ${left} without a key press`,
      heldTag: 'At the keyboard',
      released: { idle: 'Hand given back: 5 minutes without a key press.', expired: 'Hand given back: 30 minutes passed.', background: 'Hand given back: the app went to the background.', pc: 'The PC took the hand back.', link: 'Hand given back: connection lost.' },
      exit: { ended: null, gone: (bot: string) => `${bot}’s terminal no longer exists on the PC.`, closed: null, superseded: 'The terminal was opened elsewhere on this device.', failed: 'The PC could not follow this terminal.' },
      refused: { read_only: 'Session started outside Ledge: open its terminal on the PC.', unknown_session: 'This session no longer exists on the PC.', unavailable: 'The PC cannot show this terminal.' } as Partial<Record<string, string>>,
      holdRefused: { conflict: 'Another device is already typing in this terminal.', read_only: 'Session started outside Ledge: type in its terminal on the PC.', unavailable: 'The PC no longer allows typing from a linked device.' } as Partial<Record<string, string>>,
      sheetTitle: (bot: string) => `Type in ${bot}’s terminal?`,
      sheetBody: 'What you type goes as is into its terminal on the PC, like at the PC\'s keyboard. That includes a permission request: it then skips the device check.',
      sheetNote: 'The hand is taken back after 5 minutes without a key, after 30 minutes, or as soon as the app goes to the background. The PC shows this device’s name “at the keyboard” and can take the hand back.',
      go: 'Check and take over', cancel: 'Cancel',
      unprotectedTitle: 'Protect your accepts from Settings first.', unprotectedBody: 'Taking over asks for this device’s passkey, like closing a session.', openConnection: 'Open Settings',
      keys: 'Special keys',
      key: { esc: 'Esc', tab: 'Tab', ctrl: 'Ctrl', alt: 'Alt', left: '←', up: '↑', down: '↓', right: '→', enter: '↵', interrupt: '^C', paste: 'Paste', line: 'Line' },
      keyLabel: { esc: 'Escape', tab: 'Tab', ctrl: 'Control', alt: 'Alt', left: 'Left arrow', up: 'Up arrow', down: 'Down arrow', right: 'Right arrow', enter: 'Enter', interrupt: 'Control C', paste: 'Paste', line: 'Line mode' },
      armed: 'armed', locked: 'locked',
      lineField: 'Line to type in the terminal', lineSend: 'Type the line', withEnter: 'With ↵',
      pasteFailed: 'Nothing to paste, or the device refused access to the clipboard.'
    }
  },
  question: {
    legend: 'Choose an answer',
    other: 'Other answer',
    fieldLabel: (bot: string) => `Your answer to ${bot}`,
    placeholder: 'Specify your choice…',
    long: (max: number) => `The answer is too long (${max} characters at most).`,
    untypable: 'The answer must fit on one line, with no line break or control character.',
    digit: 'A lone digit would be read as an option\'s number. Choose the option above, or write the answer out in words.'
  },
  /** OMP's dialogs: an option to tap, or every question of an `ask` answered together. */
  answers: {
    send: 'Send the answers',
    cancel: 'Cancel the request',
    missing: (n: number) => `${n} ${plural(n, 'question', 'questions')} unanswered`,
    change: 'Choose another answer',
    legend: 'Choose an option'
  },
  consequence: {
    forceTitle: 'Can replace the remote history',
    forceBody: (dest?: string) => `The commits on ${dest ?? 'the remote repository'} may be overwritten. Other people working on this branch may be affected.`,
    pushTitle: 'Publishes to a remote repository',
    pushBody: 'The changes will be visible to the people who have access to this repository.',
    configuredRemote: 'the configured remote repository',
    destroys: ['Deletes files or changes', 'Files or unsaved changes may be lost.'],
    deploys: ['Changes a deployment or infrastructure', 'A live environment may change or become unavailable.'],
    publishes: ['Publishes a package', 'A published version may already have been downloaded and cannot always be withdrawn.'],
    pipes_to_shell: ['Runs a downloaded script', 'The downloaded code runs unread, with this session\'s permissions.'],
    network: ['Reaches the network', 'The command can send or receive data over the network.'],
    writes_outside_folder: ['Writes outside the session’s folder', 'The command can change files outside this session’s folder.'],
    sensitive_path: ['Touches a sensitive file', 'This file may hold secrets or sensitive configuration.'],
    script: ['Runs a script from the repository', 'It runs with this session\'s permissions and can change files or reach the network.'],
    plan: ['Approves a plan: the agent will move on to carrying it out', 'After your approval, the agent carries out the plan without asking again at each step.'],
    unknown: ['Command Ledge cannot analyse', 'Ledge cannot tell what this command will do. Read it carefully before confirming.']
  },
  risk: {
    badge: 'High impact'
  },
  /** A wide screen's right pane before anything is chosen in the list (docs/mockups/mobile-multi-device.html, part 5). */
  split: {
    request: { title: 'Choose a request', body: 'Its details and the decision open here.' },
    agent: { title: 'Choose an agent', body: 'Its thread and terminal open here.' }
  },
  gone: {
    header: 'Request', title: 'Already handled on the PC', body: 'This request was settled elsewhere. No new decision was sent.', back: 'Back to requests',
    /** Who answered, when the thread says it (docs/mockups/mobile-multi-device.html, part 1). */
    titleOn: (where: string) => `Already handled on ${where}`, titleElsewhere: 'Already handled elsewhere',
    decided: (what: 'accept' | 'deny' | 'always', time: string) => `${what === 'deny' ? 'Denied' : 'Accepted'} at ${time}. No new decision was sent.`,
    answered: (time: string) => `Answered at ${time}. No new answer was sent.`,
    staleTitle: 'This request is no longer in the last known state.', staleBody: 'Reconnect to check whether it is still waiting for a decision.'
  },
  loading: 'Loading the request…',
  connection: {
    /** « This device » (docs/mockups/mobile-multi-device.html, part 3). */
    device: {
      title: 'This device', linkedOn: (date: string) => `Linked on ${date}`, rename: 'Rename', renameLabel: (name: string) => `Rename ${name}`,
      sheetTitle: 'This device’s name', sheetBody: 'It shows on the PC and in the threads of your other devices.', field: 'Name',
      save: 'Save', cancel: 'Cancel', failed: 'The PC did not take the name. Try again.',
      others: 'The other linked devices are managed on the PC, in Ledge › Settings › Mobile access.'
    },
    title: 'Settings', section: 'Connection', back: `Back to ${ATOI}`, pc: 'PC', status: 'State', unknown: 'Unknown',
    states: { online: 'Connected', offline: 'Disconnected', connecting: 'Connecting…' },
    account: 'Account', relay: 'Server', pcFingerprint: 'PC fingerprint', version: 'App version', appFingerprint: 'App fingerprint',
    /** A value not known yet (the build, before the service worker gives it). */
    none: '—',
    signOut: 'Sign out',
    /** The theme: the phone's setting, or one of the two. */
    appearance: 'Appearance',
    themes: { system: 'System', light: 'Light', dark: 'Dark' },
    pcVersion: 'PC version',
    /** « The PC »: updating or restarting the PC's daemon from the phone (spec 2026-10-28 mobile daemon update). */
    pcUpdate: {
      title: 'The PC',
      behind: 'The PC is behind the app',
      versions: (pc: string, app: string) => `PC ${pc} · app ${app}`,
      why: 'Some features of the app need the same version on the PC.',
      update: 'Update the PC',
      keepGoing: 'Your sessions keep going. The link drops for a few seconds during the restart.',
      manual: 'The PC cannot update itself',
      clone: 'Its daemon runs from a git clone. Update it on the PC, then restart the daemon here.',
      byHand: 'Update Ledge on the PC.',
      restart: 'Restart the daemon', restartHint: 'Without installing anything. Sessions keep going.', restartGo: 'Restart',
      updating: (v: string) => `Updating to ${v}`, restarting: 'Restarting the daemon', running: 'In progress',
      steps: { asked: 'Confirmed with the device', installing: 'Installing with npm', restarting: 'Restarting the daemon', back: 'Link back' },
      leave: 'You can leave the app: the update continues on the PC.',
      done: (v: string) => `The PC is on ${v}`, restarted: 'The daemon restarted', upToDate: 'Up to date', close: 'Close',
      failed: 'The PC was not updated', notRestarted: 'The daemon did not restart', unchanged: (v: string) => `Nothing changed: it stays on ${v}.`, refused: 'Refused',
      reasons: {
        'sessions-at-risk': 'Restarting the daemon would stop sessions it runs itself (OMP). End them on the PC, then try again.',
        'npm-failed': 'npm failed on the PC. The details are in the daemon log.',
        busy: 'An update is already running on the PC.',
        'git-install': 'Its daemon runs from a git clone: update it on the PC.',
        'no-systemd': 'The PC could not restart the daemon: do it on the PC.',
        timeout: 'The PC no longer answers. Check it in person.'
      } as Record<string, string>,
      retry: 'Retry',
      confirmUpdate: 'Update the PC?',
      confirmUpdateBody: (pc: string, from: string, to: string) => `${pc} moves from ${from} to ${to}. npm installs the version, then the daemon restarts. Your sessions keep going.`,
      confirmRestart: 'Restart the daemon?',
      confirmRestartBody: (pc: string) => `${pc}’s daemon restarts without installing anything. Your sessions keep going, and the link comes back in a few seconds.`,
      passkey: 'This device’s passkey confirms the action. Without it, the PC refuses.',
      noPasskey: 'First protect the accepts with the device, above.',
      confirm: 'Confirm', cancel: 'Cancel', notDone: 'Not done.'
    }
  },
  /** Settings: what this device chooses for itself, the PC's shared threshold, and what stays on the PC. */
  settings: {
    appearance: 'Appearance',
    /** The two rows of Appearance, and the languages written in their own language (m0-langue.html, its handoff sheet). */
    theme: 'Theme', lang: 'Language', langs: { fr: 'Français', en: 'English' },
    motion: 'Reduce motion', motionHint: 'When off, the device’s setting applies.',
    notifications: 'Notifications on this device',
    notify: {
      finished: 'Agent finished', finishedHint: 'When an agent has finished its turn.',
      chat: 'Ledge’s answer', chatHint: 'When Ledge has answered a question asked from here.',
      decision: 'Decision to make', decisionHint: 'When a session asks you to decide.',
      always: 'Approval requests and the agents’ questions always notify, except during a pause.'
    },
    pause: 'Pause', pauseHint: 'No notification on this device during that time.',
    pauseFor: { hour: '1 h', four: '4 h', morning: 'Until 8 am tomorrow' },
    pauseLabel: { hour: 'One-hour pause', four: 'Four-hour pause', morning: 'Pause until 8 am tomorrow' },
    pausedUntil: (when: string) => `Paused until ${when}`,
    tomorrow: (time: string) => `tomorrow ${time}`,
    resume: 'Resume',
    ledge: 'Ledge',
    context: 'Context max', contextHint: 'Above it, a session is flagged as near its limit. Shared with the PC.',
    chatTool: 'Chat agent', chatToolHint: 'The one that answers the questions you ask from this device.',
    tools: { pc: 'PC', claude: 'Claude', codex: 'Codex', cursor: 'Cursor', omp: 'OMP' } as Record<'pc' | 'claude' | 'codex' | 'cursor' | 'omp', string>,
    toolPcHint: 'PC: the same agent as Ledge’s chat on the PC.',
    failed: 'The PC did not take this setting. Try again.',
    offline: 'Reconnect to the PC to change these settings.',
    projects: {
      title: 'Projects',
      agents: (n: number) => (n === 0 ? 'No agent' : n === 1 ? '1 agent' : `${n} agents`),
      folders_note: 'The filing rules and the servers’ folders are set on the PC.',
      folders_note_old: 'A project’s folders and the filing rules are set on the PC.',
      none: 'No project yet.',
      add: 'New project', edit: 'Edit', editLabel: (name: string) => `Edit ${name}`,
      up: (name: string) => `Move ${name} up`, down: (name: string) => `Move ${name} down`,
      newTitle: 'New project', editTitle: 'Edit project', name: 'Name', color: 'Colour',
      colors: { blue: 'Blue', green: 'Green', amber: 'Amber', violet: 'Violet', teal: 'Teal', pink: 'Pink', red: 'Red', slate: 'Slate' } as Record<'blue' | 'green' | 'amber' | 'violet' | 'teal' | 'pink' | 'red' | 'slate', string>,
      newBody: 'An empty project: its folders are added on the PC.',
      save: 'Save', create: 'Create', cancel: 'Cancel',
      remove: 'Delete project…',
      deleteTitle: (name: string) => `Delete ${name}?`,
      deleteAgents: (n: number) => (n === 0 ? 'No agent works in it.' : n === 1 ? '1 agent works in it.' : `${n} agents work in it.`),
      deleteWhere: 'Its agents, folders and rules:', noProject: 'No project', moveTo: 'To another project', target: 'Target project',
      passkey: 'This device’s passkey confirms the deletion.', noPasskey: 'Protect your accepts first, in the Connection section.',
      confirmDelete: 'Delete',
      folders: 'Folders…', foldersTitle: (name: string) => `Folders of ${name}`,
      foldersNone: 'No folder: this project’s agents are filed in it by hand.', foldersLoading: 'Reading the folders…',
      thisPc: 'this PC', removeFolder: 'Remove', removeFolderLabel: (path: string) => `Remove ${path}`,
      addFolder: 'Add a folder', addShort: 'Add', close: 'Close',
      pickTitle: 'Add a folder', recents: 'Recent', browse: 'Browse', parent: 'Parent folder', open: (name: string) => `Open ${name}`,
      empty: 'No subfolder.', cut: 'Only the first 500 subfolders are shown.', loadingFolder: 'Reading the folder…',
      folderErrors: { not_found: 'This folder does not exist on the PC.', not_folder: 'This is not a folder.', unreadable: 'The PC cannot read this folder.' } as Record<string, string>,
      addThis: 'Add this folder', addThisLabel: (path: string) => `Add ${path}`, back: 'Back',
      folderPasskey: 'This device’s passkey confirms the addition.', onlyThisPc: 'Only this PC’s folders can be browsed from here; a server’s folders are added on the desktop.',
      errors: {
        name_taken: 'Another project already has this name.', stale: 'The projects changed on the PC. Try again.',
        folder_taken: 'Another project already has this folder.', not_found: 'This folder no longer exists on the PC.',
        confirm_required: 'Protect your accepts first, in the Connection section.', cancelled: 'Check cancelled. Nothing changed.',
        expired: 'The check expired. Start again.', failed: 'The PC did not take this change. Try again.'
      } as Record<string, string>
    },
    managed: 'Set on the PC',
    terminal: 'Type into terminals', allowed: 'Allowed', notAllowed: 'Not allowed',
    managedBody: 'Mobile access, linked devices, machines and filing rules are set on the PC, in Ledge › Settings. A device cannot widen its own rights.'
  },
  /** The user left while the PC could not confirm that it removed this phone: shown on the screen they land on. */
  forget: {
    pending: 'The PC did not confirm. Remove this device in Ledge on the PC, in the Mobile access section.'
  },
  /** The GitHub login, as the boards write it. */
  account: (login: string) => `@${login}`,
  /** The PC before its first snapshot named it. */
  yourPc: 'your PC',
  replaced: {
    title: 'Ledge is open elsewhere',
    body: 'Another tab on this device took the connection. Close it, or take the connection back here.',
    here: 'Use here'
  },
  insecure: {
    title: 'Insecure connection',
    body: 'Ledge mobile only opens on an HTTPS address. Open the server’s https:// address.'
  },
  /** The app or its start failed to load (a lost connection mid-update, a blocked storage): no board shows it. */
  bootFailed: {
    title: 'Ledge could not start',
    body: 'The app failed to load. Check the device’s connection, then reload the page.',
    reload: 'Reload'
  },
  login: {
    title: 'Your agents, in your pocket',
    subtitle: 'Sign in with the same GitHub account as in Ledge on your PC.',
    notes: [
      'This device creates its own key. It never leaves it.',
      'Nothing is accessible until you confirm a code on your PC.',
      'The server relays encrypted messages: it can neither read them nor answer for you.'
    ],
    github: 'Continue with GitHub',
    /** What the relay's `?signin=` said went wrong; the boards show none, these are the desktop's words. */
    errors: { denied: 'The sign-in was refused on GitHub.', failed: 'The connection to GitHub failed. Try again.' }
  },
  /** Confirming a high-impact accept with the device's own check (Face ID, fingerprint, PIN). */
  confirm: {
    heading: 'Confirm the permission',
    note: 'A check on your device will be asked for. It confirms who you are, not that the command is safe.',
    go: 'Confirm with my device', goApple: 'Allow with Face ID',
    preparing: 'Preparing the check…',
    asking: 'Checking on this device…',
    cancelled: 'Check cancelled. Nothing was sent.',
    expired: 'The check expired. Start again.',
    failed: 'The device check did not go through. Nothing was sent. Try again.',
    prepareFailed: 'The check could not be prepared. Nothing was sent.',
    retry: 'Retry',
    /** Why the PC or the phone refused a confirmed operation, for the reasons a screen has words for; any other says only that nothing was done. */
    refused: {
      confirm_required: 'Confirmation with the device is required.',
      assertion_invalid: 'The device check was refused. Try again.',
      conflict: 'Another operation is running on the PC. Try again.'
    } as Partial<Record<string, string>>
  },
  /** Protecting the high-impact accepts with this device, at pairing and in Connection. */
  enroll: {
    title: 'Protect the accepts',
    body: 'Face ID or this device’s code will be asked for to allow a high-impact command.',
    go: 'Protect the accepts', later: 'Later',
    done: 'Protected by this device', row: 'High-impact accepts',
    unsupported: 'This device cannot protect the accepts.'
  },
  notifications: {
    title: 'Be told when an agent is waiting', body: 'Turn on notifications to open a request straight from your lock screen.',
    enable: 'Turn on notifications', later: 'Later', working: 'Turning on…', waiting: 'Connecting to the PC…',
    row: 'Notifications', on: 'On', off: 'Off',
    denied: 'Notifications refused. You can allow them in the device’s settings.',
    unsupported: 'This browser does not offer notifications. On iPhone, open Ledge from its icon on the home screen.',
    failed: 'Turning on did not go through: the PC did not receive the subscription. Check the connection, then try again.',
    noPush: 'Notifications are not available on this PC.',
    stale: 'The PC changed its keys: turn notifications on again so this device receives them again.'
  },
  recover: {
    title: (m) => `Link ${thisEn(m)}`,
    lead: 'Used Ledge on this device before? Your passkey can reconnect it to your PC, without a code.',
    notes: (m) => [
      m ? 'Your passkey stayed in the iCloud keychain, even though the app was deleted.' : 'Your passkey stayed in your passkey manager, even though the app was deleted.',
      'This device checks that the passkey was made for your PC before sending anything.',
      'Your PC is told about the reconnection and can revoke this device.'
    ],
    go: 'Reconnect with my passkey',
    code: 'Pair with a code',
    cancel: 'Cancel',
    retry: 'Try again',
    checking: {
      title: 'Checking your passkey',
      body: (pc) => `${capEn(pc)} checks that this passkey is one of its devices'.`,
      reaching: (pc) => `Reaching ${pc}…`,
      reached: (pc) => `${capEn(pc)} reached`,
      faceId: 'Face ID', check: 'Device check',
      verifying: (pc) => `${capEn(pc)} checks the passkey…`
    },
    done: {
      title: (m, pc) => `${m ?? 'Device'} reconnected to ${pc}`,
      body: (pc) => `No code needed: your passkey was enough. ${capEn(pc)} kept this device's name, its settings and its conversation history.`,
      told: (pc) => `${capEn(pc)} shows this reconnection and can revoke the device.`,
      notify: 'Reinstalling switched notifications off. Turn them back on to open a request from your lock screen.'
    },
    no: {
      none: {
        title: 'No passkey was used',
        body: (pc) => `The check was cancelled, or this device has no Ledge passkey. Nothing was sent to ${pc}.`,
        hintTitle: 'First time on this device?', hint: 'Pair it with a code: it has never been linked.'
      },
      revoked: {
        title: (m) => `${capEn(thisEn(m))} was revoked`,
        body: (pc, date) => `It was revoked in Ledge on ${pc}${date ? ` on ${date}` : ''}. Its passkey no longer opens anything.`,
        hint: 'To link it again, pair it with a code and approve it on the PC.'
      },
      old: {
        title: 'Your passkey is too old',
        body: 'It was made before Ledge could reconnect a device without a code. Nothing was sent.',
        hintTitle: 'One last time with a code.',
        hint: (m) => `Pair ${thisEn(m)} with a code; Ledge will then offer to update your passkey. Next time, it will be enough.`
      },
      offline: {
        title: (pc) => `${capEn(pc)} is offline`,
        body: (pc) => `Open Ledge on ${pc} and turn on mobile access: the reconnection resumes once it's online.`
      },
      otherPc: {
        title: (pc) => `This passkey isn't ${pc}'s`,
        body: 'It was made for another PC than the one answering on your account. This device stopped there: nothing was sent, nothing was saved.',
        inPasskey: 'In the passkey', expected: 'expected PC', received: 'Received', unknown: 'unknown',
        reinstalledTitle: 'Reinstalled Ledge on the PC, or changed PC?', reinstalledBody: "That's expected: pair with a code.",
        otherwise: 'Otherwise,', warning: "don't go further and tell the server's administrator.",
        signOut: 'Sign out'
      },
      connected: {
        title: (device) => `This passkey belongs to ${theEn(device)}, which is connected right now`,
        body: (pc) => `iCloud shares your passkey between your Apple devices. Ledge doesn't replace a connected device. ${capEn(pc)} was told.`,
        otherTitle: (device) => `On another device than ${theEn(device)}?`,
        other: 'Pair it with a code: it will have its own place.',
        reinstalledTitle: (device) => `Reinstalled ${theEn(device)}?`,
        reinstalled: (device) => `Close Ledge in Safari on ${theEn(device)}, then try again.`
      },
      rate: {
        title: 'Too many tries',
        body: (pc, min) => `5 reconnections in an hour: ${pc} refuses more for now. ${min !== null ? `Try again in ${min} min` : 'Try again later'}, or pair with a code.`,
        retryIn: (min) => `Try again in ${min} min`
      },
      blocked: {
        title: (pc) => `Reconnection blocked on ${pc}`,
        body: (pc) => `3 passkey checks failed. ${capEn(pc)} refuses passkey reconnections until you unblock them on the PC.`,
        hintBefore: (pc) => `In Ledge on ${pc}: Settings › Mobile access › Devices › `,
        unblock: 'Unblock',
        hintAfter: '. Pairing with a code still works.'
      },
      timeout: {
        title: (pc) => `${capEn(pc)} didn't answer`,
        body: "The check didn't finish in time. Nothing was saved on this device."
      },
      unsaved: {
        title: 'Reconnection not saved',
        body: (pc, m) => `${capEn(pc)} accepted your passkey, but ${thisEn(m)} couldn't save ${pc}'s key: its storage may be full. Nothing is linked yet.`
      }
    }
  },
  passkeyUpdate: {
    title: 'Update your passkey',
    body: (m) => `With an up-to-date passkey, ${thisEn(m)} can come back without a code after a reinstall. Face ID will be asked once.`,
    bodyOther: (m) => `With an up-to-date passkey, ${thisEn(m)} can come back without a code after a reinstall. A check on this device will be asked once.`,
    go: 'Update the passkey', later: 'Later', updating: 'Updating…', retry: 'Try again',
    done: 'Passkey updated',
    doneBody: (m) => `${capEn(thisEn(m))} can reconnect without a code after a reinstall.`,
    cancelled: 'Update cancelled. Your old passkey still protects your accepts.',
    failed: (pc) => `The update didn't go through: ${pc} didn't receive the new passkey. The old one still works.`,
    row: 'Reconnect without a code', rowHint: 'Your passkey must be updated once', update: 'Update', ready: 'Ready',
    stepBody: (m) => `It will protect your high-impact accepts, and let ${thisEn(m)} come back without a code after a reinstall.`
  },
  compare: {
    /** The name this phone gives itself in its `pair_commit`, when its user agent names no known device. */
    deviceLabel: 'Device',
    title: 'Compare this code',
    waitCode: 'Waiting for the PC’s code…',
    codeLabel: (code: string) => `Pairing code ${code}`,
    intro: (pc: string) => `Ledge has just shown a code on ${pc}. It must be identical to this one.`,
    basis: 'Computed from the keys of the PC and this device',
    same: 'The codes are identical',
    different: 'They are different',
    waitTitle: 'Confirm on the PC',
    waitBody: (pc: string, code: string) => `In Ledge on ${pc}, click Approve under the same code ${code}.`,
    cancel: 'Cancel',
    /** `model`: the device's kind as the pairing label names it (iPad, iPhone, Android); else « Device ». */
    doneTitle: (pc: string, model: string) => `${model} linked to ${pc}`,
    doneBody: 'You can read, approve and write. Remove this device at any time from Ledge on the PC.',
    seePending: 'See what is waiting',
    cancelledTitle: 'Pairing cancelled',
    cancelledBody: 'Different codes mean that this device and the PC do not see the same keys. Someone may be trying to get in between. Deny on the PC too.',
    expiredTitle: 'Code expired',
    expiredBody: 'The code was not confirmed in time on both devices.',
    refusedTitle: 'Pairing denied on the PC',
    refusedBody: 'Ledge on the PC denied this device.',
    lostTitle: 'This device is no longer linked',
    lostBody: 'Its keys are gone (site data cleared or private browsing) and the last known state was cleared with them. Compare a new code to link it.',
    /** A pairing was asked and none could start (no key could be made, the link closed): no board shows it. */
    stalledTitle: 'Pairing could not start',
    stalledBody: 'This device could not prepare its key. Start again; if it persists, reload the page.',
    retry: 'Start again',
    /** Waiting for the PC's code while it is not on the relay: the pairing starts by itself once it is. */
    offlineTitle: 'PC offline',
    offlineBody: (pc: string) => `Turn on mobile access in Ledge on ${pc}: pairing starts as soon as it is online.`,
    relayTitle: 'Relay unreachable',
    relayBody: 'This device cannot reach the Ledge relay. Check its internet connection, then retry.',
    retryNow: 'Retry'
  },
  denied: {
    title: 'This account has no access',
    /** The relay's redirect names no account: the board's sentence without the login. */
    bodyNoLogin: 'This GitHub account is not on this server’s list. Ask its administrator to add you.',
    other: 'Use another account'
  },
  keyChanged: {
    title: (pc: string) => `${pc}’s key changed`,
    body: 'This device cut the connection. It sends nothing and shows nothing from this PC until you pair again.',
    known: 'Known', received: 'Received',
    knownDetail: (fp: string, date: string) => `${fp} · linked on ${date}`,
    receivedDetail: (fp: string) => `${fp} · unknown`,
    reinstalledTitle: 'Did you reinstall Ledge or change PC?',
    reinstalledBody: 'That is expected: pair again and compare the new code.',
    otherwise: 'Otherwise,',
    warning: 'go no further and warn the server’s administrator.',
    relink: 'Pair again',
    signOut: 'Sign out'
  },
  /** The PC answered a hello with `denied` (this phone was removed in Ledge on the PC): no board shows it, KeyChanged is the model. */
  unrecognized: {
    title: (pc: string | null) => `${pc ?? 'Your PC'} no longer recognises this device`,
    body: 'This device was probably removed in Ledge on the PC. It sends nothing more to this PC.',
    kept: 'The last known state and your drafts stay on this device. Pairing again erases them and asks you to compare a new code.',
    relink: 'Pair again',
    signOut: 'Sign out'
  },
  /** The key store could not be read (a lost IndexedDB connection): no board shows it. Nothing was erased. */
  storage: {
    title: 'Device storage unreadable',
    body: 'The browser could not read this device’s keys. Nothing was erased: try again, or reload the page.',
    retry: 'Retry',
    reload: 'Reload'
  },
  update: {
    title: 'New version',
    version: (v: string) => `New version · ${v}`,
    body: 'The server offers an update of the app. Nothing changes until you accept it.',
    fingerprint: 'Fingerprint of this version',
    current: 'Current: ',
    /** After « Current: », the running build: its version and short fingerprint. */
    currentBuild: (v: string, fp: string) => `${v} · ${fp}`,
    compare: (v: string) => `Compare with release ${v} on GitHub`,
    later: 'Later',
    apply: 'Update'
  },
  checklist: {
    title: 'Work plan',
    allDone: 'All done',
    paused: 'Paused',
    progress: (done: number, total: number) => `${done} of ${total} tasks done`,
    box: { completed: 'Done', in_progress: 'In progress', pending: 'To do' },
    cut: 'List shortened: the rest is on the PC'
  },
  offline: {
    lastKnown: (t: string) => `Last known state · ${t}`,
    title: (pc: string | null) => pc ? `${pc} is not responding` : 'Your PC is not responding',
    body: (t: string) => `The PC has probably been asleep since ${t}. Ledge never sends a decision later on your behalf: a request may have changed meanwhile.`,
    /** The board's sentence when no state was ever received, so no time to give. */
    bodyUnknown: 'The PC is probably asleep. Ledge never sends a decision later on your behalf: a request may have changed meanwhile.',
    retry: 'Retry',
    seen: (when: string) => `seen at ${when}`,
    badge: 'Offline',
    pcOffline: 'PC offline'
  },
  /** The shared mascots' words (@ledge/ui UiCopy), as Ledge Desktop says them in English. */
  ui: {
    stateLabel: { approval: 'Your approval', question: 'A question', starting: 'Starting', idle: 'Available', working: 'Working', done: 'Done', error: 'Error', readonly: 'Read only' },
    botLabel: { starting: 'Starting', working: 'Working', approval: 'Needs your approval', question: 'Has a question', idle: 'Available', error: 'Error', done: 'Finished', readonly: 'Read-only' },
    botReadOnly: 'Read-only', botNotLive: 'Not live', residentName: 'Ledge', residentOffline: 'Ledge · connection lost'
  },
  /** The host pill of the header (m0-socle.html, §1): the PC's name, « offline » when it does not answer. */
  host: {
    unknown: 'PC',
    offline: (pc: string) => `${pc} · offline`,
    label: (pc: string, look: 'online' | 'reconnecting' | 'offline' | 'loading') =>
      `${pc}: ${look === 'online' ? 'connected' : look === 'offline' ? 'offline' : 'connecting…'}. Open Settings › Connection`
  },
  /** MR/PR before the PC sends them (m0-socle.html, §3, answer A of question Q3). */
  prs: {
    title: 'MR and PR', subtitle: 'GitHub · GitLab',
    notSent: (pc: string) => `${pc} does not send its MRs and PRs to this device yet`,
    notSentBody: 'Ledge follows the branches of the sessions and seats. Their MRs, PRs and pipelines will show here once Ledge is updated on the PC.',
    tracked: 'Tracked: the branches of the sessions and seats, via gh and glab.',
    pane: { title: 'Nothing to show', body: 'An MR or PR and its pipeline open here.' }
  },
  /** Rigs before the PC sends them (m0-socle.html, §2 and §3). */
  rigs: {
    title: 'Rigs', subtitle: 'OpenRig',
    notSent: (pc: string) => `${pc} does not send its rigs to this device yet`,
    notSentBody: `The rigs, their seats and their queue come with a later version of Ledge on the PC. Their requests already arrive in “${ATOI}”.`,
    seeAtoi: `See “${ATOI}”`,
    pane: { title: 'Nothing to show', body: 'A rig\'s seats and topology open here.' }
  },
  /** The Atelier on iPad (docs/mockups/ledge-ipad-atelier.html): the PC's rooms, tables and agents, as Ledge Desktop draws them. */
  atelier: {
    title: 'Atelier',
    subtitle: (agents: number, rooms: number, waiting: number) =>
      `${agents} ${plural(agents, 'agent', 'agents')} · ${rooms} ${plural(rooms, 'room', 'rooms')}${waiting ? ` · ${waiting} waiting` : ''}`,
    region: 'Atelier',
    fullScreen: 'Full screen', closePanel: 'Close the panel', closeTitle: 'Close',
    session: (name: string) => `${name}’s session`,
    room: (name: string) => `${name} room`,
    roomAgents: (n: number) => `${n} ${plural(n, 'agent', 'agents')}`,
    ompNoThread: 'No thread for this seat.',
    ompBody: 'Ledge does not read the conversation of an OMP seat launched by OpenRig. Its terminal shows its screen.',
    ompTerminal: 'Open its terminal',
    /** The thread's card in the panel: the request opens there, not in « À traiter » (design-ux 12:17Z). */
    awaiting: 'Decision expected',
    /** Ledge Desktop's words for the same drawing (apps/desktop/src/i18n/en.ts: atelier, rooms, zoom). */
    table: (name: string) => `${name} table`,
    conversations: (name: string) => `Agents of the ${name} room`,
    seat: (name: string, task: string) => `${name}, ${task}`,
    helperSeat: (kind: string, parent: string, task: string) => `${kind}, sub-agent of ${parent}: ${task}`,
    desk: 'Talk to Ledge',
    watching: (n: number) => `I watch over ${n} ${plural(n, 'agent', 'agents')}.`,
    assistant: 'Your assistant',
    unassigned: 'No project',
    unassignedHint: 'Ledge links these sessions to no project. They are filed from the PC.',
    legend: { working: 'Working', approval: 'Your approval', question: 'A question', done: 'Done or offline', helper: 'A small bot is a sub-agent.' },
    plaqueCounts: (n: number) => `${n} ${plural(n, 'session', 'sessions')}`,
    waiting: (n: number) => `${n} waiting`,
    working: (n: number) => `${n} working`,
    roomMenu: (name: string) => `Agents of the ${name} room`,
    rigRoom: (kind: 'rig' | 'kernel', name: string) => (kind === 'kernel' ? 'The OpenRig kernel’s room' : `The rig ${name}’s room`),
    kernel: 'Kernel', kernelWhere: 'OpenRig · operator, advisor, queue',
    /** docs/mockups/ledge-ipad-atelier.html (cd66c403): the folder's name, the phone has no path. */
    rigWhere: (folder: string, project: string | null) => ['rig', folder, project ? `project ${project}` : ''].filter(Boolean).join(' · '),
    entrance: 'ENTRANCE',
    more: (n: number) => `+${n} at this table`,
    zoom: { bar: 'Atelier zoom', out: 'Zoom out', in: 'Zoom in', reset: 'Back to 100 %', fit: 'Fit', fitTitle: 'Back to the readable view' }
  }
};
