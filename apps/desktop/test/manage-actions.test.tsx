import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WebSocket from 'ws';
import type { DaemonClient } from '@ledge/fleet';
import type { DaemonInfo } from '@ledge/protocol';
import { createMockDaemon, fakeSession } from '@ledge/fleet/test/mockDaemon';
import { LangProvider, useI18n } from '../src/i18n/lang';
import { createDesktopFleet, useFleet } from '../src/fleet/useFleet';
import { Toast, useToast } from '../src/shell/Toast';
import { useSessionActions } from '../src/manage/useSessionActions';
import { ConfirmDialog } from '../src/manage/ConfirmDialog';
import { messagesFor } from '../src/i18n/lang';

const t = messagesFor('en');
const CAN: DaemonInfo = { version: '0.7.0', install: 'npm', systemd: true, archive: true };
const OLD: DaemonInfo = { version: '0.6.0', install: 'npm', systemd: true };

const bix = fakeSession('bix', { name: 'Bix', state: 'exited' });
const nova = fakeSession('nova', { name: 'Nova', state: 'working', helpers: [{ id: 'h1', kind: 'Explore', task: 'Read', state: 'working' }] });
const rio = fakeSession('rio', { name: 'Rio', state: 'working', offline: true });
const old = fakeSession('old', { name: 'Old', state: 'exited', archivedAt: '2026-10-18T10:00:00.000Z' });

/** The hook in the real fleet, toast and language, with a button per action. */
function Harness({ client }: { client: DaemonClient }) {
  const view = useFleet(client);
  const { notice, action, notify, undo } = useToast();
  const { t } = useI18n();
  const a = useSessionActions({ client: view.client, sessions: view.sessions, archived: view.archived, machines: view.machines, errors: view.errors, notify });
  return (
    <>
      <button onClick={() => a.request('archive', ['local:bix'])}>archive bix</button>
      <button onClick={() => a.request('archive', ['local:nova'])}>archive nova</button>
      <button onClick={() => a.request('archive', ['local:rio'])}>archive rio</button>
      <button onClick={() => a.request('end', ['local:nova', 'local:h1'])}>end nova</button>
      <button onClick={() => a.request('delete', ['local:old'])}>delete old</button>
      <button onClick={() => a.resume('local:bix')}>resume bix</button>
      <button onClick={() => a.restore('local:old')}>restore old</button>
      <span aria-label="allowed">{String(a.allowed('local:bix'))}</span>
      {a.pending && <ConfirmDialog c={a.pending} onConfirm={a.confirm} onCancel={a.cancel} />}
      <Toast notice={notice} action={action} onAction={undo} />
      <i hidden>{t.close}</i>
    </>
  );
}

async function setup(daemon: DaemonInfo = CAN) {
  const d = await createMockDaemon();
  d.extras.daemon = daemon;
  for (const s of [bix, nova, rio, old]) d.upsert(s);
  const client = createDesktopFleet({ url: d.url, WebSocketImpl: WebSocket });
  render(<LangProvider lang="en"><Harness client={client} /></LangProvider>);
  // Ready once the snapshot (with its capability) arrived.
  await waitFor(() => expect(screen.getByLabelText('allowed')).toHaveTextContent(String(daemon.archive === true)));
  return { d, user: userEvent.setup(), sent: () => d.received.filter(m => m.type !== 'snapshot.request') };
}
/** The daemon sees the session's own id: the fleet routes by the machine prefix and strips it. */
const types = (ms: { type: string }[]) => ms.map(m => m.type);

afterEach(cleanup);

