import { describe, expect, it, vi } from 'vitest';
import { GithubIdError, resolveGithubId } from '../src/launch/github-id.js';
import { runSetup, type SetupIo } from '../src/launch/setup.js';
import type { LaunchFile } from '../src/launch/home.js';

type Asked = { question: string; secret?: boolean; default?: string };

function scripted(answers: Array<string | Error>) {
  const queue = [...answers];
  const said: string[] = [];
  const asked: Asked[] = [];
  const io: SetupIo = {
    async ask(question, o) {
      asked.push({ question, secret: o?.secret, default: o?.default });
      const a = queue.shift();
      if (a === undefined) throw new Error('no more scripted answers');
      if (a instanceof Error) throw a;
      return a;
    },
    say: (line) => { said.push(line); }
  };
  return { io, said, asked };
}

const resolveOk = async (input: string) => ({ id: '4242', login: input });

describe('runSetup', () => {
  it('collects the settings and says the OAuth App block', async () => {
    const { io, said } = scripted(['https://relay.example', 'cid', 'csecret', 'octo', '', 'ops@relay.example']);
    const out = await runSetup(io, {}, { resolveId: resolveOk });
    expect(out).toMatchObject({
      publicUrl: 'https://relay.example',
      githubClientId: 'cid',
      githubClientSecret: 'csecret',
      allowedGithubIds: ['4242']
    });
    expect(out.vapid?.subject).toBe('mailto:ops@relay.example');
    expect(out.vapid?.publicKey).toBeTruthy();
    expect(said.join('\n')).toContain('https://relay.example/auth/github/callback');
    expect(said.join('\n')).toContain('GitHub account octo = id 4242');
  });

  it('asks the public URL again with the reason until it is valid', async () => {
    const { io, said, asked } = scripted([
      'https://relay.example/', 'http://relay.example', 'https://relay.example', 'cid', 'sec', 'octo', 'y', 'a@b.c'
    ]);
    await runSetup(io, {}, { resolveId: resolveOk });
    expect(asked.filter((a) => /public URL/i.test(a.question))).toHaveLength(3);
    expect(said.filter((l) => l.includes('LEDGE_RELAY_PUBLIC_URL must be'))).toHaveLength(2);
  });

  it('asks the account again when the lookup fails, saying a numeric id works', async () => {
    const resolveId = vi.fn()
      .mockRejectedValueOnce(new GithubIdError('not_found'))
      .mockResolvedValueOnce({ id: '7', login: 'real' });
    const { io, said, asked } = scripted(['https://relay.example', 'cid', 'sec', 'ghost', 'real', '', 'a@b.c']);
    const out = await runSetup(io, {}, { resolveId });
    expect(out.allowedGithubIds).toEqual(['7']);
    expect(asked.filter((a) => /GitHub (login|account)/i.test(a.question))).toHaveLength(2);
    expect(said.filter((l) => /numeric id/i.test(l))).toHaveLength(1);
  });

  it('asks the secret with secret: true and never says it', async () => {
    const { io, said, asked } = scripted(['https://relay.example', 'cid', 'top-secret-value', 'octo', '', 'a@b.c']);
    await runSetup(io, {}, { resolveId: resolveOk });
    expect(asked.find((a) => /secret/i.test(a.question))?.secret).toBe(true);
    expect(said.join('\n')).not.toContain('top-secret-value');
  });

  it('keeps the current secret on an empty answer and offers the other current values as defaults', async () => {
    const current: LaunchFile = {
      publicUrl: 'https://relay.example', githubClientId: 'cid', githubClientSecret: 'kept', allowedGithubIds: ['4242']
    };
    const { io, asked } = scripted(['', '', '', '4242', '', '']);
    const out = await runSetup(io, current, { resolveId: resolveOk });
    expect(out.githubClientSecret).toBe('kept');
    expect(out.publicUrl).toBe('https://relay.example');
    expect(asked[0]?.default).toBe('https://relay.example');
    expect(asked.find((a) => /secret/i.test(a.question))?.default).toBeUndefined();
  });

  it('prefixes a bare address with mailto: and refuses other contacts', async () => {
    const { io, said } = scripted(['https://relay.example', 'cid', 'sec', 'octo', '', 'ftp://x', 'me@x.y']);
    const out = await runSetup(io, {}, { resolveId: resolveOk });
    expect(out.vapid?.subject).toBe('mailto:me@x.y');
    expect(said.some((l) => /mailto:/.test(l) && /https:\/\//.test(l))).toBe(true);
  });

  it('keeps the VAPID keys when only the subject changes', async () => {
    const vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:old@x.y' };
    const { io } = scripted(['https://relay.example', 'cid', 'sec', 'octo', '', 'new@x.y']);
    const out = await runSetup(io, { vapid }, { resolveId: resolveOk });
    expect(out.vapid).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:new@x.y' });
  });

  it('keeps the other allowed ids, the answered one first, and says so', async () => {
    const current: LaunchFile = { publicUrl: 'https://relay.example', githubClientId: 'cid', githubClientSecret: 's', allowedGithubIds: ['1', '2', '3'] };
    const { io, said } = scripted(['', '', '', '2', '', '']);
    const out = await runSetup(io, current, { resolveId: async (i) => ({ id: i }) });
    expect(out.allowedGithubIds).toEqual(['2', '1', '3']);
    expect(said.join('\n')).toContain('2 other allowed GitHub accounts are kept');
    expect(said.join('\n')).toContain('GitHub account id 2');
    const { io: io2 } = scripted(['', '', '', '9', '', '']);
    const out2 = await runSetup(io2, current, { resolveId: async (i) => ({ id: i }) });
    expect(out2.allowedGithubIds).toEqual(['9', '1', '2', '3']);
  });

  it('shows the resolved account back and asks the account again when it is not the right one', async () => {
    const resolveId = async (input: string) => ({ id: input === 'octo' ? '1' : '7', login: input });
    const { io, said, asked } = scripted(['https://relay.example', 'cid', 'sec', 'octo', 'n', 'real', 'maybe', 'Y', 'a@b.c']);
    const out = await runSetup(io, {}, { resolveId });
    expect(out.allowedGithubIds).toEqual(['7']);
    expect(asked.filter((a) => /GitHub login/i.test(a.question))).toHaveLength(2);
    expect(asked.filter((a) => a.question === 'Is this the right account? [Y/n]')).toHaveLength(3);
    expect(said).toContain('GitHub account octo = id 1');
    expect(said).toContain('GitHub account real = id 7');
    expect(said).toContain('Answer y or n.');
  });

  it('rejects when the input ends in the middle of the questions', async () => {
    const { io } = scripted(['https://relay.example', 'cid', new Error('input ended')]);
    await expect(runSetup(io, {}, { resolveId: resolveOk })).rejects.toThrow('input ended');
  });
});

describe('resolveGithubId', () => {
  it('returns a numeric id without any call', async () => {
    const fetch = vi.fn();
    expect(await resolveGithubId('12345', { fetch: fetch as unknown as typeof globalThis.fetch })).toEqual({ id: '12345' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads the id and login of a user', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 99, login: 'octo' }), { status: 200 }));
    const r = await resolveGithubId('octo', { apiBase: 'http://gh.test', fetch: fetch as unknown as typeof globalThis.fetch });
    expect(r).toEqual({ id: '99', login: 'octo' });
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe('http://gh.test/users/octo');
  });

  it('throws not_found on a 404', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 404 }));
    await expect(resolveGithubId('octo', { fetch: fetch as unknown as typeof globalThis.fetch })).rejects.toMatchObject({ reason: 'not_found' });
  });

  it('throws unavailable when the call fails', async () => {
    const fetch = vi.fn(async () => { throw new Error('down'); });
    await expect(resolveGithubId('octo', { fetch: fetch as unknown as typeof globalThis.fetch })).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
