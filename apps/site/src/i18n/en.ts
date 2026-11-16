import type { Catalogue } from './fr.ts';

// The English copy: the same meaning as the French, in plain product English. The media are still the French captures, so
// the labels read on them (« À toi », « Autoriser », « Nouvelle session ») are quoted as the screens show them.
export const en: Catalogue = {
  meta: {
    title: 'Ledge, the workshop for your coding agents',
    description: 'A workshop for all your coding agents, on your PC and your servers. You see what each one is doing, and you answer its requests without opening its terminal.',
    imageAlt: 'The Ledge Desktop workshop: the agents at their tables, by project'
  },
  nav: {
    label: 'Main navigation',
    inLedge: 'In Ledge',
    openrig: 'OpenRig',
    everywhere: 'Everywhere',
    install: 'Install',
    language: 'Language'
  },
  hero: {
    titleLines: ['Your agents work.', 'Ledge tells you when', 'it\'s your turn.'],
    lead: 'A workshop for all your coding agents, on your PC and your servers. You see what each one is doing, and you answer its requests without opening its terminal.',
    seeMore: 'See what it does',
    agentsLabel: 'Supported agents',
    notchLabel: 'The Ledge notch: at rest it shows what the agents are doing, then it stretches into a bubble when Otto is waiting for your approval, and when Ledge gives its update',
    desktopVideoLabel: 'The Ledge Desktop workshop on video: the agents work, Otto asks for approval and turns red, it is approved in "For you", it goes back to work, then it writes to Nova and Bix finishes',
    phoneVideoLabel: 'Ledge on the phone, on video: a question gets its answer, a command is allowed, then the sessions and The point, where a request is settled on the spot'
  },
  states: {
    label: 'The states of an agent',
    title: 'One glance is enough: an agent\'s light says what it is waiting for.',
    approval: { title: 'Your approval', text: 'It wants to run a command or apply a plan.' },
    question: { title: 'A question', text: 'It needs you to choose before it can go on.' },
    working: { title: 'Working', text: 'It is making progress. Nothing to do but follow its thread.' },
    idle: { title: 'Available', text: 'It has finished its turn and is waiting for your next instruction.' }
  },
  showcase: {
    title: 'A day in Ledge',
    tabsLabel: 'Moments of the day',
    scrollHint: 'Swipe to see the whole screen.',
    decide: {
      tab: 'Decide',
      text: 'An agent\'s thread moves forward as you watch. When it asks for approval, allow it, deny it, or deny it and say what to do instead.',
      media: 'A session on video: Otto\'s thread moves forward, the approval request arrives, "Allow" is clicked, the command runs and the tests pass'
    },
    yourTurn: {
      tab: 'Everything waiting for you',
      text: 'One page for everything that is waiting for your decision: requests from sessions, questions from your teams, PRs ready to merge.',
      media: 'The "For you" page: requests from sessions, questions from rigs, MRs and PRs to fix or merge, finished work'
    },
    point: {
      tab: 'The point',
      text: 'Ledge speaks first: what is waiting for you, what is finished, what is in progress, your rigs. Each line can be settled on the spot. Ask it your questions too: it cites its sources and offers the action as a card.',
      media: 'The point on video: Ledge posts by itself what is waiting, what is finished, what is in progress and the rigs, a decision is settled on the spot, then a typed question gets its answer with a card to hand off Nova\'s context'
    },
    launch: {
      tab: 'Launch',
      text: 'A first message, then the agent, its model, the project and the machine. The session joins its table.',
      media: 'New session: the project, the agent, the model and the first message'
    },
    review: {
      tab: 'Review',
      text: 'An agent\'s thread on one side, its changes on the other, file by file. Split the screen as you would in a code editor.',
      media: 'Otto\'s thread on the left, its changes on the right with the diff of a file'
    }
  },
  openrig: {
    title: 'A whole team, with OpenRig.',
    lead: 'OpenRig makes several agents work as a team: a lead, developers, a reviewer. Ledge is its cockpit. You launch the team, you watch it get organised, and its questions reach you like those of any other agent.',
    videoLabel: 'OpenRig in Ledge Desktop, on video: a click on "Launch", the product-team spec is chosen, a seat is added, the team comes together seat by seat in the topology, then a question from the lead arrives in "For you" and gets its answer',
    phoneAlt: 'The same rig on the phone: its five seats, its permissions, its topology and its queue',
    launch: { term: 'Launch', text: 'From a saved spec, a stopped rig, or by describing what you need: the operator suggests the team.' },
    tune: { term: 'Adjust', text: 'The number of seats per role, their agent, their model and their permissions, even while the rig is running.' },
    answer: { term: 'Answer', text: 'The team\'s decisions and questions arrive in "For you", on the PC and on the phone.' },
    control: { term: 'Stay in control', text: 'Every action shows the {rig} command it runs. A snapshot lets you go back.' },
    note: 'OpenRig is installed separately. Ledge drives it, it does not replace it.',
    link: 'Discover OpenRig'
  },
  talk: {
    title: 'Your agents talk to each other.',
    lead: 'An agent finds another one with {who} and writes to it with {send}. Ledge delivers the message at the recipient\'s next free moment, without interrupting it.',
    left: {
      testsPass: '● The overlay tests pass.',
      tellNova: '● I\'ll tell Nova, who is waiting for this to rebase.',
      send: '● Bash(ledge send nova "The tests pass, you can rebase")',
      waiting: '  ⎿ Waiting: Nova is working.',
      delivered: '  ⎿ Delivered to Nova.'
    },
    right: {
      fixing: '• I\'m fixing the fleet\'s ssh reconnection.',
      running: '  ◦ pnpm vitest run fleet/reconnect',
      passed: '  ✓ 12 tests pass',
      fixed: '• Reconnection fixed.',
      message: '✉ Otto\nThe tests pass, you can rebase',
      ack: '• Got it. I\'m rebasing on main.'
    },
    captions: {
      apart: 'Otto and Nova each work on their own.',
      writes: 'Otto writes to Nova.',
      waits: 'Nova is busy: the message waits.',
      turnEnds: 'Nova finishes its turn.',
      delivers: 'Ledge delivers the message to Nova.',
      carriesOn: 'Nova carries on.'
    },
    pause: 'Pause',
    play: 'Play',
    replay: 'Replay',
    legend: '{amber}, Ledge\'s commands.',
    legendAmber: 'In amber'
  },
  also: {
    title: 'And meanwhile, Ledge takes care of the rest.',
    archive: { term: 'Archive, resume', text: 'An archived session resumes later in the same conversation, with another model if you like.' },
    handoff: { term: 'Context handoff', text: 'Context almost full? The session writes a brief, and a new one picks up where it stops.' },
    forge: { term: 'MRs and PRs', text: 'GitHub and GitLab: the pipeline, the failing job, "ask the agent to fix it", merge.' },
    servers: { term: 'Your servers too', text: 'Up to 20 Linux machines by their SSH alias, without opening a single port.' },
    quotas: { term: 'Quotas', text: 'The limits of your Claude Code, Codex and Cursor accounts, with a warning before you hit the wall.' },
    notes: { term: 'Your notes', text: 'Markdown notes that the agents read, and that they can offer to correct.' },
    browser: { term: 'The agent\'s browser', text: 'Its screen, live, while it drives a browser. You watch, Ledge touches nothing.' },
    terminals: { term: 'Readable terminals', text: 'Every command in your shells is marked: passed, failed, how long it took, and one click to run it again.' }
  },
  everywhere: {
    title: 'The request reaches you wherever you are.',
    terminal: {
      title: 'In a terminal',
      text: '{tui} opens the same Ledge in a WSL tab, on a server over SSH or in a tmux pane. One key is enough to answer.',
      spriteAlt: 'Ledge in a terminal, in thirteen frames: the overview with two requests, "y" allows Otto, a digit answers Luna\'s question, Iris\'s terminal moves forward, its thread opens, then « Demander à Ledge » (Ask Ledge) and « Nouvelle session » (New session)',
      play: 'Play the demo',
      pause: 'Pause the demo',
      frames: {
        overview: 'Two sessions are waiting for you.',
        approve: '"y" allows Otto: it goes back to work.',
        next: 'Tab moves to the next one: Luna asks a question.',
        answer: 'A digit answers. Nobody is waiting any more.',
        down: '"j" moves down to Iris: its terminal, live.',
        progress: 'Iris makes progress: it fixes the header image.',
        green: 'Lighthouse is green again.',
        thread: 'Enter opens the session\'s thread.',
        back: 'Back to the overview.',
        ask: 'Ask Ledge: one question about all the sessions.',
        summary: 'Ledge reads the sessions and sums up where each one stands.',
        newSession: 'New session: an instruction, an agent, a project.',
        allWorking: 'Everyone is working.'
      }
    },
    notch: {
      title: 'At the top of the screen',
      text: 'The notch, on Windows. An approval request arrives there right away, with its two answers. The rest, Ledge groups and tells you in one go, without a bubble per agent. You keep typing where you were.',
      videoLabel: 'The notch on video: an approval request arrives right away and "Allow" is clicked, then Ledge announces in one go that Bix and Pim have finished and that a decision is waiting, then a rig\'s urgent question gets its answer on the spot'
    },
    phone: {
      title: 'In your pocket',
      text: 'An app to add to your home screen, end-to-end encrypted. Decide, follow a session, launch one, merge a PR, run your rigs. Anything that commits you asks for Face ID or your fingerprint.',
      sessionsAlt: 'The Sessions tab: the list by project, the filters and the "New" button',
      videoLabel: 'The app on video: "For you", Sessions, a session\'s thread, then the chat with Ledge',
      forgeAlt: 'The MRs and PRs tab: three open requests with the state of their pipeline'
    }
  },
  security: {
    title: 'Nothing without your click.',
    lead: 'Ledge suggests, you decide. And nobody else can decide for you.',
    readOnly: { term: 'The assistant reads, it does not act', text: 'It runs read-only. Every action goes through a card that you confirm.' },
    local: { term: 'Everything stays with you', text: 'The daemon only listens on {ip}. Your servers are reached through your own SSH.' },
    relay: { term: 'The relay reads nothing', text: 'Only encrypted messages travel between the PC and the phone. You can host the relay yourself.' },
    pairing: { term: 'A code to compare', text: 'A device gets access to nothing until you have checked the same six-digit code on both screens.' },
    hooks: { term: 'Your agents stay free', text: 'Ledge adds itself to their hooks and always hands control back. Without it, your sessions carry on as before.' }
  },
  install: {
    title: 'Settle in.',
    requirements: 'You need Windows 10 or 11 with WSL2, Node 22.13 or later, Git and tmux, and at least one agent already installed.',
    daemon: { title: 'The daemon, in WSL', text: 'Hooks up your agents and starts the service.' },
    desktop: { title: 'Ledge Desktop, on Windows', download: 'Download for Windows', text: 'The notch and the window, in a single app.' },
    session: { title: 'Your first session', text: 'Or "New session" in Ledge Desktop.' },
    notes: {
      platforms: 'Ledge Desktop and the notch are for Windows. The daemon runs on Linux: WSL2 or a server.',
      readOnly: 'A session started without Ledge stays visible, read-only.',
      phone: 'The phone acts on the PC it is paired with, not on your other machines.',
      relay: 'The hosted relay is invitation-only. You can host your own.'
    }
  },
  footer: {
    tagline: 'Ledge {version}. A new way to work with your agents.',
    tour: 'Guided tour',
    news: 'What\'s new',
    github: 'GitHub'
  }
};
