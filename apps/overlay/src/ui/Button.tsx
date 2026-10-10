import type { ButtonHTMLAttributes } from 'react';
import { transition } from '../motion';
type Variant = 'primary' | 'outline' | 'ghost' | 'secondary';
const styles: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--primary)', color: 'var(--primary-foreground)', border: '1px solid transparent' },
  outline: { background: 'transparent', color: 'var(--sidebar-foreground)', border: '1px solid var(--input)' },
  ghost: { background: 'transparent', color: 'var(--muted-foreground)', border: '1px solid transparent' },
  secondary: { background: 'var(--secondary)', color: 'var(--secondary-foreground)', border: '1px solid var(--border)' }
};
export function Button({ variant = 'outline', size = 'md', style, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'sm' | 'icon' }) {
  const dims = size === 'icon' ? { width: 36, height: 36, padding: 0 } : size === 'sm' ? { height: 32, padding: '0 12px' } : { height: 36, padding: '0 16px' };
  return (
    <button type="button" {...rest} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 'var(--radius-md)', fontSize: size === 'sm' ? 13 : 14, fontWeight: 500, cursor: 'pointer', transition: transition([['background-color', 'hover'], ['color', 'hover'], ['border-color', 'hover'], ['transform', 'hover']]), ...dims, ...styles[variant], ...style }}>
      {children}
    </button>
  );
}
