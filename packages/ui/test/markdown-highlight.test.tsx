import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ThreadMarkdown } from '../src/documents/markdown';
import { parseMarkdown } from '../src/documents/mdast';

// remarkHighlight lives in mdast.ts, shared with the TUI: the Desktop still draws ==text== as <mark>, code left alone.
describe('Markdown highlights', () => {
  it('==b== is a <mark>, `==c==` stays code as written', () => {
    const { container } = render(<ThreadMarkdown text={'a ==b== `==c==`'} />);
    expect([...container.querySelectorAll('mark')].map(m => m.textContent)).toEqual(['b']);
    expect(container.querySelector('code')?.textContent).toBe('==c==');
  });

  it('the tree without the DOM has the same highlight', () => {
    const p = parseMarkdown('a ==b== `==c==`').children[0] as { children: { type: string; value?: string }[] };
    expect(p.children.map(c => c.type)).toEqual(['text', 'highlight', 'text', 'inlineCode']);
    expect(p.children[3]!.value).toBe('==c==');
  });
});
