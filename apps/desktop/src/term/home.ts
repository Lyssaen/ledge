import { homeShort } from '@ledge/protocol';

/** `path` as it reads under `home`: the home itself is `~` and what lies inside it `~/…` (`~\…` on Windows), on whole segments
 *  only (`/home/u2` is not under `/home/u`). Without a known home (an older daemon), or with `/` as one, the path as is. For
 *  display: tabs keep the real folder. */
export function tildeHome(path: string, home: string | undefined): string {
  return homeShort(path, home);
}
