import { Injectable } from '@nestjs/common';
import type { AdminRole, Prisma } from '@prisma/client';
import { SETTINGS_SECTIONS_BY_ROLE } from '../access/permissions';
import { AuditService } from '../audit/audit.service';
import { AppError, Errors } from '../common/errors/app-error';
import { PrismaService } from '../prisma/prisma.service';
import { SETTINGS_DEFAULTS, SETTINGS_SCHEMAS, SETTINGS_SECTIONS, SettingsSection } from './settings.schemas';

type Value<K extends SettingsSection> = (typeof SETTINGS_DEFAULTS)[K];

/** Typed settings with history (settings_log) and optimistic locking. Cached 10 s per process. */
@Injectable()
export class SettingsService {
  private cache = new Map<string, { at: number; value: unknown; version: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  isSection(s: string): s is SettingsSection {
    return (SETTINGS_SECTIONS as string[]).includes(s);
  }

  editableBy(role: AdminRole): SettingsSection[] {
    return (SETTINGS_SECTIONS_BY_ROLE[role] ?? []).filter((s): s is SettingsSection => this.isSection(s));
  }

  async get<K extends SettingsSection>(section: K): Promise<{ value: Value<K>; version: number }> {
    const hit = this.cache.get(section);
    if (hit && Date.now() - hit.at < 10_000) return { value: hit.value as Value<K>, version: hit.version };
    const row = await this.prisma.setting.findUnique({ where: { section } });
    const value = (row?.value as Value<K> | undefined) ?? SETTINGS_DEFAULTS[section];
    const version = row?.version ?? 0;
    this.cache.set(section, { at: Date.now(), value, version });
    return { value, version };
  }

  async update(
    section: SettingsSection,
    input: unknown,
    expectedVersion: number,
    actor: { userId: string; adminRole: AdminRole; ip?: string; requestId?: string },
  ): Promise<{ value: unknown; version: number }> {
    const parsed = SETTINGS_SCHEMAS[section].safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(422, 'SETTINGS_INVALID', issue.message, {
        field: ['value', ...issue.path].join('.'),
        details: { errors: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
      });
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.setting.findUnique({ where: { section } });
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== expectedVersion)
        throw new AppError(
          412,
          'VERSION_MISMATCH',
          'These settings were changed by someone else. Reload and try again.',
          {
            details: { currentVersion },
          },
        );
      const before =
        (current?.value as Prisma.InputJsonValue | undefined) ?? (SETTINGS_DEFAULTS[section] as Prisma.InputJsonValue);
      const value = parsed.data as Prisma.InputJsonValue;
      const saved = current
        ? await tx.setting.update({ where: { section }, data: { value, version: { increment: 1 } } })
        : await tx.setting.create({ data: { section, value, version: 1 } });
      await tx.settingLog.create({
        data: { section, byId: actor.userId, version: saved.version, diff: { before, after: value } },
      });
      await this.audit.record(
        {
          action: 'settings.changed',
          actorId: actor.userId,
          actorRole: 'admin',
          adminRole: actor.adminRole,
          targetType: 'settings',
          targetId: section,
          detail: { version: saved.version },
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
      return saved;
    });
    this.cache.delete(section);
    return { value: result.value, version: result.version };
  }

  async history(section: SettingsSection, limit = 20) {
    return this.prisma.settingLog.findMany({ where: { section }, orderBy: { createdAt: 'desc' }, take: limit });
  }

  assertEditable(role: AdminRole, section: string): asserts section is SettingsSection {
    if (!this.isSection(section)) throw Errors.notFound('Unknown settings section.');
    if (!this.editableBy(role).includes(section))
      throw Errors.forbidden('Your role cannot change this settings section.');
  }
}
