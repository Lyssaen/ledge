import { describe, expect, it } from 'vitest';
import type { PhoneRig, PhoneTeam } from '@ledge/protocol';
import { teamIdOf } from '../../src/model/rigs';

const rig = (extra: Partial<PhoneRig> = {}): PhoneRig => ({ key: 'local/x', name: 'api', project: 'billing', lifecycle: 'running', kernel: false, seats: [], engine: 'ledge', ...extra } as PhoneRig);
const team = (id: string, name = 'api', project: string | null = 'billing'): PhoneTeam => ({ id, name, project } as PhoneTeam);

describe('teamIdOf', () => {
  it('takes the id the daemon sends', () => {
    expect(teamIdOf(rig({ teamId: 'team-ab12' }), [team('team-cd34')])).toBe('team-ab12');
  });
  it('falls back to the one live team of that name in that project', () => {
    expect(teamIdOf(rig(), [team('team-ab12'), team('team-ef56', 'web')])).toBe('team-ab12');
  });
  it('matches none when two teams share the name: no link rather than the wrong team', () => {
    expect(teamIdOf(rig(), [team('team-ab12'), team('team-cd34')])).toBeUndefined();
  });
  it('is never set for an OpenRig rig', () => {
    expect(teamIdOf(rig({ engine: 'openrig' }), [team('team-ab12')])).toBeUndefined();
  });
});
