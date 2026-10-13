import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { SessionView, measureSessionH, shownReply } from '../src/surface/SessionView';
import { fakeSession, T0 } from './mockDaemon';

const text = `## Three reducer findings fixed

Steps 1 to 6 are done and green. One point is yours to decide.

### What I did

- Transition table test, 63 cases \`src/daemon/state.test.ts\`
- exited is terminal, pending cleared on SessionEnd

### Verified

- \`pnpm test --filter ledge\`: 112 passed

### Open question

Should a session that comes back keep its pending item or start clean?

- Keep it
- Start clean

### Left to do

1. Step 7, the one-hour soak.
`;
const at = '2026-10-09T18:20:00.000Z';
const now = Date.parse(at) + 20_000;
const idle = fakeSession('r', { state: 'idle', lastReply: { text, at } });
const base = { preview: ['● Bash(pnpm test)', '  ⎿  112 passed'], visible: true, reading: false, draft: '', onDraft: () => {}, onBack: () => {}, onClose: () => {}, onDecide: () => {}, onReply: () => {}, onInterrupt: () => {}, onKill: () => {}, onFocus: () => {}, onToggleReading: () => {}, now };

describe('<SessionView> your turn: the last reply read like a plan', () => {
  it('opens a Markdown file cited in the structured reply without sending a reply', () => {
    const onDocument = vi.fn(); const onReply = vi.fn();
    const notes = fakeSession('n', { state: 'idle', lastReply: { at, text: '## Documents\n\n- [Lire le plan](docs/my plan.md)' } });
    render(<SessionView {...base} session={notes} onDocument={onDocument} onReply={onReply} />);
    fireEvent.click(screen.getByRole('link', { name: 'Lire le plan' }));
    expect(onDocument).toHaveBeenCalledWith({ path: 'docs/my plan.md' });
    expect(onReply).not.toHaveBeenCalled();
  });
  it('shows the title, the meta line, the lead and the sections with their markers', () => {
    const { container } = render(<SessionView {...base} session={idle} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Three reducer findings fixed' })).toBeInTheDocument();
    expect(container.querySelector('[data-eyebrow]')).toHaveTextContent('Your turn');
    expect(container.querySelector('[data-reply-meta]')).toHaveTextContent('Otto finished 20s ago · 2 done · 1 question');
    expect(container.querySelector('[data-reply-lead]')).toHaveTextContent('Steps 1 to 6 are done and green.');
    const kickers = [...container.querySelectorAll('[data-kicker]')].map(k => k.textContent);
    expect(kickers).toEqual(['What I did · 2', 'Verified', 'Open question', 'Left to do']);
    expect(container.querySelectorAll('[data-item="done"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-item="verified"]')).toHaveLength(1);
    expect(container.querySelector('[data-next]')).toHaveTextContent('Step 7, the one-hour soak.');
    // Inline code reads as code.
    expect(within(container.querySelector('[data-item="done"]') as HTMLElement).getByText('src/daemon/state.test.ts').tagName).toBe('CODE');
  });
  it('an ordinary bullet list is a list, not numbered cards', () => {
    const notes = fakeSession('n', { state: 'idle', lastReply: { at, text: '## Notes\n\n- first file\n- second file' } });
    const { container } = render(<SessionView {...base} session={notes} />);
    const list = container.querySelector('[data-list="bullet"]') as HTMLElement;
    expect(list.tagName).toBe('UL');
    const items = list.querySelectorAll('[data-item="item"]');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('·');
    expect(items[0]).toHaveTextContent('first file');
    expect(items[1]).toHaveTextContent('second file');
    expect(getComputedStyle(items[0]!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  });
  it('an ordinary numbered list is a list, not numbered cards', () => {
    const notes = fakeSession('n', { state: 'idle', lastReply: { at, text: '## Notes\n\n1. first file\n2. second file' } });
    const { container } = render(<SessionView {...base} session={notes} />);
    const list = container.querySelector('[data-list="ordered"]') as HTMLElement;
    expect(list.tagName).toBe('OL');
    const items = list.querySelectorAll('[data-item="item"]');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('1.');
    expect(items[0]).toHaveTextContent('first file');
    expect(items[1]).toHaveTextContent('2.');
    expect(items[1]).toHaveTextContent('second file');
    expect(getComputedStyle(items[0]!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  });
  it('a question shows its chips; a chip fills the draft and focuses the field; the hint says so', () => {
    const onDraft = vi.fn();
    const { container } = render(<SessionView {...base} session={idle} onDraft={onDraft} />);
    const q = screen.getByRole('group', { name: 'Question 1' });
    expect(q).toHaveTextContent('keep its pending item or start clean?');
    fireEvent.click(within(q).getByRole('button', { name: 'Keep it' }));
    expect(onDraft).toHaveBeenCalledWith('Keep it');
    expect(document.activeElement).toBe(container.querySelector('[data-reply]'));
    expect(screen.getByText('A chip fills the field, Enter sends')).toBeInTheDocument();
    fireEvent.click(within(q).getByRole('button', { name: 'Type an answer' }));
    expect(document.activeElement).toBe(container.querySelector('[data-reply]'));
  });
  it('described options are rows, the description under the label; a row writes only its label', () => {
    const onDraft = vi.fn();
    const described = fakeSession('d', { state: 'idle', lastReply: { at, text: '## Choix\n\nQuelle base ?\n\n- **PostgreSQL** — robuste, mais demande un serveur\n- **SQLite** — zéro infra' } });
    const { container } = render(<SessionView {...base} session={described} onDraft={onDraft} />);
    const q = screen.getByRole('group', { name: 'Question 1' });
    expect(q.querySelector('[data-options="detailed"]')).not.toBeNull();
    const pg = within(q).getByRole('button', { name: 'PostgreSQL' });
    expect(pg).toHaveAccessibleDescription('robuste, mais demande un serveur');
    expect(container.querySelectorAll('[data-chip-detail]')).toHaveLength(2);
    fireEvent.click(pg);
    expect(onDraft).toHaveBeenCalledWith('PostgreSQL');
    expect(pg).toHaveAttribute('aria-pressed', 'true');
    expect(within(q).getByRole('button', { name: 'Type an answer' })).toBeInTheDocument();
  });
  it('lettered choices: the ★ option carries a badge, and each answer line names its question', () => {
    const onDraft = vi.fn();
    const lettered = fakeSession('l', { state: 'idle', lastReply: { at, text: 'Quelques décisions :\n\n1. **Framework HTTP** : a) Express ★ (même socle), b) Fastify, c) NestJS.\n2. **Tests** : a) mocha, b) vitest ★.' } });
    render(<SessionView {...base} session={lettered} onDraft={onDraft} />);
    const q1 = screen.getByRole('group', { name: 'Question 1' });
    const express = within(q1).getByRole('button', { name: 'Express' });
    expect(express).toHaveAccessibleDescription('même socle');
    expect(express.querySelector('[data-recommended]')).toHaveTextContent('Recommended');
    expect(within(q1).getByRole('button', { name: 'Fastify' }).querySelector('[data-recommended]')).toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Question 2' })).getByRole('button', { name: 'vitest' }));
    fireEvent.click(express);
    expect(onDraft).toHaveBeenLastCalledWith('Framework HTTP: Express\nTests: vitest');
  });
  it('a decision axis keeps its recommendation and remarks under the question, its options as rows', () => {
    const axes = fakeSession('x', { state: 'idle', lastReply: { at, text: 'Les options :\n\n1. **Format**\n   - **YAML** : lisible\n   - **JSON** : stdlib seule\n   - Ma recommandation : YAML, sauf si zéro dépendance.' } });
    render(<SessionView {...base} session={axes} onDraft={vi.fn()} />);
    const q = screen.getByRole('group', { name: 'Question 1' });
    expect(within(q).getByRole('button', { name: 'YAML' }).querySelector('[data-recommended]')).not.toBeNull();
    expect(q.querySelector('[data-question-notes]')).toHaveTextContent('Ma recommandation : YAML, sauf si zéro dépendance.');
  });
  it('several questions build one line per question, numbered, and the pressed chip reads as pressed', () => {
    const onDraft = vi.fn();
    const multi = fakeSession('m', { name: 'Lu', state: 'idle', lastReply: { at, text: 'Before I start:\n\n1. Stored per screen or derived?\n2. Linked or independent?\n3. Copy the old value?' } });
    render(<SessionView {...base} session={multi} onDraft={onDraft} />);
    expect(screen.getAllByRole('group', { name: /^Question/ })).toHaveLength(3);
    fireEvent.click(within(screen.getByRole('group', { name: 'Question 2' })).getByRole('button', { name: 'independent' }));
    expect(onDraft).toHaveBeenLastCalledWith('2. independent');
    fireEvent.click(within(screen.getByRole('group', { name: 'Question 1' })).getByRole('button', { name: 'Stored per screen' }));
    expect(onDraft).toHaveBeenLastCalledWith('1. Stored per screen\n2. independent');
    expect(within(screen.getByRole('group', { name: 'Question 2' })).getByRole('button', { name: 'independent' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('One line per question, Enter sends')).toBeInTheDocument();
  });
  it('the raw toggle shows the reply as written and back', () => {
    const { container } = render(<SessionView {...base} session={idle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Full reply as written' }));
    expect(container.querySelector('[data-reply-raw]')).toHaveTextContent('### What I did');
    expect(container.querySelector('[data-kicker]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Structured view' }));
    expect(container.querySelector('[data-reply-raw]')).toBeNull();
    expect(container.querySelectorAll('[data-kicker]').length).toBeGreaterThan(0);
  });
  it('the terminal preview folds under the reply, and still opens in reading mode', () => {
    const { container, rerender } = render(<SessionView {...base} session={idle} />);
    expect((container.querySelector('details.ledge-terminal') as HTMLDetailsElement).open).toBe(false);
    rerender(<SessionView {...base} session={idle} reading />);
    expect((container.querySelector('details.ledge-terminal') as HTMLDetailsElement).open).toBe(true);
  });
  it('a plain reply reads as prose under the default title; no reply keeps the view as before', () => {
    const plain = fakeSession('p', { state: 'idle', lastReply: { at, text: 'I created the folder as asked.' } });
    const { container, rerender } = render(<SessionView {...base} session={plain} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Waiting for your instructions.' })).toBeInTheDocument();
    expect(container.querySelector('[data-reply-card]')).toHaveTextContent('I created the folder as asked.');
    expect(screen.getByText('Enter sends to the terminal as typed')).toBeInTheDocument();
    rerender(<SessionView {...base} session={fakeSession('n', { state: 'idle' })} />);
    expect(container.querySelector('[data-reply-card]')).toBeNull();
    expect((container.querySelector('details.ledge-terminal') as HTMLDetailsElement).open).toBe(true);
  });
  it('is not shown while something is asked or the agent works; shown for an ended session under "Session"', () => {
    const asked = { ...idle, state: 'waiting_permission' as const, pending: { kind: 'permission' as const, text: 'npm test', source: 'hook' as const } };
    const { container, rerender } = render(<SessionView {...base} session={asked} />);
    expect(container.querySelector('[data-reply-card]')).toBeNull();
    rerender(<SessionView {...base} session={{ ...idle, state: 'working' }} />);
    expect(container.querySelector('[data-reply-card]')).toBeNull();
    rerender(<SessionView {...base} session={{ ...idle, state: 'exited', exitCode: 0 }} />);
    expect(container.querySelector('[data-reply-card]')).not.toBeNull();
    expect(container.querySelector('[data-eyebrow]')).toHaveTextContent('Session');
    expect(shownReply({ ...idle, state: 'error' })).toBeUndefined();
  });
  it('a pipe table reads as a table with its header and cells', () => {
    const tabled = fakeSession('r', { state: 'idle', lastReply: { text: 'Results\n\n| Suite | Result |\n|---|---|\n| overlay `vitest` | pass |\n| ledge daemon | 507 tests, pass |', at } });
    const { container } = render(<SessionView {...base} session={tabled} />);
    const table = container.querySelector('[data-table]') as HTMLElement;
    expect(table.tagName).toBe('TABLE');
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Suite', 'Result']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByRole('cell', { name: '507 tests, pass' })).toBeInTheDocument();
    expect(within(table).getByText('vitest').tagName).toBe('CODE');
    expect(container.textContent).not.toContain('|---|');
  });
  it('a quote reads as a blockquote, and a right-aligned column keeps its alignment', () => {
    const text = 'Results\n\n> Pour mémoire\n> c’est **important**\n\n| Suite | N |\n|---|--:|\n| a | 12 |';
    const { container } = render(<SessionView {...base} session={fakeSession('r', { state: 'idle', lastReply: { text, at } })} />);
    const quote = container.querySelector('[data-quote]') as HTMLElement;
    expect(quote.tagName).toBe('BLOCKQUOTE');
    expect(quote).toHaveTextContent('Pour mémoire c’est important');
    expect(within(quote).getByText('important').tagName).toBe('STRONG');
    expect(container.textContent).not.toContain('>');
    expect(within(container.querySelector('[data-table]') as HTMLElement).getByRole('cell', { name: '12' })).toHaveStyle({ textAlign: 'right' });
  });
  it('estimates a taller view for a reply', () => {
    expect(measureSessionH(idle, false)).toBeGreaterThan(measureSessionH(fakeSession('n', { state: 'idle', startedAt: T0 }), false));
  });
});
