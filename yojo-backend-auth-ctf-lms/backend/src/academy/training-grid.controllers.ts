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
import { ApiTags } from '@nestjs/swagger';
import { CurrentSession, RequirePermission, RequireReason, Roles } from '../common/decorators/auth.decorators';
import { AppError } from '../common/errors/app-error';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import {
  BatchReportQuery,
  BookDto,
  DecideLeaveDto,
  DecideRequestDto,
  HolidayDto,
  LeaveDto,
  MarksDto,
  MessageDto,
  RangeQuery,
  RespondDto,
  SessionDto,
  SessionPatchDto,
  SlotDto,
  StartConversationDto,
  VerifyCredentialsDto,
  WeekQuery,
} from './training-grid.dto';
import { TrainingGridService } from './training-grid.service';

type Session = NonNullable<AppRequest['session']>;
const actorOf = (s: Session, req: AppRequest) => ({ userId: s.userId, ...metaOf(req) });

/** Training Grid for the signed-in student. Only their own batches and records. */
@ApiTags('student: training grid')
@Controller('student')
@Roles('student')
export class StudentGridController {
  constructor(private readonly grid: TrainingGridService) {}

  @Get('attendance')
  attendance(@Query() q: RangeQuery, @CurrentSession() s: Session) {
    return this.grid.attendance(s.userId, q.from, q.to);
  }

  @Get('calendar')
  calendar(@Query() q: RangeQuery, @CurrentSession() s: Session) {
    return this.grid.calendar(s.userId, q.from, q.to);
  }

  @Get('schedule')
  schedule(@Query() q: WeekQuery, @CurrentSession() s: Session) {
    return this.grid.schedule(s.userId, q.week);
  }

  @Get('trainer')
  trainer(@CurrentSession() s: Session) {
    return this.grid.myTrainers(s.userId);
  }

  @Post('session-requests')
  @HttpCode(201)
  book(@Body() dto: BookDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.grid.book(s.userId, dto.slotId, dto.purpose, dto.note, metaOf(req));
  }

  @Post('session-requests/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.grid.cancelRequest(s.userId, id);
  }

  @Post('session-requests/:id/respond')
  @HttpCode(200)
  respond(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: RespondDto, @CurrentSession() s: Session) {
    return this.grid.respondProposal(s.userId, id, dto.accept);
  }

  @Post('leave-requests')
  @HttpCode(201)
  leave(@Body() dto: LeaveDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.grid.requestLeave(s.userId, dto.from, dto.to, dto.reason, metaOf(req));
  }

  @Post('leave-requests/:id/withdraw')
  @HttpCode(200)
  withdraw(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.grid.withdrawLeave(s.userId, id);
  }

  @Get('conversations')
  conversations(@CurrentSession() s: Session) {
    return this.grid.conversations(s.userId, 'student');
  }

  @Post('conversations')
  @HttpCode(201)
  start(@Body() dto: StartConversationDto, @CurrentSession() s: Session) {
    return this.grid.startConversation(s.userId, dto.staffId, dto.subject, dto.body);
  }

  @Get('conversations/:id')
  thread(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.grid.thread(s.userId, id);
  }

  @Post('conversations/:id/messages')
  @HttpCode(201)
  send(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: MessageDto, @CurrentSession() s: Session) {
    return this.grid.send(s.userId, id, dto.body);
  }
}

/** Trainer LMS: own batches only (lead or co-trainer). */
@ApiTags('trainer: training grid')
@Controller('trainer')
@Roles('trainer')
export class TrainerGridController {
  constructor(private readonly grid: TrainingGridService) {}

  @Get('sessions')
  sessions(@Query() q: RangeQuery, @CurrentSession() s: Session) {
    return this.grid.trainerSessions(s.userId, q.from, q.to);
  }

  @Post('sessions')
  create(@Body() dto: SessionDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.grid.createSession(actorOf(s, req), dto);
  }

