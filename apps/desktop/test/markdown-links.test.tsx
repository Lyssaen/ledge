import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownLinks, ThreadMarkdown } from '@ledge/ui/documents/markdown';

afterEach(cleanup);

describe('the shared Markdown reader', () => {
  it('a web link in a thread message opens through the app, a document link through the reader, never by navigating', async () => {
    const open = vi.fn(); const onDocument = vi.fn(); const user = userEvent.setup();
    render(<MarkdownLinks.Provider value={open}><ThreadMarkdown text={'[site](https://example.com) et [doc](docs/plan.md)'} onDocument={onDocument} /></MarkdownLinks.Provider>);
    await user.click(screen.getByRole('link', { name: 'site' }));
    expect(open).toHaveBeenCalledWith('https://example.com');
    await user.click(screen.getByRole('link', { name: 'doc' }));
    expect(onDocument).toHaveBeenCalledWith({ path: 'docs/plan.md' });
  });
});
