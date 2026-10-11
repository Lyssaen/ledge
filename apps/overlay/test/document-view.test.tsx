import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentView } from '../src/surface/DocumentView';
import type { ReadingEntry } from '../src/documents/useDocumentReader';
import { LangProvider } from '../src/i18n/lang';

const reading: ReadingEntry = { reference: { path: '/w/README.md' }, loading: false, scroll: 0, sourceScroll: 0, raw: false };
const document = { type: 'document.content' as const, requestId: 'r', path: '/w/README.md', text: '# Title\n\nHello', bytes: 14, modifiedAt: '2026-10-11T00:00:00Z' };
const props = { originName: 'Otto', theme: 'dark' as const, expanded: false, onBack: vi.fn(), onClose: vi.fn(), onExpand: vi.fn(), onReload: vi.fn(), onDocument: vi.fn(), reading, onReading: vi.fn() };
describe('DocumentView', () => {
  it('shows a contents panel and exact source', () => {
    const view = render(<LangProvider lang="fr"><DocumentView {...props} state={{ status: 'ready', document }} /></LangProvider>);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sommaire' }));
    expect(screen.getByRole('navigation', { name: 'Sommaire' })).toHaveTextContent('Title');
    fireEvent.click(screen.getByRole('button', { name: 'Markdown' }));
    expect(props.onReading).toHaveBeenCalledWith({ raw: true });
    view.rerender(<LangProvider lang="fr"><DocumentView {...props} reading={{ ...reading, raw: true }} state={{ status: 'ready', document }} /></LangProvider>);
    expect(view.container.querySelector('[data-document-source]')?.textContent).toBe(document.text);
  });
  it('uses frontmatter title in the header and presents a hierarchical contents panel', () => {
    const titled = { ...document, text: '---\ntitle: Demo title\n---\n\n# First\n\n## Second' };
    render(<LangProvider lang="fr"><DocumentView {...props} state={{ status: 'ready', document: titled }} /></LangProvider>);
    expect(screen.getByText('Demo title')).toBeInTheDocument();
    expect(screen.queryByText('title: Demo title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sommaire' }));
    const nav = screen.getByRole('navigation', { name: 'Sommaire' });
    expect(nav.querySelectorAll('[data-depth="1"], [data-depth="2"]')).toHaveLength(2);
    expect(nav.querySelector('[data-depth="2"]')).toHaveTextContent('Second');
  });
  it('reloads from an icon beside the expand button', () => {
    render(<LangProvider lang="fr"><DocumentView {...props} state={{ status: 'ready', document }} /></LangProvider>);
    const reload = screen.getByRole('button', { name: 'Recharger' });
    const expand = screen.getByRole('button', { name: 'Agrandir' });
    expect(reload.textContent).toBe('');
    expect(reload.parentElement).toBe(expand.parentElement);
    fireEvent.click(reload);
    expect(props.onReload).toHaveBeenCalled();
  });
  it('keeps return and retry available when a file fails', () => {
    render(<LangProvider lang="fr"><DocumentView {...props} state={{ status: 'error', path: '/w/missing.md', code: 'not_found' }} /></LangProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('Fichier introuvable');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(props.onReload).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retour à la réponse' })[0]!);
    expect(props.onBack).toHaveBeenCalled();
  });
  it('explains when a requested source line is absent', () => {
    render(<LangProvider lang="fr"><DocumentView {...props} reading={{ ...reading, reference: { path: '/w/README.md', line: 99 }, raw: true }} state={{ status: 'ready', document }} /></LangProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('La position demandée n’existe pas');
    expect(screen.getByText(/# Title/)).toBeInTheDocument();
  });
});
