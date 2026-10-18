import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ClientMessage, FoundRepo, Machines, ServerMessage } from '@ledge/protocol';
import type { DaemonClient, Proposal } from '@ledge/fleet';
import { fakeSession } from '@ledge/fleet/test/mockDaemon';
import { boot, closeDaemons, PROJECTS, type MockDaemon } from './helpers';
import { machine } from './fleet-helpers';
import { LangProvider } from '../src/i18n/lang';
import { MESSAGES } from '../src/i18n/messages';
import { afterSave, applyProposal, newDraft } from '../src/projects/draft';
import { ProjectDialog } from '../src/projects/ProjectDialog';
import { rememberProposal, proposalOf } from '../src/projects/proposals';
import { loadEditor } from '../src/projects/lazy';
import { useLedgeScan } from '../src/projects/useLedgeScan';

// The editor's chunk is there before the dialog renders alone (boot does it for the app).
beforeAll(async () => { await loadEditor(); });

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await closeDaemons();
  localStorage.clear();
});

type ProjectsSet = Extract<ClientMessage, { type: 'projects.set' }>;
const setsOf = (d: MockDaemon) => d.received.filter((m): m is ProjectsSet => m.type === 'projects.set');
const scansOf = (d: MockDaemon) => d.received.filter(m => m.type === 'repos.scan');
const tick = () => new Promise(r => setTimeout(r, 50));

/** Local (the mock daemon) and Dev, which never connects: offline. */
const MACHINES: Machines = [{ id: 'local', label: 'Local' }, { id: 'dev', label: 'Dev', ssh: 'dev' }];
/** Two free repositories named paper-*: the naming proposal « Paper ». */
const PAPER: FoundRepo[] = [
  { path: '/home/me/dev/paper-fonts', branch: 'main', remote: 'github.com/me/paper-fonts' },
  { path: '/home/me/dev/paper-templates', branch: 'next' }
];
/** Ledge's own repository and a clone elsewhere with the same remote: « add to Ledge ». */
const LEDGE_CLONE: FoundRepo[] = [
  { path: '/w/ledge', branch: 'main', remote: 'github.com/me/ledge' },
  { path: '/home/me/site', branch: 'gh-pages', remote: 'github.com/me/ledge' }
];
// Otto works in Ledge's repository: no agent without a project, so no agents' folder is proposed.
const OTTO = [fakeSession('otto', { name: 'Otto', cwd: '/w/ledge', state: 'working' })];

/** The app on the mock daemon (Local answers the scan with `found`, Dev is offline), then the projects « + ». */
async function openNew(found: FoundRepo[]) {
  const env = await boot({ sessions: OTTO, machines: MACHINES });
  env.d.found.push(...found);
  await env.user.click(env.side.getByRole('button', { name: 'New project' }));
  const dialog = within(screen.getByRole('dialog', { name: 'New project' }));
  return { ...env, dialog };
}

