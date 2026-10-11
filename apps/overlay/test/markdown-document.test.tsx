import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownDocument } from '../src/documents/MarkdownDocument';

describe('MarkdownDocument', () => {
  it('keeps structure, unique heading anchors and inert content', () => {
    const onHeadings = vi.fn(), onDocument = vi.fn();
    const source = '---\ntitle: Plan\n---\n\n# Élan\n## Étape\n## Étape\n### Fin\n\n- one\n  - nested\n- [ ] pending\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> quote\n\n```ts\nconst x = 1\n```\n\n<script>alert(1)</script>\n\n[Next](next.md) ![Logo](https://example.com/image.png) [bad](javascript:alert(1))';
    const { container } = render(<MarkdownDocument text={source} onDocument={onDocument} onHeadings={onHeadings} />);
    expect(screen.getAllByRole('heading').map(h => [h.tagName, h.id])).toEqual([['H1', 'elan'], ['H2', 'etape'], ['H2', 'etape-1'], ['H3', 'fin']]);
    expect(onHeadings).toHaveBeenCalledWith([{ id: 'elan', depth: 1, text: 'Élan' }, { id: 'etape', depth: 2, text: 'Étape' }, { id: 'etape-1', depth: 2, text: 'Étape' }, { id: 'fin', depth: 3, text: 'Fin' }]);
    expect(screen.queryByText(/title: Plan/)).toBeNull();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(container.querySelector('script, img')).toBeNull();
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Next' }));
    expect(onDocument).toHaveBeenCalledWith({ path: 'next.md' });
  });
  it('keeps frontmatter out of reading mode while preserving the document headings', () => {
    const headings = vi.fn();
    render(<MarkdownDocument text={'---\ntitle: "Reader demo"\n---\n\n# Content\n\nHello'} onDocument={() => {}} onHeadings={headings} />);
    expect(screen.queryByText(/title: "Reader demo"/)).toBeNull();
    expect(screen.getByRole('heading', { name: 'Content' })).toBeInTheDocument();
    expect(headings).toHaveBeenCalledWith([{ id: 'content', depth: 1, text: 'Content' }]);
  });
  it('does not collide with a heading whose name is another title’s duplicate suffix', () => {
    const headings = vi.fn();
    render(<MarkdownDocument text={'# Foo\n# Foo\n# Foo-1'} onDocument={() => {}} onHeadings={headings} />);
    expect(screen.getAllByRole('heading').map(h => h.id)).toEqual(['foo', 'foo-1', 'foo-1-1']);
  });
});
