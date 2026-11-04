// The Atelier's layout lives in @ledge/ui (shared with the mobile app's Atelier, iPad lot 1): this module gives it Desktop's
// types (Session, Project, Projects) under the names Desktop has always imported.
import type { Project, Projects, Session } from '@ledge/protocol';
import * as shared from '@ledge/ui/atelier/layout';
import type { ProjectFilter } from '../nav/state';

export { STEP, MAX_SEATS, END_SEATS, RUG_SIDE, KERNEL_ROOM, ROOM_SIDE, ROOM_BACK, TABLE_GAP, tableLength, roomWidth, layoutTable, noteX, tableBranch, sheetState, helperState, walkOrder, roomTileWidth } from '@ledge/ui/atelier/layout';
export type { Side, End, Note, RigRoomInfo } from '@ledge/ui/atelier/layout';
export type Seat = shared.Seat<Session>;
export type EndSeat = shared.EndSeat<Session>;
export type TableLayout = shared.TableLayout<Session>;
export type AtelierTable = shared.AtelierTable<Session>;
export type AtelierRoom = shared.AtelierRoom<Session, Project>;
export type AtelierScene = shared.AtelierScene<Session, Project>;

/** A rig's room as a Project: no description, no repository; the kernel's violet, a rig's slate. */
const rigProject: shared.RigProject<Project> = ({ id, name, kind }) => ({ id, name, color: shared.rigColor(kind), description: '', repos: [] });

/** The rooms of the atelier (atelier rooms spec §3.1): a project with sessions has a room, its sessions at its common table. */
export function sceneOf(order: readonly Session[], projects: Projects | null, projectIdOf: (s: Session) => string | null, filter: ProjectFilter, byRig = true): AtelierScene {
  return shared.sceneOf<Session, Project>(order, projects?.projects ?? null, projectIdOf, filter, byRig, rigProject);
}

/** One room per rig whose seats Ledge follows, the kernel's first; a rig's folder is its first seat's. */
export function rigRooms(seats: readonly Session[], projectName: (id: string) => string | null, projectIdOf: (s: Session) => string | null): AtelierRoom[] {
  return shared.rigRooms<Session, Project>(seats, projectName, projectIdOf, rigProject);
}