describe('« Let Ledge do it » in the project editor', () => {
  it('shows a step per machine, then the proposal: name, colour, checked repositories with their reason; nothing is sent before the click; an unchecked one stays out', async () => {
    const { d, user, dialog } = await openNew(PAPER);
    const offer = document.querySelector('.pe-ledge')!;
    expect(offer).toHaveTextContent('Rather not look for the repositories yourself?');
    expect(offer).toHaveTextContent('Ledge scans your machines, groups the repositories that go together and proposes a project for you to check.');
    // Nothing typed nor added: « Ask Ledge » waits for a name or a repository.
    expect(dialog.queryByRole('button', { name: 'Ask Ledge' })).toBeNull();

    await user.click(dialog.getByRole('button', { name: 'Let Ledge do it' }));
    const scan = within(await screen.findByRole('dialog', { name: 'Ledge is preparing a project' }));
    expect(scan.getByText('Ledge is scanning Local…')).toBeVisible();
    expect(scan.getByText('Dev offline, skipped')).toBeVisible();
    expect(await scan.findByText('Local · 2 repositories found')).toBeVisible();
    expect(scan.getByText('Remotes and sessions compared')).toBeVisible();
    expect(document.querySelector('.pe-scan .pe-dots')).not.toBeNull();

    const prop = within(await screen.findByRole('dialog', { name: 'Ledge proposal' }));
    expect(prop.getByRole('textbox', { name: 'Name' })).toHaveValue('Paper');
    // The first colour no project uses (PROJECTS: blue, green, amber).
    expect(prop.getByRole('radio', { name: 'Violet' })).toBeChecked();
    const fonts = prop.getByRole('checkbox', { name: 'Keep paper-fonts (Local)' });
    const templates = prop.getByRole('checkbox', { name: 'Keep paper-templates (Local)' });
    expect(fonts).toBeChecked();
    expect(templates).toBeChecked();
    const fontsRow = fonts.closest('li')!;
    expect(fontsRow.querySelector('small.pe-why')).toHaveTextContent('Ledge · Named paper-*');
    // The branch the scan found.
    expect(within(fontsRow).getByText('⎇ main')).toBeVisible();
    expect(document.querySelector('.pe-proposal')).toHaveTextContent('Ledge proposes2 repositories on Local. Uncheck what does not fit, then confirm: nothing is created before.');
    expect(prop.getByText('Working repositories · 2')).toBeVisible();
    // A proposal under way: no offer, no « Ask Ledge ».
    expect(document.querySelector('.pe-ledge')).toBeNull();
    expect(prop.queryByRole('button', { name: 'Ask Ledge' })).toBeNull();
    // Scanning and proposing wrote nothing; only the machine online was scanned.
    await tick();
    expect(setsOf(d)).toEqual([]);
    expect(scansOf(d)).toHaveLength(1);

    await user.click(templates);
    expect(templates.closest('li')).toHaveClass('off');
    expect(prop.getByText('Working repositories · 1')).toBeVisible();
    expect(document.querySelector('.pe .composer-preview')!.textContent).toBe('Paper1 repository on Local · the table appears with the first session');
    await user.click(prop.getByRole('button', { name: /^Create the project/ }));
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    const sent = setsOf(d)[0]!.projects;
    expect(sent.projects.slice(0, 3)).toEqual(PROJECTS.projects);
    expect(sent.projects[3]).toEqual({ id: 'paper', name: 'Paper', color: 'violet', description: '', repos: [{ machine: 'local', path: '/home/me/dev/paper-fonts' }] });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Project Paper created.');
  });

  it('a proposal that overlaps a project is « Add to » it: the title says so, and the send keeps its repositories and adds the checked ones', async () => {
    const { d, user, dialog } = await openNew(LEDGE_CLONE);
    await user.click(dialog.getByRole('button', { name: 'Let Ledge do it' }));
    const prop = within(await screen.findByRole('dialog', { name: 'Ledge proposal for Ledge' }));
    expect(prop.getByRole('textbox', { name: 'Name' })).toHaveValue('Ledge');
    const site = prop.getByRole('checkbox', { name: 'Keep site (Local)' });
    expect(site).toBeChecked();
    expect(site.closest('li')!.querySelector('.pe-why')).toHaveTextContent('Ledge · Same remote github.com/me/ledge');
    // Ledge's own repository is there, without a box: it is not proposed.
    const own = prop.getByRole('button', { name: 'Remove ledge (Local)' }).closest('li')!;
    expect(within(own).queryByRole('checkbox')).toBeNull();
    expect(document.querySelector('.pe-proposal')).toHaveTextContent('1 more repository for Ledge, on Local.');
    // A proposal: no « Delete the project ».
    expect(prop.queryByRole('button', { name: 'Delete the project' })).toBeNull();
    await tick();
    expect(setsOf(d)).toEqual([]);

    await user.click(prop.getByRole('button', { name: /^Add to Ledge/ }));
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    const sent = setsOf(d)[0]!.projects;
    expect(sent.projects).toHaveLength(3);
    expect(sent.projects[0]).toEqual({ ...PROJECTS.projects[0], repos: [{ machine: 'local', path: '/w/ledge' }, { machine: 'local', path: '/home/me/site' }] });
    expect(sent.projects.slice(1)).toEqual(PROJECTS.projects.slice(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Ledge saved.');
  });

  it('a proposed repository another project took meanwhile: « already in » is said and the save refused while it is checked; unchecking it unblocks', async () => {
    const { d, user, dialog } = await openNew(PAPER);
    await user.click(dialog.getByRole('button', { name: 'Let Ledge do it' }));
    const prop = within(await screen.findByRole('dialog', { name: 'Ledge proposal' }));
    const fonts = prop.getByRole('checkbox', { name: 'Keep paper-fonts (Local)' });
    // A broadcast puts paper-fonts in Docs.
    const docs = PROJECTS.projects[2]!;
    act(() => d.projects({ ...PROJECTS, projects: [...PROJECTS.projects.slice(0, 2), { ...docs, repos: [...docs.repos, { machine: 'local', path: '/home/me/dev/paper-fonts' }] }] }));
    await waitFor(() => expect(fonts.closest('li')).toHaveTextContent('This repository is already in Docs'));
    await user.click(prop.getByRole('button', { name: /^Create the project/ }));
    expect(prop.getByRole('alert')).toHaveTextContent('This repository is already in Docs');
    await tick();
    expect(setsOf(d)).toEqual([]);

    await user.click(fonts);
    expect(prop.queryByRole('alert')).toBeNull();
    await user.click(prop.getByRole('button', { name: /^Create the project/ }));
    await waitFor(() => expect(setsOf(d)).toHaveLength(1));
    expect(setsOf(d)[0]!.projects.projects[3]!.repos).toEqual([{ machine: 'local', path: '/home/me/dev/paper-templates' }]);
  });

  it('« Ask Ledge » appears once a name is typed and keeps it; « Cancel » during the scan goes back to the form as it was, writing nothing', async () => {
    const { d, user, dialog, client } = await openNew(PAPER);
    // Local stays silent: the scan waits.
    const send = client.send.bind(client);
    vi.spyOn(client, 'send').mockImplementation(m => { if (m.type !== 'repos.scan') send(m); });
    await user.type(dialog.getByRole('textbox', { name: 'Name' }), 'Fonts lab');
    expect(document.querySelector('.pe-ledge')).toBeNull();
    await user.click(dialog.getByRole('button', { name: 'Ask Ledge' }));
    const scan = within(await screen.findByRole('dialog', { name: 'Ledge is preparing a project' }));
    expect(scan.getByText('Scanning Local…')).toBeVisible();
    expect(scan.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.click(scan.getByRole('button', { name: 'Cancel' }));
    const back = within(screen.getByRole('dialog', { name: 'New project' }));
    expect(back.getByRole('textbox', { name: 'Name' })).toHaveValue('Fonts lab');
    expect(document.querySelector('.pe-proposal')).toBeNull();
    expect(back.getByRole('button', { name: 'Ask Ledge' })).toBeVisible();
    await tick();
    expect(setsOf(d)).toEqual([]);

    // Now Local answers: the typed name is kept and the repositories whose name holds one of its words are proposed.
    vi.mocked(client.send).mockRestore();
    await user.click(back.getByRole('button', { name: 'Ask Ledge' }));
    const prop = within(await screen.findByRole('dialog', { name: 'Ledge proposal' }));
    expect(prop.getByRole('textbox', { name: 'Name' })).toHaveValue('Fonts lab');
    expect(prop.getByRole('checkbox', { name: 'Keep paper-fonts (Local)' }).closest('li')!.querySelector('.pe-why')).toHaveTextContent('Ledge · Name close to “fonts”');
    expect(prop.queryByRole('checkbox', { name: 'Keep paper-templates (Local)' })).toBeNull();
  });

  it('nothing free: the mockup\'s message, and the form stays as it was', async () => {
    const { user, dialog } = await openNew([{ path: '/w/ledge', branch: 'main' }]);
    await user.click(dialog.getByRole('button', { name: 'Let Ledge do it' }));
    const back = within(await screen.findByRole('dialog', { name: 'New project' }, { timeout: 3000 }));
    expect(await back.findByText('Every repository found already belongs to a project. Add one by hand.')).toBeVisible();
    expect(back.getByRole('textbox', { name: 'Name' })).toHaveValue('');
  });

  it('after « nothing free », « Run again » scans again and can propose', async () => {
    const { d, user, dialog } = await openNew([{ path: '/w/ledge', branch: 'main' }]);
    await user.click(dialog.getByRole('button', { name: 'Let Ledge do it' }));
    const back = within(await screen.findByRole('dialog', { name: 'New project' }, { timeout: 3000 }));
    await back.findByText('Every repository found already belongs to a project. Add one by hand.');
    d.found.push(...PAPER);
    await user.click(back.getByRole('button', { name: 'Run again' }));
    const prop = within(await screen.findByRole('dialog', { name: 'Ledge proposal' }, { timeout: 3000 }));
    expect(prop.getByRole('checkbox', { name: 'Keep paper-fonts (Local)' })).toBeChecked();
    expect(scansOf(d)).toHaveLength(2);
  });
});

/** A client that answers nothing: for the dialog alone. */
const silentClient = () => ({ send: vi.fn(), onMessage: () => () => {} }) as unknown as DaemonClient;

describe('a scan cut short', () => {
  it('the proposal says the scan was limited, and on which machines', async () => {
    const { d, user, dialog } = await openNew(PAPER);
    d.options.scanTruncated = true;
    await user.click(dialog.getByRole('button', { name: 'Let Ledge do it' }));
    await screen.findByRole('dialog', { name: 'Ledge proposal' }, { timeout: 3000 });
    expect(document.querySelector('.pe-proposal')).toHaveTextContent('Ledge proposes2 repositories on Local. Uncheck what does not fit, then confirm: nothing is created before. · scan limited on Local');
  });

  it('« nothing free » after a limited scan does not claim completeness', async () => {
    const { d, user, dialog } = await openNew([{ path: '/w/ledge', branch: 'main' }]);
    d.options.scanTruncated = true;
    await user.click(dialog.getByRole('button', { name: 'Let Ledge do it' }));
    const back = within(await screen.findByRole('dialog', { name: 'New project' }, { timeout: 3000 }));
    expect(await back.findByText('Every repository found already belongs to a project. Add one by hand. · scan limited on Local')).toBeVisible();
    // Run again, complete: the clause goes.
    d.options.scanTruncated = false;
    await user.click(back.getByRole('button', { name: 'Run again' }));
    expect(await back.findByText('Every repository found already belongs to a project. Add one by hand.', undefined, { timeout: 3000 })).toBeVisible();
  });

  it('says it in French too', () => {
    expect(MESSAGES.fr.projects.ledge.limited(['Local', 'Dev'])).toBe(' · parcours limité sur Local et Dev');
    expect(MESSAGES.en.projects.ledge.limited(['Local', 'Dev'])).toBe(' · scan limited on Local and Dev');
  });
});

describe('the scan with no machine answering', () => {
  it('says that no machine could be scanned, not that everything is taken', async () => {
    render(<LangProvider lang="en"><ProjectDialog projects={PROJECTS} sessions={[]} machines={[machine('local', { ready: false })]} client={silentClient()}
      fleet={{ setProjects: vi.fn() }} projectIdOf={() => null} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} /></LangProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Let Ledge do it' }));
    const back = within(await screen.findByRole('dialog', { name: 'New project' }, { timeout: 3000 }));
    expect(await back.findByText('No machine could be scanned.')).toBeVisible();
    expect(back.queryByText('Every repository found already belongs to a project. Add one by hand.')).toBeNull();
    expect(back.getByRole('button', { name: 'Run again' })).toBeVisible();
  });
});

describe('« add to » from a seeded draft', () => {
  it('keeps the seeded folder after the target\'s repositories, and its session to file', () => {
    const kit = fakeSession('kit', { name: 'Kit', cwd: '/tmp/foo', state: 'waiting_input' });
    const seeded = newDraft(PROJECTS, kit);
    const toLedge: Proposal = {
      pid: 'prop-ledge', name: 'Ledge', color: 'blue', description: '', targetId: 'ledge', file: [],
      repos: [{ machine: 'local', path: '/home/me/site', why: { kind: 'remote', remote: 'github.com/me/ledge', machines: ['Local'] } }],
      summary: { repos: 1, machines: ['Local'], target: 'Ledge', agents: [] }
    };
    const d = applyProposal(seeded, toLedge, PROJECTS);
    expect(d.id).toBe('ledge');
    expect(d.repos).toEqual([{ machine: 'local', path: '/w/ledge' }, { machine: 'local', path: '/tmp/foo' }, { machine: 'local', path: '/home/me/site' }]);
    expect(d.file).toEqual(['kit']);
    const { next } = afterSave(PROJECTS, d, [kit]);
    expect(next.projects[0]!.repos).toEqual([{ machine: 'local', path: '/w/ledge' }, { machine: 'local', path: '/tmp/foo' }, { machine: 'local', path: '/home/me/site' }]);
    expect(next.rules).toEqual([{ machine: 'local', path: '/tmp/foo', project: 'ledge' }]);
  });
});

/** Kit's folder /tmp, as Settings or the chat would hand it over (rememberProposal, then `{ kind: 'project', proposal: pid }`). */
const TMP: Proposal = {
  pid: 'prop-tmp', name: 'Tmp', color: 'violet', description: '', file: ['kit'],
  repos: [{ machine: 'local', path: '/tmp', why: { kind: 'agent', names: ['Kit'] } }],
  summary: { repos: 1, machines: ['Local'], agents: ['Kit'] }
};

describe('a proposal opened by the navigation', () => {
  it('opens the editor on it, with the agents to file checked; the main button sends the project and the rule', async () => {
    const pid = rememberProposal(TMP);
    expect(pid).toBe('prop-tmp');
    expect(proposalOf(pid)).toBe(TMP);
    const setProjects = vi.fn();
    const kit = fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input' });
    render(<LangProvider lang="en"><ProjectDialog proposal={pid} projects={PROJECTS} sessions={[kit]} machines={[machine('local')]} client={{ send: vi.fn(), onMessage: () => () => {} } as unknown as DaemonClient}
      fleet={{ setProjects }} projectIdOf={() => null} onClose={vi.fn()} onSaved={vi.fn()} onDeleted={vi.fn()} /></LangProvider>);
    const dialog = within(await screen.findByRole('dialog', { name: 'Ledge proposal' }));
    expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Tmp');
    expect(dialog.getByRole('checkbox', { name: 'Keep tmp (Local)' }).closest('li')!.querySelector('.pe-why')).toHaveTextContent('Ledge · Folder opened by Kit');
    expect(dialog.getByRole('checkbox', { name: 'Kit' })).toBeChecked();
    expect(document.querySelector('.pe-proposal')).toHaveTextContent('1 repository on Local. Also to file: Kit.');
    expect(setProjects).not.toHaveBeenCalled();
    dialog.getByRole('button', { name: /^Create the project/ }).click();
    await waitFor(() => expect(setProjects).toHaveBeenCalledTimes(1));
    const next = setProjects.mock.calls[0]![0];
    expect(next.projects[3]).toEqual({ id: 'tmp', name: 'Tmp', color: 'violet', description: '', repos: [{ machine: 'local', path: '/tmp' }] });
    expect(next.rules).toEqual([{ machine: 'local', path: '/tmp', project: 'tmp' }]);
  });

  it('a save that timed out, then confirmed after an edit, leaves proposal mode: the editor is on the project it created', async () => {
    rememberProposal(TMP);
    const setProjects = vi.fn();
    const kit = fakeSession('kit', { name: 'Kit', cwd: '/tmp', state: 'waiting_input' });
    const props = { proposal: 'prop-tmp', sessions: [kit], machines: [machine('local')], client: silentClient(), fleet: { setProjects }, projectIdOf: () => null, onClose: vi.fn(), onSaved: vi.fn(), onDeleted: vi.fn() };
    const view = render(<LangProvider lang="en"><ProjectDialog {...props} projects={PROJECTS} /></LangProvider>);
    const dialog = within(await screen.findByRole('dialog', { name: 'Ledge proposal' }));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    fireEvent.click(dialog.getByRole('button', { name: /^Create the project/ }));
    act(() => { vi.advanceTimersByTime(8000); });
    expect(dialog.getByRole('alert')).toHaveTextContent('The daemon did not confirm the save.');
    vi.useRealTimers();
    fireEvent.change(dialog.getByRole('textbox', { name: 'Name' }), { target: { value: 'Tmp files' } });
    view.rerender(<LangProvider lang="en"><ProjectDialog {...props} projects={setProjects.mock.calls[0]![0]} /></LangProvider>);
    await waitFor(() => expect(dialog.getByRole('button', { name: /^Save/ })).toBeVisible());
    expect(dialog.queryByRole('button', { name: /^Add to/ })).toBeNull();
    expect(document.querySelector('.pe-proposal')).toBeNull();
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it('an unknown pid closes the window and says the proposal no longer exists', () => {
    const onClose = vi.fn();
    const notify = vi.fn();
    render(<LangProvider lang="en"><ProjectDialog proposal="prop-gone" projects={PROJECTS} sessions={[]} machines={[]} client={{} as DaemonClient} fleet={{ setProjects: vi.fn() }}
      projectIdOf={() => null} onClose={onClose} onSaved={vi.fn()} onDeleted={vi.fn()} notify={notify} /></LangProvider>);
    expect(onClose).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('This proposal no longer exists.');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the reasons and the summary, in both languages', () => {
  it('remote (on several machines), agent, naming, folder, chat', () => {
    for (const [l, remote, agent, naming, folder] of [
      ['fr', 'Même remote github.com/me/x, sur Local et Dev', 'Dossier ouvert par Kit et Zed', 'Nommé paper-*', 'Rangé dans /w'],
      ['en', 'Same remote github.com/me/x, on Local and Dev', 'Folder opened by Kit and Zed', 'Named paper-*', 'Kept in /w']
    ] as const) {
      const why = MESSAGES[l].projects.why;
      expect(why({ kind: 'remote', remote: 'github.com/me/x', machines: ['Local', 'Dev'] })).toBe(remote);
      expect(why({ kind: 'agent', names: ['Kit', 'Zed'] })).toBe(agent);
      expect(why({ kind: 'naming', stem: 'paper' })).toBe(naming);
      expect(why({ kind: 'folder', parent: '/w' })).toBe(folder);
      expect(why({ kind: 'chat', text: 'Vu dans la conversation' })).toBe('Vu dans la conversation');
      expect(why({ kind: 'name', word: 'fonts' })).toBe(l === 'fr' ? 'Nom proche de « fonts »' : 'Name close to “fonts”');
    }
    expect(MESSAGES.fr.projects.why({ kind: 'remote', remote: 'r', machines: ['Local'] })).toBe('Même remote r');
    expect(MESSAGES.fr.projects.ledge.summary({ repos: 3, machines: ['Local', 'Dev'], target: 'Ledge', agents: ['Kit'] })).toBe('3 dépôts de plus pour Ledge, sur Local et Dev. À ranger aussi : Kit.');
    expect(MESSAGES.fr.projects.ledge.summary({ repos: 1, machines: ['Local'], agents: [] })).toBe('1 dépôt sur Local.');
  });
});

/** A client that keeps what is sent and plays the daemon's answers. */
function fakeClient() {
  const sent: ClientMessage[] = [];
  const fns = new Set<(m: ServerMessage) => void>();
  const client = { send: (m: ClientMessage) => { sent.push(m); }, onMessage: (f: (m: ServerMessage) => void) => { fns.add(f); return () => { fns.delete(f); }; } } as unknown as DaemonClient;
  return { client, sent, emit: (m: ServerMessage) => act(() => { for (const f of [...fns]) f(m); }) };
}
const idOf = (m: ClientMessage | undefined) => (m as Extract<ClientMessage, { type: 'repos.scan' }>).requestId;

describe('useLedgeScan', () => {
  it('one scan per machine online, each with its own requestId; an offline one is skipped unasked; truncated and outdated answers are said', () => {
    const { client, sent, emit } = fakeClient();
    const machines = [machine('local'), machine('dev'), machine('box', { ready: false })];
    const { result } = renderHook(() => useLedgeScan(client, machines));
    expect(result.current.status).toBe('idle');
    act(() => result.current.start());
    expect(sent).toEqual([{ type: 'repos.scan', requestId: expect.any(String), machineId: 'local' }, { type: 'repos.scan', requestId: expect.any(String), machineId: 'dev' }]);
    expect(idOf(sent[0])).not.toBe(idOf(sent[1]));
    expect(result.current.status).toBe('scanning');
    expect(result.current.steps.map(s => s.state)).toEqual(['waiting', 'waiting', 'offline']);
    // An answer to another request changes nothing.
    emit({ type: 'repos.found', requestId: 'other', repos: [{ path: '/x', branch: null }], truncated: false });
    emit({ type: 'repos.found', requestId: idOf(sent[0]), repos: [{ path: '/a', branch: 'main' }, { path: '/b', branch: null }], truncated: true });
    expect(result.current.steps[0]).toEqual({ machine: 'local', label: 'Local', state: 'done', repos: 2, truncated: true });
    expect(result.current.status).toBe('scanning');
    emit({ type: 'repos.found', requestId: idOf(sent[1]), repos: [], truncated: false, error: 'outdated' });
    expect(result.current.status).toBe('done');
    expect(result.current.scans.map(s => [s.machine, s.label, s.status, s.repos.length, s.truncated])).toEqual([
      ['local', 'Local', 'ok', 2, true], ['dev', 'Dev', 'outdated', 0, false], ['box', 'Box', 'offline', 0, false]
    ]);
    expect(MESSAGES.en.projects.ledge.step(result.current.steps[0]!)).toBe('Local · 2 repositories found · scan limited');
    expect(MESSAGES.en.projects.ledge.step(result.current.steps[1]!)).toBe('Dev: daemon too old, skipped');
    expect(MESSAGES.fr.projects.ledge.step(result.current.steps[1]!)).toBe('Dev : daemon trop ancien, ignorée');
    expect(MESSAGES.fr.projects.ledge.step(result.current.steps[2]!)).toBe('Box hors ligne, ignorée');
  });

  it('a machine silent for 15 s times out (offline for proposing); a late answer is ignored', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { client, sent, emit } = fakeClient();
    const { result } = renderHook(() => useLedgeScan(client, [machine('local')]));
    act(() => result.current.start());
    act(() => { vi.advanceTimersByTime(14_999); });
    expect(result.current.steps[0]!.state).toBe('waiting');
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.steps[0]!.state).toBe('timeout');
    expect(result.current.status).toBe('done');
    expect(result.current.scans[0]!.status).toBe('offline');
    emit({ type: 'repos.found', requestId: idOf(sent[0]), repos: [{ path: '/a', branch: 'main' }], truncated: false });
    expect(result.current.steps[0]!.state).toBe('timeout');
    expect(MESSAGES.en.projects.ledge.step(result.current.steps[0]!)).toBe('Local did not answer, skipped');
  });

  it('cancel goes back to idle and ignores the answers still to come', () => {
    const { client, sent, emit } = fakeClient();
    const { result } = renderHook(() => useLedgeScan(client, [machine('local')]));
    act(() => result.current.start());
    act(() => result.current.cancel());
    expect(result.current.status).toBe('idle');
    expect(result.current.steps).toEqual([]);
    emit({ type: 'repos.found', requestId: idOf(sent[0]), repos: [{ path: '/a', branch: 'main' }], truncated: false });
    expect(result.current.status).toBe('idle');
    expect(result.current.scans).toEqual([]);
  });
});
