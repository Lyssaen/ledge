import { describe, expect, it } from 'vitest';
import { buttonClass, iconButtonClass } from '../../src/ui/Button';

describe('the buttons', () => {
  it('a screen leads with the shared red (--primary), as every mockup of the redesign draws `.btn.primary`', () => {
    expect(buttonClass({ variant: 'primary' })).toContain('bg-primary');
    expect(buttonClass({ variant: 'primary' })).toContain('text-primary-fg');
    expect(buttonClass({ variant: 'primary' })).not.toContain('bg-fg');
    expect(iconButtonClass({ variant: 'primary' })).toContain('bg-primary');
  });

  it('the other ways stay outlined', () => {
    expect(buttonClass()).toContain('border-input');
    expect(buttonClass()).not.toContain('bg-primary');
  });
});
