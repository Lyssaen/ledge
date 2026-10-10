import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { inline } from '../src/surface/ReplyCard';

afterEach(() => vi.restoreAllMocks());

describe('inline markdown', () => {
  it('renders links that open outside, italics, strikethrough and bold with italics inside', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<p>{inline('voir [la doc](https://example.com/a?b=1&c=2) et *vite* ou _lent_, ~~rayé~~, **gras avec *italique***')}</p>);
    const link = screen.getByRole('link', { name: 'la doc' });
    expect(link).toHaveAttribute('href', 'https://example.com/a?b=1&c=2');
    fireEvent.click(link);
    expect(open).toHaveBeenCalledWith('https://example.com/a?b=1&c=2', '_blank', 'noopener');
    expect(screen.getByText('vite').tagName).toBe('EM');
    expect(screen.getByText('lent').tagName).toBe('EM');
    expect(screen.getByText('rayé').tagName).toBe('S');
    const bold = screen.getByText(/gras avec/);
    expect(bold.tagName).toBe('STRONG');
    expect(bold.querySelector('em')).toHaveTextContent('italique');
    expect(document.body.textContent).not.toMatch(/[*_~[\]()]/);
  });
  it('leaves underscores inside words, lone stars and anything inside code alone', () => {
    render(<p>{inline('snake_case_name et 2*3*4 puis `a *b* _c_`')}</p>);
    expect(screen.getByText('snake_case_name et 2*3*4 puis')).toBeInTheDocument();
    expect(screen.getByText('a *b* _c_').tagName).toBe('CODE');
    expect(document.querySelector('em')).toBeNull();
  });
  it('only web links are links: a javascript or file scheme stays text', () => {
    render(<p>{inline('[x](javascript:alert(1)) et [y](file:///etc/passwd)')}</p>);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
