/** `path` as it reads under `home`: the home itself is `~` and what lies inside it `~/…`, on whole segments only (`/home/u2` is not
 *  under `/home/u`). Without a known home (an older daemon), or with `/` as one, the path as is. For display: tabs keep the real folder. */
export function tildeHome(path: string, home: string | undefined): string {
  const h = home?.replace(/\/+$/, '');
  if (!h) return path;
  if (path === h) return '~';
  return path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path;
}
