import type { DaemonClient as BaseClient } from '@ledge/client';
import type { Fleet } from './machines';

export { createDaemonClient } from '@ledge/client';
export type { DaemonStatus, WsCtor } from '@ledge/client';
/** The shared client (packages/client), plus the overlay's own fleet of machines when it drives several daemons. */
export interface DaemonClient extends BaseClient { fleet?: Fleet }
