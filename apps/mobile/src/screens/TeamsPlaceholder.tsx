// Stand-ins for the team screens below the tab, replaced by Tasks 9 to 11: the routes and the tab exist, the screens come after.
import { copy } from '../copy';
import { useMobile, type MobileStore } from '../state/store';
import { BackHeader, linkView } from '../ui/Header';

/** A team screen below the tab (a team or role editor, a live team sheet, its composition). */
export function TeamsPage({ store }: { store: MobileStore }) {
  const state = useMobile(store);
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4">
      <BackHeader title={copy.nav.teams} fallback={{ name: 'teams' }} label={copy.nav.backTo.teams ?? copy.nav.back} link={linkView(state)} />
    </main>
  );
}
