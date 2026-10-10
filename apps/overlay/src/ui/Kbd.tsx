export function Kbd({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 5, border: `1px solid ${accent ? 'transparent' : 'var(--input)'}`, background: accent ? 'var(--primary-hover)' : 'var(--sidebar)', fontSize: 11, lineHeight: 1, fontWeight: 500, color: accent ? 'var(--primary-foreground)' : 'var(--sidebar-foreground)' }}>{children}</span>;
}
