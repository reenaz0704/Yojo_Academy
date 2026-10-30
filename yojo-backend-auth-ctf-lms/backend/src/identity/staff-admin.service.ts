import { Inject, Injectable } from '@nestjs/common';
import type { AdminRole, Capability, Prisma, UserRole } from '@prisma/client';
import Redis from 'ioredis';
import { PolicyService } from '../access/policy.service';
import { AuditService } from '../audit/audit.service';
import { randomToken, sha256 } from '../common/crypto/crypto.util';
import { AppError, Errors } from '../common/errors/app-error';
import { APP_CONFIG } from '../config/config.module';
import type { AppConfig } from '../config/config.schema';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';
import { DUAL_CONTROL_TTL_MS, INVITE_TTL_MS, MFA_REENROL_TTL_SEC } from './constants';
import type { CreateInviteDto, DecideAccessRequestDto, StaffRoleDto } from './dto/admin.dto';
import { MAIL_PORT, type MailPort } from './mail/mail.port';
import { MfaService } from './mfa.service';
import { SessionService } from './session.service';
import { REENROL } from './staff-auth.service';
import { isStaffEmail, normEmail, type RequestMeta } from './types';

export interface Actor extends RequestMeta {
  userId: string;
  adminRole: AdminRole;
}

const STAFF_SELECT = {
  id: true,
  code: true,
  email: true,
  role: true,
  adminRole: true,
  capability: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  staffProfile: { select: { displayName: true, title: true } },
} satisfies Prisma.UserSelect;

