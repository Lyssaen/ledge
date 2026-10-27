import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, screen, within } from '@testing-library/react';
import type { Session, ThreadItem } from '@ledge/protocol';
import { boot, closeDaemons, listSessions, ottoFolded, ottoThread, unfoldPast } from './helpers';
import { resetAvatarForTests, setAvatar } from '../src/shell/avatar';

afterEach(async () => { cleanup(); localStorage.clear(); resetAvatarForTests(); await closeDaemons(); });

const thread = () => within(screen.getByRole('tabpanel', { name: 'Session thread' }));
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();

/** Opens `name`'s page on `items`; `helpers`: its live subagents (the others in the thread are gone, finished). */
async function open(name: string, id: string, items: ThreadItem[], helpers?: Session['helpers']) {
  const env = await boot({ sessions: listSessions().map(s => (s.id === id && helpers ? { ...s, helpers } : s)), list: true });
  env.d.thread(id, items);
  await env.user.click(screen.getByRole('button', { name: new RegExp(`^${name},`) }));
  await thread().findAllByRole('listitem');
  return env;
}

describe('the rail (issue #34)', () => {
  it('an exchange older than the last three unfolds from its row and folds back; the current one has no row', async () => {
    const { user } = await open('Otto', 'otto', ottoFolded());
    await unfoldPast(user);
    expect(document.querySelectorAll('.turn.folded')).toHaveLength(0);
    expect(document.querySelector('.turn.current .turn-fold')).toBeNull();
    await user.click(thread().getByRole('button', { name: /Câble la liste/, expanded: true }));
    expect(document.querySelectorAll('.turn.folded')).toHaveLength(1);
    expect(thread().queryByText('Câble la liste', { exact: true })).toBeNull();
  });

  it('a session that waits on you says so under its last exchange, and its exchange does not end', async () => {
    await open('Otto', 'otto', ottoThread());
    expect(await thread().findByText(/Otto is waiting for your approval of a command\./)).toHaveTextContent('The thread resumes after your answer.');
    expect(document.querySelector('.turn.current .end-row')).toBeNull();
  });

  it('an exchange that ended counts its actions and files; a failure caught up after is « recovered »', async () => {
    await open('Bix', 'bix', [
      { kind: 'prompt', id: 'p', at: ago(120), turn: 1, text: 'Relis la PR' },
      { kind: 'tool', id: 'a', at: ago(110), turn: 1, tool: 'Bash', label: 'npm test', status: 'failed', durationMs: 900, error: 'exit 1', files: [] },
      { kind: 'tool', id: 'b', at: ago(100), turn: 1, tool: 'Edit', label: '/w/ledge/src/a.ts', status: 'success', durationMs: 100, files: [{ path: '/w/ledge/src/a.ts', change: 'edit', diff: '- a\n+ b' }] },
      { kind: 'reply', id: 'r', at: ago(90), turn: 1, text: 'Corrigé.' }
    ]);
    const end = document.querySelector('.turn.current .end-row')!;
    expect(end.querySelector('.end-text')).toHaveTextContent('End of the exchange · 1 failed, recovered · 2 actions · 1 file changed');
    expect(end.querySelector('.end-failed')).toHaveTextContent(/^1 failed$/);
  });

  it('subagents launched one after the other share one card, counted by state', async () => {
    await open('Nova', 'nova', [
      { kind: 'prompt', id: 'p', at: ago(60), turn: 1, text: 'Explore' },
      { kind: 'helper', id: 'h1', at: ago(50), turn: 1, task: 'Lire le code', agentType: 'Explore', state: 'exited' },
      { kind: 'helper', id: 'h2', at: ago(49), turn: 1, task: 'Lire les tests', agentType: 'Plan', state: 'working' }
    ], [{ id: 'h2', kind: 'Plan', task: 'Lire les tests', state: 'working' }]);
    const cards = document.querySelectorAll('.helpers-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveClass('many');
    expect(cards[0]!.querySelector('.helpers-head')).toHaveTextContent('Subagents launched· 1 done, 1 running');
    expect([...cards[0]!.querySelectorAll('.helper-card')].map(c => c.getAttribute('data-helper'))).toEqual(['h1', 'h2']);
    expect(within(cards[0] as HTMLElement).getByRole('button', { name: "Open Plan's thread" })).toBeVisible();
  });

  it('your prompt\'s disc beside « You » shows your profile photo, the user icon without one (#50)', async () => {
    await open('Bix', 'bix', [{ kind: 'prompt', id: 'p', at: ago(60), turn: 1, text: 'Relis la PR' }]);
    const disc = () => thread().getByText('Relis la PR').closest('.prompt-row')!.querySelector('.n.av')!;
    expect(disc()).toHaveAttribute('aria-hidden', 'true');
    expect(disc().querySelector('img')).toBeNull();
    expect(disc().querySelector('svg')).not.toBeNull();
    act(() => setAvatar('data:image/webp;base64,UklGRg=='));
    expect(disc().querySelector('img')).toHaveAttribute('src', 'data:image/webp;base64,UklGRg==');
    act(() => setAvatar(null));
    expect(disc().querySelector('img')).toBeNull();
  });

  it('a <task-notification> opens its exchange as a task card, its notification folded', async () => {
    const text = '<task-notification>\n<task-id>b7x</task-id>\n<status>killed</status>\n<summary>Agent "Explore" was stopped</summary>\n</task-notification>';
    await open('Nova', 'nova', [{ kind: 'prompt', id: 'p', at: ago(60), turn: 1, text }]);
    const card = document.querySelector<HTMLElement>('.task-card')!;
    expect(card.querySelector('[data-badge]')).toHaveTextContent('Stopped');
    expect(card.querySelector('.task-text')).toHaveTextContent('The agent Explore was stopped. It can resume if you write to it.');
    expect(card.querySelector('details.raw')).not.toHaveAttribute('open');
    expect(thread().queryByText('You')).toBeNull();
  });

  it('Story and Objective: tags on the prompt and the page heading; an agent that notes another objective gets a row', async () => {
    await open('Nova', 'nova', [
      { kind: 'prompt', id: 'p', at: ago(60), turn: 1, text: '[synapse-obs] story=ST7-123 objectif=analyse\nRegarde le ticket' },
      { kind: 'reply', id: 'r', at: ago(50), turn: 1, text: '[synapse-obs] objectif=implementation\nJe m’y mets.' }
    ]);
    const prompt = thread().getByText('Regarde le ticket').closest<HTMLElement>('.prompt-block')!;
    expect(prompt).not.toHaveTextContent('synapse-obs');
    expect([...prompt.querySelectorAll('.tag')].map(t => t.textContent)).toEqual(['Story ST7-123', 'Objective Analysis']);
    expect(document.querySelector('.objective-row .objective')).toHaveTextContent('Session objectiveAnalysisImplementation· noted by Nova');
    expect([...document.querySelectorAll('.pane-heading .tag')].map(t => t.textContent)).toEqual(['Story ST7-123', 'Objective Implementation']);
    expect(thread().getByText('Je m’y mets.')).toBeVisible();
  });
});
