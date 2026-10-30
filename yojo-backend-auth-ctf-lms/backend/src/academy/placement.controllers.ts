import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CurrentSession, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import { PlacementService } from './placement.service';

type Session = NonNullable<AppRequest['session']>;
const actorOf = (s: Session, req: AppRequest) => ({ userId: s.userId, ...metaOf(req) });
const URL_RE = /^https?:\/\/[^\s"'<>]{3,300}$/;

class ResumeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) headline?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) objective?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  skills?: string[];
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  certifications?: string[];
}
class ProjectDto {
  @ApiProperty() @IsString() @Length(2, 120) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  skills?: string[];
  @ApiPropertyOptional() @IsOptional() @Matches(URL_RE, { message: 'Use an http(s) link.' }) repoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(URL_RE, { message: 'Use an http(s) link.' }) demoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublic?: boolean;
}
class ProjectPatchDto extends PartialType(ProjectDto) {}
class MilestoneSubmitDto {
  @ApiPropertyOptional() @IsOptional() @Matches(URL_RE, { message: 'Use an http(s) link.' }) evidenceUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}
class ReviewDto {
  @ApiProperty() @IsBoolean() approve!: boolean;
  @ApiPropertyOptional({ description: 'Required when sending back' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  feedback?: string;
}
class VerifyMilestoneDto {
  @ApiProperty() @IsBoolean() done!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
}
class MockResultDto {
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) technical!: number;
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) communication!: number;
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) problemSolving!: number;
  @ApiProperty() @IsBoolean() passed!: boolean;
  @ApiProperty() @IsString() @Length(5, 2000) feedback!: string;
}
class MilestoneDto {
  @ApiProperty() @IsString() @Length(2, 120) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dueAt?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}
class ActiveDto {
  @ApiProperty() @IsBoolean() active!: boolean;
}
class BatchQuery {
  @ApiProperty() @IsUUID() batchId!: string;
}

/** Placement Mission for the signed-in student. */
@ApiTags('student: placement')
@Controller('student')
@Roles('student')
export class StudentPlacementController {
  constructor(private readonly svc: PlacementService) {}

  @Get('placement')
  overview(@CurrentSession() s: Session) {
    return this.svc.overview(s.userId);
  }

  @Get('placement/skill-gaps')
  gaps(@CurrentSession() s: Session) {
    return this.svc.skillGaps(s.userId);
  }

  @Get('resume')
  resume(@CurrentSession() s: Session) {
    return this.svc.resume(s.userId);
  }

  @Put('resume')
  update(@Body() dto: ResumeDto, @CurrentSession() s: Session) {
    return this.svc.updateResume(s.userId, dto);
  }

  @Post('resume/submit')
  @HttpCode(200)
  submit(@CurrentSession() s: Session) {
    return this.svc.submitResume(s.userId);
  }

  @Get('portfolio')
  portfolio(@CurrentSession() s: Session) {
    return this.svc.portfolio(s.userId);
  }

  @Post('portfolio')
  add(@Body() dto: ProjectDto, @CurrentSession() s: Session) {
    return this.svc.addProject(s.userId, dto);
  }

  @Patch('portfolio/:id')
  edit(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: ProjectPatchDto, @CurrentSession() s: Session) {
    return this.svc.editProject(s.userId, id, dto);
  }

  @Delete('portfolio/:id')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    await this.svc.removeProject(s.userId, id);
  }

  @Post('portfolio/:id/submit')
  @HttpCode(200)
  submitProject(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.svc.submitProject(s.userId, id);
  }

  @Post('milestones/:id/submit')
  @HttpCode(200)
  milestone(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MilestoneSubmitDto,
    @CurrentSession() s: Session,
  ) {
    return this.svc.submitMilestone(s.userId, id, dto.evidenceUrl, dto.note);
  }
}

/** Trainer reviews for students in their own batches. */
@ApiTags('trainer: placement')
@Controller('trainer')
@Roles('trainer')
export class TrainerPlacementController {
  constructor(private readonly svc: PlacementService) {}

  @Get('placement/reviews')
  queue(@CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.reviewQueue(actorOf(s, req), false);
  }

  @Post('resumes/:studentId/review')
  @HttpCode(200)
  resume(
    @Param('studentId', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.reviewResume(actorOf(s, req), id, dto.approve, dto.feedback, false);
  }

  @Post('portfolio/:id/review')
  @HttpCode(200)
  project(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.reviewProject(actorOf(s, req), id, dto.approve, dto.feedback, false);
  }

  @Post('milestones/:studentId/:milestoneId/verify')
  @HttpCode(200)
  milestone(
    @Param('studentId', new ParseUUIDPipe()) sid: string,
    @Param('milestoneId', new ParseUUIDPipe()) mid: string,
    @Body() dto: VerifyMilestoneDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.verifyMilestone(actorOf(s, req), sid, mid, dto.done, dto.note, false);
  }

  @Post('session-requests/:id/mock-result')
  @HttpCode(201)
  mock(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MockResultDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.mockResult(actorOf(s, req), id, dto, false);
  }
}

/** Admin LMS → placement milestones, reviews and readiness reports (permission `students`). */
@ApiTags('admin: placement')
@Controller('admin')
@Roles('admin')
export class AdminPlacementController {
  constructor(private readonly svc: PlacementService) {}

  @Get('placement/milestones')
  @RequirePermission('students')
  milestones() {
    return this.svc.milestones();
  }

  @Post('placement/milestones')
  @RequirePermission('students', 'Y')
  add(@Body() dto: MilestoneDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.addMilestone(actorOf(s, req), dto);
  }

  @Post('placement/milestones/:id/active')
  @RequirePermission('students', 'Y')
  @HttpCode(200)
  active(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ActiveDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.setMilestoneActive(actorOf(s, req), id, dto.active);
  }

  @Get('placement/reviews')
  @RequirePermission('students')
  queue(@CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.reviewQueue(actorOf(s, req), true);
  }

  @Post('resumes/:studentId/review')
  @RequirePermission('students', 'Y')
  @HttpCode(200)
  resume(
    @Param('studentId', new ParseUUIDPipe()) id: string,
    @Body() dto: ReviewDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.reviewResume(actorOf(s, req), id, dto.approve, dto.feedback, true);
  }

  @Get('placement/report')
  @RequirePermission('reports')
  report(@Query() q: BatchQuery) {
    return this.svc.batchReport(q.batchId);
  }
}
