import { describe, it, expect } from 'vitest';
import { RoleSchema, RolesListingSchema } from '../src/index.js';

const role = { id: 'review', label: 'Relecteur', prompt: 'Tu relis.', source: 'repo', path: '/r/.ledge/roles/review.md' };

describe('roles', () => {
  it('a role may name the home role it shadows; without it, it reads as before', () => {
    expect(RoleSchema.parse({ ...role, shadows: '/h/.ledge/roles/review.md' }).shadows).toBe('/h/.ledge/roles/review.md');
    expect(RoleSchema.parse(role)).not.toHaveProperty('shadows');
    expect(RolesListingSchema.parse({ type: 'roles.listing', roles: [role], problems: [] }).roles[0]).toEqual(role);
  });
});
