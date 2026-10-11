import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { App } from '../src/App';

class SilentSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  readyState = 0;
  send() {}
  close() {}
  addEventListener() {}
  removeEventListener() {}
}

describe('App theme', () => {
  beforeEach(() => { vi.stubGlobal('WebSocket', SilentSocket); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('defaults to dark, toggles with Ctrl+Alt+T and persists', () => {
    localStorage.clear();
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.keyDown(window, { key: 't', ctrlKey: true, altKey: true });
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('ledge.theme')).toBe('light');
  });

  it('paints a stored accent onto the root and leaves danger-text to CSS', () => {
    localStorage.clear();
    localStorage.setItem('ledge.accent', '#3366ff');
    render(<App />);
    expect(document.documentElement.style.getPropertyValue('--sidebar-primary')).toMatch(/^#[0-9a-f]{6}$/);
    expect(document.documentElement.style.getPropertyValue('--ledge-glow')).toMatch(/^#[0-9a-f]{6}$/);
    expect(document.documentElement.style.getPropertyValue('--danger-text')).toBe('');
  });
});
