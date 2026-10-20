import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ApprovalBadge, AutoMark } from '../src/shell/SessionBot';

afterEach(cleanup);

describe('OMP approval marks (mockup omp-sessions)', () => {
  it('nothing for « ask », for an OMP with no mode or for another harness; « Auto files » quiet, « Auto » in the danger tone', () => {
    for (const s of [{ tool: 'omp' as const }, { tool: 'omp' as const, approval: 'always-ask' as const }, { tool: 'claude' as const, approval: 'yolo' as const }]) {
      const { container } = render(<><ApprovalBadge session={s} /><AutoMark session={s} /></>);
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
    render(<ApprovalBadge session={{ tool: 'omp', approval: 'write' }} />);
    expect(screen.getByText('Auto files').closest('.approval-badge')).not.toHaveClass('yolo');
    cleanup();
    render(<><ApprovalBadge session={{ tool: 'omp', approval: 'yolo' }} /><AutoMark session={{ tool: 'omp', approval: 'yolo' }} /></>);
    expect(screen.getByText('Auto').closest('.approval-badge')).toHaveClass('yolo');
    expect(screen.getByRole('img', { name: 'Auto' })).toHaveAttribute('title', 'Approves everything, commands included');
  });
});
