import type { ButtonHTMLAttributes } from 'react';
import { transition } from '../motion';
type Variant = 'primary' | 'outline' | 'ghost' | 'secondary';
/** Colors, hover and disabled states live in base.css (`.ledge-btn[data-variant]`), so `:hover` and `:disabled` apply;
 *  a caller's inline `style` still wins (a pressed toggle's color, the danger text of Kill). */
export function Button({ variant = 'outline', size = 'md', style, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm' | 'icon' }) {
  const dims = size === 'icon' ? { width: 36, height: 36, padding: 0 } : size === 'sm' ? { height: 32, padding: '0 12px' } : { height: 36, padding: '0 16px' };
  return (
    <button type="button" {...rest} className={className ? `ledge-btn ${className}` : 'ledge-btn'} data-variant={variant} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 'var(--radius-md)', fontSize: size === 'sm' ? 13 : 14, fontWeight: 500, transition: transition([['background-color', 'hover'], ['color', 'hover'], ['border-color', 'hover'], ['transform', 'hover'], ['opacity', 'hover']]), ...dims, ...style }}>
      {children}
    </button>
  );
}