  @Patch('sessions/:id')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SessionPatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.grid.updateSession(actorOf(s, req), id, dto);
  }

  @Get('sessions/:id/attendance')
  roster(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.grid.roster(actorOf(s, req), id);
  }

  @Put('sessions/:id/attendance')
  mark(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MarksDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.grid.mark(actorOf(s, req), id, dto.marks, dto.reason);
  }

  @Get('slots')
  slots(@CurrentSession() s: Session) {
    return this.grid.slots(s.userId);
  }

  @Post('slots')
  addSlot(@Body() dto: SlotDto, @CurrentSession() s: Session) {
    return this.grid.addSlot(s.userId, dto.startsAt, dto.endsAt, dto.kind ?? 'one_to_one');
  }

  @Delete('slots/:id')
  @HttpCode(204)
  async removeSlot(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    await this.grid.removeSlot(s.userId, id);
  }

  @Get('session-requests')
  requests(@CurrentSession() s: Session) {
    return this.grid.trainerRequests(s.userId);
  }

  @Post('session-requests/:id/decide')
  @HttpCode(200)
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideRequestDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.grid.decideRequest(actorOf(s, req), id, dto.decision, dto.note, dto.proposedStart);
  }

  @Get('leave-requests')
  leave(@CurrentSession() s: Session) {
    return this.grid.trainerLeave(s.userId);
  }

  @Post('leave-requests/:id/decide')
  @HttpCode(200)
  decideLeave(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideLeaveDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.grid.decideLeave(actorOf(s, req), id, dto.approve, dto.note);
  }

  @Get('conversations')
  conversations(@CurrentSession() s: Session) {
    return this.grid.conversations(s.userId, 'staff');
  }

  @Get('conversations/:id')
  thread(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session) {
    return this.grid.thread(s.userId, id);
  }

  @Post('conversations/:id/messages')
  @HttpCode(201)
  send(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: MessageDto, @CurrentSession() s: Session) {
    return this.grid.send(s.userId, id, dto.body);
  }
}

/** Admin LMS: sessions for any batch, attendance corrections at any time, reports, holidays, trainer credentials. */
@ApiTags('admin: training grid')
@Controller('admin')
@Roles('admin')
export class AdminGridController {
  constructor(private readonly grid: TrainingGridService) {}

  @Post('sessions')
  @RequirePermission('batches', 'Y')
  create(@Body() dto: SessionDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.grid.createSession(actorOf(s, req), dto, true);
  }

  @Patch('sessions/:id')
  @RequirePermission('batches', 'Y')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SessionPatchDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.grid.updateSession(actorOf(s, req), id, dto, true);
  }

  @Get('sessions/:id/attendance')
  @RequirePermission('attendance.view')
  roster(@Param('id', new ParseUUIDPipe()) id: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.grid.roster(actorOf(s, req), id, true);
  }

  @Put('sessions/:id/attendance')
  @RequirePermission('attendance.edit', 'Y')
  @RequireReason()
  mark(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MarksDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.grid.mark(actorOf(s, req), id, dto.marks, dto.reason, true);
  }

  @Get('attendance/report')
  @RequirePermission('attendance.view')
  report(@Query() q: BatchReportQuery) {
    return this.grid.batchReport(q.batchId, q.from, q.to);
  }

  @Post('leave-requests/:id/decide')
  @RequirePermission('attendance.edit', 'Y')
  @HttpCode(200)
  decideLeave(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideLeaveDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.grid.decideLeave(actorOf(s, req), id, dto.approve, dto.note, true);
  }

  @Get('holidays')
  @RequirePermission('attendance.view')
  holidays() {
    return this.grid.holidays();
  }

  @Post('holidays')
  @RequirePermission('attendance.edit', 'Y')
  addHoliday(@Body() dto: HolidayDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.grid.addHoliday(actorOf(s, req), dto.day, dto.name);
  }

  @Delete('holidays/:day')
  @RequirePermission('attendance.edit', 'Y')
  @HttpCode(204)
  async removeHoliday(@Param('day') day: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new AppError(404, 'NOT_FOUND', 'No holiday on that day.');
    await this.grid.removeHoliday(actorOf(s, req), day);
  }

  @Post('trainers/:id/credentials')
  @RequirePermission('staff', 'Y')
  @HttpCode(200)
  verify(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyCredentialsDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.grid.verifyCredentials(actorOf(s, req), id, dto.verified);
  }
}
