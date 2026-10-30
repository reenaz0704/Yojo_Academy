import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CurrentSession, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import { AdminAnalyticsService } from './admin-analytics.service';
import { LmsInsightsService } from './lms-insights.service';
import { StudentReportService } from './student-report.service';

type Session = NonNullable<AppRequest['session']>;

/** Trainer LMS dashboard and batch overview (own batches only). */
@ApiTags('trainer: insights')
@Controller('trainer')
@Roles('trainer')
export class TrainerInsightsController {
  constructor(private readonly svc: LmsInsightsService) {}

  @Get('dashboard')
  dashboard(@CurrentSession() s: Session) {
    return this.svc.trainerDashboard(s.userId);
  }

  @Get('batches/:id/overview')
  overview(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.svc.batchOverview(id, s.userId);
  }
}

/** Admin LMS dashboard tiles and batch performance (permission `reports`). */
@ApiTags('admin: insights')
@Controller('admin/lms')
@Roles('admin')
export class AdminInsightsController {
  constructor(
    private readonly svc: LmsInsightsService,
    private readonly analyticsSvc: AdminAnalyticsService,
  ) {}

  @Get('dashboard')
  @RequirePermission('reports')
  dashboard() {
    return this.svc.adminDashboard();
  }

  @Get('batches/:id/overview')
  @RequirePermission('reports')
  overview(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.svc.batchOverview(id);
  }

  @Get('analytics')
  @RequirePermission('reports')
  analytics() {
    return this.analyticsSvc.analytics();
  }

  @Get('insights')
  @RequirePermission('reports')
  insights() {
    return this.analyticsSvc.insightRules();
  }
}

class CertificateListQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['valid', 'revoked'] }) @IsOptional() @IsIn(['valid', 'revoked']) status?:
    | 'valid'
    | 'revoked';
  @ApiPropertyOptional() @IsOptional() @IsUUID() courseId?: string;
}

/** Admin LMS → Certificates register (permission `certificates`). Issue and revoke live in AdminCoursesController. */
@ApiTags('admin: certificates')
@Controller('admin')
@Roles('admin')
export class AdminCertificatesController {
  constructor(private readonly svc: AdminAnalyticsService) {}

  @Get('certificates')
  @RequirePermission('certificates')
  list(@Query() q: CertificateListQuery) {
    return this.svc.certificates(q);
  }
}

class ReportListQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: ['Offensive', 'Defensive', 'GRC'] })
  @IsOptional()
  @IsIn(['Offensive', 'Defensive', 'GRC'])
  path?: string;
  @ApiPropertyOptional({ enum: ['taken', 'skipped', 'none'] })
  @IsOptional()
  @IsIn(['taken', 'skipped', 'none'])
  quiz?: 'taken' | 'skipped' | 'none';
  @ApiPropertyOptional() @IsOptional() @IsUUID() batchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) cursor?: string;
}

/** Admin LMS → Student reports (permission `reports`): list with career-path filters, full per-student report. */
@ApiTags('admin: student reports')
@Controller('admin/student-reports')
@Roles('admin')
export class AdminStudentReportsController {
  constructor(private readonly svc: StudentReportService) {}

  @Get()
  @RequirePermission('reports')
  list(@Query() q: ReportListQuery) {
    return this.svc.list(q);
  }

  @Get(':id')
  @RequirePermission('reports')
  report(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.report({ userId: s.userId, ...metaOf(req) }, id);
  }
}
