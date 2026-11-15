import { ConfigError, parsePublicUrl } from '../config.js';
import { GithubIdError, resolveGithubId } from './github-id.js';
import type { LaunchFile } from './home.js';
import { generateVapid } from './vapid.js';

/** The terminal as the dialogue sees it; `ask` rejects on end of input or Ctrl-C so that nothing is saved. */
export interface SetupIo {
  ask(question: string, o?: { secret?: boolean; default?: string }): Promise<string>;
  say(line: string): void;
}

/** Asks until the answer is not empty; an empty answer takes the default when there is one. */
async function askRequired(io: SetupIo, question: string, def?: string): Promise<string> {
  for (;;) {
    const a = (await io.ask(question, def ? { default: def } : undefined)).trim() || def;
    if (a) return a;
    io.say('An answer is required.');
  }
}

/** The questions of a first launch, answered through `io`; returns the settings to save and writes nothing itself. */
export async function runSetup(
  io: SetupIo,
  current: LaunchFile,
  deps: { resolveId?: typeof resolveGithubId } = {}
): Promise<LaunchFile> {
  const resolveId = deps.resolveId ?? resolveGithubId;

  let publicUrl: string;
  for (;;) {
    const raw = await askRequired(io, 'Public URL of this relay (https, no path)', current.publicUrl);
    try {
      publicUrl = parsePublicUrl(raw, true);
      break;
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      io.say(e.message);
    }
  }

  io.say('Create a GitHub OAuth App (GitHub > Settings > Developer settings > OAuth Apps) with:');
  io.say(`  Homepage URL: ${publicUrl}`);
  io.say(`  Authorization callback URL: ${publicUrl}/auth/github/callback`);
  io.say('  Tick "Enable Device Flow". No permission is needed.');
  const githubClientId = await askRequired(io, 'GitHub OAuth App client id', current.githubClientId);
  let githubClientSecret: string | undefined;
  while (!githubClientSecret) {
    githubClientSecret = (await io.ask('GitHub OAuth App client secret', { secret: true })).trim() || current.githubClientSecret;
    if (!githubClientSecret) io.say('An answer is required.');
  }

  let githubId: string;
  for (;;) {
    const login = await askRequired(io, 'GitHub login (or numeric id) allowed to use this relay', current.allowedGithubIds?.[0]);
    try {
      const r = await resolveId(login);
      githubId = r.id;
      io.say(`GitHub account ${r.login ?? login} = id ${r.id}`);
      break;
    } catch (e) {
      if (!(e instanceof GithubIdError)) throw e;
      io.say(`${e.reason === 'not_found' ? `GitHub has no account named ${login}.` : 'GitHub could not be reached.'} A numeric id also works.`);
    }
  }

  let subject: string;
  for (;;) {
    const raw = await askRequired(io, 'Contact for Web Push (mailto: address or https URL)', current.vapid?.subject ?? publicUrl);
    const candidate = /^(mailto:|https:\/\/)/.test(raw) ? raw : /^\S+@\S+$/.test(raw) ? `mailto:${raw}` : raw;
    if (/^(mailto:|https:\/\/)\S+$/.test(candidate)) { subject = candidate; break; }
    io.say('The contact must be an email address, a mailto: address or an https:// URL.');
  }

  // Phones' push subscriptions are bound to the public key, so a new subject never regenerates the keys.
  const vapid = current.vapid ? { ...current.vapid, subject } : generateVapid(subject);
  return { publicUrl, githubClientId, githubClientSecret, allowedGithubIds: [githubId], vapid };
}
