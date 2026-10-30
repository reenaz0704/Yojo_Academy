import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { CurrentSession, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import { TrainerDeskService } from './trainer-desk.service';

type Session = NonNullable<AppRequest['session']>;
const actorOf = (s: Session, req: AppRequest) => ({ userId: s.userId, ...metaOf(req) });

export class RemarkDto {
  @ApiProperty({ enum: ['remark', 'private_note'] }) @IsIn(['remark', 'private_note']) kind!: 'remark' | 'private_note';
  @ApiProperty() @IsString() @Length(3, 2000) text!: string;
}
export class RemarkEditDto {
  @ApiProperty() @IsString() @Length(3, 2000) text!: string;
}
export class StaffRequestDto {
  @ApiProperty({ enum: ['escalation', 'guardian_contact'] })
  @IsIn(['escalation', 'guardian_contact'])
  kind!: 'escalation' | 'guardian_contact';
  @ApiProperty() @IsString() @Length(5, 1000) reason!: string;
}
export class ResolveRequestDto {
  @ApiProperty() @IsString() @Length(5, 1000) resolution!: string;
}
export class RequestsQuery {
  @ApiPropertyOptional({ enum: ['open', 'resolved'] }) @IsOptional() @IsIn(['open', 'resolved']) status?:
    | 'open'
    | 'resolved';
}
export class LabsQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() batchId?: string;
}
export class NudgeDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty() @Matches(/^[A-Za-z0-9_-]{2,40}$/) missionCode!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) message?: string;
}
export class TrainerConversationDto {
  @ApiProperty() @IsUUID() studentId!: string;
  @ApiProperty() @IsString() @Length(2, 150) subject!: string;
  @ApiProperty() @IsString() @Length(1, 4000) body!: string;
}
export class OutcomeDto {
  @ApiProperty() @IsString() @Length(5, 2000) outcome!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) followUp?: string;
}
export class FeedbackDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() sessionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sessionRequestId?: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}
export class FeedbackQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
}

/** Trainer console: student 360, remarks, admin requests, Lab Monitor, nudges, new messages, outcomes, feedback. */
@ApiTags('trainer: desk')
@Controller('trainer')
@Roles('trainer')
export class TrainerDeskController {
  constructor(private readonly desk: TrainerDeskService) {}

  @Get('students/:id')
  student(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.desk.student(s.userId, id);
  }

  @Post('students/:id/remarks')
  addRemark(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RemarkDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.desk.addRemark(actorOf(s, req), id, dto.kind, dto.text);
  }

  @Patch('remarks/:id')
  editRemark(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RemarkEditDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.desk.editRemark(actorOf(s, req), id, dto.text);
  }

  @Post('students/:id/requests')
  raise(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: StaffRequestDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.desk.raiseRequest(actorOf(s, req), id, dto.kind, dto.reason);
  }

  @Get('labs')
  labs(@Query() q: LabsQuery, @CurrentSession() s: Session) {
    return this.desk.labs(s.userId, q.batchId);
  }

  @Post('labs/nudge')
  nudge(@Body() dto: NudgeDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.desk.nudge(actorOf(s, req), dto.studentId, dto.missionCode, dto.message);
  }

  @Post('conversations')
  startConversation(@Body() dto: TrainerConversationDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.desk.startConversation(actorOf(s, req), dto.studentId, dto.subject, dto.body);
  }

  @Post('session-requests/:id/outcome')
  outcome(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: OutcomeDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.desk.recordOutcome(actorOf(s, req), id, dto.outcome, dto.followUp);
  }

  @Get('feedback')
  feedback(@Query() q: FeedbackQuery, @CurrentSession() s: Session) {
    return this.desk.trainerFeedback(s.userId, { page: q.page, rating: q.rating });
  }
}

/** Students rate the sessions they attended (a trainer sees the rating without the student's name). */
@ApiTags('student: feedback')
@Controller('student')
@Roles('student')
export class StudentFeedbackController {
  constructor(private readonly desk: TrainerDeskService) {}

  @Get('feedback')
  mine(@CurrentSession() s: Session) {
    return this.desk.studentFeedback(s.userId);
  }

  @Post('feedback')
  give(@Body() dto: FeedbackDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.desk.giveFeedback(s.userId, dto, metaOf(req));
  }
}

/** Platform Admin: trainers' requests about students, and a trainer's feedback with student names (moderation). */
@ApiTags('admin: trainer desk')
@Controller('admin')
@Roles('admin')
export class AdminTrainerDeskController {
  constructor(private readonly desk: TrainerDeskService) {}

  @Get('student-requests')
  @RequirePermission('students')
  requests(@Query() q: RequestsQuery) {
    return this.desk.listRequests(q.status);
  }

  @Post('student-requests/:id/resolve')
  @RequirePermission('students', 'Y')
  resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ResolveRequestDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.desk.resolveRequest(actorOf(s, req), id, dto.resolution);
  }

  @Get('trainers/:id/feedback')
  @RequirePermission('reports')
  feedback(@Param('id', new ParseUUIDPipe()) id: string, @Query() q: FeedbackQuery) {
    return this.desk.trainerFeedback(id, { page: q.page, rating: q.rating, asAdmin: true });
  }
}
