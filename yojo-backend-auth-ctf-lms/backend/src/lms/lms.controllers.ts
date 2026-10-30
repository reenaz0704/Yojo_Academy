import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentSession, RequirePermission, RequireReason, Roles, StepUp } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { EntitlementService } from '../entitlements/entitlement.service';
import { metaOf } from '../identity/http';
import { AdminUsersService, type AdminActor } from './admin-users.service';
import { BatchesService } from './batches.service';
import {
  BatchDto,
  BatchPatchDto,
  EnrolDto,
  GrantEntitlementDto,
  ProvisionStudentDto,
  ReasonOnlyDto,
  UserListQuery,
  UserStatusDto,
} from './lms.dto';

type Session = NonNullable<AppRequest['session']>;
const actorOf = (s: Session, req: AppRequest): AdminActor => ({ userId: s.userId, ...metaOf(req) });

@ApiTags('admin: users')
@Controller('admin')
@Roles('admin')
export class AdminUsersController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly entitlements: EntitlementService,
    private readonly batches: BatchesService,
  ) {}

  @Get('users')
  @RequirePermission('users.search')
  list(@Query() q: UserListQuery) {
    return this.users.list(q);
  }

  @Get('total-users')
  @RequirePermission('totalUsers')
  totals() {
    return this.users.totals();
  }

  @Get('users/:id')
  @RequirePermission('users.search')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.users.detail(id);
  }

  @Patch('users/:id/status')
  @RequirePermission('users.manage', 'Y')
  @RequireReason()
  @StepUp('window')
  status(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UserStatusDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.users.setStatus(id, dto.status, dto.reason, actorOf(s, req));
  }

  @Post('users/:id/sessions/revoke')
  @RequirePermission('users.manage', 'Y')
  @RequireReason()
  revokeSessions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonOnlyDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.users.revokeSessions(id, dto.reason, actorOf(s, req));
  }

  @Post('students')
  @RequirePermission('students', 'Y')
  @RequireReason()
  provision(@Body() dto: ProvisionStudentDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.users.provisionStudent(dto, actorOf(s, req));
  }

  @Post('students/:id/entitlements')
  @RequirePermission('entitlements', 'Y')
  @RequireReason()
  @StepUp('fresh')
  grant(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GrantEntitlementDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.entitlements.grant(id, dto, actorOf(s, req));
  }

  @Post('students/:id/entitlements/:entitlementId/revoke')
  @RequirePermission('entitlements', 'Y')
  @RequireReason()
  @StepUp('fresh')
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('entitlementId', new ParseUUIDPipe()) entitlementId: string,
    @Body() dto: ReasonOnlyDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.entitlements.revoke(id, entitlementId, dto.reason, actorOf(s, req));
  }

  @Post('students/:id/enrolments')
  @RequirePermission('batches', 'Y')
  enrol(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: EnrolDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.batches.enrol(id, dto.batchId, actorOf(s, req));
  }

  @Get('batches')
  @RequirePermission('batches')
  async batchList() {
    return { items: await this.batches.listAll() };
  }

  @Post('batches')
  @RequirePermission('batches', 'Y')
  createBatch(@Body() dto: BatchDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.batches.create(dto, actorOf(s, req));
  }

  @Patch('batches/:id')
  @RequirePermission('batches', 'Y')
  updateBatch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: BatchPatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.batches.update(id, dto, actorOf(s, req));
  }
}

@ApiTags('trainer')
@Controller('trainer')
@Roles('trainer')
export class TrainerController {
  constructor(private readonly batches: BatchesService) {}

  @Get('batches')
  async list(@CurrentSession() s: Session) {
    return { items: await this.batches.trainerBatches(s.userId) };
  }

  @Get('batches/:id')
  one(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.batches.trainerBatch(s.userId, id);
  }

  @Get('batches/:id/students')
  students(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.batches.trainerBatchStudents(s.userId, id);
  }
}
