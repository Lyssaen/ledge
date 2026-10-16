export function Kbd({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return <kbd className="mono" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 4, border: `1px solid ${accent ? 'transparent' : 'var(--input)'}`, background: accent ? 'var(--primary-hover)' : 'transparent', fontSize: 11, lineHeight: 1, fontWeight: 500, whiteSpace: 'nowrap', color: accent ? 'var(--primary-foreground)' : 'var(--muted-foreground)' }}>{children}</kbd>;
}
