import type { Messages } from './messages';

/** English counts only 1 as singular. */
const pluralEn = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Desktop's copy in English, shaped by the French (see messages.ts, which loads it on demand). */
export const en: Messages = {
  side: {
    label: 'Sidebar', newSession: 'New session', search: 'Search', searchLabel: 'Search a session',
    views: 'Views', atelier: 'Atelier', chat: 'Chat Ledge', projects: 'Projects', newProject: 'New project', unassigned: 'No project',
    machines: 'Machines', manageMachines: 'Manage machines', agents: (n) => pluralEn(n, `${n} agent`, `${n} agents`), offline: 'offline', settings: 'Settings'
  },
  crumb: { atelier: 'Atelier', list: 'List', settings: 'Settings', clearFilter: 'Remove the filter: show every project', clearFilterTitle: 'Every project (Esc)', escape: 'Esc', openParent: (n) => `Open ${n}’s conversation` },
  top: {
    viewTabs: 'Agents view', helpersHide: 'Hide subagents', helpersShow: 'Show subagents', pause: 'Freeze animations', play: 'Animate',
    search: 'Search a session (Ctrl K)', chat: 'Chat Ledge (/)', shortcuts: 'Keyboard shortcuts (?)', fullscreen: 'Full screen', fullscreenExit: 'Exit full screen',
    terminalShow: 'Show the terminal', terminalHide: 'Hide the terminal', terminalShowTitle: 'Show the terminal (O)', terminalHideTitle: 'Hide the terminal (O)'
  },
  foot: { sessions: 'Local and SSH sessions', search: 'A session', chat: 'Chat Ledge', shortcuts: 'Shortcuts' },
  sections: { general: 'General', appearance: 'Appearance', notifications: 'Notifications', sounds: 'Sounds', machines: 'Machines', projects: 'Projects', shortcuts: 'Shortcuts', about: 'About' },
  pending: 'This screen is coming soon.',
  close: 'Close',
  modalTitles: { launch: 'New session' },
  search: {
    title: 'Go to a session', placeholder: 'Agent, task, project or machine…', empty: 'No session matches this search.', results: 'Sessions',
    browse: 'Browse', open: 'Open', closeKey: 'Close', enter: 'Enter', escape: 'Esc'
  },
  shortcuts: {
    title: 'Keyboard shortcuts',
    intro: 'Active while the window has focus. Navigation keys stay available for typing and the terminal when they have focus.',
    outro: 'Ctrl / ⌘ K opens the search from any view. Y and N only act on the pinned request of the open session, never while typing.',
    rows: [['Ctrl / ⌘ K','Search and open a session'],['Ctrl ,','Open the settings'],['Alt 1…9','Jump to the main sessions'],['Alt ← / →','Previous / next session'],['J / K or ↓ / ↑','Walk through the sessions (atelier or list)'],['F','Filter the list'],['Enter','Open the selected session'],['N','New session'],['+ / −','Zoom the atelier in / out'],['0','Fit the atelier to the screen'],['Ctrl + wheel','Zoom under the pointer'],['Space + drag','Pan the view'],['/','Open Ledge chat'],['R','Write a reply to the agent'],['Y / N','Allow / deny the pending request'],['1…9','Pick a suggested answer'],['J / K','Next / previous file (Changes)'],['O','Show or hide the terminal'],['Esc','Close the panel or go back to the atelier'],['?','Show these shortcuts']]
  },
  tray: { open: 'Open Ledge Desktop', newSession: 'New session', dnd: 'Do not disturb', dndOff: 'Resume alerts', quit: 'Quit Ledge Desktop' },
  notify: {
    approval: (name) => `${name} needs your approval`,
    question: (name) => `${name} has a question`,
    finished: (name) => `${name} has finished`,
    failed: (name) => `${name} ran into an error`,
    manyTitle: 'Your team',
    many: (n) => `${n} sessions need you or have finished`
  },
  atelier: {
    table: (name) => `${name} table`,
    conversations: (name) => `Conversations of project ${name}`,
    actions: (name) => `Actions of project ${name}`, actionsTitle: 'Project actions',
    edit: 'Edit project',
    newSession: 'New session', newSessionAt: (name) => `New session at the ${name} table`,
    isolate: (name) => `Isolate project ${name}`, isolateLabel: 'Isolate this table', showAll: 'Show every project',
    more: (n) => `+${n} at this table`, moreTitle: 'See every agent of the project in the list',
    seat: (name, task, machine) => `${name}, ${task}, ${machine}`,
    helperSeat: (kind, parent, task) => `${kind}, subagent of ${parent}: ${task}`,
    offline: 'Offline',
    desk: 'Talk to Ledge',
    watching: (n) => pluralEn(n, `I'm watching over ${n} agent.`, `I'm watching over ${n} agents.`),
    listening: "I'm listening.",
    assistant: 'Your assistant',
    unassignedHint: 'Ledge links these sessions to no project. Drag them onto a table, or use “Move to…”.',
    empty: {
      title: (name) => `No agent at the ${name} table`,
      body: (where) => `The table will appear as soon as a session starts in ${where}.`,
      noRepo: 'this project'
    },
    legend: { working: 'Running', approval: 'Your approval', question: 'A question', done: 'Done or offline', helper: 'A small bot is a subagent.' }
  },
  filing: {
    moveTo: 'Move to…', newProject: 'New project…', from: (folder) => `From ${folder}`,
    grip: 'Drag onto a table to move it there',
    dropHelp: (name) => `Drop on a project to move ${name} there.`,
    dropHere: 'Drop here', dropNow: (name) => `Release to seat ${name}`,
    joined: (name, table) => `${name} joins the ${table} table. Ledge will remember this folder.`,
    offline: (name) => `${name} could not be moved: the local Ledge daemon is not reachable.`,
    outdated: (name) => `${name} could not be moved: update the local Ledge daemon, it does not know projects yet.`,
    invalid: (name) => `${name} could not be moved: Ledge cannot remember this folder.`,
    unconfirmed: (name) => `${name} was not moved: Ledge did not confirm. Try again.`
  },
  zoom: {
    bar: 'Atelier zoom', out: 'Zoom out', outTitle: 'Zoom out (−)', in: 'Zoom in', inTitle: 'Zoom in (+)',
    reset: 'Back to 100 %', fit: 'Fit', fitTitle: 'See everything (0)', hint: 'Ctrl + wheel · drag the floor · double-click a table'
  },
  list: {
    buckets: { decide: 'To decide', running: 'Running', done: 'Done', offline: 'Offline' },
    filter: 'Filter the sessions', filterPlaceholder: 'Agent, task, machine, repository…', clearFilter: 'Clear the filter',
    chips: 'Filter by state', all: 'All',
    groupBy: 'Group by', groupLabel: 'Group', groups: { project: 'Project', machine: 'Machine', state: 'State' },
    comfy: 'Comfortable rows', tight: 'Compact rows',
    collapse: (name) => `Collapse ${name}`, expand: (name) => `Expand ${name}`, only: (name) => `Show only ${name}`,
    branch: (b) => `Branch ${b}`,
    newSessionIn: (name) => `New session in ${name}`,
    tally: { decide: (n) => `${n} to decide`, running: (n) => `${n} running`, done: (n) => `${n} done`, offline: (n) => `${n} offline` },
    unassignedHelp: 'Drag onto a project, or use “Move to…”.',
    grip: 'Drag onto a project',
    dropHelp: 'Drop on a project in the sidebar or on its group.',
    dropNow: (name) => `Drop to move ${name}`,
    row: (name, task, state, ctx) => `${name}, ${task}, ${state}, ${ctx}`,
    kids: {
      show: (n) => pluralEn(n, `Show ${n} subagent`, `Show ${n} subagents`),
      hide: (n) => pluralEn(n, `Hide ${n} subagent`, `Hide ${n} subagents`),
      count: (n) => pluralEn(n, `${n} subagent`, `${n} subagents`)
    },
    empty: {
      projectTitle: (name) => `No session in ${name}`,
      projectBody: (where) => `The project will fill as soon as a session starts in ${where}.`,
      noneTitle: 'No session', noneBody: 'Start a session to see it here.',
      noMatch: 'No session matches', clear: 'Clear the filters',
      noMatchBody: (q, chip, none) => (!q && !chip && none ? `Nothing in “${none}”.` : q && chip ? `Nothing for “${q}” among the “${chip}” sessions.` : q ? `Nothing for “${q}”.` : `Nothing among the “${chip}” sessions.`)
    },
    foot: { walk: 'browse', open: 'open', filter: 'filter', note: 'pending requests come first in each group.' },
    enter: 'Enter',
    allow: 'Allow', deny: 'Deny', reply: 'Reply', open: 'Open', openTitle: 'Open the session (Enter)',
    when: {
      now: 'just now', wait: (d) => `for ${d}`, ago: (d) => `${d} ago`,
      requestNow: 'Request received just now', waitTitle: (d) => `Waiting for ${d}`,
      activityNow: 'Last activity just now', activityAgo: (d) => `Last activity ${d} ago`,
      seenAgo: (d) => `Last seen ${d} ago`,
      units: { min: 'min', h: 'h', d: 'd' }
    }
  },
  decisions: {
    failed: (name, message) => `Could not send the decision to ${name}: ${message}`,
    unconfirmed: (name) => `Ledge did not see the decision for ${name} land. Open the session to check.`,
    replyFailed: (name, message) => `Could not send the reply to ${name}: ${message}`,
    replyUnconfirmed: (name) => `Ledge did not see the reply to ${name} land. Check the thread.`,
    noteNotTyped: 'Refused, but the note could not be typed.'
  },
  session: {
    meta: 'Machine and repositories',
    subagent: 'Subagent',
    rail: {
      label: (p) => `Agents of the project ${p}`, kids: (n) => `Subagents · ${n}`, kidsOf: (n) => `Subagents of ${n}`, newHere: 'New session here'
    },
    kidsPill: (n) => pluralEn(n, '1 subagent', `${n} subagents`), kidsPillTitle: 'Show the subagents in the rail',
    views: { label: 'Session view', thread: 'Thread', changes: 'Changes' },
    changes: {
      files: 'Changed files', count: (n) => pluralEn(n, '1 file', `${n} files`), toggle: (n) => `Files · ${n}`,
      labels: { add: 'Added', edit: 'Modified', write: 'Rewritten', delete: 'Deleted', rename: 'Renamed' },
      letters: { add: 'A', edit: 'M', write: 'M', delete: 'D', rename: 'R' },
      empty: 'No file changed', emptyCursor: 'Cursor Agent does not report the files it touches.',
      emptyBody: (n) => `${n} has not changed anything in this session yet.`,
      copy: 'Copy the path', copied: (p) => `Path copied: ${p}`,
      prev: 'Previous file', next: 'Next file',
      createdBy: 'Created by', changedBy: 'Changed by', turn: (n) => `turn ${n}`, seeInThread: '· see it in the thread',
      diff: 'Differences',
      gap: (n, a, b) => pluralEn(n, `⋯ 1 unchanged line (line ${a})`, `⋯ ${n} unchanged lines (lines ${a}–${b})`),
      unfold: (n) => pluralEn(n, 'Show 1 unchanged line', `Show ${n} unchanged lines`),
      cut: 'Diff limited to the first 80 lines.', noDiff: 'This file has no recorded difference.',
      noTouchDiff: 'No recorded difference for this action.',
      signs: { add: 'added', del: 'removed' }
    },
    pane: {
      label: 'Reading pane', tabs: 'Open documents', closeTab: (l) => `Close ${l}`,
      grow: 'Enlarge', shrink: 'Shrink', growTitle: 'Enlarge the pane (65 %)', shrinkTitle: 'Shrink the pane (50 %)',
      close: 'Close', closeTitle: 'Close the pane (Esc)', closeShort: 'Close (Esc)',
      resize: 'Resize the pane', allChanges: 'All changes',
      diffTitle: (f) => `Change · ${f}`, diffLabel: (f) => `± ${f}`,
      reading: 'Reading the document…',
      errors: {
        not_found: 'Document not found.', too_large: 'Document too large (1 MB at most).',
        offline: 'The machine is offline: the document cannot be read.', timeout: 'The document did not arrive in time.',
        other: 'The document could not be read.'
      }
    },
    terminal: {
      title: 'Terminal', empty: 'No output received yet.', readOnly: 'Read-only preview', offline: 'Offline',
      open: 'Open in a terminal', openFailed: (n) => `${n}’s terminal could not open.`
    },
    pending: {
      regions: { approval: 'Approval requested', plan: 'Plan to approve', question: 'Question from the agent' },
      command: (n) => `${n} wants to run a command`, edit: (n) => `${n} wants to change a file`, approval: (n) => `${n} wants your approval`,
      question: (n) => `${n} asks you a question`, plan: (n, title) => `${n} proposes a plan · ${title}`, planBadge: 'Plan to approve',
      allow: 'Allow', deny: 'Deny', always: 'Always allow for this session', alwaysProject: 'Always allow in this project',
      approvePlan: 'Approve the plan', keepPlanning: 'Keep planning', approveAuto: 'Approve in auto mode',
      alwaysScope: {
        project: 'Claude Code saves the rule in the project’s settings: it also holds for its later sessions in this project.',
        edits: 'Claude Code switches to accepting edits for the whole session: every edit after this one is accepted without asking you.',
        session: 'The agent stops asking for this command or these files for the rest of the session.',
        plan: 'Claude Code switches to auto mode, which answers the next requests by itself, commands included. On versions without auto mode (before 2.1), it accepts edits automatically.'
      },
      relay: (p) => `${p} passes this decision on.`, relayAnswer: (p) => `${p} will relay your answer.`,
      revise: 'Write what to revise, then Enter.', reviseKey: 'Write what to revise, then Enter: the plan goes back to planning.'
    },
    reply: {
      label: 'Reply to the agent', send: 'Send', denyWith: 'Deny with this message',
      placeholder: {
        plan: 'What to revise in the plan… (Enter: keep planning)', approval: 'Or deny and say what to do instead…',
        question: (n) => `Or answer ${n} freely…`, done: (n) => `Start ${n} again with a new instruction…`, idle: (n) => `Reply to ${n}…`
      },
      denyHint: 'Enter denies with this message', planHint: 'Enter sends the plan back to planning', write: 'write',
      offline: (m) => `${m} is offline.`, offlineBody: ' The thread is frozen at the last known activity; you can reply once it reconnects.', seeMachine: 'See the machine',
      viaParent: (n, p) => `Replies to ${n} go through ${p}, who started it.`, openParent: (p) => `Open ${p}`,
      readOnly: 'Session started without Ledge: read only.', optionsOnly: 'Choose one of the proposed answers (1–9).',
      noNote: 'This agent takes no message with a refusal: deny with N.', tooLong: (max) => `A note holds ${max} characters at most.`
    },
    thread: {
      label: 'Session thread',
      you: 'You', fromParent: (n) => `Instruction from ${n}`,
      exchange: (at) => `Exchange at ${at}`, live: 'running',
      actions: (n) => pluralEn(n, '1 action', `${n} actions`),
      kinds: {
        read: (n) => pluralEn(n, `${n} read`, `${n} reads`), search: (n) => pluralEn(n, `${n} search`, `${n} searches`),
        command: (n) => pluralEn(n, `${n} command`, `${n} commands`), edit: (n) => pluralEn(n, `${n} edit`, `${n} edits`)
      },
      files: (n) => pluralEn(n, '· 1 file changed', `· ${n} files changed`),
      failed: (n) => `· ${n} failed`,
      cut: (n) => `· ${n} interrupted`,
      running: 'running · ', interrupted: 'interrupted', liveAction: 'Action running',
      marks: { running: 'Running', success: 'Succeeded', failed: 'Failed', unknown: 'Interrupted' },
      verbs: { create: 'Create', delete: 'Delete', read: 'Read', search: 'Search', command: 'Command', edit: 'Edit' },
      decided: { accept: 'Allowed', always: 'Always allowed', deny: 'Denied', unknown: 'Answered in the terminal' },
      helperLaunched: 'Subagent started', openHelper: (n, task) => `Open ${n}: ${task}`,
      seeChange: 'View the change', seeChangeShort: 'View',
      read: 'Read',
      unread: 'New since your last visit', latest: 'Go to the latest message',
      lost: (m) => `Connection lost with ${m}`,
      lostBody: 'The thread is frozen: what follows is the last known state; what the agent is doing now is not known.',
      frozenEnd: (s) => `No news since the connection was lost · ${s}`, ended: (s) => `Session ended · ${s}`,
      loading: 'Loading the thread…', empty: 'Nothing in the thread yet.', notLoaded: 'The thread was not loaded before the connection was lost.'
    },
    plan: {
      kicker: 'Proposed plan', fallback: 'Plan',
      statuses: { proposed: 'Awaiting your approval', open: 'Proposed', approved: 'Approved', revised: 'Revised afterwards' },
      more: (n) => pluralEn(n, '… and 1 more step', `… and ${n} more steps`), steps: (n) => pluralEn(n, '1 step', `${n} steps`),
      readPlan: 'Read the plan', openBeside: 'Open beside',
      approved: 'Plan approved', approvedAuto: 'Plan approved · auto mode', toRevise: 'Plan to revise',
      by: (n) => `Plan proposed by ${n}`, tab: (t) => `Plan · ${t}`,
      answerHint: { lead: 'Answer below the thread:', approve: 'approve', keep: 'keep planning' },
      summary: (n, s) => pluralEn(n, `1 step: ${s}`, `${n} steps: ${s}`)
    },
    todos: {
      workPlan: 'Work plan', workPlanUpdated: 'Work plan updated', updated: 'work plan updated',
      allDone: 'All done', paused: 'Paused',
      doneOf: (d, n) => `${d}/${n} done`, inProgress: (t) => `in progress: ${t}`,
      boxes: { completed: 'Done', in_progress: 'In progress', pending: 'To do' }
    }
  },
  launch: {
    prompt: 'Instruction', placeholder: 'What should the agent do? Describe the expected result.',
    suggestions: 'Suggestions', ideas: ['Review the latest pull request', 'Fix the failing tests', 'Update the documentation'],
    agent: 'Agent',
    tools: { claude: ['Claude Code', 'Design, review'], codex: ['Codex', 'Code and tests'], cursor: ['Cursor Agent', 'In the editor'] },
    project: 'Project', machine: 'Machine', offline: 'offline', offlineTitle: 'Offline: reconnect the machine in Settings',
    repos: (m) => `Repositories on ${m}`, noGit: 'Folder without Git', notFound: 'not found', oneRepo: (t) => `One repository only for ${t}`,
    noRepos: (p, m) => `No repository of ${p} on ${m}.`, editProject: 'Edit the project',
    noProjects: 'No project yet.', noProjectsBody: 'Create a project to launch agents in it.', newProject: 'New project',
    newAgent: 'A new agent', joins: (n, t) => `${n} will join the ${t} table`, seat: (n, m, r) => `Seat ${n} · ${m} · ${r}`, noRepo: 'no repository',
    missing: { tool: 'Choose an agent', prompt: 'Write the instruction', machine: 'No machine online', repos: 'Choose at least one repository' },
    cancel: 'Cancel', launch: 'Launch', launching: 'Launching…',
    started: (n, t) => `${n} is starting at the ${t} table.`, refused: (m) => `Launch refused: ${m}`,
    timeout: 'The launch did not answer. Check the machine, then try again.'
  },
  projects: {
    titles: { new: 'New project', edit: (n) => `Edit ${n}`, delete: (n) => `Delete ${n}` },
    name: 'Name', namePlaceholder: 'E.g. Paper Rendering', color: 'Colour',
    colors: { blue: 'Blue', green: 'Green', amber: 'Amber', violet: 'Violet', teal: 'Teal', pink: 'Pink', red: 'Red', slate: 'Slate' },
    description: 'Description', optional: 'optional', descriptionPlaceholder: 'One sentence on what the project is for',
    repos: (n) => `Working repositories · ${n}`, branchTitle: 'Default branch detected', noGit: 'Folder without Git',
    notFound: 'not found', offline: 'offline', remove: (n, m) => `Remove ${n} (${m})`, addRepo: 'Add a repository',
    empty: 'No repository yet. The project can exist without one, but Ledge will not be able to file sessions in it.',
    fileToo: 'Also file',
    problems: { name_empty: 'Give the project a name', name_taken: 'This name is already used by another project', repo_duplicate: 'This repository is listed twice', gone: 'This project was deleted meanwhile',
      repo_taken: (p) => `This repository is already in ${p}` },
    refused: {
      offline: 'The local daemon is offline: nothing was saved.', outdated: 'The local daemon is too old for projects: update it.',
      invalid: 'The daemon refused this project.', timeout: 'The daemon did not confirm the save.'
    },
    preview: (n, ms) => `${n} ${pluralEn(n, 'repository', 'repositories')}${ms ? ` on ${ms}` : ''}`, firstSession: ' · the table appears with the first session', newName: 'New project',
    create: 'Create the project', save: 'Save', saving: 'Saving…', cancel: 'Cancel', deleteProject: 'Delete the project',
    saved: (n) => `${n} saved.`,
    created: (n) => `Project ${n} created. It appears in the sidebar; its table opens with the first session.`,
    createdWith: (n, names) => `Project ${n} created. ${new Intl.ListFormat('en', { type: 'conjunction' }).format(names)} ${pluralEn(names.length, 'joins', 'join')} its table.`,
    delete: {
      lead: (n) => `${n} disappears from the sidebar and the atelier. Its repositories stay untouched on your machines.`,
      noAgents: 'No agent at this table.',
      agents: (n, names) => `${n} ${pluralEn(n, 'agent', 'agents')} (${names})`,
      toNone: () => 'will move to « No project ».',
      toProject: (_n, p) => `will join ${p}.`,
      rules: (n) => `${n} remembered ${pluralEn(n, 'folder', 'folders')}`,
      rulesForget: () => 'will be forgotten.',
      rulesMove: () => 'will point to that project.',
      noRules: 'No remembered folder.',
      reposMove: (n, p) => `${n} ${pluralEn(n, 'repository', 'repositories')} will join ${p}.`,
      reposGone: (n) => `${n} ${pluralEn(n, 'repository', 'repositories')} ${pluralEn(n, 'leaves', 'leave')} Ledge (the folders stay on your machines).`,
      their: 'Its agents', none: 'No project', moveTo: 'Move to…', target: 'Target project',
      confirm: (n) => `Delete ${n}`, moveAndDelete: 'Move and delete',
      done: (n) => `${n} deleted.`,
      doneMoved: (k, p) => ` ${k} ${pluralEn(k, 'agent', 'agents')} ${pluralEn(k, 'joins', 'join')} ${p}.`,
      doneNone: (k) => ` ${k} ${pluralEn(k, 'agent', 'agents')} ${pluralEn(k, 'moves', 'move')} to « No project ».`
    },
    picker: {
      machines: 'Machine to browse', offline: 'offline',
      offlineBody: (m) => `${m} is offline. Reconnect it in Settings › Machines to browse its folders.`,
      crumbs: 'Current folder', root: 'root', parent: 'Parent folder', contents: (d, m) => `Contents of ${d} on ${m}`,
      open: (n) => `Open ${n}`,
      noGit: 'no Git', add: 'Add', added: 'Added', addLabel: (n, m) => `Add ${n} (${m})`, addedLabel: (n) => `${n} already added`,
      typed: (m) => `Path on ${m}`, typedPlaceholder: (m) => `Or type a path on ${m}`,
      offlinePath: (m) => `${m} is offline: this path cannot be checked.`, notFound: (m) => `Folder not found on ${m}.`,
      alreadyListed: 'This repository is already in the list.', absolute: 'Type a full path, starting with /.',
      ownedBy: (p) => `Already in ${p}`, ownedLabel: (n, p) => `${n} is already in ${p}`,
      timeout: 'The folder did not answer.', retry: 'Try again'
    }
  },
  stateLabel: { approval: 'Approval', question: 'Question', starting: 'Starting', idle: 'Available', working: 'Running', done: 'Done', error: 'Error', readonly: 'Read only' },
  botLabel: { starting: 'Starting', working: 'Working', approval: 'Needs your approval', question: 'Has a question', idle: 'Available', error: 'Error', done: 'Finished', readonly: 'Read-only' },
  botReadOnly: 'Read-only',
  botNotLive: 'Not live',
  resident: { name: 'Ledge', offline: 'Ledge · connection lost' }
};
