/** Claude Code delivers another session's SendMessage as a prompt: one `<cross-session-message from="<address>"
 *  from-name="<name>" …>` block per message queued, the transcript prefixing a line « Another Claude session sent a
 *  message: ». Attributes come in any order, `from-name` may be missing, and the closing tag too (the hook keeps only
 *  the start of a long prompt); the next opening tag ends a block only at a line start, so a body may quote one. Returns each block's sender and body, or undefined for a prompt that is not one.
 *  Imports nothing of the daemon: state.ts and history.ts both read it. */
const FIRST_LINE = /^Another Claude session sent a message:\s*\n/;
const BLOCK = /<cross-session-message\b([^>]*)>([\s\S]*?)(?:<\/cross-session-message>|(?=\n[ \t]*<cross-session-message\b)|$)/g;
const ATTR = /([\w-]+)="([^"]*)"/g;
export function crossSession(text: string): { from: string; name?: string; text: string }[] | undefined {
  const body = text.trimStart().replace(FIRST_LINE, '');
  if (!body.startsWith('<cross-session-message')) return undefined;
  const out: { from: string; name?: string; text: string }[] = [];
  for (const m of body.matchAll(BLOCK)) {
    const attrs = new Map([...m[1]!.matchAll(ATTR)].map(a => [a[1]!, a[2]!] as const));
    const from = attrs.get('from'); const name = attrs.get('from-name');
    if (from) out.push({ from, ...(name ? { name } : {}), text: m[2]!.trim() });
  }
  return out.length ? out : undefined;
}
