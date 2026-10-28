// Stand-ins for the team screens, replaced by Tasks 8 to 11: the routes and the tab exist, the screens come after.
import { copy } from '../copy';
import { useMobile, type MobileStore } from '../state/store';
import { requestsOf } from '../model/requests';
import { closedTasks } from '../model/teams';
import { BackHeader, Header, linkView } from '../ui/Header';
import { TabBar } from '../ui/TabBar';

/** The Équipes tab. */
export function TeamsTab({ store }: { store: MobileStore }) {
  const state = useMobile(store);
  const count = requestsOf([...state.sessions.values()]).length + closedTasks(state.tasks.values()).length;
  return (
    <>
      <main className="min-h-0 flex-1 overflow-y-auto px-4">
        <Header title={copy.nav.teams} subtitle="" link={linkView(state)} />
      </main>
      <TabBar count={count} active="teams" chat={!!state.device?.chat} />
    </>
  );
}

/** A team screen below the tab (a team or role editor, a live team sheet, its composition). */
export function TeamsPage({ store }: { store: MobileStore }) {
  const state = useMobile(store);
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4">
      <BackHeader title={copy.nav.teams} fallback={{ name: 'teams' }} label={copy.nav.backTo.teams ?? copy.nav.back} link={linkView(state)} />
    </main>
  );
}
