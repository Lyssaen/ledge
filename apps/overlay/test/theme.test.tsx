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
});
