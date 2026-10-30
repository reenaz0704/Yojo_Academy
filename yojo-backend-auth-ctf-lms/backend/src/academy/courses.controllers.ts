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
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { CurrentSession, Public, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import { AppError } from '../common/errors/app-error';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import { CoursesAdminService } from './courses-admin.service';
import {
  CatalogQuery,
  ChangeReasonDto,
  CoEditorDto,
  CourseChangeDecisionDto,
  CourseChangeQuery,
  CourseDto,
  CoursePatchDto,
  CourseStatusDto,
  CourseStatusQuery,
  FaqDto,
  FaqPatchDto,
  IssueCertificateDto,
  LessonDto,
  LessonPatchDto,
  ModuleDto,
  ModulePatchDto,
  RevokeDto,
  StudentCoursesQuery,
  TrainerBatchesDto,
  TrainerCourseCreateDto,
  TrainerCoursePatchDto,
  TrainerFaqDto,
  TrainerFaqPatchDto,
  TrainerLessonDto,
  TrainerLessonPatchDto,
  TrainerModuleDto,
  TrainerModulePatchDto,
} from './courses.dto';
import { CoursesService } from './courses.service';
import { CourseChangesService } from './courses-changes.service';
import { TrainerCoursesService, type Pending } from './courses-trainer.service';

type Session = NonNullable<AppRequest['session']>;
const actorOf = (s: Session, req: AppRequest) => ({ userId: s.userId, ...metaOf(req) });
/** A trainer change to a published course is not applied yet: answer 202 Accepted with the request code. */
const pend = <T>(res: Response, r: T | Pending) => {
  if (r && typeof r === 'object' && (r as Pending).pending === true) res.status(202);
  return r;
};
const slugOk = (s: string) => {
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(s)) throw new AppError(404, 'NOT_FOUND', 'This course is not available.');
  return s;
};

/** Public course catalog (published courses, public fields only) and certificate verification. */
@ApiTags('courses')
@Controller()
export class PublicCoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get('courses')
  @Public()
  catalog(@Query() q: CatalogQuery) {
    return this.courses.catalog(q);
  }

  @Get('courses/categories')
  @Public()
  categories() {
    return this.courses.categories();
  }

  @Get('courses/:slug')
  @Public()
  detail(@Param('slug') slug: string) {
    return this.courses.publicDetail(slugOk(slug));
  }

  @Get('certificates/:code/verify')
  @Public()
  verify(@Param('code') code: string) {
    if (!/^YJ-CERT-\d{1,10}$/.test(code)) throw new AppError(404, 'NOT_FOUND', 'No certificate with that code.');
    return this.courses.verifyCertificate(code);
  }
}

/** Cyber Arsenal for the signed-in student: state, progress, lessons, certificates. */
@ApiTags('student: courses')
@Controller('student')
@Roles('student')
export class StudentCoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get('courses')
  list(@Query() q: StudentCoursesQuery, @CurrentSession() s: Session) {
    return this.courses.forStudent(s.userId, q.view ?? 'all');
  }

  @Get('courses/:slug')
  detail(@Param('slug') slug: string, @CurrentSession() s: Session) {
    return this.courses.studentDetail(s.userId, slugOk(slug));
  }

  @Get('course-progress/:courseId')
  progress(@Param('courseId', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.courses.courseProgress(s.userId, id);
  }

  @Get('lessons/:id')
  lesson(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.courses.openLesson(s.userId, id);
  }

  @Post('lessons/:id/complete')
  @HttpCode(200)
  complete(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.courses.completeLesson(s.userId, id);
  }

  @Get('certificates')
  certificates(@CurrentSession() s: Session) {
    return this.courses.certificates(s.userId);
  }
}

/** Admin LMS → courses, modules, lessons, FAQs, certificates (permission `courses` / `certificates`). */
@ApiTags('admin: courses')
@Controller('admin')
@Roles('admin')
export class AdminCoursesController {
  constructor(private readonly admin: CoursesAdminService) {}

  @Get('courses')
  @RequirePermission('courses')
  list(@Query() q: CourseStatusQuery) {
    return this.admin.list(q.status);
  }

  @Get('courses/:id')
  @RequirePermission('courses')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.admin.get(id);
  }

  /** Trainer edits and deletes of this course's content, with the reason each trainer gave (OI-48). */
  @Get('courses/:id/changes')
  @RequirePermission('courses')
  changes(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.admin.changes(id);
  }

  @Post('courses')
  @RequirePermission('courses', 'Y')
  create(@Body() dto: CourseDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.admin.create(dto, actorOf(s, req));
  }

  @Patch('courses/:id')
  @RequirePermission('courses', 'Y')
  patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CoursePatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.admin.patch(id, dto, actorOf(s, req));
  }

  @Post('courses/:id/status')
  @RequirePermission('courses', 'Y')
  @HttpCode(200)
  status(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CourseStatusDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.admin.setStatus(id, dto.status, actorOf(s, req));
  }

  @Post('courses/:id/modules')
  @RequirePermission('courses', 'Y')
  addModule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ModuleDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.admin.addModule(id, dto, actorOf(s, req));
  }

  @Patch('modules/:id')
  @RequirePermission('courses', 'Y')
  patchModule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ModulePatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.admin.patchModule(id, dto, actorOf(s, req));
  }

  @Delete('modules/:id')
  @RequirePermission('courses', 'Y')
  @HttpCode(204)
  async deleteModule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    await this.admin.deleteModule(id, actorOf(s, req));
  }

  @Post('modules/:id/lessons')
  @RequirePermission('courses', 'Y')
  addLesson(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LessonDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.admin.addLesson(id, dto, actorOf(s, req));
  }

  @Patch('lessons/:id')
  @RequirePermission('courses', 'Y')
  patchLesson(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: LessonPatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.admin.patchLesson(id, dto, actorOf(s, req));
  }

  @Delete('lessons/:id')
  @RequirePermission('courses', 'Y')
  @HttpCode(204)
  async deleteLesson(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    await this.admin.deleteLesson(id, actorOf(s, req));
  }

  @Post('courses/:id/faqs')
  @RequirePermission('courses', 'Y')
  addFaq(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FaqDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.admin.addFaq(id, dto, actorOf(s, req));
  }

  @Patch('faqs/:id')
  @RequirePermission('courses', 'Y')
  patchFaq(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: FaqPatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.admin.patchFaq(id, dto, actorOf(s, req));
  }

  @Delete('faqs/:id')
  @RequirePermission('courses', 'Y')
  @HttpCode(204)
  async deleteFaq(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    await this.admin.deleteFaq(id, actorOf(s, req));
  }

  @Post('certificates')
  @RequirePermission('certificates', 'Y')
  issue(@Body() dto: IssueCertificateDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.admin.issueCertificate(dto.userId, dto.courseId, actorOf(s, req));
  }

  @Post('certificates/:code/revoke')
  @RequirePermission('certificates', 'Y')
  @HttpCode(200)
  revoke(@Param('code') code: string, @Body() dto: RevokeDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.admin.revokeCertificate(code, dto.reason, actorOf(s, req));
  }
}

