import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazy, Suspense, type ComponentType, type JSX } from 'react';
import { render, screen } from '@testing-library/react';
import { LangProvider } from '../src/i18n/lang';

const EN = 'This part of Ledge could not load. Restart the app.';
const FR = 'Cette partie de Ledge n’a pas pu se charger. Relancez l’application.';

afterEach(() => { vi.restoreAllMocks(); });

describe('a part of the app whose chunk fails to load', () => {
  it('shows a note instead of unmounting the app, and logs the error', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ChunkBoundary } = await import('../src/shell/ChunkBoundary');
    const failure = new Error('Failed to fetch dynamically imported module');
    const Broken = lazy<ComponentType>(() => Promise.reject(failure));
    render(<LangProvider lang="en"><p>The shell</p><ChunkBoundary><Suspense fallback={null}><Broken /></Suspense></ChunkBoundary></LangProvider>);
    expect(await screen.findByText(EN)).toBeVisible();
    expect(screen.getByText('The shell')).toBeVisible();
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('could not load'), failure);
  });

  it('says it in French too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { ChunkBoundary } = await import('../src/shell/ChunkBoundary');
    const Broken = lazy<ComponentType>(() => Promise.reject(new Error('offline')));
    render(<LangProvider lang="fr"><ChunkBoundary><Suspense fallback={null}><Broken /></Suspense></ChunkBoundary></LangProvider>);
    expect(await screen.findByText(FR)).toBeVisible();
  });

  // Each lazy place: its module's import fails (a chunk missing after an update); the place shows the note.
  const places: [string, string, () => Promise<(p: never) => JSX.Element>][] = [
    ['the session page', '../src/session/Workspace', async () => (await import('../src/session/lazy')).SessionPlace],
    ['the New session form', '../src/launch/LaunchComposer', async () => (await import('../src/launch/lazy')).LaunchPlace],
    ['the project editor', '../src/projects/ProjectEditor', async () => (await import('../src/projects/lazy')).EditorPlace],
    ['the chat', '../src/chat/ChatPanel', async () => (await import('../src/chat/lazy')).ChatPlace]
  ];
  for (const [name, module, place] of places) {
    it(`${name}: the note, the rest of the page stays`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      // Mocked before the place's module is first imported in this file: its own import() of the chunk then fails.
      vi.doMock(module, () => { throw new Error('chunk missing'); });
      const Place = await place() as unknown as ComponentType<{ label: string }>;
      render(<LangProvider lang="en"><p>The shell</p><Place label="Chat Ledge" /></LangProvider>);
      expect(await screen.findByText(EN)).toBeVisible();
      expect(screen.getByText('The shell')).toBeVisible();
    });
  }
});
