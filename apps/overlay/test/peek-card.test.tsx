import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PeekCard } from '../src/surface/PeekCard';
import { fakeSession } from './mockDaemon';

const session = fakeSession('a', { name: 'Otto', project: 'harness-assistant', state: 'working', topic: 'Split the settings view' });

describe('<PeekCard>', () => {
  it('names the bot, its state and its task, and offers Close and Open in Ledge', () => {
    const onClose = vi.fn();
    const onOpen = vi.fn();
    render(<PeekCard session={session} visible onClose={onClose} onOpen={onOpen} />);
    expect(screen.getByText('Otto')).toBeInTheDocument();
    expect(screen.getByText('Split the settings view')).toBeInTheDocument();
    expect(document.querySelector('[data-layer="peek"]')).not.toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Ledge' }));
    expect(onOpen).toHaveBeenCalled();
  });
  it('is inert when hidden', () => {
    render(<PeekCard session={session} visible={false} onClose={() => {}} onOpen={() => {}} />);
    expect(document.querySelector('[data-layer="peek"]')).toHaveAttribute('inert');
  });
});
