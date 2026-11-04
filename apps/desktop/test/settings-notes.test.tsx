import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ClientMessage, NoteInfo, ServerMessage } from '@ledge/protocol';
import { Notes } from '../src/settings/Notes';
import { LangProvider } from '../src/i18n/lang';
import type { SettingsContext } from '../src/settings/SettingsPage';

afterEach(() => cleanup());

const NOTES: NoteInfo[] = [
  { name: 'machines', file: 'machines.md', title: 'Les machines du homelab', when: 'une question sur une machine', firstLine: '# M', scope: 'all', projects: [], modifiedAt: '2026-11-01T10:00:00.000Z', checkedAt: '2026-11-01', additions: 2, truncated: false },
  { name: 'reseau', file: 'reseau.md', title: 'Réseau domestique', firstLine: '# Réseau', scope: 'chat', projects: ['ledge'], modifiedAt: '2026-08-28T10:00:00.000Z', oldDays: 68,
    flag: { what: 'la box a changé', by: 'Pim', at: '2026-11-04T10:00:00.000Z' }, additions: 0, truncated: false }
];

function fakeClient() {
  const sent: ClientMessage[] = [];
  const handlers = new Set<(m: ServerMessage) => void>();
  const client = {
    send(m: ClientMessage) {
      sent.push(m);
      queueMicrotask(() => {
        const reply: ServerMessage | null = m.type === 'brain.list' || m.type === 'brain.note' ? { type: 'brain.result', rid: m.rid, dir: '/home/u/.ledge/context', notes: m.type === 'brain.note' ? NOTES.map(n => (n.name === m.note ? { ...n, flag: undefined } : n)) : NOTES }
          : m.type === 'document.read' ? { type: 'document.content', requestId: m.requestId, path: m.path, text: '---\ntitle: R\n---\nLa box VOO.', bytes: 30, modifiedAt: '2026-11-04T10:00:00.000Z' } : null;
        if (reply) for (const h of handlers) h(reply);
      });
    },
    onMessage(h: (m: ServerMessage) => void) { handlers.add(h); return () => { handlers.delete(h); }; },
    status: () => 'open', onStatus: () => () => {}
  };
  return { client, sent };
}

describe('Settings › Notes (docs/mockups/ledge-brain-notes.html, part 3)', () => {
  it('lists each note with its scope, projects, date and flag; opens one; clears a flag', async () => {
    const { client, sent } = fakeClient();
    const saved = vi.fn();
    const ctx = { client, machines: [], saved } as unknown as SettingsContext;
    render(<LangProvider lang="fr"><Notes ctx={ctx} /></LangProvider>);
    expect(await screen.findByText('Les machines du homelab')).toBeVisible();
    expect(screen.getByText('/home/u/.ledge/context')).toBeVisible();
    expect(screen.getByText('2 notes')).toBeVisible();
    expect(screen.getByText('Chat seulement')).toBeVisible();
    expect(screen.getByText('Projets : ledge')).toBeVisible();
    expect(screen.getByText('vérifiée le 01/11/2026')).toBeVisible();
    expect(screen.getByText('modifiée le 28/08/2026 · ancienne')).toBeVisible();
    expect(screen.getByText(/la box a changé · Pim, le 04\/11\/2026/)).toBeVisible();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ouvrir' })[1]!);
    expect(await screen.findByText('La box VOO.')).toBeVisible();
    expect(sent).toContainEqual(expect.objectContaining({ type: 'document.read', path: '/home/u/.ledge/context/reseau.md' }));
    fireEvent.click(screen.getByRole('button', { name: 'Effacer le signalement' }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith('reseau : signalement effacé'));
    expect(sent).toContainEqual(expect.objectContaining({ type: 'brain.note', note: 'reseau', op: 'unflag' }));
    expect(screen.queryByText('Effacer le signalement')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Vérifiée aujourd’hui' })[0]!);
    await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ type: 'brain.note', note: 'machines', op: 'checked' })));
  });
});
