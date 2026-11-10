import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { daemonStore, type DaemonError } from '@ledge/fleet';
import { closeDaemons, LAUNCH_PROJECTS, openLaunch, type MockDaemon } from './helpers';
import { LAUNCH_TIMEOUT_MS, type LaunchMessage } from '../src/launch/model';
import { useLaunch } from '../src/launch/useLaunch';

beforeEach(() => localStorage.clear());
// jsdom has no scrollIntoView: a test that stubs it leaves none behind.
afterEach(async () => { vi.useRealTimers(); delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; cleanup(); await closeDaemons(); });

const launches = (d: MockDaemon) => d.received.filter(m => m.type === 'session.launch');
const dialog = () => screen.queryByRole('dialog', { name: 'New session' });
const launchButton = (form: ReturnType<typeof within>) => form.getByRole('button', { name: /Launch/ });

describe('launching', () => {
  it('one launch at a time; launched: the form closes, the session opens in its tab, the notice names agent and table', async () => {
    const { d, user, form } = await openLaunch({ list: false });
    await user.type(form.getByRole('textbox', { name: 'First message' }), 'Relis la PR');
    await user.click(within(form.getByRole('group', { name: 'Agent' })).getByRole('button', { name: /^Codex/ }));
    d.holdLaunch();                                                    // the fake daemon answers only when released
    await user.keyboard('{Control>}{Enter}{/Control}');
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(form.getByRole('button', { name: /Launching…/ })).toHaveAttribute('aria-disabled', 'true');
    await user.click(form.getByRole('button', { name: /Launching…/ }));
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    // The IDE's modal sends more (its model, where it opens): what the launch is made of.
    expect(launches(d)).toEqual([expect.objectContaining({ type: 'session.launch', tool: 'codex', cwd: '/w/ledge/app', name: expect.any(String), prompt: 'Relis la PR' })]);
    const name = launches(d)[0]!.name!;
    d.releaseLaunch();
    await waitFor(() => expect(dialog()).toBeNull());
    expect(screen.getByText(`${name} is starting at the Ledge table.`)).toBeVisible();
    // The IDE opens the launched session in its tab (where the modal said: the active group).
    await waitFor(() => expect(screen.queryAllByRole('tab').find(t => t.closest('.dv-tabs-container') && t.getAttribute('aria-selected') === 'true')).toHaveAccessibleName(name));
    expect(launches(d)).toHaveLength(1);
  }, 30_000);

  it('an agent that lands with no table (its folder left the project meanwhile) is said to start with no project, never at the form’s table', async () => {
    const { d, user, form } = await openLaunch({ list: false });
    await user.type(form.getByRole('textbox', { name: 'First message' }), 'Relis la PR');
    await user.click(within(form.getByRole('group', { name: 'Agent' })).getByRole('button', { name: /^Codex/ }));
    d.holdLaunch();
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    const name = launches(d)[0]!.name!;
    const [ledge, ...others] = LAUNCH_PROJECTS.projects;
    d.projects({ projects: [{ ...ledge!, repos: ledge!.repos.filter(r => r.path !== '/w/ledge/app') }, ...others], rules: [] });
    d.releaseLaunch();
    await waitFor(() => expect(dialog()).toBeNull());
    expect(await screen.findByText(`${name} is starting, with no project.`)).toBeVisible();
    expect(screen.queryByText(/ is starting at the Ledge table\./)).toBeNull();
  });

  it('a refusal stays in the form with its message and values; a retry is possible', async () => {
    const { d, user, form } = await openLaunch();
    await user.type(form.getByRole('textbox', { name: 'First message' }), 'Relis la PR');
    await user.click(within(form.getByRole('group', { name: 'Agent' })).getByRole('button', { name: /^Codex/ }));
    d.refuseLaunch('codex: command not found');
    await user.click(launchButton(form));
    // With several machines the fleet names the one that refused.
    await waitFor(() => expect(form.getByRole('alert')).toHaveTextContent('Launch refused: Local: codex: command not found'));
    expect(form.getByRole('textbox', { name: 'First message' })).toHaveValue('Relis la PR');
    expect(within(form.getByRole('group', { name: 'Agent' })).getByRole('button', { name: /^Codex/ })).toHaveAttribute('aria-pressed', 'true');
    expect(launchButton(form)).toHaveTextContent(/^Launch/);
    expect(launchButton(form)).toHaveAttribute('aria-disabled', 'false');
    expect(dialog()).not.toBeNull();
    expect(document.querySelector('.toast')).toBeNull();
    // A retry goes out, and succeeds.
    d.options.autoLaunch = true;
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(dialog()).toBeNull());
    expect(launches(d)).toHaveLength(2);
    expect(screen.getByText(/ is starting at the Ledge table\.$/)).toBeVisible();
  });

  it('another command refused by the machine during a launch does not end it: the machine dropping later is the launch\'s refusal', async () => {
    const { d, user, form } = await openLaunch();
    await user.type(form.getByRole('textbox', { name: 'First message' }), 'Relis la PR');
    await user.click(within(form.getByRole('group', { name: 'Agent' })).getByRole('button', { name: /^Codex/ }));
    d.holdLaunch();
    await user.click(launchButton(form));
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    d.reply({ type: 'error', id: 'otto', message: 'not waiting', request: 'session.decide' });   // another command's refusal
    expect(launchButton(form)).toHaveTextContent(/^Launching…/);
    await d.close();
    // The fleet's « Local is offline » ends the launch at once (the form then names the machine missing, the refusal behind it), not 20 s of « Launching… ».
    await waitFor(() => expect(launchButton(form)).toHaveTextContent(/^Launch(?!ing)/));
    expect(form.getByRole('alert')).toHaveTextContent('No machine online');
  });

  it('no answer within 20 s says so; a late answer after closing does not reopen or toast', async () => {
    const { d, form } = await openLaunch();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.type(form.getByRole('textbox', { name: 'First message' }), 'Relis la PR');
    await user.click(within(form.getByRole('group', { name: 'Agent' })).getByRole('button', { name: /^Codex/ }));
    d.holdLaunch();
    await user.click(launchButton(form));
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    act(() => { vi.advanceTimersByTime(LAUNCH_TIMEOUT_MS - 1000); });
    expect(form.queryByRole('alert')).toBeNull();
    expect(form.getByRole('button', { name: /Launching…/ })).toHaveAttribute('aria-disabled', 'true');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(form.getByRole('alert')).toHaveTextContent('The launch did not answer. Check the machine, then try again.');
    expect(launchButton(form)).toHaveTextContent(/^Launch/);
    expect(launchButton(form)).toHaveAttribute('aria-disabled', 'false');
    await user.keyboard('{Escape}');
    expect(dialog()).toBeNull();
    // The held launch answers late: the agent appears at its place, nothing reopens, nothing is said.
    const name = launches(d)[0]!.name!;
    d.releaseLaunch();
    await screen.findByRole('button', { name: new RegExp(`^${name},`) });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(dialog()).toBeNull();
    expect(document.querySelector('.toast')).toBeNull();
  });

  it('Cancel while launching closes the form; the late answer is not announced', async () => {
    const { d, user, form } = await openLaunch();
    await user.type(form.getByRole('textbox', { name: 'First message' }), 'Relis la PR');
    await user.click(within(form.getByRole('group', { name: 'Agent' })).getByRole('button', { name: /^Codex/ }));
    d.holdLaunch();
    await user.click(launchButton(form));
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    await user.click(form.getByRole('button', { name: 'Cancel' }));
    expect(dialog()).toBeNull();
    const name = launches(d)[0]!.name!;
    d.releaseLaunch();
    await screen.findByRole('button', { name: new RegExp(`^${name},`) });
    expect(document.querySelector('.toast')).toBeNull();
    // Reopened, the form starts afresh.
    await user.keyboard('n');
    const again = within(await screen.findByRole('dialog', { name: 'New session' }));
    expect(launchButton(again)).toHaveTextContent(/^Launch/);
    expect(again.queryByRole('alert')).toBeNull();
  });

  it('a late answer for an earlier launch is not taken for the current one; the notice names the launched session and its own table', async () => {
    const { d, user, form } = await openLaunch();
    await user.type(form.getByRole('textbox', { name: 'First message' }), 'A');
    await user.click(within(form.getByRole('group', { name: 'Agent' })).getByRole('button', { name: /^Codex/ }));
    d.holdLaunch();
    await user.click(launchButton(form));
    await waitFor(() => expect(launches(d)).toHaveLength(1));
    await user.click(form.getByRole('button', { name: 'Cancel' }));
    await user.keyboard('n');
    const b = within(await screen.findByRole('dialog', { name: 'New session' }));
    await user.type(b.getByRole('textbox', { name: 'First message' }), 'B');
    await user.click(within(b.getByRole('group', { name: 'Agent' })).getByRole('button', { name: /^Claude Code/ }));
    // The IDE's modal: the project is a menu of « project · folder · machine » rows.
    await user.click(b.getByRole('button', { name: /^Project / }));
    await user.click(within(screen.getByRole('menu')).getAllByRole('menuitem', { name: /^Payment Service/ })[0]!);
    await user.click(launchButton(b));
    await waitFor(() => expect(launches(d)).toHaveLength(2));
    expect(launches(d)[1]).toMatchObject({ tool: 'claude', cwd: '/w/pay' });
    // A answers: listed, then launched; B's form keeps waiting.
    const seq = daemonStore.getState().lastLaunched?.seq ?? 0;
    d.releaseLaunch(1);
    await waitFor(() => expect(daemonStore.getState().lastLaunched?.seq).toBe(seq + 1));
    expect(dialog()).not.toBeNull();
    expect(b.getByRole('button', { name: /Launching…/ })).toHaveAttribute('aria-disabled', 'true');
    expect(document.querySelector('.toast')).toBeNull();
    // B answers: the form closes, the notice names B at the table its session sits at.
    d.releaseLaunch();
    await waitFor(() => expect(dialog()).toBeNull());
    expect(screen.getByText(`${launches(d)[1]!.name} is starting at the Payment Service Platform Migration Europe table.`)).toBeVisible();
  });

});

