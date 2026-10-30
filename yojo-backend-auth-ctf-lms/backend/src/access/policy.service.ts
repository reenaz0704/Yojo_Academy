import { Injectable } from '@nestjs/common';
import type { AdminRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Permission } from './permissions';

/**
 * Evaluates admin permissions from role_permissions (seeded from PERMISSIONS). Cached for 60 s per process;
 * the table only changes through migrations/seed, so the cache cannot be poisoned by an API call.
 */
@Injectable()
export class PolicyService {
  private cache: { at: number; map: Map<string, 'Y' | 'R'> } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async level(adminRole: AdminRole, permission: Permission): Promise<'Y' | 'R' | null> {
    const map = await this.load();
    return map.get(`${adminRole}:${permission}`) ?? null;
  }

  async permissionsFor(adminRole: AdminRole): Promise<Record<string, 'Y' | 'R'>> {
    const map = await this.load();
    const out: Record<string, 'Y' | 'R'> = {};
    for (const [k, v] of map) if (k.startsWith(`${adminRole}:`)) out[k.slice(adminRole.length + 1)] = v;
    return out;
  }

  clearCache(): void {
    this.cache = null;
  }

  private async load(): Promise<Map<string, 'Y' | 'R'>> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.map;
    const rows = await this.prisma.rolePermission.findMany();
    const map = new Map(rows.map((r) => [`${r.adminRole}:${r.permission}`, r.level] as const));
    this.cache = { at: Date.now(), map };
    return map;
  }
}
