import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChatTeamProposal } from '@ledge/protocol';
import { TeamCard } from '../src/chat/TeamCard';
import { ChatCopyProvider } from '../src/chat/copy';
import { copy } from './chat-copy-fixture';

const team = {
  label: 'Proposed team', folder: 'Folder', table: () => 'Table', newTable: (p: string) => `new table in ${p}`, seats: 'Seats',
  autonomy: { ask: 'asks', edits: 'edits', auto: 'autonomous' }, autoWarning: (r: string) => `${r} autonomous`,
  launch: 'Launch', launching: 'Launching…', retry: 'Retry', save: 'Save', saved: (p: string) => `Saved: ${p}`, notSaved: (why: string) => `Not saved: ${why}`,
  launched: (at: string) => `Launched at ${at}`, openTable: 'Open the table', failed: (why: string) => `Failed: ${why}`, template: (id: string) => `template ${id}`
};
const proposal = (extra: Partial<ChatTeamProposal> = {}): ChatTeamProposal => ({ cwd: '/w/api', project: 'api', name: 'duo', seats: [{ role: 'dev', label: 'Dev', tool: 'claude' }], ...extra });
const card = (tm: ChatTeamProposal) => render(<ChatCopyProvider value={{ ...copy, chat: { ...copy.chat, team } }}><TeamCard team={tm} busy={false} disabled={false} onLaunch={vi.fn()} onSave={vi.fn()} /></ChatCopyProvider>);

describe('TeamCard « Enregistrer » refused (#143)', () => {
  it('says why the template was not written, and keeps « Save »', () => {
    card(proposal({ saveError: 'le modèle « duo » existe déjà (/h/.ledge/teams/duo.yaml) : il n\'a pas été remplacé' }));
    expect(screen.getByRole('alert').textContent).toBe('Not saved: le modèle « duo » existe déjà (/h/.ledge/teams/duo.yaml) : il n\'a pas été remplacé');
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
  it('says nothing of it once saved', () => {
    card(proposal({ saveError: 'x', savedPath: '/h/.ledge/teams/duo.yaml' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Saved: /h/.ledge/teams/duo.yaml')).toBeTruthy();
  });
});