describe('useLaunch', () => {
  const msg: LaunchMessage = { type: 'session.launch', tool: 'codex', cwd: '/w/a', name: 'Ada', prompt: 'Go', machineId: 'nas' };
  type View = { client: { send: (m: unknown) => void }; lastLaunched: { id: string; seq: number } | null; errors: readonly DaemonError[]; sessions: readonly object[] };
  const setup = (initial: Partial<View> = {}) => {
    const onLaunched = vi.fn();
    const view: View = { client: { send: vi.fn() }, lastLaunched: { id: 'local:old', seq: 3 }, errors: [{ message: 'old', seq: 5, request: 'session.launch' }], sessions: [], ...initial };
    const hook = renderHook((v: View) => useLaunch(v as never, onLaunched), { initialProps: view });
    return { ...hook, view, onLaunched };
  };

  it('only answers seen after the send count; a launch error with a session id or for another request does not', () => {
    const { result, rerender, view, onLaunched } = setup();
    act(() => result.current.launch(msg));
    act(() => result.current.launch(msg));
    expect(view.client.send).toHaveBeenCalledOnce();
    expect(result.current.state).toEqual({ status: 'launching' });
    rerender({ ...view, errors: [...view.errors, { id: 'local:otto', message: 'no', seq: 6, request: 'session.launch' }, { message: 'no', seq: 7, request: 'session.reply' }] });
    expect(result.current.state).toEqual({ status: 'launching' });
    rerender({ ...view, lastLaunched: { id: 'nas:ada', seq: 4 } });
    expect(onLaunched).toHaveBeenCalledExactlyOnceWith('nas:ada');
    expect(result.current.state).toEqual({ status: 'idle' });
  });

  it('a launched answer from another machine, or for another tool or folder, is not this launch: the wait goes on', () => {
    const ada = (extra: object) => ({ id: 'nas:ada', name: 'Ada', tool: 'codex', cwd: '/w/a', ...extra });
    const { result, rerender, view, onLaunched } = setup({ sessions: [] });
    act(() => result.current.launch(msg));
    rerender({ ...view, lastLaunched: { id: 'local:ada', seq: 4 } });
    rerender({ ...view, lastLaunched: { id: 'nas:bob', seq: 5 }, sessions: [ada({ id: 'nas:bob', tool: 'claude' })] });
    rerender({ ...view, lastLaunched: { id: 'nas:cid', seq: 6 }, sessions: [ada({ id: 'nas:cid', cwd: '/w/b' })] });
    expect(onLaunched).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: 'launching' });
    // Listed with the same tool and folder (normalized), or not listed yet: this launch.
    rerender({ ...view, lastLaunched: { id: 'nas:ada', seq: 7 }, sessions: [ada({ cwd: '/w//a/' })] });
    expect(onLaunched).toHaveBeenCalledExactlyOnceWith('nas:ada');
    act(() => result.current.launch({ ...msg, machineId: undefined }));
    rerender({ ...view, lastLaunched: { id: 'local:dee', seq: 8 }, sessions: [] });
    expect(onLaunched).toHaveBeenLastCalledWith('local:dee');
  });

  it('a machine that drops mid-launch: the fleet\'s « is offline » is the refusal', () => {
    const { result, rerender, view } = setup();
    act(() => result.current.launch(msg));
    rerender({ ...view, errors: [...view.errors, { message: 'NAS is offline', seq: 6, request: 'session.launch' }] });
    expect(result.current.state).toEqual({ status: 'refused', message: 'NAS is offline' });
  });

  it('timed out, a late answer while the form is open still lands; after reset nothing does', () => {
    vi.useFakeTimers();
    const { result, rerender, view, onLaunched } = setup();
    act(() => result.current.launch(msg));
    act(() => { vi.advanceTimersByTime(LAUNCH_TIMEOUT_MS); });
    expect(result.current.state).toEqual({ status: 'timeout' });
    rerender({ ...view, lastLaunched: { id: 'nas:ada', seq: 4 } });
    expect(onLaunched).toHaveBeenCalledExactlyOnceWith('nas:ada');
    act(() => result.current.launch(msg));
    act(() => result.current.reset());
    expect(result.current.state).toEqual({ status: 'idle' });
    rerender({ ...view, lastLaunched: { id: 'nas:bob', seq: 5 }, errors: [...view.errors, { message: 'late', seq: 6, request: 'session.launch' }] });
    expect(onLaunched).toHaveBeenCalledOnce();
    expect(result.current.state).toEqual({ status: 'idle' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
