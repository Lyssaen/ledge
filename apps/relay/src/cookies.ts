/** `name=value` pairs of a `Cookie` header. The first occurrence of a name wins. Values are kept as sent. */
export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!name || out.has(name)) continue;
    out.set(name, part.slice(eq + 1).trim());
  }
  return out;
}

/** A `Set-Cookie` value, always `HttpOnly; SameSite=Lax`; `Secure` when asked. */
export function setCookie(name: string, value: string, opts: { maxAgeS: number; path: string; secure: boolean }): string {
  const parts = [`${name}=${value}`, `Max-Age=${Math.max(0, Math.floor(opts.maxAgeS))}`, `Path=${opts.path}`, 'HttpOnly', 'SameSite=Lax'];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}
