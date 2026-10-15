import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ComposerForm } from '../src/conversation/ComposerForm';

const ids = { form: 'f-form', field: 'f-field', hint: 'f-hint' };
function Harness({ canSend = true, frozen = false, initial = '', onSend }: { canSend?: boolean; frozen?: boolean; initial?: string; onSend: () => void }) {
  const [value, setValue] = useState(initial);
  return <ComposerForm ids={ids} label="Talk" placeholder="Ask…" send="Go" hint="Ctrl + Enter" value={value}
    frozen={frozen} canSend={canSend} onChange={setValue} onSend={onSend} />;
}
const box = () => screen.getByRole('textbox', { name: 'Talk' }) as HTMLTextAreaElement;

describe('ComposerForm', () => {
  it('uses the ids it is given and ties the hint to the field', () => {
    render(<Harness onSend={vi.fn()} />);
    expect(document.getElementById('f-form')?.tagName).toBe('FORM');
    expect(box().id).toBe('f-field');
    expect(box()).toHaveAttribute('aria-describedby', 'f-hint');
    expect(box()).toHaveAttribute('maxlength', '10000');
    expect(box()).toHaveAttribute('placeholder', 'Ask…');
    expect(document.getElementById('f-hint')).toHaveTextContent('Ctrl + Enter');
    expect(document.getElementById('f-hint')).toHaveAttribute('aria-live', 'polite');
  });
  it('sends once on Ctrl or ⌘ + Enter, never on Enter alone or during an IME composition', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} />);
    fireEvent.change(box(), { target: { value: 'Hello' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(onSend).toHaveBeenCalledTimes(3);
  });
  it('never sends a blank message', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} initial={'  \n '} />);
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    fireEvent.submit(document.getElementById('f-form')!);
    expect(onSend).not.toHaveBeenCalled();
  });
  it('canSend false keeps typing possible but blocks the button, the shortcut and the submit', () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} canSend={false} initial="Ready" />);
    expect(box()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    fireEvent.submit(document.getElementById('f-form')!);
    expect(onSend).not.toHaveBeenCalled();
  });
  it('frozen disables the field and keeps the draft on screen', () => {
    render(<Harness onSend={vi.fn()} frozen canSend={false} initial="Kept draft" />);
    expect(box()).toBeDisabled();
    expect(box()).toHaveValue('Kept draft');
  });
});
