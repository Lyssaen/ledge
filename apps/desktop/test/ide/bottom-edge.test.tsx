import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LangProvider } from '../../src/i18n/lang';
import { BottomEdge } from '../../src/ide/BottomEdge';

afterEach(cleanup);

describe('BottomEdge', () => {
  const mount = () => {
    const onLayout = vi.fn();
    render(<LangProvider lang="en"><div className="ide-editor"><BottomEdge onLayout={onLayout} /></div></LangProvider>);
    const editor = document.querySelector('.ide-editor') as HTMLElement;
    editor.getBoundingClientRect = () => ({ left: 0, right: 800, top: 100, bottom: 800, width: 800, height: 700, x: 0, y: 100, toJSON: () => ({}) });
    return { onLayout, edge: screen.getByTitle('Drag to resize · double-click: default height') };
  };

  it('dragging the top edge sends the height up from the editor\'s bottom', () => {
    const { onLayout, edge } = mount();
    fireEvent.mouseDown(edge, { clientY: 560 });
    fireEvent.mouseMove(window, { clientY: 480 });
    expect(onLayout).toHaveBeenLastCalledWith({ type: 'dragBottom', height: 320 });
    expect(document.body).toHaveClass('ide-resizing-y');
    fireEvent.mouseUp(window, { clientY: 480 });
    expect(onLayout).toHaveBeenLastCalledWith({ type: 'dragBottom', height: 320 });
    expect(document.body).not.toHaveClass('ide-resizing-y');
    onLayout.mockClear();
    fireEvent.mouseMove(window, { clientY: 400 });
    expect(onLayout).not.toHaveBeenCalled();
  });

  it('a double click restores the default height', () => {
    const { onLayout, edge } = mount();
    fireEvent.doubleClick(edge);
    expect(onLayout).toHaveBeenCalledWith({ type: 'resetBottom' });
  });
});
