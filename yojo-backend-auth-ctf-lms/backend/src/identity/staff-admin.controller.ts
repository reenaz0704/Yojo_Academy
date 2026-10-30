import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentSession, RequireReason, RequirePermission, Roles, StepUp } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import {
  CreateInviteDto,
  DecideAccessRequestDto,
  DualControlDecisionDto,
  StaffRoleDto,
  StaffStatusDto,
} from './dto/admin.dto';
import { ReasonDto } from './dto/auth.dto';
import { metaOf } from './http';
import { StaffAdminService, type Actor } from './staff-admin.service';

type Session = NonNullable<AppRequest['session']>;
const actorOf = (s: Session, req: AppRequest): Actor => ({ userId: s.userId, adminRole: s.adminRole!, ...metaOf(req) });

@ApiTags('admin: staff')
@Controller('admin')
@Roles('admin')
export class StaffAdminController {
  constructor(private readonly staff: StaffAdminService) {}

  @Get('staff')
  @RequirePermission('staff', 'Y')
  async list(@Query('status') status?: string, @Query('cursor') cursor?: string) {
    const items = await this.staff.list({ status, cursor, limit: 100 });
    return { items, nextCursor: items.length === 100 ? items[items.length - 1].id : null };
  }

  @Post('staff/invites')
  @RequirePermission('staff', 'Y')
  invite(@Body() dto: CreateInviteDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.staff.invite(dto, actorOf(s, req));
  }

  @Get('staff/requests')
  @RequirePermission('staff', 'Y')
  async requests(@Query('status') status?: 'pending' | 'approved' | 'declined') {
    return {
      items: await this.staff.listRequests(
        status && ['pending', 'approved', 'declined'].includes(status) ? status : 'pending',
      ),
    };
  }

  @Post('staff/requests/:id/decide')
  @RequirePermission('staff', 'Y')
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideAccessRequestDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.staff.decideRequest(id, dto, actorOf(s, req));
  }

  @Patch('staff/:id/status')
  @RequirePermission('staff', 'Y')
  @RequireReason()
  status(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: StaffStatusDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.staff.setStatus(id, dto.status, dto.reason!, actorOf(s, req));
  }

  @Patch('staff/:id/role')
  @RequirePermission('staff', 'Y')
  @StepUp('fresh')
  @RequireReason()
  role(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: StaffRoleDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.staff.setRole(id, dto, dto.reason!, actorOf(s, req));
  }

  @Post('staff/:id/mfa-reset')
  @RequirePermission('mfa.reset', 'Y')
  @StepUp('fresh')
  @RequireReason()
  mfaReset(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.staff.requestMfaReset(id, dto.reason!, actorOf(s, req));
  }

  @Get('dual-control')
  @RequirePermission('mfa.reset', 'Y')
  async dualControl() {
    return { items: await this.staff.listDualControl() };
  }

  @Post('dual-control/:id/decide')
  @RequirePermission('mfa.reset', 'Y')
  @StepUp('fresh')
  decideDual(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DualControlDecisionDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.staff.decideDualControl(id, dto.decision, dto.note, actorOf(s, req));
  }
}