describe('session actions', () => {
  it('archiving a finished session sends session.archive at once and offers Annuler, which restores', async () => {
    const { d, user, sent } = await setup();
    try {
      await user.click(screen.getByText('archive bix'));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      await waitFor(() => expect(sent()).toContainEqual({ type: 'session.archive', id: 'bix' }));
      expect(screen.getByRole('status')).toHaveTextContent(t.manage.archived('Bix', 0));
      await user.click(screen.getByRole('button', { name: new RegExp(t.manage.undo) }));
      await waitFor(() => expect(sent()).toContainEqual({ type: 'session.restore', id: 'bix' }));
    } finally { await d.close(); }
  });

  it('the Annuler action lives 8 s: still there at 7 s, gone after 8 s', async () => {
    const { d, user } = await setup();
    try {
      await user.click(screen.getByText('archive bix'));
      const label = new RegExp(t.manage.undo);
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      await new Promise(r => setTimeout(r, 7000));
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('button', { name: label })).toBeNull(), { timeout: 2500 });
    } finally { await d.close(); }
  }, 15_000);

  it('archiving an offline session is not asked either', async () => {
    const { d, user, sent } = await setup();
    try {
      await user.click(screen.getByText('archive rio'));
      // An offline session is archived at once too.
      await waitFor(() => expect(types(sent())).toContain('session.archive'));
      expect(screen.queryByRole('alertdialog')).toBeNull();
    } finally { await d.close(); }
  });

  it('archiving a working session asks first, then sends session.archive', async () => {
    const { d, user, sent } = await setup();
    try {
      await user.click(screen.getByText('archive nova'));
      const dialog = await screen.findByRole('alertdialog', { name: t.manage.confirm.title.archive(['Nova']) });
      expect(dialog).toHaveAccessibleDescription(t.manage.confirm.body.archive(['Nova'], 1));
      expect(types(sent())).not.toContain('session.archive');
      await user.click(screen.getByRole('button', { name: t.manage.confirm.ok.archive }));
      await waitFor(() => expect(sent()).toContainEqual({ type: 'session.archive', id: 'nova' }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent(t.manage.archived('Nova', 1));
    } finally { await d.close(); }
  });

  it('end and delete always ask; cancel sends nothing', async () => {
    const { d, user, sent } = await setup();
    try {
      await user.click(screen.getByText('end nova'));
      await screen.findByRole('alertdialog', { name: t.manage.confirm.title.end(['Nova']) });
      await user.click(screen.getByRole('button', { name: t.manage.confirm.cancel }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      await user.click(screen.getByText('delete old'));
      await screen.findByRole('alertdialog', { name: t.manage.confirm.title.delete(['Old']) });
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(types(sent())).not.toContain('session.kill');
      expect(types(sent())).not.toContain('session.delete');
      // Confirmed: end is the existing session.kill (the helper's id is ignored), delete is session.delete.
      await user.click(screen.getByText('end nova'));
      await user.click(await screen.findByRole('button', { name: t.manage.confirm.ok.end }));
      await waitFor(() => expect(sent().filter(m => m.type === 'session.kill')).toEqual([{ type: 'session.kill', id: 'nova' }]));
      await user.click(screen.getByText('delete old'));
      await user.click(await screen.findByRole('button', { name: t.manage.confirm.ok.delete }));
      await waitFor(() => expect(sent()).toContainEqual({ type: 'session.delete', id: 'old' }));
    } finally { await d.close(); }
  });

  it('resume and restore send their message', async () => {
    const { d, user, sent } = await setup();
    try {
      await user.click(screen.getByText('resume bix'));
      await user.click(screen.getByText('restore old'));
      await waitFor(() => expect(sent()).toEqual(expect.arrayContaining([{ type: 'session.resume', id: 'bix' }, { type: 'session.restore', id: 'old' }])));
    } finally { await d.close(); }
  });

  it('nothing is sent to a machine whose daemon cannot archive', async () => {
    const { d, user, sent } = await setup(OLD);
    try {
      expect(screen.getByLabelText('allowed')).toHaveTextContent('false');
      await user.click(screen.getByText('archive bix'));
      await user.click(screen.getByText('resume bix'));
      await user.click(screen.getByText('restore old'));
      await user.click(screen.getByText('delete old'));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      await new Promise(r => setTimeout(r, 150));
      expect(sent().filter(m => /^session\.(archive|restore|resume|delete)$/.test(m.type))).toEqual([]);
    } finally { await d.close(); }
  });

  it('a refusal from the daemon is shown as a toast', async () => {
    const { d, user } = await setup();
    try {
      await user.click(screen.getByText('resume bix'));
      await waitFor(() => expect(d.received.some(m => m.type === 'session.resume')).toBe(true));
      act(() => d.refuse('no conversation to resume', 'bix', 'session.resume'));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.manage.refused('Bix', 'no conversation to resume')));
    } finally { await d.close(); }
  });
});
