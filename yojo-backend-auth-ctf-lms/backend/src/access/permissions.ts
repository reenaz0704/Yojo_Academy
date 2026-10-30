import type { AdminRole } from '@prisma/client';

export type Level = 'Y' | 'R' | '-';

/**
 * Admin access matrix. Product decision (22 Oct): admin staff have ONE role, Platform Admin, replacing the four
 * sub-roles of spec v2.0 §6.6. Every admin permission is therefore full ('Y') for platform. The 'R'/'-' levels are
 * kept in the type so a future role can be added without touching the guards; a DB CHECK currently rejects any
 * admin_role other than 'platform'.
 * This constant is the single source: the seed writes it to role_permissions and a test checks the table matches.
 */
export const PERMISSIONS = [
  'dashboard',
  'courses',
  'labs',
  'students',
  'attendance.view',
  'attendance.edit',
  'performance',
  'finance.view',
  'finance.act',
  'approvals',
  'assessments',
  'analytics',
  'notifications',
  'broadcast',
  'reports',
  'reports.archive',
  'certificates',
  'settings',
  'users.search',
  'users.manage',
  'entitlements',
  'batches',
  'labs.secrets',
  'staff',
  'ctf',
  'ctf.secrets',
  'enquiries',
  'website.content',
  'gamification',
  'blogs.moderate',
  'support.inbox',
  'totalUsers',
  'insights',
  'insights.timeline',
  'insights.admin',
  'audit.view',
  'mfa.reset',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export const ADMIN_ROLES: AdminRole[] = ['platform'];

export function matrixLevel(role: AdminRole, perm: Permission): Level {
  return role === 'platform' && PERMISSIONS.includes(perm) ? 'Y' : '-';
}

/** Rows for role_permissions (no row = no access). */
export function matrixRows(): { adminRole: AdminRole; permission: Permission; level: 'Y' | 'R' }[] {
  return PERMISSIONS.map((permission) => ({ adminRole: 'platform' as AdminRole, permission, level: 'Y' as const }));
}

/** Settings sections each role may change. */
export const SETTINGS_SECTIONS_BY_ROLE: Partial<Record<AdminRole, string[]>> = {
  platform: ['plans', 'xp', 'ai', 'promos', 'maintenance', 'policy', 'auth', 'gamification', 'placement'],
};
