import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentSession, RequirePermission, Roles } from '../common/decorators/auth.decorators';
import { AppError } from '../common/errors/app-error';
import type { AppRequest } from '../common/http/request-context';
import { metaOf } from '../identity/http';
import {
  CareerPathDto,
  CareerQuizDto,
  CloseWeekDto,
  LeaderboardQuery,
  LedgerQuery,
  OnboardingDto,
  StreakDecisionDto,
  XpCorrectionDto,
} from './academy.dto';
import { CareerPathService } from './career-path.service';
import { GamificationService, type DailyKey } from './gamification.service';
import { istWeekStart } from './ist';
import { StudentDashboardService } from './student-dashboard.service';

type Session = NonNullable<AppRequest['session']>;

/** Cyber Command for the signed-in student. Identity always comes from the session, never from the request. */
@ApiTags('student: academy')
@Controller('student')
@Roles('student')
export class StudentAcademyController {
  constructor(
    private readonly game: GamificationService,
    private readonly dash: StudentDashboardService,
    private readonly career: CareerPathService,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentSession() s: Session) {
    return this.dash.dashboard(s.userId);
  }

  @Get('career-quiz')
  careerQuiz(@CurrentSession() s: Session) {
    return this.career.status(s.userId);
  }

  @Post('career-quiz')
  @HttpCode(201)
  takeCareerQuiz(@Body() dto: CareerQuizDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.career.take(s.userId, dto.answers, metaOf(req));
  }

  @Post('career-path')
  @HttpCode(200)
  chooseCareerPath(@Body() dto: CareerPathDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.career.choose(s.userId, dto.path, metaOf(req));
  }

  @Get('onboarding')
  onboarding(@CurrentSession() s: Session) {
    return this.dash.onboarding(s.userId);
  }

  @Post('onboarding/quiz')
  @HttpCode(201)
  submit(@Body() dto: OnboardingDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.dash.submitOnboarding(s.userId, dto.answers, metaOf(req));
  }

  @Get('streak')
  streak(@CurrentSession() s: Session) {
    return this.game.streak(s.userId);
  }

  @Post('streak/decision')
  @HttpCode(200)
  decide(@Body() dto: StreakDecisionDto, @CurrentSession() s: Session, @Req() req: AppRequest) {
    return this.game.decide(s.userId, dto.breakId, dto.decision, metaOf(req));
  }

  @Get('daily')
  daily(@CurrentSession() s: Session) {
    return this.game.daily(s.userId);
  }

  @Post('daily/:key/claim')
  @HttpCode(200)
  claim(@Param('key') key: string, @CurrentSession() s: Session) {
    if (!['learn', 'lab', 'read'].includes(key)) throw new AppError(404, 'NOT_FOUND', 'No such daily patch.');
    return this.game.claimDaily(s.userId, key as DailyKey);
  }

  @Get('weekly-ops')
  weekly(@CurrentSession() s: Session) {
    return this.game.weeklyOps(s.userId, true);
  }

  @Get('achievements')
  achievements(@CurrentSession() s: Session) {
    return this.game.achievements(s.userId);
  }

  @Get('leaderboard')
  leaderboard(@Query() q: LeaderboardQuery, @CurrentSession() s: Session) {
    return this.game.leaderboard(s.userId, q.tab ?? 'week');
  }

  @Get('xp')
  xp(@Query() q: LedgerQuery, @CurrentSession() s: Session) {
    return this.game.ledger(s.userId, q.limit, q.before);
  }
}

/** Admin LMS: XP history, corrections (reason required, audited) and the weekly league close. */
@ApiTags('admin: gamification')
@Controller('admin')
@Roles('admin')
export class AdminGamificationController {
  constructor(private readonly game: GamificationService) {}

  @Get('students/:id/xp')
  @RequirePermission('students')
  ledger(@Param('id', new ParseUUIDPipe()) id: string, @Query() q: LedgerQuery) {
    return this.game.ledger(id, q.limit, q.before);
  }

  @Post('students/:id/xp-corrections')
  @RequirePermission('gamification', 'Y')
  @HttpCode(201)
  correct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: XpCorrectionDto,
    @CurrentSession() s: Session,
    @Req() req: AppRequest,
  ) {
    return this.game.correct(id, dto.delta, dto.reason, { userId: s.userId, ...metaOf(req) });
  }

  @Post('league/close-week')
  @RequirePermission('gamification', 'Y')
  @HttpCode(200)
  close(@Body() dto: CloseWeekDto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.week) || dto.week >= istWeekStart())
      throw new AppError(400, 'VALIDATION_FAILED', 'Close only a past week (give its Monday, IST).', { field: 'week' });
    return this.game.closeWeek(dto.week);
  }
}
