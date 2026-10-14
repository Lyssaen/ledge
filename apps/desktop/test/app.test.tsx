import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';

// A developer machine may have a real daemon on 47831: the shell tests run against a socket that never opens.
class SilentSocket { onopen = null; onmessage = null; onclose = null; onerror = null; readyState = 0; constructor(public url: string) {} send() {} close() {} }
beforeAll(() => { vi.stubGlobal('WebSocket', SilentSocket); });
afterAll(() => { vi.unstubAllGlobals(); });

describe('Desktop shell', () => {
  it('renders the team and room toggles in English', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Meeting' })).toBeInTheDocument();
  });
});

describe('visible-ids dispatch', () => {
  it('keeps the persisted selection until the fleet has delivered a first snapshot', async () => {
    localStorage.clear(); localStorage.setItem('desktop.selected', 'local:otto'); localStorage.setItem('desktop.view', JSON.stringify({ view: 'team' }));
    render(<App />);
    await new Promise(r => setTimeout(r, 300));   // the socket never opens: sessions stay [] and no snapshot ever arrives
    expect(localStorage.getItem('desktop.selected')).toBe('local:otto');
  });
});