/** Trainer console → Content: modules, lessons and FAQs of the courses their batches run (see TrainerCoursesService). */
@ApiTags('trainer: courses')
@Controller('trainer')
@Roles('trainer')
export class TrainerCoursesController {
  constructor(private readonly svc: TrainerCoursesService) {}

  @Get('courses')
  list(@CurrentSession() s: Session) {
    return this.svc.list(s.userId);
  }

  /** Batches the trainer leads or co-leads, with the course each one runs ("Assign to batches"). */
  @Get('course-batches')
  batches(@CurrentSession() s: Session) {
    return this.svc.myBatches(s.userId);
  }

  @Post('courses')
  create(@Body() dto: TrainerCourseCreateDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.create(actorOf(s, req), dto);
  }

  @Get('courses/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.svc.get(s.userId, id);
  }

  @Patch('courses/:id')
  async patch(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TrainerCoursePatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return pend(res, await this.svc.patch(actorOf(s, req), id, dto));
  }

  @Post('courses/:id/publish')
  @HttpCode(200)
  publish(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.svc.publish(actorOf(s, req), id);
  }

  @Post('courses/:id/unpublish')
  async unpublish(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() why: ChangeReasonDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return pend(res, await this.svc.unpublish(actorOf(s, req), id, why));
  }

  @Post('courses/:id/batches')
  @HttpCode(200)
  assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TrainerBatchesDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.assignBatches(actorOf(s, req), id, dto.batchIds);
  }

  @Delete('courses/:id/batches/:batchId')
  @HttpCode(204)
  async unassign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('batchId', new ParseUUIDPipe()) batchId: string,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    await this.svc.unassignBatch(actorOf(s, req), id, batchId);
  }

  @Post('courses/:id/co-editors')
  addCoEditor(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CoEditorDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.addCoEditor(actorOf(s, req), id, dto.email);
  }

  @Delete('courses/:id/co-editors/:userId')
  @HttpCode(204)
  async removeCoEditor(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    await this.svc.removeCoEditor(actorOf(s, req), id, userId);
  }

  @Get('courses/:id/students')
  students(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.svc.students(s.userId, id);
  }

  @Post('courses/:id/modules')
  async addModule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TrainerModuleDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return pend(res, await this.svc.addModule(actorOf(s, req), id, dto));
  }

  @Patch('modules/:id')
  async patchModule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TrainerModulePatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return pend(res, await this.svc.patchModule(actorOf(s, req), id, dto));
  }

  @Delete('modules/:id')
  @HttpCode(204)
  async deleteModule(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() why: ChangeReasonDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return pend(res, await this.svc.deleteModule(actorOf(s, req), id, why));
  }

  @Post('modules/:id/lessons')
  async addLesson(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TrainerLessonDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return pend(res, await this.svc.addLesson(actorOf(s, req), id, dto));
  }

  @Patch('lessons/:id')
  async patchLesson(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TrainerLessonPatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return pend(res, await this.svc.patchLesson(actorOf(s, req), id, dto));
  }

  @Delete('lessons/:id')
  @HttpCode(204)
  async deleteLesson(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() why: ChangeReasonDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return pend(res, await this.svc.deleteLesson(actorOf(s, req), id, why));
  }

  @Post('courses/:id/faqs')
  async addFaq(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TrainerFaqDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return pend(res, await this.svc.addFaq(actorOf(s, req), id, dto));
  }

  @Patch('faqs/:id')
  async patchFaq(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TrainerFaqPatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return pend(res, await this.svc.patchFaq(actorOf(s, req), id, dto));
  }

  @Delete('faqs/:id')
  @HttpCode(204)
  async deleteFaq(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() why: ChangeReasonDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return pend(res, await this.svc.deleteFaq(actorOf(s, req), id, why));
  }
}

/** Admin console → Courses → Change requests: trainer changes to published courses (owner, 29 Oct). */
@ApiTags('admin: courses')
@Controller('admin/course-changes')
@Roles('admin')
export class AdminCourseChangesController {
  constructor(private readonly svc: CourseChangesService) {}

  @Get()
  @RequirePermission('courses')
  list(@Query() q: CourseChangeQuery) {
    return this.svc.list(q.status);
  }

  @Post(':id/decide')
  @HttpCode(200)
  @RequirePermission('courses', 'Y')
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CourseChangeDecisionDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.svc.decide(id, dto.approve, dto.note, actorOf(s, req));
  }
}
