import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { CurrentSession, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { AuditService } from './audit.service';

class AuditQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @Matches(/^\d+$/) cursor?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() actorId?: string;
}

@ApiTags('audit')
@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** Platform sees every row; other admin roles (R) see only their own actions (spec §6.9). */
  @Get('admin/audit')
  @Roles('admin')
  @RequirePermission('audit.view')
  list(@Query() q: AuditQuery, @CurrentSession() s: NonNullable<AppRequest['session']>, @Req() req: AppRequest) {
    const own = req.permissionLevel !== 'Y';
    return this.audit.list({
      limit: q.limit ?? 25,
      cursor: q.cursor,
      action: q.action,
      actorId: own ? s.userId : q.actorId,
    });
  }

  @Get('admin/audit/verify')
  @Roles('admin')
  @RequirePermission('audit.view', 'Y')
  verify() {
    return this.audit.verify();
  }

  @Get('trainer/audit')
  @Roles('trainer')
  own(@Query() q: AuditQuery, @CurrentSession() s: NonNullable<AppRequest['session']>) {
    return this.audit.list({ limit: q.limit ?? 25, cursor: q.cursor, action: q.action, actorId: s.userId });
  }
}
