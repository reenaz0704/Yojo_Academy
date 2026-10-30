import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentSession, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import { AppError } from '../common/errors/app-error';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import {
  AnswerStepDto,
  FlagDto,
  HintDto,
  MissionDto,
  MissionPatchDto,
  MissionQuery,
  QuizStepDto,
} from './missions.dto';
import { MissionsService } from './missions.service';

type Session = NonNullable<AppRequest['session']>;
const code = (c: string) => {
  if (!/^[A-Z0-9][A-Z0-9-]{1,23}$/.test(c)) throw new AppError(404, 'NOT_FOUND', 'No mission with that code.');
  return c;
};

/** Missions and the World Breach Map for the signed-in student. */
@ApiTags('student: missions')
@Controller('student')
@Roles('student')
export class StudentMissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Get('missions')
  list(@Query() q: MissionQuery, @CurrentSession() s: Session) {
    return this.missions.list(s.userId, q);
  }

  @Get('missions/:code')
  detail(@Param('code') c: string, @CurrentSession() s: Session) {
    return this.missions.detail(s.userId, code(c));
  }

  @Post('missions/:code/attempts')
  @HttpCode(200)
  start(@Param('code') c: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.missions.start(s.userId, code(c), metaOf(req));
  }

  @Post('missions/:code/hints')
  @HttpCode(200)
  hint(@Param('code') c: string, @CurrentSession() s: Session) {
    return this.missions.hint(s.userId, code(c));
  }

  @Post('missions/:code/submit')
  @HttpCode(200)
  submit(@Param('code') c: string, @Body() dto: FlagDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.missions.submit(s.userId, code(c), dto.flag, metaOf(req));
  }

  @Post('missions/:code/steps/:n/read')
  @HttpCode(200)
  read(
    @Param('code') c: string,
    @Param('n', ParseIntPipe) n: number,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.missions.readStep(s.userId, code(c), n, metaOf(req));
  }

  @Post('missions/:code/steps/:n/quiz')
  @HttpCode(200)
  quiz(
    @Param('code') c: string,
    @Param('n', ParseIntPipe) n: number,
    @Body() dto: QuizStepDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.missions.quizStep(s.userId, code(c), n, dto.answers, metaOf(req));
  }

  @Post('missions/:code/steps/:n/answer')
  @HttpCode(200)
  answer(
    @Param('code') c: string,
    @Param('n', ParseIntPipe) n: number,
    @Body() dto: AnswerStepDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.missions.answerStep(s.userId, code(c), n, dto.answer, metaOf(req));
  }

  @Get('missions/:code/lab')
  labSession(@Param('code') c: string, @CurrentSession() s: Session) {
    return this.missions.labSession(s.userId, code(c));
  }

  @Post('missions/:code/lab/start')
  @HttpCode(200)
  labStart(@Param('code') c: string, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.missions.labStart(s.userId, code(c), metaOf(req));
  }

  @Post('missions/:code/lab/stop')
  @HttpCode(200)
  labStop(@Param('code') c: string, @CurrentSession() s: Session) {
    return this.missions.labStop(s.userId, code(c));
  }

  @Post('missions/:code/abandon')
  @HttpCode(200)
  abandon(@Param('code') c: string, @CurrentSession() s: Session) {
    return this.missions.abandon(s.userId, code(c));
  }

  @Get('cities')
  cities(@CurrentSession() s: Session) {
    return this.missions.cities(s.userId);
  }
}

/** Admin LMS → missions (permission `labs`; answers with `labs.secrets`). */
@ApiTags('admin: missions')
@Controller('admin')
@Roles('admin')
export class AdminMissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Get('missions')
  @RequirePermission('labs')
  list() {
    return this.missions.adminList();
  }

  @Get('missions/:code')
  @RequirePermission('labs')
  one(@Param('code') code: string) {
    return this.missions.adminGet(code);
  }

  @Post('missions')
  @RequirePermission('labs', 'Y')
  create(@Body() dto: MissionDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.missions.create({ userId: s.userId, ...metaOf(req) }, dto);
  }

  @Patch('missions/:code')
  @RequirePermission('labs', 'Y')
  patch(@Param('code') c: string, @Body() dto: MissionPatchDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.missions.patch({ userId: s.userId, ...metaOf(req) }, code(c), dto);
  }

  @Put('missions/:code/flag')
  @RequirePermission('labs.secrets', 'Y')
  @HttpCode(200)
  flag(@Param('code') c: string, @Body() dto: FlagDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.missions.setFlag({ userId: s.userId, ...metaOf(req) }, code(c), dto.flag);
  }

  @Put('missions/:code/hints')
  @RequirePermission('labs', 'Y')
  @HttpCode(200)
  hint(@Param('code') c: string, @Body() dto: HintDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.missions.setHint({ userId: s.userId, ...metaOf(req) }, code(c), dto);
  }

  @Get('missions/:code/completions')
  @RequirePermission('labs')
  completions(@Param('code') c: string) {
    return this.missions.completions(code(c));
  }

  @Get('cities')
  @RequirePermission('labs')
  cities() {
    return this.missions.cityList();
  }
}