/** Platform Admin staff management (spec §6.4.1, §6.8, §8.6). Every write is audited with the actor. */
@Injectable()
export class StaffAdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(MAIL_PORT) private readonly mail: MailPort,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
  ) {}

  list(filter: { status?: string; cursor?: string; limit: number }) {
    return this.prisma.user.findMany({
      where: { role: { in: ['admin', 'trainer'] }, ...(filter.status ? { status: filter.status as never } : {}) },
      select: STAFF_SELECT,
      orderBy: { createdAt: 'asc' },
      take: filter.limit,
      ...(filter.cursor ? { skip: 1, cursor: { id: filter.cursor } } : {}),
    });
  }

  /** Creates a single-use 72-hour invite; any earlier open invite for the same email is revoked. */
  async invite(dto: CreateInviteDto, actor: Actor): Promise<{ id: string; email: string; expiresAt: Date }> {
    const email = normEmail(dto.email);
    if (!isStaffEmail(this.cfg, email))
      throw new AppError(400, 'STAFF_DOMAIN_REQUIRED', 'Staff must use an organisation email address.', {
        field: 'email',
      });
    const target = this.targetRole(dto);
    const batchIds = dto.role === 'trainer' ? [...new Set(dto.batchIds ?? [])] : [];
    if (batchIds.length && (await this.prisma.batch.count({ where: { id: { in: batchIds } } })) !== batchIds.length)
      throw Errors.validation('Choose batches from the list.', 'batchIds');
    const existing = await this.prisma.user.findUnique({ where: { email }, select: { status: true } });
    if (existing && existing.status !== 'invited')
      throw Errors.conflict('ACCOUNT_EXISTS', 'This person already has an account.');

    const token = randomToken(32);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.staffInvite.updateMany({
        where: { email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const inv = await tx.staffInvite.create({
        data: {
          email,
          ...target,
          batchIds,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          createdById: actor.userId,
        },
      });
      await this.audit.record(
        {
          action: 'staff.invite.created',
          actorId: actor.userId,
          actorRole: 'admin',
          adminRole: actor.adminRole,
          targetType: 'staff_invite',
          targetId: inv.id,
          detail: { email, ...target, batchIds },
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
      return inv;
    });
    await this.mail.send({
      to: email,
      template: 'staff_invite',
      subject: 'You are invited to Yojo Cyber Academy',
      text: `Accept your invite within 72 hours: ${this.cfg.PUBLIC_APP_URL}/login.html#invite=${token}`,
    });
    return { id: row.id, email, expiresAt: row.expiresAt };
  }

  listRequests(status: 'pending' | 'approved' | 'declined' = 'pending') {
    return this.prisma.staffAccessRequest.findMany({ where: { status }, orderBy: { createdAt: 'asc' }, take: 200 });
  }

  async decideRequest(id: string, dto: DecideAccessRequestDto, actor: Actor) {
    const req = await this.prisma.staffAccessRequest.findUnique({ where: { id } });
    if (!req) throw Errors.notFound('Request not found.');
    if (req.status !== 'pending') throw Errors.conflict('ALREADY_DECIDED', 'This request was already decided.');
    if (dto.decision === 'decline' && !dto.reason) throw Errors.reasonRequired();

    let invite: { id: string } | null = null;
    if (dto.decision === 'approve')
      invite = await this.invite(
        { email: req.email, role: dto.role!, adminRole: dto.adminRole, capability: dto.capability },
        actor,
      );
    await this.prisma.staffAccessRequest.update({
      where: { id },
      data: {
        status: dto.decision === 'approve' ? 'approved' : 'declined',
        decidedById: actor.userId,
        decisionReason: dto.reason,
        decidedAt: new Date(),
      },
    });
    if (dto.decision === 'decline')
      await this.mail.send({
        to: req.email,
        template: 'access_request_declined',
        subject: 'Your Yojo staff access request',
        text: 'Your request for staff access was not approved.',
      });
    await this.audit.record({
      action: `staff.access_request.${dto.decision}d`,
      actorId: actor.userId,
      actorRole: 'admin',
      adminRole: actor.adminRole,
      targetType: 'staff_access_request',
      targetId: id,
      reason: dto.reason,
      detail: { inviteId: invite?.id ?? null },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { status: dto.decision === 'approve' ? 'approved' : 'declined', inviteId: invite?.id ?? null };
  }

  async setStatus(id: string, status: 'active' | 'suspended', reason: string, actor: Actor) {
    const user = await this.staffOrThrow(id);
    this.notSelf(id, actor);
    if (user.status === 'invited' || user.status === 'deleted')
      throw Errors.conflict('STATUS_NOT_CHANGEABLE', 'This account cannot be changed in its current state.');
    await this.prisma.user.update({
      where: { id },
      data: { status, ...(status === 'active' ? { lockedUntil: null, failedLogins: 0 } : {}) },
    });
    const revoked = status === 'suspended' ? await this.sessions.revokeAll(id, 'suspended') : 0;
    await this.audit.record({
      action: 'staff.status.changed',
      actorId: actor.userId,
      actorRole: 'admin',
      adminRole: actor.adminRole,
      targetType: 'user',
      targetId: id,
      reason,
      detail: { from: user.status, to: status, sessionsRevoked: revoked },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { id, status };
  }

  /** Changes sub-role or capability. Never on yourself; every session of the target ends (spec §6.5). */
  async setRole(id: string, dto: StaffRoleDto, reason: string, actor: Actor) {
    const user = await this.staffOrThrow(id);
    this.notSelf(id, actor);
    const data: { adminRole?: AdminRole; capability?: Capability } = {};
    if (user.role === 'admin') {
      if (!dto.adminRole || dto.capability) throw Errors.validation('Give adminRole for an admin.', 'adminRole');
      data.adminRole = dto.adminRole;
    } else {
      if (!dto.capability || dto.adminRole) throw Errors.validation('Give capability for a trainer.', 'capability');
      data.capability = dto.capability;
    }
    await this.prisma.user.update({ where: { id }, data });
    const revoked = await this.sessions.revokeAll(id, 'role_changed');
    await this.audit.record({
      action: 'staff.role.changed',
      actorId: actor.userId,
      actorRole: 'admin',
      adminRole: actor.adminRole,
      targetType: 'user',
      targetId: id,
      reason,
      detail: { from: { adminRole: user.adminRole, capability: user.capability }, to: data, sessionsRevoked: revoked },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { id, ...data };
  }

  /** Step one of dual control: records the request; a second admin must confirm (spec §6.8). */
  async requestMfaReset(id: string, reason: string, actor: Actor) {
    await this.staffOrThrow(id);
    this.notSelf(id, actor);
    const open = await this.prisma.dualControlAction.findFirst({
      where: { kind: 'mfa_reset', targetId: id, status: 'awaiting_second_admin', expiresAt: { gt: new Date() } },
    });
    if (open)
      throw Errors.conflict('ALREADY_REQUESTED', `An MFA reset for this person is already waiting (${open.code}).`);
    const row = await this.prisma.$transaction(async (tx) => {
      const dc = await tx.dualControlAction.create({
        data: {
          kind: 'mfa_reset',
          targetType: 'user',
          targetId: id,
          requestedById: actor.userId,
          reason,
          expiresAt: new Date(Date.now() + DUAL_CONTROL_TTL_MS),
        },
      });
      await this.audit.record(
        {
          action: 'staff.mfa_reset.requested',
          actorId: actor.userId,
          actorRole: 'admin',
          adminRole: actor.adminRole,
          targetType: 'user',
          targetId: id,
          reason,
          detail: { dualControl: dc.code },
          ip: actor.ip,
          requestId: actor.requestId,
        },
        tx,
      );
      return dc;
    });
    return { id: row.id, code: row.code, status: row.status, expiresAt: row.expiresAt };
  }

  listDualControl() {
    return this.prisma.dualControlAction.findMany({
      where: { status: 'awaiting_second_admin', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Step two: a different admin who also holds mfa.reset at Y confirms or rejects. */
  async decideDualControl(id: string, decision: 'confirm' | 'reject', note: string | undefined, actor: Actor) {
    const dc = await this.prisma.dualControlAction.findUnique({ where: { id } });
    if (!dc) throw Errors.notFound('Request not found.');
    if (dc.status !== 'awaiting_second_admin')
      throw Errors.conflict('ALREADY_DECIDED', 'This request was already decided.');
    if (dc.expiresAt.getTime() < Date.now()) {
      await this.prisma.dualControlAction.update({ where: { id }, data: { status: 'expired' } });
      throw new AppError(410, 'DUAL_CONTROL_EXPIRED', 'This request expired. Start a new one.');
    }
    if (dc.requestedById === actor.userId)
      throw new AppError(403, 'SECOND_ADMIN_REQUIRED', 'A different admin must confirm this request.');
    if (dc.targetId === actor.userId)
      throw new AppError(403, 'SELF_ACTION_FORBIDDEN', 'You cannot decide a request about yourself.');
    if (dc.kind !== 'mfa_reset')
      throw Errors.conflict('UNSUPPORTED_KIND', 'This kind of request is handled in a later milestone.');
    if ((await this.policy.level(actor.adminRole, 'mfa.reset')) !== 'Y') throw Errors.forbidden();

    const updated = await this.prisma.dualControlAction.updateMany({
      where: { id, status: 'awaiting_second_admin' },
      data: {
        status: decision === 'confirm' ? 'confirmed' : 'rejected',
        secondAdminId: actor.userId,
        decisionNote: note,
        decidedAt: new Date(),
      },
    });
    if (updated.count !== 1) throw Errors.conflict('ALREADY_DECIDED', 'This request was already decided.');

    let revoked = 0;
    if (decision === 'confirm') {
      const target = await this.prisma.user.findUniqueOrThrow({ where: { id: dc.targetId } });
      await this.mfa.removeAll(target.id);
      revoked = await this.sessions.revokeAll(target.id, 'mfa_reset');
      const token = randomToken(32);
      await this.redis.set(REENROL(token), target.id, 'EX', MFA_REENROL_TTL_SEC);
      await this.mail.send({
        to: target.email,
        template: 'mfa_reset',
        subject: 'Set up your Yojo authenticator again',
        text: `Your authenticator was reset by two admins. Set it up again within 72 hours: ${this.cfg.PUBLIC_APP_URL}/login.html#mfa-reenrol=${token}`,
      });
    }
    await this.audit.record({
      action: `staff.mfa_reset.${decision === 'confirm' ? 'confirmed' : 'rejected'}`,
      actorId: actor.userId,
      actorRole: 'admin',
      adminRole: actor.adminRole,
      targetType: 'user',
      targetId: dc.targetId,
      reason: note,
      detail: { dualControl: dc.code, requestedBy: dc.requestedById, sessionsRevoked: revoked },
      ip: actor.ip,
      requestId: actor.requestId,
    });
    return { id, status: decision === 'confirm' ? 'confirmed' : 'rejected' };
  }

  private targetRole(dto: CreateInviteDto): {
    role: UserRole;
    adminRole: AdminRole | null;
    capability: Capability | null;
  } {
    if (dto.role === 'admin') {
      if (!dto.adminRole || dto.capability)
        throw Errors.validation('An admin invite needs adminRole and no capability.', 'adminRole');
      return { role: 'admin', adminRole: dto.adminRole, capability: null };
    }
    if (!dto.capability || dto.adminRole)
      throw Errors.validation('A trainer invite needs capability and no adminRole.', 'capability');
    return { role: 'trainer', adminRole: null, capability: dto.capability };
  }

  private async staffOrThrow(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user || (user.role !== 'admin' && user.role !== 'trainer')) throw Errors.notFound('Staff member not found.');
    return user;
  }

  private notSelf(id: string, actor: Actor): void {
    if (id === actor.userId)
      throw new AppError(403, 'SELF_ACTION_FORBIDDEN', 'You cannot do this to your own account.');
  }
}
