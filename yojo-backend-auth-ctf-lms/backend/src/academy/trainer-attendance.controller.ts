import { Body, Controller, Get, Put, Query, Req } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { CurrentSession, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import { TrainerAttendanceService } from './trainer-attendance.service';

type Session = NonNullable<AppRequest['session']>;
const STATUSES = ['present', 'absent', 'leave', 'half_day'] as const;

class DayQuery {
  @ApiPropertyOptional({ example: '2026-10-30' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) day?: string;
}
class SummaryQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(180) days?: number;
}
class MarkDto {
  @ApiProperty() @IsUUID() trainerId!: string;
  @ApiProperty({ example: '2026-10-30' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) day!: string;
  @ApiProperty({ enum: STATUSES }) @IsIn(STATUSES) status!: (typeof STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) note?: string;
}

/** Admin → Attendance → Trainers (owner, 30 Oct). */
@ApiTags('admin: attendance')
@Controller('admin/trainer-attendance')
@Roles('admin')
export class AdminTrainerAttendanceController {
  constructor(private readonly svc: TrainerAttendanceService) {}

  @Get()
  @RequirePermission('attendance.view')
  day(@Query() q: DayQuery) {
    return this.svc.day(q.day);
  }

  @Get('summary')
  @RequirePermission('attendance.view')
  summary(@Query() q: SummaryQuery) {
    return this.svc.summary(q.days);
  }

  @Put()
  @RequirePermission('attendance.edit', 'Y')
  mark(@Body() dto: MarkDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.mark({ userId: s.userId, ...metaOf(req) }, dto);
  }
}
