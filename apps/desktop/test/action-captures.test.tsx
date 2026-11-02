import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ToolItem } from '@ledge/protocol';
import { LangProvider } from '../src/i18n/lang';
import { ActionGroup } from '../src/session/ActionGroup';

vi.mock('@ledge/fleet', async importOriginal => ({ ...(await importOriginal<object>()), useImageUrl: () => ({ url: 'blob:t', failed: false }) }));
afterEach(cleanup);

const REF = { id: 'a'.repeat(64), mime: 'image/png' as const, width: 1280, height: 800, bytes: 1000, preview: true };
const tool: ToolItem = { kind: 'tool', id: 'u1', at: new Date(2026, 9, 26, 14, 2).toISOString(), turn: 1, tool: 'screenshot', label: 'screenshot', status: 'success', files: [], images: [REF] };

describe('ActionGroup captures', () => {
  it('routes a capture click to onCapture(toolId, index) and opens no lightbox', async () => {
    const onCapture = vi.fn();
    render(<LangProvider lang="en"><ActionGroup client={{} as never} sessionId="s1" who="Nova" onCapture={onCapture} tools={[tool]} todos={[]} now={Date.now()} live={false} onChange={() => {}} /></LangProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /capture/i }));
    expect(onCapture).toHaveBeenCalledWith('u1', 0);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
