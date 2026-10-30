import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentSession, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import {
  AssessmentDto,
  AssessmentListQuery,
  AssessmentPatchDto,
  AssessmentStatusDto,
  ExtensionDto,
  GradeDto,
  QuestionDto,
  SubmitDto,
} from './assessments.dto';
import { AssessmentsService } from './assessments.service';

type Session = NonNullable<AppRequest['session']>;
const actorOf = (s: Session, req: AppRequest) => ({ userId: s.userId, ...metaOf(req) });

/** Incoming Challenges for the signed-in student. */
@ApiTags('student: assessments')
@Controller('student')
@Roles('student')
export class StudentAssessmentsController {
  constructor(private readonly svc: AssessmentsService) {}

  @Get('assessments')
  list(@Query() q: AssessmentListQuery, @CurrentSession() s: Session) {
    return this.svc.list(s.userId, q.status);
  }

  @Get('assessments/:id')
  detail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.svc.detail(s.userId, id);
  }

  @Post('assessments/:id/attempts')
  @HttpCode(200)
  start(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.svc.start(s.userId, id);
  }

  @Post('attempts/:id/submit')
  @HttpCode(200)
  submit(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: SubmitDto, @CurrentSession() s: Session) {
    return this.svc.submit(s.userId, id, dto);
  }

  @Get('results')
  results(@CurrentSession() s: Session) {
    return this.svc.results(s.userId);
  }
}

/** Shared trainer/admin routes; the scope check lives in the service (trainer: own courses and batches). */
abstract class StaffAssessments {
  protected abstract readonly admin: boolean;
  constructor(protected readonly svc: AssessmentsService) {}
  protected a(s: Session, req: AppRequest) {
    return actorOf(s, req);
  }
}

@ApiTags('trainer: assessments')
@Controller('trainer')
@Roles('trainer')
export class TrainerAssessmentsController extends StaffAssessments {
  protected readonly admin = false;
  // Nest reads constructor types from the decorated class itself, so each controller declares its own constructor.
  constructor(svc: AssessmentsService) {
    super(svc);
  }

  @Get('assessments')
  list(@CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.staffList(this.a(s, req), this.admin);
  }

  @Get('assessments/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.staffGet(this.a(s, req), id, this.admin);
  }

  @Post('assessments')
  create(@Body() dto: AssessmentDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.create(this.a(s, req), dto, this.admin);
  }

  @Patch('assessments/:id')
  patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssessmentPatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.patch(this.a(s, req), id, dto, this.admin);
  }

  @Post('assessments/:id/status')
  @HttpCode(200)
  status(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssessmentStatusDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.setStatus(this.a(s, req), id, dto.status, this.admin);
  }

  @Post('assessments/:id/release')
  @HttpCode(200)
  release(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.release(this.a(s, req), id, this.admin);
  }

  @Post('assessments/:id/questions')
  addQuestion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: QuestionDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.addQuestion(this.a(s, req), id, dto, this.admin);
  }

  @Delete('questions/:id')
  @HttpCode(204)
  async deleteQuestion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    await this.svc.deleteQuestion(this.a(s, req), id, this.admin);
  }

  @Get('assessments/:id/submissions')
  submissions(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.submissions(this.a(s, req), id, this.admin);
  }

  @Post('attempts/:id/grade')
  @HttpCode(200)
  grade(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GradeDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.grade(this.a(s, req), id, dto, this.admin);
  }

  @Post('assessments/:id/extensions')
  extend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ExtensionDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.extend(this.a(s, req), id, dto.studentId, dto.dueAt, dto.reason, this.admin);
  }

  @Get('assessments/:id/report')
  report(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.report(this.a(s, req), id, this.admin);
  }
}

@ApiTags('admin: assessments')
@Controller('admin')
@Roles('admin')
export class AdminAssessmentsController extends StaffAssessments {
  protected readonly admin = true;
  constructor(svc: AssessmentsService) {
    super(svc);
  }

  @Get('assessments')
  @RequirePermission('assessments')
  list(@CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.staffList(this.a(s, req), this.admin);
  }

  @Get('assessments/:id')
  @RequirePermission('assessments')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.staffGet(this.a(s, req), id, this.admin);
  }

  @Post('assessments')
  @RequirePermission('assessments', 'Y')
  create(@Body() dto: AssessmentDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.create(this.a(s, req), dto, this.admin);
  }

  @Patch('assessments/:id')
  @RequirePermission('assessments', 'Y')
  patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssessmentPatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.patch(this.a(s, req), id, dto, this.admin);
  }

  @Post('assessments/:id/status')
  @RequirePermission('assessments', 'Y')
  @HttpCode(200)
  status(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssessmentStatusDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.setStatus(this.a(s, req), id, dto.status, this.admin);
  }

  @Post('assessments/:id/release')
  @RequirePermission('assessments', 'Y')
  @HttpCode(200)
  release(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.release(this.a(s, req), id, this.admin);
  }

  @Post('assessments/:id/questions')
  @RequirePermission('assessments', 'Y')
  addQuestion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: QuestionDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.addQuestion(this.a(s, req), id, dto, this.admin);
  }

  @Get('assessments/:id/submissions')
  @RequirePermission('assessments')
  submissions(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.submissions(this.a(s, req), id, this.admin);
  }

  @Post('attempts/:id/grade')
  @RequirePermission('assessments', 'Y')
  @HttpCode(200)
  grade(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GradeDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.grade(this.a(s, req), id, dto, this.admin);
  }

  @Post('assessments/:id/extensions')
  @RequirePermission('assessments', 'Y')
  extend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ExtensionDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.extend(this.a(s, req), id, dto.studentId, dto.dueAt, dto.reason, this.admin);
  }

  @Get('assessments/:id/report')
  @RequirePermission('assessments')
  report(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.report(this.a(s, req), id, this.admin);
  }
}
