import { copy } from '../copy';
import type { InboxItem } from './requests';

export interface PushTarget { remote: string; branch?: string; force: boolean }

/** `-o`, `--repo` and friends take a value: it is not the remote. */
const VALUE_FLAGS = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
/** Flags that can rewrite or remove remote history: a force push, a deletion, a mirror, a prune. */
const FORCE_FLAGS = new Set(['-f', '--force', '--force-with-lease', '--force-if-includes', '--delete', '-d', '--mirror', '--prune']);

/**
 * Reads a plain `git push`: the remote, the branch and whether it can rewrite or delete remote history (`force`: force, delete, mirror, `:ref`). `remote` is empty when the command
 * names none (git then uses the configured one). Anything that is not a simple push gives `null`.
 */
export function parsePushTarget(cmd: string): PushTarget | null {
  const tokens = cmd.trim().split(/\s+/);
  if (tokens[0] !== 'git') return null;
  const at = tokens.indexOf('push');
  if (at < 1) return null;
  let force = false;
  const positional: string[] = [];
  const args = tokens.slice(at + 1);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith('--')) {
      const name = a.split('=')[0]!;
      if (FORCE_FLAGS.has(name)) force = true;
      else if (VALUE_FLAGS.has(name) && !a.includes('=')) i++;
    } else if (a.startsWith('-') && a.length > 1) {
      if (/[fd]/.test(a.slice(1))) force = true;
      else if (VALUE_FLAGS.has(a)) i++;
    } else positional.push(a);
  }
  const [remote = '', ...refspecs] = positional;
  // Every refspec counts: `+x` forces, `:x` deletes.
  if (refspecs.some(r => r.startsWith('+') || r.startsWith(':'))) force = true;
  const refspec = refspecs[0];
  const branch = refspec?.replace(/^\+/, '').split(':').pop();
  return { remote, ...(branch ? { branch } : {}), force };
}

export interface Consequence { title: string; body: string; destination?: string }

/**
 * What a low-risk request will do, when it is worth saying: an edit inside the session's folder. A read-only command
 * or a question needs no warning; a high-risk request has its consequence instead.
 */
export function lowRiskNoticeFor(item: InboxItem): Consequence | null {
  if (item.risk !== 'low' || item.riskReason !== 'edit_inside_folder') return null;
  return { title: copy.detail.editsInProject, body: copy.detail.editsInProjectBody };
}

/** What a high-impact request will do if accepted, in words. `null` for a low-risk one. */
export function consequenceFor(item: InboxItem): Consequence | null {
  if (item.risk === 'low') return null;
  const c = copy.consequence;
  const reason = item.riskReason ?? (item.kind === 'plan' ? 'plan' : 'unknown');
  if (reason === 'pushes') {
    const t = parsePushTarget(item.text);
    const destination = t?.remote ? (t.branch ? `${t.remote}/${t.branch}` : t.remote) : c.configuredRemote;
    return t?.force
      ? { title: c.forceTitle, body: c.forceBody(t.remote ? destination : undefined), destination }
      : { title: c.pushTitle, body: c.pushBody, destination };
  }
  switch (reason) {
    case 'destroys': case 'deploys': case 'publishes': case 'pipes_to_shell': case 'network':
    case 'writes_outside_folder': case 'sensitive_path': case 'script': case 'plan': {
      const [title, body] = c[reason];
      return { title, body };
    }
    default: {
      const [title, body] = c.unknown;
      return { title, body };
    }
  }
}
