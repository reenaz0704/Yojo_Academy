import { ADMIN_ROLES, matrixLevel, matrixRows, PERMISSIONS, SETTINGS_SECTIONS_BY_ROLE } from './permissions';
import { projectStudentForTrainer, TRAINER_VISIBLE_STUDENT_FIELDS } from './trainer-projection';

describe('admin access (single Platform Admin role)', () => {
  it('has exactly one admin role', () => {
    expect(ADMIN_ROLES).toEqual(['platform']);
    expect(PERMISSIONS.length).toBeGreaterThanOrEqual(35);
  });

  it('gives Platform Admin full access to every key', () => {
    for (const p of PERMISSIONS) expect(matrixLevel('platform', p)).toBe('Y');
  });

  it('denies every key to any legacy sub-role value', () => {
    for (const r of ['payment', 'content', 'support'] as const) {
      for (const p of PERMISSIONS) expect(matrixLevel(r, p)).toBe('-');
    }
  });

  it('matrixRows has one Y row per permission', () => {
    const rows = matrixRows();
    expect(rows).toHaveLength(PERMISSIONS.length);
    expect(rows.every((r) => r.adminRole === 'platform' && r.level === 'Y')).toBe(true);
  });

  it('only platform has settings sections', () => {
    expect(SETTINGS_SECTIONS_BY_ROLE.platform).toContain('policy');
    expect(SETTINGS_SECTIONS_BY_ROLE.support).toBeUndefined();
  });
});

describe('trainer projection (spec §6.7)', () => {
  it('drops everything outside the 15 allowed fields', () => {
    const view = projectStudentForTrainer({
      id: 's1',
      name: 'Asha',
      xp: 120,
      email: 'asha@x.demo',
      phone: '999',
      guardian: { phone: '1' },
      fees: 5000,
      dob: '2008-01-01',
    });
    expect(view).toEqual({ id: 's1', name: 'Asha', xp: 120 });
    expect(TRAINER_VISIBLE_STUDENT_FIELDS).toHaveLength(15);
  });
});
