/** Why a GitHub login could not be turned into an account id. */
export class GithubIdError extends Error {
  constructor(readonly reason: 'not_found' | 'unavailable') {
    super(reason === 'not_found' ? 'GitHub has no such account' : 'GitHub could not be reached');
    this.name = 'GithubIdError';
  }
}

/** The numeric id of a GitHub account given its login; a numeric input is already an id and costs no call. */
export async function resolveGithubId(
  input: string,
  o: { apiBase?: string; fetch?: typeof fetch } = {}
): Promise<{ id: string; login?: string }> {
  if (/^[1-9][0-9]*$/.test(input)) return { id: input };
  const doFetch = o.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${o.apiBase ?? 'https://api.github.com'}/users/${encodeURIComponent(input)}`, {
      headers: { 'user-agent': 'ledge-relay', accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10_000)
    });
  } catch {
    throw new GithubIdError('unavailable');
  }
  if (res.status === 404) throw new GithubIdError('not_found');
  if (!res.ok) throw new GithubIdError('unavailable');
  let body: { id?: unknown; login?: unknown };
  try {
    body = (await res.json()) as { id?: unknown; login?: unknown };
  } catch {
    throw new GithubIdError('unavailable');
  }
  if (typeof body.id !== 'number' || !Number.isInteger(body.id) || body.id < 1) throw new GithubIdError('unavailable');
  return { id: String(body.id), login: typeof body.login === 'string' ? body.login : undefined };
}
